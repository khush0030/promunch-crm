// Merge tags for flow emails (pure, unit-testable).
//
// Body tokens:   {{first_name}} {{checkout_url}} {{cart_items}} {{cart_total}}
//                {{coupon_code}} {{product.title}} {{product.url}}
//                {{product.image}} {{product.price}} {{product_image}} (full <img>)
// Subject/preview: same minus the HTML-only ones (cart_items, checkout_url,
//                product.url, product.image).
//
// Browse-abandonment enrolments carry context.product = {title, url, image,
// price|null}. Null fallbacks: url -> the all-products collection, image ->
// the <img> is dropped entirely, price -> empty, title -> "your pick".

import { cartItemsHtml, money, type ImageLookup } from "./cart-items";

export const PRODUCT_URL_FALLBACK = "https://promunch.in/collections/best-sellers";
export const PRODUCT_TITLE_FALLBACK = "your pick";

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Stamp the recovery link so a recovered order is attributable to the exact
 * email that won it. utm_content carries the step number, which is what tells
 * us whether the coupon step is actually earning its margin give-away.
 */
export function trackedCheckoutUrl(url: string, stepIndex: number): string {
  try {
    const u = new URL(url);
    u.searchParams.set("utm_source", "email");
    u.searchParams.set("utm_medium", "cart_recovery");
    u.searchParams.set("utm_campaign", "abandoned_cart");
    u.searchParams.set("utm_content", `email_${stepIndex + 1}`);
    return u.toString();
  } catch {
    return url;
  }
}

type Product = { title: string | null; url: string | null; image: string | null; price: number | null };

export function productFromContext(ctx: Record<string, unknown> | null | undefined): Product {
  const p = (ctx?.product ?? null) as Record<string, unknown> | null;
  const str = (v: unknown) => {
    const s = typeof v === "string" ? v.trim() : "";
    return s || null;
  };
  const url = str(p?.url);
  const image = str(p?.image);
  const priceNum = p?.price == null || p?.price === "" ? NaN : Number(p.price);
  return {
    title: str(p?.title),
    url: url && /^https?:\/\//i.test(url) ? url : null,
    image: image && /^https?:\/\//i.test(image) ? image : null,
    price: Number.isFinite(priceNum) && priceNum > 0 ? priceNum : null,
  };
}

/** Email-safe product image block linked to the product; "" when no image. */
export function productImageHtml(p: { title: string | null; url: string | null; image: string | null }): string {
  if (!p.image) return "";
  const alt = esc(p.title ?? "PROMUNCH");
  const href = esc(p.url ?? PRODUCT_URL_FALLBACK);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;"><tr><td align="center"><a href="${href}" style="text-decoration:none;"><img src="${esc(p.image)}" width="280" alt="${alt}" style="display:block;width:280px;max-width:100%;height:auto;border-radius:12px;border:0;"></a></td></tr></table>`;
}

const T = (name: string) => new RegExp(`\\{\\{\\s*${name.replace(".", "\\.")}\\s*\\}\\}`, "g");

export function personalize(
  html: string,
  ctx: Record<string, unknown> | null,
  first: string | null,
  stepIndex = 0,
  coupon = "",
  images?: ImageLookup,
): string {
  const c = ctx ?? {};
  const checkout = trackedCheckoutUrl(String(c.checkout_url ?? c.url ?? "https://promunch.in"), stepIndex);
  const totalNum = Number(c.total ?? 0);
  const product = productFromContext(c);
  let out = html;
  if (!product.image) {
    // No image: drop any <img> that would render {{product.image}} as a broken box.
    out = out.replace(/<img\b[^>]*\{\{\s*product\.image\s*\}\}[^>]*>/gi, "");
  }
  return out
    .replace(T("first_name"), esc(first || "there"))
    .replace(T("checkout_url"), checkout)
    .replace(T("cart_items"), cartItemsHtml(c, images))
    .replace(T("cart_total"), totalNum > 0 ? money(totalNum) : "your cart")
    .replace(T("coupon_code"), esc(coupon))
    .replace(T("product.title"), esc(product.title ?? PRODUCT_TITLE_FALLBACK))
    .replace(T("product.url"), esc(product.url ?? PRODUCT_URL_FALLBACK))
    .replace(T("product_image"), productImageHtml(product))
    .replace(T("product.image"), product.image ? esc(product.image) : "")
    .replace(T("product.price"), product.price != null ? money(product.price) : "");
}

/** Subjects/preview lines: plain text, so no HTML escaping. */
export function personalizeSubject(
  subject: string,
  ctx: Record<string, unknown> | null,
  first: string | null,
  coupon = "",
): string {
  const c = ctx ?? {};
  const totalNum = Number(c.total ?? 0);
  const product = productFromContext(c);
  return subject
    .replace(T("first_name"), first || "there")
    .replace(T("cart_total"), totalNum > 0 ? money(totalNum) : "your cart")
    .replace(T("coupon_code"), coupon)
    .replace(T("product.title"), product.title ?? PRODUCT_TITLE_FALLBACK)
    .replace(T("product.price"), product.price != null ? money(product.price) : "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
