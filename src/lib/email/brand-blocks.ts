// Brand building blocks for flow email bodies (flow-templates.ts). Each
// function returns an email-safe, inline-styled HTML string in the one
// PROMUNCH storefront style (tokens in brand-tokens.ts). The result is
// dropped into renderMarketingEmail() (designed) or renderPlainMarketingEmail()
// (founder note), which add the logo, card and compliance footer.
//
// Text arguments are HTML-escaped, except p(html), which takes trusted author
// HTML (links, bold). {{merge}} tags pass through untouched so personalize.ts
// can fill them later (e.g. couponBox("{{coupon}}", ...)).
//
// Keep imports relative: vitest has no "@/" alias.

import { EMAIL_COLORS as C, EMAIL_FONT, EMAIL_HEADING_FONT, EMAIL_LAYOUT, EMAIL_MONO, EMAIL_TYPE, LINK_STYLE, escHtml } from "./brand-tokens";

const FONT = `font-family:${EMAIL_FONT};`;
const HFONT = `font-family:${EMAIL_HEADING_FONT};`;
/** Usable width inside the card (600 minus side padding). */
const INNER = EMAIL_LAYOUT.width - EMAIL_LAYOUT.pad * 2;

/** Style any bare <a> in author HTML black + underlined (keeps explicit styles). */
function styleLinks(html: string): string {
  return html.replace(/<a\b(?![^>]*\bstyle=)([^>]*)>/gi, `<a$1 style="${LINK_STYLE}">`);
}

export function h1(text: string): string {
  return `<h1 style="margin:0 0 16px;${HFONT}font-size:${EMAIL_TYPE.h1}px;line-height:1.2;font-weight:${EMAIL_TYPE.headingWeight};color:${C.ink};">${escHtml(text)}</h1>`;
}

/** Paragraph. `html` may contain trusted inline HTML (links, <strong>). */
export function p(html: string): string {
  return `<p style="margin:0 0 16px;${FONT}font-size:${EMAIL_TYPE.body}px;line-height:${EMAIL_TYPE.lineHeight};color:${C.ink};">${styleLinks(html)}</p>`;
}

/**
 * Bulletproof button (table cell carries the colour so Outlook keeps it).
 * solid = brand red with white text, uppercase Archivo Black like the site's
 * CTAs (the one primary CTA); outline = white with a red border + red text.
 */
export function button(label: string, href: string, variant: "solid" | "outline" = "solid"): string {
  const solid = variant === "solid";
  const bg = solid ? C.brand : C.card;
  const fg = solid ? C.onBrand : C.brand;
  const r = EMAIL_LAYOUT.buttonRadius;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr>` +
    `<td bgcolor="${bg}" style="background:${bg};border:2px solid ${C.brand};border-radius:${r}px;">` +
    `<a href="${escHtml(href)}" style="display:inline-block;padding:15px 28px;${HFONT}font-size:15px;line-height:1.2;font-weight:400;letter-spacing:1px;text-transform:uppercase;color:${fg};text-decoration:none;border-radius:${r}px;">${escHtml(label)}</a>` +
    `</td></tr></table>`;
}

/** Coupon panel. `code` may be a merge tag like {{coupon}}. */
export function couponBox(code: string, headline: string, note?: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr>` +
    `<td bgcolor="${C.panel}" style="background:${C.panel};border:2px dashed ${C.brand};border-radius:${EMAIL_LAYOUT.buttonRadius}px;padding:20px;text-align:center;">` +
    `<div style="${HFONT}font-size:18px;line-height:1.3;font-weight:400;color:${C.ink};">${escHtml(headline)}</div>` +
    `<div style="margin:10px 0 6px;font-family:${EMAIL_MONO};font-size:26px;line-height:1.2;font-weight:700;letter-spacing:3px;color:${C.brand};">${escHtml(code)}</div>` +
    (note ? `<div style="${FONT}font-size:${EMAIL_TYPE.small}px;line-height:1.5;color:${C.muted};">${escHtml(note)}</div>` : "") +
    `</td></tr></table>`;
}

/**
 * 1 to 3 product cards. Fluid-hybrid layout: each card is an inline-block
 * with a max-width, so cards sit side by side on desktop and stack on phones
 * with no media query (works in the Gmail app, which drops <style>).
 */
export function productGrid(items: { title: string; url: string; image?: string; price?: string }[]): string {
  const list = items.slice(0, 3);
  if (list.length === 0) return "";
  const cols = list.length;
  const gap = 16;
  const cardW = Math.floor((INNER - gap * (cols - 1)) / cols);
  const cards = list
    .map((it, i) => {
      const href = escHtml(it.url);
      const img = it.image
        ? `<a href="${href}" style="text-decoration:none;"><img src="${escHtml(it.image)}" alt="${escHtml(it.title)}" width="${cardW}" style="display:block;width:100%;max-width:${cardW}px;height:auto;border:1px solid ${C.line};border-radius:${EMAIL_LAYOUT.buttonRadius}px;"></a>`
        : "";
      const price = it.price
        ? `<div style="margin-top:4px;${FONT}font-size:15px;line-height:1.4;font-weight:700;color:${C.ink};">${escHtml(it.price)}</div>`
        : "";
      const right = i < cols - 1 ? gap : 0;
      return `<div style="display:inline-block;width:100%;max-width:${cardW}px;vertical-align:top;margin:0 ${right}px ${gap}px 0;text-align:left;">` +
        img +
        `<div style="margin-top:10px;${FONT}font-size:${EMAIL_TYPE.body}px;line-height:1.4;font-weight:700;"><a href="${href}" style="color:${C.ink};text-decoration:underline;">${escHtml(it.title)}</a></div>` +
        price +
        `</div>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 8px;"><tr>` +
    `<td style="font-size:0;line-height:0;text-align:left;">${cards}</td></tr></table>`;
}

/** Customer quote with optional 1 to 5 stars. */
export function reviewQuote(text: string, author: string, stars?: number): string {
  const n = stars == null ? 0 : Math.max(0, Math.min(5, Math.round(stars)));
  const starRow = n
    ? `<div style="margin:0 0 8px;${FONT}font-size:18px;line-height:1;letter-spacing:2px;color:${C.brand};">${"&#9733;".repeat(n)}${"&#9734;".repeat(5 - n)}</div>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr>` +
    `<td style="border-left:3px solid ${C.brand};padding:4px 0 4px 16px;">` +
    starRow +
    `<div style="${FONT}font-size:${EMAIL_TYPE.body}px;line-height:${EMAIL_TYPE.lineHeight};font-style:italic;color:${C.ink};">&ldquo;${escHtml(text)}&rdquo;</div>` +
    `<div style="margin-top:6px;${FONT}font-size:${EMAIL_TYPE.small}px;line-height:1.4;color:${C.muted};">${escHtml(author)}</div>` +
    `</td></tr></table>`;
}

export function divider(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr>` +
    `<td style="border-top:1px solid ${C.line};height:1px;line-height:1px;font-size:0;">&nbsp;</td></tr></table>`;
}

/** Sign-off, e.g. signature("Parth", "Founder, PROMUNCH"). */
export function signature(name: string, role: string): string {
  return `<p style="margin:24px 0 0;${FONT}font-size:${EMAIL_TYPE.body}px;line-height:1.5;color:${C.ink};">` +
    `<strong>${escHtml(name)}</strong><br><span style="font-size:${EMAIL_TYPE.small + 1}px;color:${C.muted};">${escHtml(role)}</span></p>`;
}
