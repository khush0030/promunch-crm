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

import { EMAIL_COLORS as C, EMAIL_FONT, EMAIL_HEADING_FONT, EMAIL_LAYOUT, EMAIL_MONO, EMAIL_TYPE, LINK_STYLE, SOCIAL_LINKS, escHtml } from "./brand-tokens";

export { SOCIAL_LINKS };

const FONT = `font-family:${EMAIL_FONT};`;
const HFONT = `font-family:${EMAIL_HEADING_FONT};`;
/** Usable width inside the card (600 minus side padding). */
const INNER = EMAIL_LAYOUT.width - EMAIL_LAYOUT.pad * 2;

/** Style any bare <a> in author HTML black + underlined (keeps explicit styles). */
function styleLinks(html: string): string {
  return html.replace(/<a\b(?![^>]*\bstyle=)([^>]*)>/gi, `<a$1 style="${LINK_STYLE}">`);
}

/**
 * Founder sign-off: round photo (when a public URL is set), name, role and a
 * credential line. Credential verified 2026-09-30: Parth Mutha, Forbes 30 Under
 * 30 Asia 2025 (Food & Drink), per BU MET news + his LinkedIn. Only the photo
 * is optional; with no photo the text still reads as a proper signature.
 */
export const FOUNDER = {
  name: "Parth Mutha",
  role: "Founder, PROMUNCH",
  credential: "Forbes 30 Under 30 Asia 2025",
  /** Public, square, <100KB. Served from public/email/ (middleware skips .jpg). */
  photoUrl: "https://admin.promunch.in/email/parth-headshot.jpg",
} as const;

export function founderSignoff(opts: { photoUrl?: string } = {}): string {
  const photo = (opts.photoUrl ?? FOUNDER.photoUrl).trim();
  const photoCell = /^https:\/\//i.test(photo)
    ? `<td width="76" valign="middle" style="width:76px;padding:0 14px 0 0;"><img src="${escHtml(photo)}" width="64" height="64" alt="${escHtml(FOUNDER.name)}" style="display:block;width:64px;height:64px;border-radius:32px;border:2px solid ${C.brand};object-fit:cover;"></td>`
    : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 8px;"><tr>` +
    photoCell +
    `<td valign="middle" style="${FONT}font-size:${EMAIL_TYPE.body}px;line-height:1.4;color:${C.ink};">` +
    `<strong>${escHtml(FOUNDER.name)}</strong><br>` +
    `<span style="font-size:${EMAIL_TYPE.small}px;color:${C.muted};">${escHtml(FOUNDER.role)}</span><br>` +
    `<span style="font-size:13px;font-weight:700;letter-spacing:.5px;color:${C.brand};">${escHtml(FOUNDER.credential)}</span>` +
    `</td></tr></table>`;
}

/** Rounded feature photo with an optional small caption (e.g. founder story). */
export function photo(src: string, alt: string, caption?: string, width = 400): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;"><tr><td align="center">` +
    `<img src="${escHtml(src)}" width="${width}" alt="${escHtml(alt)}" style="display:block;width:${width}px;max-width:100%;height:auto;border-radius:14px;">` +
    (caption ? `<div style="${FONT}font-size:13px;line-height:1.5;color:${C.muted};margin-top:8px;text-align:center;">${escHtml(caption)}</div>` : "") +
    `</td></tr></table>`;
}

/**
 * Numbered tip card on the cream panel: optional picture on top (store CDN,
 * requested at a small width), then red number + label, then body HTML.
 */
export function tipCard(n: number, title: string, html: string, img?: { src: string; alt: string; href?: string }): string {
  const pic = img
    ? `<tr><td style="padding:0 0 14px;">` +
      (img.href ? `<a href="${escHtml(img.href)}" style="text-decoration:none;">` : "") +
      `<img src="${escHtml(img.src)}" width="${INNER - 36}" alt="${escHtml(img.alt)}" style="display:block;width:100%;max-width:${INNER - 36}px;height:auto;border-radius:10px;">` +
      (img.href ? `</a>` : "") +
      `</td></tr>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;"><tr>` +
    `<td bgcolor="${C.panel}" style="background:${C.panel};border-radius:${EMAIL_LAYOUT.buttonRadius}px;padding:18px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${pic}<tr><td>` +
    `<div style="${FONT}font-size:13px;line-height:1.4;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${C.brand};margin:0 0 6px;">${n}. ${escHtml(title)}</div>` +
    `<div style="${FONT}font-size:${EMAIL_TYPE.body}px;line-height:${EMAIL_TYPE.lineHeight};color:${C.ink};">${styleLinks(html)}</div>` +
    `</td></tr></table></td></tr></table>`;
}

/** Big tappable ★★★★★ row (each star links to the review page) with a caption. */
export function starRating(href: string, caption = "Tap the stars to leave your rating"): string {
  const star = `<a href="${escHtml(href)}" style="display:inline-block;padding:0 4px;font-size:40px;line-height:1;color:${C.brand};text-decoration:none;">&#9733;</a>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;"><tr><td align="center" style="text-align:center;">` +
    star.repeat(5) +
    `<div style="${FONT}font-size:${EMAIL_TYPE.small}px;line-height:1.5;color:${C.muted};margin-top:8px;">${escHtml(caption)}</div>` +
    `</td></tr></table>`;
}

/** Small uppercase red label above a headline, e.g. "A note from our founder". */
export function eyebrow(text: string): string {
  return `<p style="margin:0 0 8px;${FONT}font-size:13px;line-height:1.4;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${C.brand};">${escHtml(text)}</p>`;
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
export function button(
  label: string,
  href: string,
  variant: "solid" | "outline" = "solid",
  opts: { full?: boolean } = {},
): string {
  const solid = variant === "solid";
  const bg = solid ? C.brand : C.card;
  const fg = solid ? C.onBrand : C.brand;
  const r = EMAIL_LAYOUT.buttonRadius;
  // Full width = one big thumb target on mobile, centred label.
  const width = opts.full ? ` width="100%"` : "";
  const aDisplay = opts.full ? "display:block;text-align:center;padding:18px 20px;" : "display:inline-block;padding:15px 28px;";
  return `<table role="presentation"${width} cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr>` +
    `<td bgcolor="${bg}" align="center" style="background:${bg};border:2px solid ${C.brand};border-radius:${r}px;">` +
    `<a href="${escHtml(href)}" style="${aDisplay}${HFONT}font-size:16px;line-height:1.2;font-weight:400;letter-spacing:1px;text-transform:uppercase;color:${fg};text-decoration:none;border-radius:${r}px;">${escHtml(label)}</a>` +
    `</td></tr></table>`;
}

/**
 * "Follow the crunch" row for relationship emails (welcome, how-to, reviews,
 * VIP, anniversary). Text links, not icon images: Gmail/Outlook block images
 * by default and icons then show as broken boxes. Deliberately NOT used in
 * sales emails (cart, browse, win-back) where it would pull clicks off the CTA.
 */
export function socialRow(): string {
  const link = (label: string, href: string) =>
    `<a href="${escHtml(href)}" style="display:inline-block;margin:4px 6px;padding:8px 14px;border:1px solid ${C.brand};border-radius:${EMAIL_LAYOUT.buttonRadius}px;${FONT}font-size:${EMAIL_TYPE.small}px;font-weight:700;color:${C.brand};text-decoration:none;">${label}</a>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;"><tr><td align="center" style="text-align:center;">` +
    `<div style="${FONT}font-size:${EMAIL_TYPE.small}px;line-height:1.5;color:${C.muted};margin:0 0 6px;">Follow the crunch <b style="color:${C.ink};">@promunch.snacks</b></div>` +
    link("Instagram", SOCIAL_LINKS.instagram) +
    link("Facebook", SOCIAL_LINKS.facebook) +
    link("YouTube", SOCIAL_LINKS.youtube) +
    `</td></tr></table>`;
}

/** Small reassurance row (e.g. free shipping, COD, reply for help), centred, muted. */
export function trustRow(items: string[]): string {
  const cells = items.map((t) => escHtml(t)).join(`&nbsp;&nbsp;<span style="color:${C.line};">|</span>&nbsp;&nbsp;`);
  return `<p style="margin:0 0 20px;${FONT}font-size:${EMAIL_TYPE.small}px;line-height:1.6;color:${C.muted};text-align:center;">${cells}</p>`;
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
