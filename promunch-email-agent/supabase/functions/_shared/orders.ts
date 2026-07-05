// Shopify order lookup for the WhatsApp AI agent.
//
// Reads the shopify_orders table — filled by the shopify-webhook on every
// order. No live Shopify Admin API call: orders sync in via webhook, so a
// lookup is a plain indexed query.
//
// The customer is matched by their WhatsApp number (= shopify_orders
// .customer_phone, a normalised wa_id). The agent NEVER asks for a phone
// number — it already has it from the chat.

import { db } from "./supabase.ts";
import { toWaId } from "./journeys.ts";
import { fmtMoney } from "./shopify.ts";

export interface OrderSummary {
  order_number: string;
  placed_at: string;                       // YYYY-MM-DD
  financial_status: string | null;         // paid / pending / refunded …
  fulfillment_status: string;              // fulfilled / partial / unfulfilled
  total: string;                           // formatted, e.g. ₹499.00
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  items: { name: string; qty: number }[];
  tracking: string | null;
}

// Find a customer's orders. ALWAYS scoped to the chatter's own phone, so the
// agent can never read another customer's order (audit H1).
//   - orderNumber given  → that order, only if it belongs to the chatter.
//   - orderNumber absent → all of the chatter's orders, most recent first.
export async function lookupOrders(
  waId: string | null,
  orderNumber?: string | null,
): Promise<OrderSummary[]> {
  const sb = db();
  const normalized = toWaId(waId);

  let q = sb.from("shopify_orders")
    .select(
      "order_number, total_price, currency, financial_status, " +
        "customer_name, customer_email, customer_phone, line_items, shopify_created_at, raw",
    )
    .order("shopify_created_at", { ascending: false })
    .limit(10);

  // Whitelist the order number to alphanumerics — never let customer-supplied
  // text reach the PostgREST filter (audit H2: a value like
  // "1,customer_email.not.is.null" would otherwise inject an attacker filter).
  const clean = (orderNumber ?? "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 32);
  if (clean) {
    // Order number given. ALWAYS constrain to the chatter's own phone so we can
    // never return another customer's order (audit H1: cross-customer PII leak
    // via a guessable order number). No phone on file → refuse, don't leak.
    if (!normalized) return [];
    q = q.eq("customer_phone", normalized)
      .or(`order_number.eq.#${clean},order_number.eq.${clean},order_number.ilike.%${clean}%`);
  } else if (normalized) {
    q = q.eq("customer_phone", normalized);
  } else {
    return [];
  }

  const { data, error } = await q;
  if (error) throw new Error(`shopify_orders query failed: ${error.message}`);
  // Defensive: the query is already phone-scoped, but drop anything that isn't
  // this customer's before mapping, so a stranger's row can never be returned.
  // Type-only cast: supabase-js can't infer the row shape through the .or()
  // chain and degrades the element type; runtime rows are unchanged.
  const all = (data ?? []) as Record<string, any>[];
  const rows = normalized
    ? all.filter((r) => r.customer_phone === normalized)
    : all;
  return rows.map(toSummary);
}

function toSummary(r: Record<string, any>): OrderSummary {
  const raw = r.raw ?? {};
  const items = (Array.isArray(r.line_items) ? r.line_items : []).map((li: any) => ({
    name: li.title || li.name || "Item",
    qty: li.quantity ?? 1,
  }));
  const f = Array.isArray(raw.fulfillments) ? raw.fulfillments[0] : null;
  return {
    order_number: r.order_number,
    placed_at: String(r.shopify_created_at ?? "").slice(0, 10),
    financial_status: r.financial_status ?? null,
    fulfillment_status: raw.fulfillment_status ?? f?.status ?? "unfulfilled",
    total: fmtMoney(Number(r.total_price ?? 0), r.currency || "INR"),
    customer_name: r.customer_name ?? null,
    customer_email: r.customer_email ?? null,
    customer_phone: r.customer_phone ?? null,
    items,
    tracking: f?.tracking_url || f?.tracking_urls?.[0] || raw.order_status_url || null,
  };
}

// True when an order is cancelled or fully reversed — i.e. an "order
// confirmed!" or post-purchase message would be wrong to send. Reads
// shopify_orders (kept current by the shopify-webhook orders/updated handler),
// matching by order number.
export async function isOrderCancelled(
  orderRef: string | null | undefined,
): Promise<boolean> {
  if (!orderRef) return false;
  const clean = String(orderRef).replace(/[^A-Za-z0-9-]/g, "").slice(0, 32);
  if (!clean) return false;

  const { data } = await db()
    .from("shopify_orders")
    .select("financial_status, raw")
    .or(`order_number.eq.#${clean},order_number.eq.${clean}`)
    .limit(1)
    .maybeSingle();
  if (!data) return false;

  const raw = (data.raw ?? {}) as Record<string, any>;
  if (raw.cancelled_at) return true;
  const fin = String(data.financial_status ?? "").toLowerCase();
  return fin === "voided" || fin === "refunded";
}

// Compact plain-text rendering handed back to Claude as a tool result.
export function orderForAI(o: OrderSummary): string {
  const items = o.items.map((i) => `${i.qty}x ${i.name}`).join(", ") || "(no items)";
  return [
    `Order ${o.order_number} — placed ${o.placed_at}`,
    `Payment: ${o.financial_status ?? "unknown"} | Fulfillment: ${o.fulfillment_status}`,
    `Total: ${o.total}`,
    `Items: ${items}`,
    o.tracking ? `Tracking: ${o.tracking}` : null,
    `Customer on file: ${o.customer_name ?? "—"}`,
  ].filter(Boolean).join("\n");
}
