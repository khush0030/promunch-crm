// CRM `contacts` sync from Shopify order webhooks.
//
// WHY: the CRM contact list was only ever populated by one-off backfills — the
// live order path (shopify-webhook → shopify_orders) never touched `contacts`,
// so every new buyer since the last backfill was invisible on
// /dashboard/contacts. This helper is called from shopify-webhook on every
// orders/* event so the CRM stays current in real time.
//
// STATS SOURCE: Shopify Admin GraphQL (numberOfOrders / amountSpent) is the
// all-time truth — shopify_orders only reaches back to the orders backfill
// horizon (Apr 2026). When admin isn't reachable we fall back to aggregating
// shopify_orders and MERGE with the existing row via max(), so a short local
// history can never shrink stats a fuller backfill already wrote.
//
// IDEMPOTENT: safe on orders/updated re-deliveries — upsert on email, stats
// recomputed from source-of-truth each call, never incremented.
//
// Writes via the service-role client (migration 004 revoked anon on contacts).

import { db } from "./supabase.ts";
import { adminGraphQL, normalizeName } from "./shopify-customer.ts";

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

export async function syncContactFromOrder(order: any): Promise<SyncResult> {
  const email = String(order.email ?? order.customer?.email ?? "")
    .trim().toLowerCase();
  // Email-less buyers (guest/marketplace) aren't email-addressable CRM
  // contacts; their identity lives in wa_contacts keyed on phone.
  if (!email) return { ok: false, reason: "no-email" };

  const { firstName, lastName } = normalizeName(
    order.customer?.first_name ?? order.shipping_address?.first_name ??
      order.billing_address?.first_name,
    order.customer?.last_name ?? order.shipping_address?.last_name ??
      order.billing_address?.last_name,
  );
  const phone = order.customer?.phone ?? order.phone ??
    order.shipping_address?.phone ?? order.billing_address?.phone ?? null;
  const addr = order.shipping_address ?? order.billing_address ?? null;
  const orderedAt: string | null = order.created_at ?? null;

  const { data: existingRaw, error: readErr } = await db().from("contacts")
    .select("id,first_name,last_name,phone,city,state,country," +
      "shopify_customer_id,total_orders,total_spent,first_purchase_date," +
      "last_purchase_date,status")
    .eq("email", email)
    .maybeSingle();
  if (readErr) return { ok: false, reason: `read: ${readErr.message}` };
  const existing = existingRaw as ContactRow | null;

  // ---- stats: Shopify all-time truth, else local aggregate merged via max()
  let totalOrders: number | null = null;
  let totalSpent: number | null = null;
  if (order.customer?.id) {
    try {
      const j = await adminGraphQL(CUSTOMER_STATS, {
        id: `gid://shopify/Customer/${order.customer.id}`,
      });
      const c = j?.data?.customer;
      if (c) {
        totalOrders = Number(c.numberOfOrders) || 0;
        totalSpent = Number(c.amountSpent?.amount) || 0;
      }
    } catch { /* admin-not-configured or transient — fall through */ }
  }
  if (totalOrders === null) {
    const { data: rows } = await db().from("shopify_orders")
      .select("total_price")
      .eq("customer_email", email);
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
    email,
    source: "shopify",
    // never null-out data a fuller sync already wrote
    first_name: firstName ?? existing?.first_name ?? null,
    last_name: lastName ?? existing?.last_name ?? null,
    phone: phone ?? existing?.phone ?? null,
    city: addr?.city ?? existing?.city ?? null,
    state: addr?.province ?? existing?.state ?? null,
    country: addr?.country ?? existing?.country ?? null,
    shopify_customer_id: order.customer?.id
      ? String(order.customer.id)
      : existing?.shopify_customer_id ?? null,
    total_orders: totalOrders,
    total_spent: totalSpent,
    average_order_value: totalOrders > 0
      ? Math.round(((totalSpent ?? 0) / totalOrders) * 100) / 100
      : 0,
    first_purchase_date: firstPurchase,
    last_purchase_date: lastPurchase,
  };
  // a purchase never resurrects an unsubscribed/bounced contact
  if (!existing) row.status = "active";

  const { error: writeErr } = await db().from("contacts")
    .upsert(row, { onConflict: "email" });
  if (writeErr) return { ok: false, reason: `write: ${writeErr.message}` };

  return { ok: true, created: !existing };
}
