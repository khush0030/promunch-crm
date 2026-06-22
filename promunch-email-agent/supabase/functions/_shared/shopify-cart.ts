// Shopify cart permalink builder — the heart of WhatsApp "Path A" ordering.
//
// CONVENTION (must hold for this to work): every Meta Commerce catalog item's
// `retailer_id` is set to the item's Shopify *variant* numeric id. When a
// customer builds a cart inside WhatsApp, Meta sends us an `order` webhook whose
// product_items[].product_retailer_id is therefore already the variant id — so
// we can drop them straight into a Shopify cart permalink with ZERO Shopify
// product API calls.
//
// Permalink shape: https://<store>/cart/<variantId>:<qty>,<variantId>:<qty>...
// This lands the customer in Shopify's hosted checkout with the cart prefilled;
// they pay via COD / UPI / cards and the order flows back through the existing
// Shopify webhook → shopify_orders. Docs:
//   https://shopify.dev/docs/api/liquid/objects/cart#cart-permalinks

// The storefront domain that serves the Shopify cart/checkout. PROMUNCH_SITE_URL
// (promunch.in) is the Shopify primary domain — the abandoned-cart recovery flow
// already treats `${SITE_URL}/cart` as a Shopify cart URL — so reuse it. Falls
// back to the raw myshopify domain if the site URL isn't set.
function storeBase(): string {
  const site = Deno.env.get("PROMUNCH_SITE_URL");
  if (site) return site.replace(/\/+$/, "");
  const domain = Deno.env.get("SHOPIFY_STORE_DOMAIN");
  if (domain) return `https://${domain}`;
  return "https://promunch.in";
}

export interface CartLine {
  variantId: string; // Shopify numeric variant id (== Meta retailer_id)
  quantity: number;
}

// Build a Shopify cart permalink from cart lines. Sanitises ids to digits and
// clamps quantities to >= 1. Returns null if no valid lines remain.
export function buildCartPermalink(lines: CartLine[]): string | null {
  const path = lines
    .map((l) => ({ id: String(l.variantId ?? "").replace(/\D/g, ""), qty: Math.max(1, Math.floor(Number(l.quantity) || 1)) }))
    .filter((l) => l.id.length > 0)
    .map((l) => `${l.id}:${l.qty}`)
    .join(",");
  if (!path) return null;
  return `${storeBase()}/cart/${path}`;
}

// Normalise the product_items array from a Meta `order` webhook message into
// cart lines + a running total (Meta gives item_price + currency per line).
export interface OrderWebhookItem {
  product_retailer_id?: string;
  quantity?: number | string;
  item_price?: number | string;
  currency?: string;
}

export function cartFromOrderItems(items: OrderWebhookItem[]): {
  lines: CartLine[];
  total: number;
  currency: string;
  count: number;
} {
  let total = 0;
  let currency = "INR";
  const lines: CartLine[] = [];
  for (const it of items ?? []) {
    const qty = Math.max(1, Math.floor(Number(it.quantity) || 1));
    const price = Number(it.item_price) || 0;
    if (it.currency) currency = it.currency;
    total += price * qty;
    if (it.product_retailer_id) lines.push({ variantId: String(it.product_retailer_id), quantity: qty });
  }
  return { lines, total, currency, count: lines.reduce((n, l) => n + l.quantity, 0) };
}
