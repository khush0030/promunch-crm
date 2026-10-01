// Merge tags for flow emails (pure, unit-testable).
//
// Body tokens:   {{first_name}} {{checkout_url}} {{cart_items}} {{cart_summary}} {{cart_total}}
//                {{coupon_code}} {{product.title}} {{product.url}}
//                {{product.image}} {{product.price}} {{product_image}} (full <img>)
//                {{product_card}} (image + name + price with the code applied)
//                {{review_url}} {{review_product}} (the product they bought; the engine
//                puts ctx.review_product, see order-product.ts)
//                {{reorder_url}} {{reorder_card}} (refill emails: one-tap cart link of
//                the same items when the order stored ctx.reorder_url, else the product
//                page; card is "" and the url is Best Sellers when unknown)
// Subject/preview: same minus the HTML-only ones (cart_items, checkout_url,
//                product.url, product.image).
//
// Browse-abandonment enrolments carry context.product = {title, url, image,
// price|null}. Null fallbacks: url -> the all-products collection, image ->
// the <img> is dropped entirely, price -> empty, title -> "your pick".

import { EMAIL_COLORS, EMAIL_FONT } from "./brand-tokens";
import { cartItemsHtml, cartSummaryHtml, cleanTitle, money, type ImageLookup } from "./cart-items";
import { emailImage, reorderUrl, reviewUrl, type ReviewProduct } from "./order-product";

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
  const rawTitle = str(p?.title);
  return {
    title: rawTitle ? cleanTitle(rawTitle) : null,
    url: url && /^https?:\/\//i.test(url) ? url : null,
    image: image && /^https?:\/\//i.test(image) ? image : null,
    price: Number.isFinite(priceNum) && priceNum > 0 ? priceNum : null,
  };
}

/**
 * Browse-abandonment hero ({{product_card}}): the product they viewed, big and
 * linked, its clean name, and the price with their code applied, so "15% off"
 * becomes "₹260, ₹221 with your code". The discounted price only shows when a
 * code was actually issued for this send.
 */
export function productCardHtml(p: Product, percentOff = 0, hasCoupon = false): string {
  const href = esc(p.url ?? PRODUCT_URL_FALLBACK);
  const title = esc(p.title ?? PRODUCT_TITLE_FALLBACK);
  const img = p.image
    ? `<tr><td align="center" style="padding:0 0 14px;"><a href="${href}" style="text-decoration:none;"><img src="${esc(p.image)}" width="320" alt="${title}" style="display:block;width:320px;max-width:100%;height:auto;border-radius:14px;border:1px solid ${EMAIL_COLORS.line};"></a></td></tr>`
    : "";
  const pct = Math.max(0, Math.min(100, Number(percentOff) || 0));
  let price = "";
  if (p.price != null) {
    const after = Math.round(p.price * (1 - pct / 100));
    price = hasCoupon && pct > 0
      ? `<span style="color:${EMAIL_COLORS.muted};text-decoration:line-through;">${money(p.price)}</span>&nbsp;&nbsp;<strong style="color:${EMAIL_COLORS.brand};font-size:20px;">${money(after)}</strong> <span style="color:${EMAIL_COLORS.muted};font-size:14px;">with your code</span>`
      : `<strong style="font-size:20px;">${money(p.price)}</strong>`;
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;">` +
    img +
    `<tr><td align="center" style="font-family:${EMAIL_FONT};font-size:18px;line-height:1.4;font-weight:700;color:${EMAIL_COLORS.ink};text-align:center;padding:0 0 6px;"><a href="${href}" style="color:${EMAIL_COLORS.ink};text-decoration:none;">${title}</a></td></tr>` +
    (price ? `<tr><td align="center" style="font-family:${EMAIL_FONT};font-size:16px;line-height:1.4;color:${EMAIL_COLORS.ink};text-align:center;">${price}</td></tr>` : "") +
    `</table>`;
}

/** Refill hero ({{reorder_card}}): the product they bought, image + name, linked; "" when unknown. */
export function reorderCardHtml(p: ReviewProduct | null, stepIndex = 0, cartPermalink?: unknown): string {
  if (!p) return "";
  const href = esc(reorderUrl(p, stepIndex, cartPermalink));
  const title = esc(p.title);
  const img = p.image
    ? `<tr><td align="center" style="padding:0 0 12px;"><a href="${href}" style="text-decoration:none;"><img src="${esc(emailImage(p.image))}" width="260" alt="${title}" style="display:block;width:260px;max-width:100%;height:auto;border-radius:12px;"></a></td></tr>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;"><tr><td bgcolor="${EMAIL_COLORS.panel}" style="background:${EMAIL_COLORS.panel};border-radius:14px;padding:20px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
    `<tr><td align="center" style="font-family:${EMAIL_FONT};font-size:13px;line-height:1.4;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${EMAIL_COLORS.brand};text-align:center;padding:0 0 12px;">Last time you picked</td></tr>` +
    img +
    `<tr><td align="center" style="font-family:${EMAIL_FONT};font-size:18px;line-height:1.4;font-weight:700;color:${EMAIL_COLORS.ink};text-align:center;"><a href="${href}" style="color:${EMAIL_COLORS.ink};text-decoration:none;">${title}</a></td></tr>` +
    `</table></td></tr></table>`;
}

/** Email-safe product image block linked to the product; "" when no image. */
export function productImageHtml(p: { title: string | null; url: string | null; image: string | null }): string {
  if (!p.image) return "";
  const alt = esc(p.title ?? "PROMUNCH");
  const href = esc(p.url ?? PRODUCT_URL_FALLBACK);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td align="center"><a href="${href}" style="text-decoration:none;"><img src="${esc(p.image)}" width="280" alt="${alt}" style="display:block;width:280px;max-width:100%;height:auto;border-radius:4px;border:1px solid ${EMAIL_COLORS.line};"></a></td></tr></table>`;
}

const T = (name: string) => new RegExp(`\\{\\{\\s*${name.replace(".", "\\.")}\\s*\\}\\}`, "g");

function reviewProductOf(c: Record<string, unknown>): ReviewProduct | null {
  const r = c.review_product as ReviewProduct | null | undefined;
  return r && typeof r.url === "string" && /^https:\/\//.test(r.url) ? r : null;
}

export function personalize(
  html: string,
  ctx: Record<string, unknown> | null,
  first: string | null,
  stepIndex = 0,
  coupon = "",
  images?: ImageLookup,
  percentOff = 0,
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
    // Only show the discount line when a real code was issued for this send.
    .replace(T("cart_summary"), cartSummaryHtml(c, coupon ? percentOff : 0))
    .replace(T("cart_total"), totalNum > 0 ? money(totalNum) : "your cart")
    .replace(T("coupon_code"), esc(coupon))
    .replace(T("product.title"), esc(product.title ?? PRODUCT_TITLE_FALLBACK))
    .replace(T("product.url"), esc(product.url ?? PRODUCT_URL_FALLBACK))
    .replace(T("review_url"), esc(reviewUrl(reviewProductOf(c), stepIndex)))
    .replace(T("review_product"), esc(reviewProductOf(c)?.title ?? "order"))
    .replace(T("reorder_url"), esc(reorderUrl(reviewProductOf(c), stepIndex, c.reorder_url)))
    .replace(T("reorder_card"), reorderCardHtml(reviewProductOf(c), stepIndex, c.reorder_url))
    .replace(T("product_card"), productCardHtml(product, percentOff, !!coupon))
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
    .replace(T("review_product"), reviewProductOf(c)?.title ?? "order")
    .replace(T("first_name"), first || "there")
    .replace(T("cart_total"), totalNum > 0 ? money(totalNum) : "your cart")
    .replace(T("coupon_code"), coupon)
    .replace(T("product.title"), product.title ?? PRODUCT_TITLE_FALLBACK)
    .replace(T("product.price"), product.price != null ? money(product.price) : "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
