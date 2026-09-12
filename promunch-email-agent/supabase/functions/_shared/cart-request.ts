// Shared storefront/worker contract. Contains no runtime or provider secrets.
export const CART_REQUEST_PREFIX = "PROMUNCH cart request: ";
export const CART_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
export const STOREFRONT_ORIGINS = new Set([
  "https://trypromunch.in", "https://www.trypromunch.in",
  "https://promunch.in", "https://www.promunch.in",
  "https://a1e4f4-2.myshopify.com",
]);

// A permalink cannot faithfully carry subscriptions, bundles or arbitrary
// per-line properties. Decline those carts rather than silently changing them.
export function requestedCartUrl(cart: unknown, origin: string): string | null {
  if (!STOREFRONT_ORIGINS.has(origin) || !cart || typeof cart !== "object") return null;
  const items = (cart as { items?: unknown }).items;
  if (!Array.isArray(items) || !items.length || items.length > 30) return null;
  const quantities = new Map<string, number>();
  for (const item of items) {
    if (!item || typeof item !== "object") return null;
    const id = String(item.variant_id ?? "");
    const qty = item.quantity;
    if (!/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id)) ||
      !Number.isInteger(qty) || qty < 1 || qty > 99 || item.selling_plan_allocation ||
      item.parent_relationship || item.item_components?.length ||
      (item.properties && Object.keys(item.properties).length)) return null;
    const total = (quantities.get(id) ?? 0) + qty;
    if (total > 99) return null;
    quantities.set(id, total);
  }
  const path = [...quantities].map(([id, qty]) => `${id}:${qty}`).join(",");
  // Keep Breeze checkout on the storefront; never bypass it via native checkout.
  return `${origin}/cart/${path}?storefront=true&utm_source=whatsapp&utm_medium=chat&utm_campaign=requested_cart`;
}

export function cartRequestCode(message: string): string | null {
  const match = /^PROMUNCH cart request: (cr_[a-f0-9]{32})$/.exec(message.trim());
  return match?.[1] ?? null;
}

export function validRequestedCartLink(link: { target_url?: string; sent_by?: string; created_at?: string } | null, now = Date.now()): string | null {
  if (!link?.sent_by?.startsWith("growth:cart-request:") || !link.created_at) return null;
  const age = now - Date.parse(link.created_at);
  if (!Number.isFinite(age) || age < 0 || age >= CART_REQUEST_TTL_MS) return null;
  try {
    const url = new URL(link.target_url ?? "");
    if (!STOREFRONT_ORIGINS.has(url.origin) || url.username || url.password || url.hash ||
      url.searchParams.get("storefront") !== "true" ||
      !/^\/cart\/[1-9]\d{0,15}:[1-9]\d?(,[1-9]\d{0,15}:[1-9]\d?)*$/.test(url.pathname)) return null;
    return url.toString();
  } catch { return null; }
}
