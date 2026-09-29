// Design → email-safe HTML. Table layout + inline styles (what Gmail, Outlook
// and Apple Mail all agree on), a 600px card, one small <style> block only
// for mobile stacking. The compliance footer (unsubscribe + postal address)
// is always appended and cannot be removed from the builder.
//
// Pure + isomorphic: the builder preview and the sender run this same code.
// Keep imports relative: vitest has no "@/" alias.

import type { Block, BrandKit, EmailDesign, ProductInfo, Theme } from "./design";

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

const WIDTH = 600;
const PAD = 28;

export function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fontStack(t: Theme): string {
  return t.font === "serif"
    ? "Georgia,'Times New Roman',serif"
    : "'Helvetica Neue',Helvetica,Arial,sans-serif";
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
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;"><tr><td style="border-radius:8px;background:${bg};border:2px solid ${t.button};"><a href="${esc(href)}" style="display:inline-block;padding:13px 26px;font-family:${font};font-size:16px;font-weight:700;color:${fg};text-decoration:none;border-radius:8px;">${esc(label)}</a></td></tr></table>`;
}

function productCell(p: ProductInfo, b: Extract<Block, { type: "products" }>, t: Theme, font: string, ctx: RenderContext): string {
  const href = esc(tagUrl(p.url, ctx.utm));
  const img = p.image
    ? `<a href="${href}"><img src="${esc(p.image)}" alt="${esc(p.title)}" width="100%" style="display:block;width:100%;height:auto;border:0;border-radius:10px;"></a>`
    : "";
  const price =
    b.showPrice && p.price != null
      ? `<div style="margin:6px 0 10px;font-size:15px;font-weight:700;color:${t.text};">${inr(p.price)}${
          p.compareAt && p.compareAt > p.price
            ? ` <span style="font-weight:400;color:#8A7F83;text-decoration:line-through;font-size:13px;">${inr(p.compareAt)}</span>`
            : ""
        }</div>`
      : `<div style="height:10px;"></div>`;
  const btn = b.buttonLabel ? buttonHtml(b.buttonLabel, tagUrl(p.url, ctx.utm), t, "solid", font) : "";
  return `${img}<div style="margin-top:10px;font-size:14px;line-height:1.4;font-weight:600;color:${t.text};">${esc(p.title)}</div>${price}${btn}`;
}

function blockHtml(b: Block, ctx: RenderContext, t: Theme, font: string): string {
  const { brand, utm } = ctx;
  switch (b.type) {
    case "logo": {
      const logo = brand.logoUrl
        ? `<img src="${esc(brand.logoUrl)}" alt="PROMUNCH" width="${brand.logoWidth}" style="display:inline-block;width:${brand.logoWidth}px;max-width:100%;height:auto;border:0;">`
        : `<div style="font-size:28px;font-weight:900;letter-spacing:1px;color:${t.accent};">PROMUNCH</div>`;
      const tag =
        b.showTagline && brand.tagline
          ? `<div style="margin-top:4px;font-size:13px;font-style:italic;color:#8A7F83;">${esc(brand.tagline)}</div>`
          : "";
      const linked = brand.website ? `<a href="${esc(tagUrl(brand.website, utm))}" style="text-decoration:none;">${logo}</a>` : logo;
      return row(`<div style="text-align:${b.align};">${linked}${tag}</div>`, `24px ${PAD}px 8px`);
    }
    case "heading": {
      const size = b.size === "xl" ? 32 : b.size === "lg" ? 26 : 20;
      return row(
        `<h1 style="margin:0;font-family:${font};font-size:${size}px;line-height:1.25;font-weight:800;color:${t.text};text-align:${b.align};">${inlineText(b.text, t.accent, utm)}</h1>`,
        `16px ${PAD}px 8px`,
      );
    }
    case "text":
      return row(paragraphs(b.text, t.text, b.align, t.accent, utm), `8px ${PAD}px 2px`);
    case "image": {
      if (!b.src) return "";
      const w = b.padded ? WIDTH - PAD * 2 : WIDTH;
      const img = `<img src="${esc(b.src)}" alt="${esc(b.alt)}" width="${w}" style="display:block;width:100%;max-width:${w}px;height:auto;border:0;${b.padded ? "border-radius:12px;" : ""}">`;
      const inner = b.href ? `<a href="${esc(tagUrl(b.href, utm))}">${img}</a>` : img;
      return row(inner, b.padded ? `12px ${PAD}px` : "0");
    }
    case "button":
      return row(
        `<div style="text-align:${b.align};">${buttonHtml(b.label, tagUrl(b.href, utm), t, b.variant, font)}</div>`,
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
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border:2px dashed ${t.accent};border-radius:12px;padding:20px;text-align:center;">` +
          `<div style="font-size:17px;font-weight:700;color:${t.text};">${esc(b.headline)}</div>` +
          `<div style="margin:10px 0;font-family:'Courier New',Courier,monospace;font-size:26px;font-weight:700;letter-spacing:3px;color:${t.accent};">${esc(b.code)}</div>` +
          (b.note ? `<div style="font-size:13px;color:#5C5155;">${esc(b.note)}</div>` : "") +
          `</td></tr></table>`,
        `14px ${PAD}px`,
      );
    case "divider":
      return row(`<div style="border-top:1px solid #E4DFDD;height:1px;line-height:1px;font-size:0;">&nbsp;</div>`, `16px ${PAD}px`);
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
            `<a href="${esc(tagUrl(u, utm))}" style="display:inline-block;margin:0 6px 6px;padding:7px 14px;border:1px solid #E4DFDD;border-radius:999px;font-size:13px;font-weight:600;color:${t.text};text-decoration:none;">${label}</a>`,
        )
        .join("");
      return row(`<div style="text-align:${b.align};">${html}</div>`, `12px ${PAD}px`);
    }
  }
}

function footerHtml(ctx: RenderContext): string {
  const address = ctx.brand.footerAddress || "PROMUNCH, 28, AB Rd, Industrial Area No. 1, Dewas, Madhya Pradesh 455001";
  return `<tr><td style="padding:22px ${PAD}px 26px;border-top:1px solid #EFECEA;font-size:12px;line-height:1.6;color:#8A7F83;text-align:center;">
You are receiving this because you subscribed to PROMUNCH email.<br>
<a href="${esc(ctx.unsubscribeUrl)}" style="color:#5C5155;text-decoration:underline;">Unsubscribe</a> at any time.<br>
${esc(address)}
</td></tr>`;
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
      const shown = html || `<tr><td style="padding:14px ${PAD}px;"><div style="border:1px dashed #C9C0BC;border-radius:8px;padding:14px;text-align:center;font-size:13px;color:#8A7F83;">Empty ${esc(b.type)} block: pick it on the left to fill it in</div></td></tr>`;
      return shown.replace(/^<tr>/, `<tr data-bid="${esc(b.id)}">`);
    })
    .join("\n");
  const annotateCss = ctx.annotate
    ? `[data-bid]{cursor:pointer}[data-bid]:hover{outline:1px dashed #AF272F;outline-offset:-1px}${
        ctx.annotate.selected ? `[data-bid="${esc(ctx.annotate.selected)}"]{outline:2px solid #AF272F!important;outline-offset:-2px}` : ""
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
<style>
@media only screen and (max-width:620px){
  .pm-card{width:100%!important;border-radius:0!important}
  .pm-col{display:block!important;width:100%!important;padding-right:0!important}
}
${annotateCss}
</style>
</head>
<body style="margin:0;padding:0;background:${t.background};font-family:${font};color:${t.text};-webkit-text-size-adjust:100%;">
${pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${t.background};">
<tr><td align="center" style="padding:24px 0;">
<table role="presentation" class="pm-card" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:${WIDTH}px;max-width:${WIDTH}px;background:${t.content};border-radius:16px;overflow:hidden;font-family:${font};">
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
