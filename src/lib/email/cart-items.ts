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

export function cartItemsHtml(ctx: Record<string, unknown>, images?: ImageLookup): string {
  const raw = Array.isArray(ctx.items) ? (ctx.items as CartItem[]) : [];
  if (raw.length === 0) return "";
  const rows = raw.slice(0, 8).map((it) => {
    const rawTitle = String(it.title ?? it.name ?? "Item");
    const title = esc(rawTitle);
    const qty = Number(it.quantity ?? 1) || 1;
    const line = (Number(it.price ?? 0) || 0) * qty;
    const img = itemImage(it, images);
    const cell = `padding:12px 0;border-bottom:1px solid ${C.line};vertical-align:middle;font-family:${EMAIL_FONT};`;
    const imgCell = img
      ? `<td width="76" style="${cell}width:76px;"><img src="${esc(img)}" width="64" height="64" alt="${title}" style="display:block;width:64px;height:64px;border-radius:4px;border:1px solid ${C.line};object-fit:cover;"></td>`
      : "";
    return `<tr>
      ${imgCell}<td style="${cell}font-size:16px;line-height:1.4;color:${C.ink};">${title}${qty > 1 ? ` <span style="color:${C.muted};">x${qty}</span>` : ""}</td>
      <td style="${cell}font-size:16px;font-weight:700;color:${C.ink};text-align:right;white-space:nowrap;">${money(line)}</td>
    </tr>`;
  }).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;border-top:1px solid ${C.line};">${rows}</table>`;
}

/** True when any item still needs a catalog lookup for its image. */
export function needsImageLookup(ctx: Record<string, unknown> | null | undefined): boolean {
  const raw = Array.isArray(ctx?.items) ? (ctx!.items as CartItem[]) : [];
  return raw.some((it) => !httpUrl(it.image_url ?? it.image ?? (it.image as { src?: string } | undefined)?.src));
}
