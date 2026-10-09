import { supabaseAdmin } from "@/lib/supabase-admin";

// One definition of "orders a WhatsApp campaign earned", shared by the
// campaign report tiles (/api/whatsapp/analytics/campaigns) and the journey
// card (/api/whatsapp/campaigns/[id]/journey) so the two never disagree.
//
// Last-touch, 7 days: each order is credited to the ONE most recent campaign
// touch before it, where a touch is that recipient's own delivered/read send
// (not the campaign's start time: a multi-day campaign reaches people days
// apart) and the order lands within ATTRIBUTION_WINDOW_DAYS of it.
// Sent-but-undelivered and failed messages never earn credit. HYPD creator
// seeds and refunded/voided orders never count.
export const ATTRIBUTION_WINDOW_DAYS = 7;

// Ids per .in() lookup. 500 uuids made the request URL ~18KB, past the
// PostgREST/proxy limit, so the lookup failed silently and no phone matched.
export const ID_BATCH = 150;

export type Touch = { campaignId: string; phone: string; at: number };
export type AttributableOrder = { phone: string; at: number; total: number };
export type Attribution = Map<string, { orders: number; revenue: number }>;

export function attributeOrders(
  touches: Touch[],
  orders: AttributableOrder[],
  windowDays = ATTRIBUTION_WINDOW_DAYS,
): Attribution {
  const byPhone = new Map<string, Touch[]>();
  for (const t of touches) {
    const list = byPhone.get(t.phone) ?? [];
    list.push(t);
    byPhone.set(t.phone, list);
  }
  const windowMs = windowDays * 86400000;
  const out: Attribution = new Map();
  for (const o of orders) {
    let winner: Touch | null = null;
    for (const t of byPhone.get(o.phone) ?? []) {
      if (t.at > o.at || o.at - t.at > windowMs) continue;
      if (!winner || t.at > winner.at) winner = t;
    }
    if (!winner) continue;
    const r = out.get(winner.campaignId) ?? { orders: 0, revenue: 0 };
    r.orders++;
    r.revenue += o.total;
    out.set(winner.campaignId, r);
  }
  return out;
}

// Pull every row of a query, 1000 at a time (PostgREST page cap). `mk` returns
// a fresh query builder each call so .range() applies cleanly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function pageAll<T>(mk: () => any, cap = 60000): Promise<T[]> {
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

export type CampaignMsg = { campaign_id: string; contact_id: string | null; status: string; created_at: string };

// Delivered/read campaign sends since `since` turned into touches. `phoneOf`
// maps wa_contacts.id -> wa_id (= shopify_orders.customer_phone).
export function touchesFrom(msgs: CampaignMsg[], phoneOf: (contactId: string) => string | null | undefined): Touch[] {
  const out: Touch[] = [];
  for (const m of msgs) {
    if (m.status !== "delivered" && m.status !== "read") continue;
    if (!m.contact_id) continue;
    const phone = phoneOf(m.contact_id);
    if (!phone) continue;
    out.push({ campaignId: m.campaign_id, phone, at: new Date(m.created_at).getTime() });
  }
  return out;
}

// Paid, non-creator orders placed since `since`, ready for attributeOrders.
export async function loadAttributableOrders(since: string): Promise<AttributableOrder[]> {
  type Ord = { customer_phone: string; total_price: number | string; shopify_created_at: string; financial_status: string | null; is_creator: boolean | null };
  const rows = await pageAll<Ord>(() =>
    supabaseAdmin
      .from("shopify_orders")
      .select("customer_phone,total_price,shopify_created_at,financial_status,is_creator").order("id", { ascending: true })
      .gte("shopify_created_at", since)
      .not("customer_phone", "is", null)
  );
  return rows
    .filter((o) => !o.is_creator && o.financial_status !== "refunded" && o.financial_status !== "voided")
    .map((o) => ({ phone: o.customer_phone, at: new Date(o.shopify_created_at).getTime(), total: Number(o.total_price || 0) }));
}

// wa_contacts.id -> wa_id for the given contact ids.
export async function loadContactPhones(contactIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (let i = 0; i < contactIds.length; i += ID_BATCH) {
    const { data } = await supabaseAdmin.from("wa_contacts").select("id,wa_id").in("id", contactIds.slice(i, i + ID_BATCH));
    (data ?? []).forEach((w: { id: string; wa_id: string | null }) => out.set(w.id, w.wa_id));
  }
  return out;
}

// Full attribution for every campaign touch since `since`. A touch before
// `since` can never beat one after it for an order placed after `since`, so
// callers only need `since` <= the earliest campaign they report on.
export async function loadCampaignAttribution(since: string): Promise<Attribution> {
  const msgs = await pageAll<CampaignMsg>(() =>
    supabaseAdmin
      .from("wa_messages")
      .select("campaign_id,contact_id,status,created_at").order("id", { ascending: true })
      .eq("direction", "outbound")
      .not("campaign_id", "is", null)
      .in("status", ["delivered", "read"])
      .gte("created_at", since)
  );
  const ids = [...new Set(msgs.map((m) => m.contact_id).filter(Boolean))] as string[];
  const [phones, orders] = await Promise.all([loadContactPhones(ids), loadAttributableOrders(since)]);
  return attributeOrders(touchesFrom(msgs, (id) => phones.get(id)), orders);
}
