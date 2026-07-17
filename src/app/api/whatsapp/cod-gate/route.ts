import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/rbac-server";
import { recordAudit } from "@/lib/audit";

// COD confirmation gate — dashboard needs-call queue + manual confirm/cancel.
// GET returns gate-managed orders (confirmation_status non-null, i.e. the
// order actually went through the gate) for the Task 10 UI. POST proxies to
// the cod-gate-action edge function (service-role auth), mirroring the same
// confirm/cancel logic the customer's WhatsApp buttons trigger, but with
// confirmed_via="manual" — no outbound WhatsApp message is sent.

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET() {
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("shopify_orders")
    .select("shopify_id, order_number, customer_name, customer_phone, total_price, currency, confirmation_status, confirmation_sent_at, confirmed_at, confirmed_via, shopify_created_at")
    .not("confirmation_status", "is", null)
    .gte("shopify_created_at", since)
    .order("shopify_created_at", { ascending: false })
    .limit(300);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ orders: data ?? [] });
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => null);
  const shopifyId = String((body as Record<string, unknown> | null)?.shopify_id ?? "");
  const action = String((body as Record<string, unknown> | null)?.action ?? "");
  if (!/^\d+$/.test(shopifyId) || !["confirm", "cancel"].includes(action)) {
    return NextResponse.json({ error: "shopify_id + action (confirm|cancel) required" }, { status: 400 });
  }

  const r = await fetch(`${SUPABASE_URL}/functions/v1/cod-gate-action`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ shopify_id: shopifyId, action }),
  });
  const out = await r.json().catch(() => ({ error: "bad edge response" }));

  if (r.ok) {
    await recordAudit({
      action: `cod_gate.${action}`,
      entityType: "shopify_order",
      entityId: shopifyId,
      summary: `COD gate ${action} for order ${shopifyId} (manual)`,
      request: req,
      actor: gate.user,
    });
  }

  return NextResponse.json(out, { status: r.ok ? 200 : 502 });
}
