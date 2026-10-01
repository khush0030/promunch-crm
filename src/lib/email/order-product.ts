// Review emails link to the Judge.me review section of the product the
// customer actually bought (owner, 2026-09-30), not the store-wide review page:
// a review on the product page helps that product sell.
//
// The order enrolment stores line items ({title, product_id, variant_id,
// quantity, price}); Shopify order payloads carry no handle, so the product
// page URL comes from the public storefront catalog (products.json), cached
// per process. Everything here fails soft: no catalog / no match -> the
// store-wide review page.
//
// Keep imports relative: vitest has no "@/" alias.

import { cleanTitle } from "./cart-items";

export const STORE = "https://promunch.in";
export const REVIEW_FALLBACK_PATH = "/pages/review-submission";
/** Judge.me product review widget anchor (id on every product page). */
export const REVIEW_ANCHOR = "#judgeme_product_reviews";

export type StoreProduct = { id: string; handle: string; title: string; image: string | null };
export type ReviewProduct = { title: string; url: string; image: string | null };

type OrderItem = Record<string, unknown>;

/**
 * The item to ask about: the highest line value (price x qty) that exists in
 * the live catalog. Skips ₹0 / creator-seed lines.
 */
export function pickReviewProduct(
  ctx: Record<string, unknown> | null | undefined,
  catalog: Map<string, StoreProduct>,
): ReviewProduct | null {
  const items = Array.isArray(ctx?.items) ? (ctx!.items as OrderItem[]) : [];
  let best: { p: StoreProduct; value: number } | null = null;
  for (const it of items) {
    const id = it.product_id == null ? "" : String(it.product_id);
    const p = id ? catalog.get(id) : undefined;
    if (!p) continue;
    const value = (Number(it.price ?? 0) || 0) * (Number(it.quantity ?? 1) || 1);
    if (value <= 1) continue;
    if (!best || value > best.value) best = { p, value };
  }
  if (!best) return null;
  // "Noodle Masala Soya Crunchies - 270gm" reads badly in "How was your ...?",
  // so drop a trailing pack size.
  const title = cleanTitle(best.p.title).replace(/\s*-\s*\d+\s*(g|gm|gms|grams?)\s*$/i, "").trim();
  return { title, url: `${STORE}/products/${best.p.handle}`, image: best.p.image };
}

/** Review link with UTMs, landing on the Judge.me widget; store page when unknown. */
export function reviewUrl(product: ReviewProduct | null, stepIndex: number): string {
  const utm = `utm_source=email&utm_medium=flow&utm_campaign=review_request&utm_content=email_${stepIndex + 1}`;
  return product ? `${product.url}?${utm}${REVIEW_ANCHOR}` : `${STORE}${REVIEW_FALLBACK_PATH}?${utm}`;
}

let cache: { at: number; map: Map<string, StoreProduct> } | null = null;
const CACHE_MS = 60 * 60 * 1000;

/** Public storefront catalog keyed by Shopify product id. Empty map on failure. */
export async function loadStoreCatalog(fetchImpl: typeof fetch = fetch): Promise<Map<string, StoreProduct>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.map;
  const map = new Map<string, StoreProduct>();
  try {
    for (let page = 1; page <= 5; page++) {
      const r = await fetchImpl(`${STORE}/products.json?limit=250&page=${page}`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) break;
      const j = (await r.json()) as { products?: Array<{ id: number; handle: string; title: string; images?: Array<{ src: string }> }> };
      const list = j.products ?? [];
      for (const p of list) {
        map.set(String(p.id), { id: String(p.id), handle: p.handle, title: p.title, image: p.images?.[0]?.src ?? null });
      }
      if (list.length < 250) break;
    }
  } catch (e) {
    console.warn("[order-product] catalog load failed:", e instanceof Error ? e.message : e);
  }
  if (map.size > 0) cache = { at: Date.now(), map };
  return map;
}

/** True when a body/subject uses the review tokens (so the engine only fetches when needed). */
export function usesReviewTokens(...texts: Array<string | undefined>): boolean {
  return texts.some((t) => !!t && /\{\{\s*review_(url|product)\s*\}\}/.test(t));
}
