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

// Find a customer's orders.
//   - orderNumber given  → that order (verified to be the chatter's, if the
//                          phone also matches; otherwise returned anyway so
//                          the agent can still help).
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

  const clean = orderNumber?.trim().replace(/^#/, "");
  if (clean) {
    q = q.or(`order_number.eq.#${clean},order_number.eq.${clean},order_number.ilike.%${clean}%`);
  } else if (normalized) {
    q = q.eq("customer_phone", normalized);
  } else {
    return [];
  }

  const { data, error } = await q;
  if (error) throw new Error(`shopify_orders query failed: ${error.message}`);
  let rows = data ?? [];

  // searched by order number → prefer rows that are actually this customer's
  if (clean && normalized) {
    const own = rows.filter((r) => r.customer_phone === normalized);
    if (own.length) rows = own;
  }
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
