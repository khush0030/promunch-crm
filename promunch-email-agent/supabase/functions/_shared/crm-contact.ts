// CRM `contacts` sync from Shopify order webhooks.
//
// WHY: the CRM contact list was only ever populated by one-off backfills — the
// live order path (shopify-webhook → shopify_orders) never touched `contacts`,
// so every new buyer since the last backfill was invisible on
// /dashboard/contacts. This helper is called from shopify-webhook on every
// orders/* event so the CRM stays current in real time.
//
// IDENTITY: ~93% of orders (HYPD marketplace / guest checkout) carry a phone
// but no email. Migration 007 made contacts.email nullable, so:
//   * email present  → upsert on email (the long-standing identity key)
//   * phone only     → find by phone variants (or shopify_customer_id) and
//                      update, else insert an email-less row; a partial unique
//                      index on (phone) WHERE email IS NULL backstops races.
//
// STATS SOURCE: Shopify Admin GraphQL (numberOfOrders / amountSpent) is the
// all-time truth — shopify_orders only reaches back to the orders backfill
// horizon (Apr 2026). When admin isn't reachable we fall back to aggregating
// shopify_orders and MERGE with the existing row via max(), so a short local
// history can never shrink stats a fuller backfill already wrote.
//
// IDEMPOTENT: safe on orders/updated re-deliveries — stats recomputed from
// source-of-truth each call, never incremented.
//
// Writes via the service-role client (migration 004 revoked anon on contacts).

import { db } from "./supabase.ts";
import { adminGraphQL, normalizeName } from "./shopify-customer.ts";
import { toWaId } from "./journeys.ts";

const CUSTOMER_STATS = `
query CustomerStats($id: ID!) {
  customer(id: $id) {
    numberOfOrders
    amountSpent { amount }
  }
}`;

type SyncResult = { ok: boolean; reason?: string; created?: boolean };

type ContactRow = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  shopify_customer_id: string | null;
  total_orders: number | null;
  total_spent: number | null;
  first_purchase_date: string | null;
  last_purchase_date: string | null;
  status: string | null;
};

const CONTACT_COLS = "id,email,first_name,last_name,phone,city,state,country," +
  "shopify_customer_id,total_orders,total_spent,first_purchase_date," +
  "last_purchase_date,status";

// "+919876543210", "919876543210" and "9876543210" are the same person —
// contacts hold Shopify's E.164 while shopify_orders holds bare wa_ids.
function phoneVariants(waId: string): string[] {
  const v = new Set([waId, `+${waId}`]);
  if (waId.startsWith("91") && waId.length === 12) v.add(waId.slice(2));
  return [...v];
}

export async function syncContactFromOrder(order: any): Promise<SyncResult> {
  const email = String(order.email ?? order.customer?.email ?? "")
    .trim().toLowerCase() || null;
  const waId = toWaId(
    order.customer?.phone ?? order.phone ??
      order.shipping_address?.phone ?? order.billing_address?.phone,
  );
  const shopifyCustomerId = order.customer?.id ? String(order.customer.id) : null;
  if (!email && !waId && !shopifyCustomerId) {
    return { ok: false, reason: "no-identity" };
  }

  // ---- find the existing row by the strongest identity we have
  let existing: ContactRow | null = null;
  if (email) {
    const { data, error } = await db().from("contacts")
      .select(CONTACT_COLS).eq("email", email).maybeSingle();
    if (error) return { ok: false, reason: `read: ${error.message}` };
    existing = data as ContactRow | null;
  }
  if (!existing && shopifyCustomerId) {
    const { data } = await db().from("contacts")
      .select(CONTACT_COLS).eq("shopify_customer_id", shopifyCustomerId).maybeSingle();
    existing = data as ContactRow | null;
  }
  if (!existing && !email && waId) {
    const { data } = await db().from("contacts")
      .select(CONTACT_COLS).in("phone", phoneVariants(waId)).limit(1);
    existing = ((data ?? [])[0] ?? null) as unknown as ContactRow | null;
  }

  const { firstName, lastName } = normalizeName(
    order.customer?.first_name ?? order.shipping_address?.first_name ??
      order.billing_address?.first_name,
    order.customer?.last_name ?? order.shipping_address?.last_name ??
      order.billing_address?.last_name,
  );
  const addr = order.shipping_address ?? order.billing_address ?? null;
  const orderedAt: string | null = order.created_at ?? null;

  // ---- stats: Shopify all-time truth, else local aggregate merged via max()
  let totalOrders: number | null = null;
  let totalSpent: number | null = null;
  if (shopifyCustomerId) {
    try {
      const j = await adminGraphQL(CUSTOMER_STATS, {
        id: `gid://shopify/Customer/${shopifyCustomerId}`,
      });
      const c = j?.data?.customer;
      if (c) {
        totalOrders = Number(c.numberOfOrders) || 0;
        totalSpent = Number(c.amountSpent?.amount) || 0;
      }
    } catch { /* admin-not-configured or transient — fall through */ }
  }
  if (totalOrders === null) {
    let q = db().from("shopify_orders").select("total_price");
    if (email && waId) {
      q = q.or(`customer_email.eq.${email},customer_phone.eq.${waId}`);
    } else if (email) {
      q = q.eq("customer_email", email);
    } else {
      q = q.eq("customer_phone", waId);
    }
    const { data: rows } = await q;
    const cnt = rows?.length ?? 0;
    const sum = (rows ?? []).reduce((s, r) => s + (Number(r.total_price) || 0), 0);
    totalOrders = Math.max(existing?.total_orders ?? 0, cnt);
    totalSpent = Math.max(Number(existing?.total_spent) || 0, sum);
  }

  const firstPurchase = [existing?.first_purchase_date, orderedAt]
    .filter(Boolean).sort()[0] ?? null;
  const lastPurchase = [existing?.last_purchase_date, orderedAt]
    .filter(Boolean).sort().pop() ?? null;

  const row: Record<string, unknown> = {
    // keep the row's email if it already has one; never null it out
    email: email ?? existing?.email ?? null,
    source: "shopify",
    first_name: firstName ?? existing?.first_name ?? null,
    last_name: lastName ?? existing?.last_name ?? null,
    phone: existing?.phone ?? (waId ? `+${waId}` : null),
    city: addr?.city ?? existing?.city ?? null,
    state: addr?.province ?? existing?.state ?? null,
    country: addr?.country ?? existing?.country ?? null,
    shopify_customer_id: shopifyCustomerId ?? existing?.shopify_customer_id ?? null,
    total_orders: totalOrders,
    total_spent: totalSpent,
    average_order_value: totalOrders > 0
      ? Math.round(((totalSpent ?? 0) / totalOrders) * 100) / 100
      : 0,
    first_purchase_date: firstPurchase,
    last_purchase_date: lastPurchase,
  };

  if (existing) {
    // a purchase never resurrects an unsubscribed/bounced contact — update
    // by id and leave status untouched
    const { error } = await db().from("contacts").update(row).eq("id", existing.id);
    if (error) return { ok: false, reason: `update: ${error.message}` };
    return { ok: true, created: false };
  }

  row.status = "active";
  const { error } = await db().from("contacts").insert(row);
  if (error) {
    // 23505 = a concurrent webhook delivery inserted the same identity first —
    // that delivery owns the row; this one is a no-op.
    if (error.code === "23505") return { ok: true, created: false };
    return { ok: false, reason: `insert: ${error.message}` };
  }
  return { ok: true, created: true };
}
