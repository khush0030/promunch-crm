// Design → email-safe HTML. Table layout + inline styles (what Gmail, Outlook
// and Apple Mail all agree on), a 600px card, one small <style> block only
// for mobile stacking. The compliance footer (unsubscribe + postal address)
// is always appended and cannot be removed from the builder.
//
// Pure + isomorphic: the builder preview and the sender run this same code.
// Keep imports relative: vitest has no "@/" alias.

import type { Block, BrandKit, EmailDesign, ProductInfo, Theme } from "./design";
import {
  EMAIL_BRAND,
  EMAIL_COLORS as BC,
  EMAIL_FONT,
  EMAIL_FONT_LINK,
  EMAIL_HEADING_FONT,
  EMAIL_LAYOUT,
  EMAIL_MONO,
  EMAIL_TYPE,
  footerInnerHtml,
  logoHtml,
} from "../email/brand-tokens";

// Look: the shared PROMUNCH storefront style (email/brand-tokens.ts, from promunch.in).
// Colours come from the design's theme (default = brand tokens); greys,
// radii, font and spacing come from the tokens so Studio and flow emails match.

export type RenderContext = {
  brand: BrandKit;
  products: Record<string, ProductInfo>;
  unsubscribeUrl: string;
  previewText?: string;
  /** Tags links to our own store so Shopify orders can be credited. */
  utm?: { campaign: string; content?: string };
  /** Merge-tag values. Omit to leave {{tags}} for a later pass. */
  merge?: Record<string, string | null | undefined>;
  /** Builder preview only: tag each block's row so a click can select it. */
  annotate?: { selected?: string | null };
};

const WIDTH = EMAIL_LAYOUT.width;
const PAD = EMAIL_LAYOUT.pad;
const R = EMAIL_LAYOUT.buttonRadius;

export function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Headings + buttons: the site's Archivo Black (sans themes) or Georgia (serif). */
function headingStack(t: Theme): string {
  return t.font === "serif" ? "Georgia,'Times New Roman',serif" : EMAIL_HEADING_FONT;
}

function fontStack(t: Theme): string {
  return t.font === "serif"
    ? "Georgia,'Times New Roman',serif"
    : EMAIL_FONT;
}

/** Only http(s)/mailto links survive; anything else becomes "#". */
export function safeUrl(url: string): string {
  const u = String(url || "").trim();
  if (/^(https?:|mailto:)/i.test(u)) return u;
  return "#";
}

const OWN_HOSTS = /(^|\.)(promunch\.in|trypromunch\.in|a1e4f4-2\.myshopify\.com)$/i;

/** Add utm_* to links that point at our own store (never to other sites). */
export function tagUrl(url: string, utm?: RenderContext["utm"]): string {
  const safe = safeUrl(url);
  if (!utm || !/^https?:/i.test(safe)) return safe;
  try {
    const u = new URL(safe);
    if (!OWN_HOSTS.test(u.hostname)) return safe;
    if (!u.searchParams.has("utm_source")) u.searchParams.set("utm_source", "email");
    if (!u.searchParams.has("utm_medium")) u.searchParams.set("utm_medium", "email");
    if (!u.searchParams.has("utm_campaign")) u.searchParams.set("utm_campaign", utm.campaign);
    if (utm.content && !u.searchParams.has("utm_content")) u.searchParams.set("utm_content", utm.content);
    return u.toString();
  } catch {
    return safe;
  }
}

/**
 * Markdown-lite for text blocks: **bold**, *italic*, [label](url), line
 * breaks, blank line = new paragraph. Everything is escaped first, so a text
 * block can never inject raw HTML.
 */
export function inlineText(src: string, linkColor: string, utm?: RenderContext["utm"]): string {
  let s = esc(src);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => {
    const url = tagUrl(href.replace(/&amp;/g, "&"), utm);
    return `<a href="${esc(url)}" style="color:${linkColor};text-decoration:underline;">${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  return s;
}

function paragraphs(src: string, color: string, align: string, linkColor: string, utm?: RenderContext["utm"]): string {
  return String(src)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:${color};text-align:${align};">${inlineText(p, linkColor, utm).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
}

function row(inner: string, padding = `0 ${PAD}px`): string {
  return `<tr><td style="padding:${padding};">${inner}</td></tr>`;
}

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function buttonHtml(label: string, href: string, t: Theme, variant: "solid" | "outline", font: string): string {
  const solid = variant === "solid";
  const bg = solid ? t.button : "transparent";
  const fg = solid ? t.buttonText : t.button;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;"><tr><td${solid ? ` bgcolor="${bg}"` : ""} style="border-radius:${R}px;background:${bg};border:2px solid ${t.button};"><a href="${esc(href)}" style="display:inline-block;padding:15px 28px;font-family:${font};font-size:15px;line-height:1.2;font-weight:${t.font === "serif" ? 700 : 400};letter-spacing:1px;text-transform:uppercase;color:${fg};text-decoration:none;border-radius:${R}px;">${esc(label)}</a></td></tr></table>`;
}

/**
 * Product card: image, title, price, then a quiet underlined text link. The
 * per-product link is deliberately NOT a solid button so the email keeps one
 * primary call to action (the button block).
 */
function productCell(p: ProductInfo, b: Extract<Block, { type: "products" }>, t: Theme, font: string, ctx: RenderContext): string {
  const href = esc(tagUrl(p.url, ctx.utm));
  const img = p.image
    ? `<a href="${href}"><img src="${esc(p.image)}" alt="${esc(p.title)}" width="100%" style="display:block;width:100%;height:auto;border:1px solid ${BC.line};border-radius:${R}px;"></a>`
    : "";
  const price =
    b.showPrice && p.price != null
      ? `<div style="margin:4px 0 0;font-size:15px;font-weight:700;color:${t.text};">${inr(p.price)}${
          p.compareAt && p.compareAt > p.price
            ? ` <span style="font-weight:400;color:${BC.hint};text-decoration:line-through;font-size:13px;">${inr(p.compareAt)}</span>`
            : ""
        }</div>`
      : "";
  const link = b.buttonLabel
    ? `<div style="margin:8px 0 0;font-size:15px;font-weight:700;"><a href="${href}" style="color:${t.text};text-decoration:underline;">${esc(b.buttonLabel)}</a></div>`
    : "";
  return `${img}<div style="margin-top:10px;font-family:${font};font-size:16px;line-height:1.4;font-weight:700;color:${t.text};">${esc(p.title)}</div>${price}${link}`;
}

function blockHtml(b: Block, ctx: RenderContext, t: Theme, font: string): string {
  const { brand, utm } = ctx;
  switch (b.type) {
    case "logo": {
      // Storefront logo (brand kit override, else promunch.in's header logo)
      // on a white rounded backing so the transparent PNG never vanishes in
      // dark mode; alt text in brand red covers image-off clients.
      const html = logoHtml({
        tagline: b.showTagline ? brand.tagline : null,
        href: brand.website ? tagUrl(brand.website, utm) : null,
        align: b.align,
        logoUrl: brand.logoUrl || EMAIL_BRAND.logoUrl,
        logoWidth: brand.logoWidth,
      });
      return row(html, `24px ${PAD}px 8px`);
    }
    case "heading": {
      const size = b.size === "xl" ? 28 : b.size === "lg" ? 22 : 18;
      return row(
        `<h1 style="margin:0;font-family:${headingStack(t)};font-size:${size}px;line-height:1.2;font-weight:${t.font === "serif" ? 700 : EMAIL_TYPE.headingWeight};color:${t.text};text-align:${b.align};">${inlineText(b.text, t.accent, utm)}</h1>`,
        `16px ${PAD}px 8px`,
      );
    }
    case "text":
      return row(paragraphs(b.text, t.text, b.align, t.accent, utm), `8px ${PAD}px 2px`);
    case "image": {
      if (!b.src) return "";
      const w = b.padded ? WIDTH - PAD * 2 : WIDTH;
      const img = `<img src="${esc(b.src)}" alt="${esc(b.alt)}" width="${w}" style="display:block;width:100%;max-width:${w}px;height:auto;border:0;${b.padded ? "border-radius:${R}px;" : ""}">`;
      const inner = b.href ? `<a href="${esc(tagUrl(b.href, utm))}">${img}</a>` : img;
      return row(inner, b.padded ? `12px ${PAD}px` : "0");
    }
    case "button":
      return row(
        `<div style="text-align:${b.align};">${buttonHtml(b.label, tagUrl(b.href, utm), t, b.variant, headingStack(t))}</div>`,
        `14px ${PAD}px 18px`,
      );
    case "products": {
      const items = b.items.map((id) => ctx.products[id]).filter((p): p is ProductInfo => !!p && p.inStock);
      if (items.length === 0) return "";
      const cols = Math.max(1, Math.min(3, b.columns));
      const gap = 16;
      const cellW = Math.floor((WIDTH - PAD * 2 - gap * (cols - 1)) / cols);
      const rows: string[] = [];
      for (let i = 0; i < items.length; i += cols) {
        const cells = items.slice(i, i + cols);
        const tds = cells
          .map(
            (p, j) =>
              `<td class="pm-col" width="${cellW}" valign="top" style="width:${cellW}px;padding:0 ${j < cols - 1 ? gap : 0}px ${gap}px 0;text-align:center;">${productCell(p, b, t, font, ctx)}</td>`,
          )
          .join("");
        const filler = cells.length < cols ? `<td class="pm-col" width="${cellW}" style="width:${cellW}px;"></td>`.repeat(cols - cells.length) : "";
        rows.push(`<tr>${tds}${filler}</tr>`);
      }
      return row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join("")}</table>`,
        `12px ${PAD}px 4px`,
      );
    }
    case "coupon":
      return row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${BC.panel}" style="background:${BC.panel};border:2px dashed ${t.accent};border-radius:${R}px;padding:20px;text-align:center;">` +
          `<div style="font-family:${headingStack(t)};font-size:18px;line-height:1.3;font-weight:${t.font === "serif" ? 700 : 400};color:${t.text};">${esc(b.headline)}</div>` +
          `<div style="margin:10px 0;font-family:${EMAIL_MONO};font-size:26px;font-weight:700;letter-spacing:3px;color:${t.accent};">${esc(b.code)}</div>` +
          (b.note ? `<div style="font-size:13px;color:${BC.muted};">${esc(b.note)}</div>` : "") +
          `</td></tr></table>`,
        `14px ${PAD}px`,
      );
    case "divider":
      return row(`<div style="border-top:1px solid ${BC.line};height:1px;line-height:1px;font-size:0;">&nbsp;</div>`, `16px ${PAD}px`);
    case "spacer": {
      const h = Math.max(4, Math.min(96, Number(b.size) || 24));
      return `<tr><td style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</td></tr>`;
    }
    case "social": {
      const links = [
        ["Instagram", brand.instagram],
        ["Facebook", brand.facebook],
        ["YouTube", brand.youtube],
        ["Website", brand.website],
      ].filter(([, u]) => !!u && /^https?:/i.test(u));
      if (links.length === 0) return "";
      const html = links
        .map(
          ([label, u]) =>
            `<a href="${esc(tagUrl(u, utm))}" style="display:inline-block;margin:0 8px 6px;font-size:13px;color:${BC.muted};text-decoration:underline;">${label}</a>`,
        )
        .join("");
      return row(`<div style="text-align:${b.align};">${html}</div>`, `12px ${PAD}px`);
    }
  }
}

function footerHtml(ctx: RenderContext): string {
  const address = ctx.brand.footerAddress || EMAIL_BRAND.defaultFooterAddress;
  return `<tr><td style="padding:20px ${PAD}px 24px;border-top:1px solid ${BC.line};">${footerInnerHtml(ctx.unsubscribeUrl, address)}</td></tr>`;
}

/** Replace {{name|fallback}} tags. Values are HTML-escaped. */
export function applyMerge(html: string, merge: Record<string, string | null | undefined>): string {
  return html.replace(/\{\{\s*([a-z_]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/gi, (_m, key: string, fallback?: string) => {
    const v = merge[key.toLowerCase()];
    const out = v != null && String(v).trim() !== "" ? String(v).trim() : (fallback ?? "");
    return esc(out);
  });
}

/** Same tags for plain text (subject lines): no HTML escaping. */
export function mergeText(text: string, merge: Record<string, string | null | undefined>): string {
  return String(text ?? "")
    .replace(/\{\{\s*([a-z_]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/gi, (_m, key: string, fallback?: string) => {
      const v = merge[key.toLowerCase()];
      return v != null && String(v).trim() !== "" ? String(v).trim() : (fallback ?? "");
    })
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Full HTML document for one recipient (or a preview). */
export function renderDesign(design: EmailDesign, ctx: RenderContext): string {
  const t = design.theme;
  const font = fontStack(t);
  const body = design.blocks
    .map((b) => {
      const html = blockHtml(b, ctx, t, font);
      if (!ctx.annotate) return html;
      // Empty blocks (no image yet, no products) still need a clickable row.
      const shown = html || `<tr><td style="padding:14px ${PAD}px;"><div style="border:1px dashed #BBBBBB;border-radius:8px;padding:14px;text-align:center;font-size:13px;color:#767676;">Empty ${esc(b.type)} block: pick it on the left to fill it in</div></td></tr>`;
      return shown.replace(/^<tr>/, `<tr data-bid="${esc(b.id)}">`);
    })
    .join("\n");
  const annotateCss = ctx.annotate
    ? `[data-bid]{cursor:pointer}[data-bid]:hover{outline:1px dashed #111111;outline-offset:-1px}${
        ctx.annotate.selected ? `[data-bid="${esc(ctx.annotate.selected)}"]{outline:2px solid #111111!important;outline-offset:-2px}` : ""
      }`
    : "";
  const pre = ctx.previewText
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(ctx.previewText)}${"&#847;&zwnj;&nbsp;".repeat(40)}</div>`
    : "";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<link href="${EMAIL_FONT_LINK}" rel="stylesheet">
<style>
:root{color-scheme:light;supported-color-schemes:light}
@media only screen and (max-width:620px){
  .pm-card{width:100%!important;border-radius:0!important;border-left:0!important;border-right:0!important}
  .pm-col{display:block!important;width:100%!important;padding-right:0!important}
}
${annotateCss}
</style>
</head>
<body style="margin:0;padding:0;background:${t.background};font-family:${font};color:${t.text};-webkit-text-size-adjust:100%;">
${pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${t.background}" style="background:${t.background};">
<tr><td align="center" style="padding:24px 0;">
<table role="presentation" class="pm-card" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0" bgcolor="${t.content}" style="width:${WIDTH}px;max-width:${WIDTH}px;background:${t.content};border:1px solid ${BC.line};border-radius:${EMAIL_LAYOUT.cardRadius}px;overflow:hidden;font-family:${font};">
${body}
${footerHtml(ctx)}
</table>
</td></tr>
</table>
</body>
</html>`;
  return ctx.merge ? applyMerge(html, ctx.merge) : html;
}

/** Sample values for previews and test sends. */
export const SAMPLE_MERGE: Record<string, string> = {
  first_name: "Asha",
  last_name: "Sharma",
  email: "asha@example.com",
};

export const MERGE_TAGS: { tag: string; label: string }[] = [
  { tag: "{{first_name|there}}", label: "First name (fallback: there)" },
  { tag: "{{last_name}}", label: "Last name" },
  { tag: "{{email}}", label: "Email address" },
];
