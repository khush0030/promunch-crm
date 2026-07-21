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
type OrderRow = { customer_phone: string | null; total_price: number | string; financial_status: string | null; is_creator: boolean | null; shopify_created_at: string };
function liveOrders(rows: OrderRow[] | null): OrderRow[] {
  return (rows ?? []).filter(
    (o) => o.customer_phone && !o.is_creator &&
      o.financial_status !== "refunded" && o.financial_status !== "voided"
  );
}

// Pull every row of a query, 1000 at a time (PostgREST silently caps a single
// response at 1000 rows — an unpaged read here undercounts as soon as the
// window holds more than that; 30 days is already ~6k outbound messages).
async function pageAll<T>(mk: () => any, cap = 60000): Promise<T[]> {
  const size = 1000;
  let from = 0;
  const out: T[] = [];
  for (;;) {
    const { data, error } = await mk().range(from, from + size - 1);
    if (error || !data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < size || from >= cap) break;
    from += size;
  }
  return out;
}

// A long .in() list overflows the PostgREST query string — chunk it.
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function attributeRevenue(since: string): Promise<{ orders: number; revenue: number }> {
  const ordRows = await pageAll<OrderRow>(() =>
    supabaseAdmin
      .from("shopify_orders")
      .select("customer_phone,total_price,financial_status,is_creator,shopify_created_at")
      .gte("shopify_created_at", since)
      .not("customer_phone", "is", null)
  );
  const live = liveOrders(ordRows);
  if (!live.length) return { orders: 0, revenue: 0 };

  const phones = [...new Set(live.map((o) => o.customer_phone!))];
  // wa_contacts for those phones → their internal ids
  const idToPhone = new Map<string, string>();
  for (const slice of chunk(phones, 200)) {
    const { data: waC } = await supabaseAdmin
      .from("wa_contacts")
      .select("id,wa_id")
      .in("wa_id", slice);
    (waC ?? []).forEach((w: { id: string; wa_id: string }) => idToPhone.set(w.id, w.wa_id));
  }
  if (!idToPhone.size) return { orders: 0, revenue: 0 };

  // Earliest outbound message per contact in the window. An order only counts
  // as WhatsApp-influenced when a message PRECEDED it — otherwise the order
  // confirmation we send for every purchase "attributes" its own order and the
  // headline claims nearly all store revenue (measured: 343 of 365 orders).
  const firstMsgAt = new Map<string, number>(); // phone → earliest outbound (epoch ms)
  for (const slice of chunk([...idToPhone.keys()], 200)) {
    const msgged = await pageAll<{ contact_id: string; created_at: string }>(() =>
      supabaseAdmin
        .from("wa_messages")
        .select("contact_id,created_at")
        .eq("direction", "outbound")
        .gte("created_at", since)
        .in("contact_id", slice)
    );
    msgged.forEach((m) => {
      const p = idToPhone.get(m.contact_id);
      if (!p) return;
      const t = new Date(m.created_at).getTime();
      const cur = firstMsgAt.get(p);
      if (cur == null || t < cur) firstMsgAt.set(p, t);
    });
  }
  if (!firstMsgAt.size) return { orders: 0, revenue: 0 };

  const matched = live.filter((o) => {
    const at = firstMsgAt.get(o.customer_phone!);
    return at != null && at < new Date(o.shopify_created_at).getTime();
  });
  const revenue = matched.reduce((s, o) => s + Number(o.total_price || 0), 0);
  return { orders: matched.length, revenue: Math.round(revenue) };
}

// Fallback classification straight from the raw Meta error text, for rows the
// send path didn't stamp with ai_meta.category (everything before Jul 2026 —
// without this the whole panel collapsed into "unknown").
function categoryFromErrorText(err: string | null): { category: string; cause: string } | null {
  if (!err) return null;
  const m = err.toLowerCase();
  if (/131049|healthy ecosystem|131050|130472|experiment/.test(m))
    return { category: "deliverability", cause: "Meta's per-user marketing frequency cap (or experiment holdout) — the contact retries on a later day where possible." };
  if (/131026|undeliverable|media upload/.test(m))
    return { category: "deliverability", cause: "Recipient can't receive — number not on WhatsApp, or Meta couldn't fetch the header media." };
  if (/oauthexception|access token|\(#190\)/.test(m))
    return { category: "auth", cause: "WhatsApp access token expired or invalid." };
  if (/132\d{3}|template/.test(m))
    return { category: "template", cause: "Template paused, missing, or sent with mismatched fields." };
  if (/131048|130429|80007|131056|rate limit|too many/.test(m))
    return { category: "rate", cause: "Meta rate-limited the number." };
  if (/^http 5/.test(m))
    return { category: "system", cause: "Meta API server error (5xx)." };
  return null;
}

async function summariseFailures(since: string) {
  const { data: rows } = await supabaseAdmin
    .from("wa_messages")
    .select("ai_meta,error")
    .eq("direction", "outbound")
    .eq("status", "failed")
    .gte("created_at", since)
    .limit(3000);
  const buckets = new Map<string, { count: number; cause: string }>();
  (rows ?? []).forEach((r: { ai_meta: { category?: string; cause?: string } | null; error: string | null }) => {
    const fallback = r.ai_meta?.category ? null : categoryFromErrorText(r.error);
    const cat = r.ai_meta?.category || fallback?.category || "unknown";
    const cause = r.ai_meta?.cause || fallback?.cause || "";
    const b = buckets.get(cat) || { count: 0, cause };
    b.count += 1;
    if (!b.cause && cause) b.cause = cause;
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
