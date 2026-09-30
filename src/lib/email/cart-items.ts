// Abandoned-cart items block for flow emails ({{cart_items}}). Pure: the
// product-image lookup is passed in, so this is unit-testable.
//
// Showing the real items is the single biggest lift in a recovery email:
// "your cart is waiting" is generic, "your 2 Cream & Onion Crunchies are
// waiting" is theirs. A thumbnail makes it unmistakable. Titles come from
// Shopify, so they are escaped; image URLs must be http(s) or are dropped.

import { EMAIL_COLORS as C, EMAIL_FONT } from "./brand-tokens";

export type CartItem = Record<string, unknown>;

/** Lookup keys: Shopify variant id (== wa_catalog_items.retailer_id) or lowercased title. */
export type ImageLookup = Map<string, string>;

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function money(n: number): string {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function httpUrl(u: unknown): string | null {
  const s = String(u ?? "").trim();
  return /^https:\/\//i.test(s) || /^http:\/\//i.test(s) ? s : null;
}

/** Best image for a line item: its own URL, then variant id, then title match. */
export function itemImage(it: CartItem, images?: ImageLookup): string | null {
  const own = httpUrl(it.image_url ?? it.image ?? (it.image as { src?: string } | undefined)?.src);
  if (own) return own;
  if (!images || images.size === 0) return null;
  for (const k of [it.variant_id, it.product_id]) {
    if (k != null && k !== "") {
      const hit = images.get(String(k));
      if (hit) return hit;
    }
  }
  const title = String(it.title ?? it.name ?? "").trim().toLowerCase();
  return title ? images.get(title) ?? null : null;
}

/**
 * Shopify titles are written for search ("PROMUNCH Edamame Beans Travel Combo -
 * Pack of 9 (25g each )"). In an email the brand is already in the header, so
 * drop a leading "PROMUNCH", a trailing "| PROMUNCH", and tidy stray spaces.
 */
export function cleanTitle(raw: string): string {
  return String(raw)
    .replace(/^\s*PROMUNCH\s+/i, "")
    .replace(/\s*\|\s*PROMUNCH\s*$/i, "")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s{2,}/g, " ")
    .trim() || String(raw).trim();
}

function cartLines(ctx: Record<string, unknown>): CartItem[] {
  return Array.isArray(ctx.items) ? (ctx.items as CartItem[]) : [];
}

/** Sum of line prices (price x qty); falls back to ctx.total when items lack prices. */
export function cartSubtotal(ctx: Record<string, unknown>): number {
  const sum = cartLines(ctx).reduce((s, it) => s + (Number(it.price ?? 0) || 0) * (Number(it.quantity ?? 1) || 1), 0);
  return sum > 0 ? sum : Number(ctx.total ?? 0) || 0;
}

export function cartItemsHtml(ctx: Record<string, unknown>, images?: ImageLookup): string {
  const raw = cartLines(ctx);
  if (raw.length === 0) return "";
  const rows = raw.slice(0, 8).map((it) => {
    const title = esc(cleanTitle(String(it.title ?? it.name ?? "Item")));
    const qty = Number(it.quantity ?? 1) || 1;
    const line = (Number(it.price ?? 0) || 0) * qty;
    const img = itemImage(it, images);
    const cell = `padding:14px 0;border-bottom:1px solid ${C.line};vertical-align:middle;font-family:${EMAIL_FONT};`;
    const imgCell = img
      ? `<td width="108" style="${cell}width:108px;"><img src="${esc(img)}" width="92" height="92" alt="${title}" style="display:block;width:92px;height:92px;border-radius:10px;border:1px solid ${C.line};object-fit:cover;background:${C.card};"></td>`
      : "";
    return `<tr>
      ${imgCell}<td style="${cell}font-size:16px;line-height:1.4;color:${C.ink};">${title}<br><span style="font-size:14px;color:${C.muted};">Qty ${qty}</span></td>
      <td style="${cell}font-size:16px;font-weight:700;color:${C.ink};text-align:right;white-space:nowrap;padding-left:12px;">${line > 0 ? money(line) : ""}</td>
    </tr>`;
  }).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;border-top:1px solid ${C.line};">${rows}</table>`;
}

/** Free-shipping threshold and flat fee below it (Master KB shipping policy). */
export const FREE_SHIPPING_MIN = 599;
export const SHIPPING_FEE = 99;

/**
 * Price breakdown with the coupon applied: subtotal, discount, shipping, what
 * they pay. Turns "15% off" into a rupee number they can see. Shipping is
 * judged on the discounted subtotal (Shopify applies the threshold after
 * discounts), so a cart that drops below ₹599 honestly shows ₹99. "" when the
 * cart has no priced items.
 */
export function cartSummaryHtml(ctx: Record<string, unknown>, percentOff = 0): string {
  const subtotal = cartSubtotal(ctx);
  if (subtotal <= 0) return "";
  const pct = Math.max(0, Math.min(100, Number(percentOff) || 0));
  const discount = Math.round((subtotal * pct) / 100);
  const afterDiscount = subtotal - discount;
  const freeShip = afterDiscount >= FREE_SHIPPING_MIN;
  const shipping = freeShip ? 0 : SHIPPING_FEE;
  const pay = afterDiscount + shipping;
  const cell = `padding:6px 0;font-family:${EMAIL_FONT};font-size:16px;line-height:1.4;`;
  const row = (label: string, value: string, style = "") =>
    `<tr><td style="${cell}color:${C.muted};${style}">${label}</td><td style="${cell}text-align:right;white-space:nowrap;color:${C.ink};${style}">${value}</td></tr>`;
  const gap = FREE_SHIPPING_MIN - afterDiscount;
  const shipNote = freeShip
    ? ""
    : `<p style="margin:10px 0 0;font-family:${EMAIL_FONT};font-size:14px;line-height:1.5;color:${C.muted};">Add ${money(gap)} more and shipping is free.</p>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;"><tr><td bgcolor="${C.panel}" style="background:${C.panel};border-radius:14px;padding:16px 20px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
    row("Subtotal", money(subtotal)) +
    (discount > 0 ? row(`Your ${pct}% off`, `&minus;${money(discount)}`, `color:${C.brand};font-weight:700;`) : "") +
    row("Shipping", freeShip ? "FREE" : money(shipping), freeShip ? `color:${C.brand};font-weight:700;` : "") +
    `<tr><td colspan="2" style="padding:6px 0 0;border-top:1px solid ${C.line};font-size:0;line-height:0;">&nbsp;</td></tr>` +
    row("You pay", money(pay), `font-weight:700;font-size:18px;color:${C.ink};`) +
    `</table>${shipNote}</td></tr></table>`;
}

/** True when any item still needs a catalog lookup for its image. */
export function needsImageLookup(ctx: Record<string, unknown> | null | undefined): boolean {
  const raw = Array.isArray(ctx?.items) ? (ctx!.items as CartItem[]) : [];
  return raw.some((it) => !httpUrl(it.image_url ?? it.image ?? (it.image as { src?: string } | undefined)?.src));
}
