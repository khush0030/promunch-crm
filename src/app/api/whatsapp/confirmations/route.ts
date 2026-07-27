import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// WhatsApp order-confirmation coverage.
//
// GET  — every Shopify order in the window, each tagged sent / not-sent /
//        failed / no-phone / cancelled, plus a coverage %. shopify_orders is
//        the source of truth (filled by shopify-webhook on every order); we
//        diff it against the confirmation_sent events shopify-wa logs.
// POST — trigger the wa-confirmation-sweep edge function. Body {orders:[...]}
//        force-sends those exact orders; empty body runs the normal sweep.

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type OrderStatus = "sent" | "missing" | "failed" | "gave_up" | "no_phone" | "cancelled";

const norm = (s: unknown) => String(s ?? "").trim().replace(/^#/, "");

// Every template name that counts as a delivered order confirmation. Mirrors
// confirmationTemplateNames() in supabase/functions/_shared/confirmations.ts:
// the fixed history set plus whatever the Flows tab currently points
// first/returning at — the UI must never disagree with the send-path dedup.
async function confirmationTemplateNames(): Promise<string[]> {
  const base = [
    "order_confirmation", "order_confirmation_v2", "order_verify_v1",
    "order_confirmation_repeat_v1",
  ];
  try {
    const { data } = await supabaseAdmin
      .from("wa_flow_settings")
      .select("confirmation_template_first, confirmation_template_repeat")
      .eq("id", 1).maybeSingle();
    return [...new Set([
      ...base,
      ...[data?.confirmation_template_first, data?.confirmation_template_repeat]
        .map((n) => String(n ?? "").trim()).filter(Boolean),
    ])];
  } catch {
    return base;
  }
}

export async function GET(req: NextRequest) {
  const raw = Number(new URL(req.url).searchParams.get("hours"));
  const hours = Math.min(Math.max(Number.isFinite(raw) ? raw : 24, 1), 720);
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  // events can land slightly after the order — widen the event lookback
  const evSince = new Date(Date.now() - (hours + 48) * 3600_000).toISOString();

  const [ordersRes, eventsRes, msgsRes] = await Promise.all([
    supabaseAdmin
      .from("shopify_orders")
      .select("order_number, customer_name, customer_phone, total_price, currency, financial_status, raw, shopify_created_at")
      .gte("shopify_created_at", since)
      .order("shopify_created_at", { ascending: false })
      .limit(500),
    supabaseAdmin
      .from("connector_events")
      .select("event, ref, message, created_at")
      .eq("connector", "shopify_wa")
      .in("event", ["confirmation_failed", "confirmation_resend_failed", "confirmation_gave_up", "no_phone"])
      .gte("created_at", evSince)
      .order("created_at", { ascending: false }),
    // wa_messages — the transactional message ledger; the source of truth for
    // "this order's confirmation was actually delivered". Same record the
    // send paths dedup against, so the UI never disagrees with them.
    supabaseAdmin
      .from("wa_messages")
      .select("template_vars, status, created_at")
      // order_verify_v1 (COD gate) IS the order confirmation for gated orders —
      // without it here the dashboard would show them as "missing".
      .in("template_name", await confirmationTemplateNames())
      .gte("created_at", evSince),
  ]);

  if (ordersRes.error) return NextResponse.json({ error: ordersRes.error.message }, { status: 500 });

  // delivered confirmations keyed by normalised order ref (template var "2").
  // wa_messages.status lifecycle: "sent" → "delivered" → "read" — any of
  // those means the customer got it; "failed" / "pending" mean they didn't.
  const DELIVERED = new Set(["sent", "delivered", "read"]);
  const sentByRef = new Map<string, string>();
  for (const m of msgsRes.data ?? []) {
    if (!DELIVERED.has(String(m.status))) continue;
    const r = norm((m.template_vars as Record<string, unknown> | null)?.["2"]);
    if (!r) continue;
    const prev = sentByRef.get(r);
    if (!prev || (m.created_at as string) < prev) sentByRef.set(r, m.created_at as string);
  }

  // events grouped by normalised order number, newest first
  const evByRef = new Map<string, { event: string; message: string | null; created_at: string }[]>();
  for (const e of eventsRes.data ?? []) {
    const r = norm(e.ref);
    if (!r) continue;
    (evByRef.get(r) ?? evByRef.set(r, []).get(r)!).push(e);
  }

  const orders = (ordersRes.data ?? []).map((o) => {
    const ref = norm(o.order_number);
    const rawOrder = (o.raw ?? {}) as Record<string, unknown>;
    const nameFrom = (src: any): string | null =>
      (src && ([src.first_name, src.last_name].filter(Boolean).join(" ").trim() || (typeof src.name === "string" ? src.name.trim() : ""))) || null;
    const customerName =
      o.customer_name ||
      nameFrom(rawOrder.customer) ||
      nameFrom(rawOrder.shipping_address) ||
      nameFrom(rawOrder.billing_address) ||
      null;
    const fin = String(o.financial_status ?? rawOrder.financial_status ?? "").toLowerCase();
    const cancelled = !!rawOrder.cancelled_at || fin === "voided" || fin === "refunded";
    const evs = evByRef.get(ref) ?? [];
    const has = (name: string) => evs.find((e) => e.event === name);

    const sentAt = sentByRef.get(ref) ?? null;
    let status: OrderStatus;
    let detail: string | null = null;
    if (cancelled) {
      status = "cancelled";
    } else if (sentAt) {
      status = "sent";
    } else if (has("confirmation_gave_up")) {
      status = "gave_up";
      detail = has("confirmation_gave_up")!.message;
    } else if (!o.customer_phone || has("no_phone")) {
      status = "no_phone";
    } else if (has("confirmation_resend_failed") || has("confirmation_failed")) {
      status = "failed";
      detail = (has("confirmation_resend_failed") ?? has("confirmation_failed"))!.message;
    } else {
      status = "missing";
    }

    return {
      order_number: o.order_number,
      customer_name: customerName,
      phone: o.customer_phone,
      total: o.total_price,
      currency: o.currency,
      created_at: o.shopify_created_at,
      status,
      detail,
      confirmed_at: sentAt,
    };
  });

  const count = (s: OrderStatus) => orders.filter((o) => o.status === s).length;
  const sent = count("sent");
  const cancelled = count("cancelled");
  const noPhone = count("no_phone");
  const outstanding = count("missing") + count("failed") + count("gave_up");
  // "eligible" = orders we actually can and should confirm
  const eligible = orders.length - cancelled - noPhone;

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    hours,
    summary: {
      total: orders.length,
      sent,
      outstanding,
      noPhone,
      cancelled,
      coveragePct: eligible > 0 ? Math.round((sent / eligible) * 1000) / 10 : 100,
    },
    orders,
  });
}

export async function POST(req: NextRequest) {
  let body: { orders?: unknown } = {};
  try { body = await req.json(); } catch { /* empty body — full sweep */ }

  const orders = Array.isArray(body.orders)
    ? body.orders.map((o) => String(o)).filter(Boolean)
    : [];
  const payload = orders.length > 0 ? { orders } : {};

  const res = await fetch(`${SUPABASE_URL}/functions/v1/wa-confirmation-sweep`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  return NextResponse.json(data, { status: res.ok ? 200 : 502 });
}
