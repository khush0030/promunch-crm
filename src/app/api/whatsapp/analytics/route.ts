import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// WhatsApp analytics summary — built for non-technical employees, not devs.
// Every number ships with a plain-English meaning + a verdict the frontend can
// show. This is Layer 1: headline strip, delivery funnel, failure translator,
// rough spend + revenue. Click/conversion attribution lands in Layer 2.
// ---------------------------------------------------------------------------

// Approx Meta India per-message price (INR) by template category. Marketing is
// the big cost driver; utility/auth are cheap; in-window free text is free.
// These are estimates for directional cost — edit to match the Meta invoice.
const PRICE: Record<string, number> = {
  marketing: 0.78,
  offer: 0.78,
  utility: 0.115,
  authentication: 0.115,
  service: 0,
};

const BILLED = ["sent", "delivered", "read"]; // a message is charged once it leaves us

// Plain-English meaning for each failure category from explainWaError().
const FAIL_INFO: Record<
  string,
  { title: string; willRetry: boolean; action: string; tone: "r" | "a" | "b" }
> = {
  auth: {
    title: "WhatsApp connection problem",
    willRetry: false,
    action: "The WhatsApp access token needs refreshing. All sends are blocked until this is fixed.",
    tone: "r",
  },
  template: {
    title: "Template problem",
    willRetry: false,
    action: "A template was paused, rejected, or sent with wrong fields. Check the Templates tab.",
    tone: "r",
  },
  rate: {
    title: "Meta is slowing us down",
    willRetry: true,
    action: "We sent too fast. These retry on their own — no action needed.",
    tone: "a",
  },
  system: {
    title: "Meta server hiccup",
    willRetry: true,
    action: "A temporary error on Meta's side. These retry automatically.",
    tone: "a",
  },
  deliverability: {
    title: "Could not be delivered",
    willRetry: false,
    action: "The person is not on WhatsApp, blocked us, or the daily marketing limit was hit. This is normal.",
    tone: "b",
  },
  unknown: {
    title: "Unrecognised issue",
    willRetry: false,
    action: "Open the message to see Meta's reason.",
    tone: "a",
  },
};

function istTodayStartISO(): string {
  const IST = 5.5 * 60 * 60 * 1000;
  const ist = new Date(Date.now() + IST);
  const midnightUtcMs = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST;
  return new Date(midnightUtcMs).toISOString();
}

export async function GET(req: NextRequest) {
  const days = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 30));
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const todayStart = istTodayStartISO();

  // Small helper: head-only COUNT on outbound wa_messages.
  const outCount = async (statuses: string[] | null, from = since) => {
    let q = supabaseAdmin
      .from("wa_messages")
      .select("*", { count: "exact", head: true })
      .eq("direction", "outbound")
      .gte("created_at", from);
    if (statuses) q = q.in("status", statuses);
    const { count } = await q;
    return count ?? 0;
  };
  const inCount = async (from = since) => {
    const { count } = await supabaseAdmin
      .from("wa_messages")
      .select("*", { count: "exact", head: true })
      .eq("direction", "inbound")
      .gte("created_at", from);
    return count ?? 0;
  };

  // --- counts (parallel) ---
  const [
    sent,
    delivered,
    read,
    failed,
    replies,
    sentToday,
    repliesToday,
  ] = await Promise.all([
    outCount(BILLED),
    outCount(["delivered", "read"]),
    outCount(["read"]),
    outCount(["failed"]),
    inCount(),
    outCount(BILLED, todayStart),
    inCount(todayStart),
  ]);

  // --- spend by template category ---
  const spend = await estimateSpend(since);

  // --- revenue attribution (orders-first, bounded by order volume) ---
  const { orders, revenue } = await attributeRevenue(since);

  // --- failure translator ---
  const failures = await summariseFailures(since);

  // --- link clicks (free-text tracked links; 0 if table not migrated yet) ---
  const clicks = await countClicks(since);

  // --- derived ---
  const deliveredPct = sent ? Math.round((delivered / sent) * 100) : 0;
  const readPct = sent ? Math.round((read / sent) * 100) : 0;
  const failedPct = sent + failed ? Math.round((failed / (sent + failed)) * 100) : 0;
  const roi = spend > 0 ? revenue / spend : null;

  // Health: red if a blocking failure category is present, amber on high
  // failure rate, else green.
  const hasBlocker = failures.groups.some((g) => g.tone === "r" && g.count > 0);
  const health =
    hasBlocker
      ? { tone: "r", label: "Needs attention", note: "Some sends are blocked — see failures below." }
      : failedPct > 20
      ? { tone: "a", label: "Watch", note: `${failedPct}% of sends failed in this period.` }
      : { tone: "g", label: "Healthy", note: "Delivery is running normally." };

  // Funnel: people/messages moving from sent → bought. Clicked is Layer 2.
  const funnel = [
    { key: "sent", label: "Messages sent", count: sent, pct: 100, unit: "messages" },
    { key: "delivered", label: "Delivered", count: delivered, pct: deliveredPct, unit: "messages" },
    { key: "read", label: "Read", count: read, pct: readPct, unit: "messages" },
    { key: "replied", label: "Replies received", count: replies, pct: sent ? Math.round((replies / sent) * 100) : 0, unit: "replies" },
    { key: "clicked", label: "Link clicks", count: clicks, pct: sent ? Math.round((clicks / sent) * 100) : 0, unit: "clicks" },
    { key: "bought", label: "Orders", count: orders, pct: sent ? Math.round((orders / sent) * 100) : 0, unit: "orders" },
  ];

  return NextResponse.json({
    window: { days, since },
    headline: {
      sent,
      delivered,
      deliveredPct,
      read,
      readPct,
      replies,
      orders,
      revenue,
      spend,
      roi,
    },
    today: { sent: sentToday, replies: repliesToday },
    funnel,
    failures,
    health,
  });
}

async function countClicks(since: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("wa_link_clicks")
    .select("*", { count: "exact", head: true })
    .gte("clicked_at", since);
  if (error) return 0; // table not migrated yet → degrade to 0
  return count ?? 0;
}

async function estimateSpend(since: string): Promise<number> {
  const { data: tpls } = await supabaseAdmin.from("wa_templates").select("name,category");
  const namesByCat: Record<string, string[]> = {};
  (tpls ?? []).forEach((t: { name: string; category: string }) => {
    (namesByCat[t.category] ||= []).push(t.name);
  });
  let spend = 0;
  for (const [cat, names] of Object.entries(namesByCat)) {
    const price = PRICE[cat] ?? 0;
    if (!price || !names.length) continue;
    const { count } = await supabaseAdmin
      .from("wa_messages")
      .select("*", { count: "exact", head: true })
      .eq("direction", "outbound")
      .in("status", BILLED)
      .gte("created_at", since)
      .in("template_name", names);
    spend += (count ?? 0) * price;
  }
  return Math.round(spend * 100) / 100;
}

// Attribute orders to WhatsApp: customers we messaged in the window who then
// placed an order in the window. Orders link to a WhatsApp contact by
// customer_phone (a normalised wa_id, same shape as wa_contacts.wa_id — see the
// RFM rollup). HYPD creator seeds (₹0.01, is_creator) and refunded/voided
// orders are excluded. Loose (not click-through) but defensible.
type OrderRow = { customer_phone: string | null; total_price: number | string; financial_status: string | null; is_creator: boolean | null };
function liveOrders(rows: OrderRow[] | null): OrderRow[] {
  return (rows ?? []).filter(
    (o) => o.customer_phone && !o.is_creator &&
      o.financial_status !== "refunded" && o.financial_status !== "voided"
  );
}

async function attributeRevenue(since: string): Promise<{ orders: number; revenue: number }> {
  const { data: ordRows } = await supabaseAdmin
    .from("shopify_orders")
    .select("customer_phone,total_price,financial_status,is_creator")
    .gte("shopify_created_at", since)
    .not("customer_phone", "is", null)
    .limit(1000);
  const live = liveOrders(ordRows as OrderRow[]);
  if (!live.length) return { orders: 0, revenue: 0 };

  const phones = [...new Set(live.map((o) => o.customer_phone!))];
  // wa_contacts for those phones → their internal ids
  const { data: waC } = await supabaseAdmin
    .from("wa_contacts")
    .select("id,wa_id")
    .in("wa_id", phones);
  const idToPhone = new Map<string, string>();
  (waC ?? []).forEach((w: { id: string; wa_id: string }) => idToPhone.set(w.id, w.wa_id));
  if (!idToPhone.size) return { orders: 0, revenue: 0 };

  // which of those contacts got an outbound message in the window
  const { data: msgged } = await supabaseAdmin
    .from("wa_messages")
    .select("contact_id")
    .eq("direction", "outbound")
    .gte("created_at", since)
    .in("contact_id", [...idToPhone.keys()]);
  const engagedPhones = new Set<string>();
  (msgged ?? []).forEach((m: { contact_id: string }) => {
    const p = idToPhone.get(m.contact_id);
    if (p) engagedPhones.add(p);
  });
  if (!engagedPhones.size) return { orders: 0, revenue: 0 };

  const matched = live.filter((o) => engagedPhones.has(o.customer_phone!));
  const revenue = matched.reduce((s, o) => s + Number(o.total_price || 0), 0);
  return { orders: matched.length, revenue: Math.round(revenue) };
}

async function summariseFailures(since: string) {
  const { data: rows } = await supabaseAdmin
    .from("wa_messages")
    .select("ai_meta")
    .eq("direction", "outbound")
    .eq("status", "failed")
    .gte("created_at", since)
    .limit(3000);
  const buckets = new Map<string, { count: number; cause: string }>();
  (rows ?? []).forEach((r: { ai_meta: { category?: string; cause?: string } | null }) => {
    const cat = r.ai_meta?.category || "unknown";
    const b = buckets.get(cat) || { count: 0, cause: r.ai_meta?.cause || "" };
    b.count += 1;
    if (!b.cause && r.ai_meta?.cause) b.cause = r.ai_meta.cause;
    buckets.set(cat, b);
  });
  const groups = [...buckets.entries()]
    .map(([category, b]) => {
      const info = FAIL_INFO[category] || FAIL_INFO.unknown;
      return {
        category,
        title: info.title,
        cause: b.cause,
        count: b.count,
        willRetry: info.willRetry,
        action: info.action,
        tone: info.tone,
      };
    })
    .sort((a, b) => b.count - a.count);
  return { total: (rows ?? []).length, groups };
}
