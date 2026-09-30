// ONE source of truth for how every PROMUNCH customer email looks: flow
// emails (layout.ts), founder notes (plain-layout.ts), flow body blocks
// (brand-blocks.ts), cart items, and the Email Studio default theme
// (email-studio/design.ts + render.ts).
//
// Values are taken from the live storefront, https://promunch.in (Sep 30 2026),
// so email matches the site:
//   red     #AF272F  custom sections --accent / --psm-accent, logo, CTA buttons
//   red dk  #8E1F26  custom sections --accent-deep
//   ink     #1A1714  custom sections --ink
//   ink-2   #4A453F  custom sections --ink-2 (secondary text)
//   mute    #8A8278  custom sections --mute (struck-through prices only)
//   hair    #E5E0D6  custom sections --hair (dividers, borders)
//   paper   #FFFFFF  custom sections --paper / --bg (the card)
//   cream   #F4F1EA  Shopify theme scheme-1 --color-background (page)
//   heading 'Archivo Black' 400, uppercase CTAs: --fdisp / --font-heading-family
//   body    'Assistant' (--fbody, computed body font), fallback the theme's
//           --font-body-family "Helvetica, Arial, sans-serif"
//   buttons 14px radius (computed on "SHOP THE LINEUP" / "JOIN" CTAs)
//   logo    header <img> //promunch.in/cdn/shop/files/promuch.png (red wordmark,
//           transparent PNG, so it sits on a white backing for dark mode)
//
// Simplicity rules still apply (Porcellia checklist): one red CTA, few
// images, 16px body, dark-mode safe, minimal footer.
//
// Pure constants, no imports: safe for the browser builder, vitest (no "@/"
// alias) and server code alike.

export const EMAIL_COLORS = {
  /** Brand red: CTAs, logo, links, coupon border. */
  brand: "#AF272F",
  /** Deeper red: festive page background, pressed/hover shade. */
  brandDeep: "#8E1F26",
  /** Body text and headings. */
  ink: "#1A1714",
  /** Secondary text: tagline, notes, captions, footer. 9:1 on white. */
  muted: "#4A453F",
  /** Struck-through compare-at prices. */
  hint: "#8A8278",
  /** Page background around the card (storefront cream). */
  page: "#F4F1EA",
  /** The email card. */
  card: "#FFFFFF",
  /** Hairline dividers and borders. */
  line: "#E5E0D6",
  /** Soft panel fill (coupon box). */
  panel: "#F4F1EA",
  /** Text on a solid (red) button. */
  onBrand: "#FFFFFF",
} as const;

/** Web fonts the storefront uses. Loaded via <link>; Apple Mail/iOS render them. */
export const EMAIL_FONT_LINK =
  "https://fonts.googleapis.com/css2?family=Archivo+Black&family=Assistant:wght@400;700&display=swap";
/** Body: Assistant, falling back to the theme's own Helvetica/Arial. */
export const EMAIL_FONT = "Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif";
/** Headings + buttons: Archivo Black, falling back to Arial Black (Gmail/Outlook). */
export const EMAIL_HEADING_FONT = "'Archivo Black','Arial Black',Arial,Helvetica,sans-serif";
export const EMAIL_MONO = "'Courier New',Courier,monospace";

export const EMAIL_TYPE = {
  body: 16,
  lineHeight: 1.6,
  h1: 28,
  h2: 22,
  small: 14,
  footer: 12,
  /** Archivo Black is a single heavy weight, set at 400 like the site. */
  headingWeight: 400,
} as const;

export const EMAIL_LAYOUT = {
  width: 600,
  pad: 28,
  cardRadius: 14,
  buttonRadius: 14,
} as const;

export const EMAIL_BRAND = {
  wordmark: "PROMUNCH",
  tagline: "Your Munchy Pal",
  website: "https://promunch.in",
  /** Storefront header logo (red wordmark, 4.17:1, transparent PNG). */
  logoUrl: "https://promunch.in/cdn/shop/files/promuch.png?v=1784261565&width=400",
  logoWidth: 160,
  defaultFooterAddress: "PROMUNCH, 28, AB Rd, Industrial Area No. 1, Dewas, Madhya Pradesh 455001",
} as const;

/** Footer postal address: env override, else the real PROMUNCH address. */
export function emailFooterAddress(): string {
  return (typeof process !== "undefined" && process.env?.EMAIL_FOOTER_ADDRESS) || EMAIL_BRAND.defaultFooterAddress;
}

/** Inline style for links in body copy: brand red, underlined. */
/** Official PROMUNCH socials, as linked from the promunch.in site footer. */
export const SOCIAL_LINKS = {
  instagram: "https://www.instagram.com/promunch.snacks",
  facebook: "https://www.facebook.com/promunch.snacks",
  youtube: "https://www.youtube.com/@PromunchYourMunchyPal",
} as const;

export const LINK_STYLE = `color:${EMAIL_COLORS.brand};text-decoration:underline;`;

/** HTML escape for text and attribute values. Leaves {{merge}} tags intact. */
export function escHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Storefront logo on a white rounded backing (so the transparent PNG never
 * vanishes in dark mode), linked to the site, with the tagline in small grey.
 * alt="PROMUNCH" in brand red covers image-off clients.
 */
export function logoHtml(opts: { tagline?: string | null; href?: string | null; align?: "left" | "center"; logoUrl?: string; logoWidth?: number } = {}): string {
  const C = EMAIL_COLORS;
  const align = opts.align ?? "center";
  const url = opts.logoUrl || EMAIL_BRAND.logoUrl;
  const w = opts.logoWidth || EMAIL_BRAND.logoWidth;
  const img = `<img src="${escHtml(url)}" alt="${EMAIL_BRAND.wordmark}" width="${w}" style="display:block;width:${w}px;max-width:100%;height:auto;border:0;font-family:${EMAIL_HEADING_FONT};font-size:24px;color:${C.brand};">`;
  const linked = opts.href ? `<a href="${escHtml(opts.href)}" style="text-decoration:none;">${img}</a>` : img;
  const box = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align}" style="${align === "center" ? "margin:0 auto;" : ""}"><tr><td bgcolor="${C.card}" style="background:${C.card};border-radius:8px;padding:6px 10px;">${linked}</td></tr></table>`;
  const tag = opts.tagline
    ? `<div style="margin-top:2px;font-family:${EMAIL_FONT};font-size:13px;line-height:1.4;font-style:italic;color:${C.muted};text-align:${align};">${escHtml(opts.tagline)}</div>`
    : "";
  return `<div style="text-align:${align};">${box}${tag}</div>`;
}

/** Minimal compliance footer: why you got it, unsubscribe, postal address. */
export function footerInnerHtml(unsubscribeUrl: string, address: string, align: "left" | "center" = "center"): string {
  const C = EMAIL_COLORS;
  return `<div style="font-family:${EMAIL_FONT};font-size:${EMAIL_TYPE.footer}px;line-height:1.6;color:${C.muted};text-align:${align};">` +
    `You are receiving this because you subscribed to PROMUNCH email. ` +
    `<a href="${escHtml(unsubscribeUrl)}" style="color:${C.muted};text-decoration:underline;">Unsubscribe</a><br>` +
    `${escHtml(address)}</div>`;
}

/**
 * <head> shared by every email. Loads the storefront fonts (Apple Mail, iOS,
 * some Android use them; Gmail/Outlook fall back to the web-safe stacks).
 * Light-only colour scheme so Apple Mail / iOS don't half-invert the design.
 * The small <style> only styles bare links/paragraphs and phone widths; the
 * email still reads correctly where clients strip it.
 */
export function emailHead(): string {
  return `<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<link href="${EMAIL_FONT_LINK}" rel="stylesheet">
<style>
:root{color-scheme:light;supported-color-schemes:light}
a{color:${EMAIL_COLORS.brand};text-decoration:underline}
p{margin:0 0 16px}
@media only screen and (max-width:620px){
  .pm-card{width:100%!important;border-radius:0!important;border-left:0!important;border-right:0!important}
  .pm-pad{padding-left:20px!important;padding-right:20px!important}
  .pm-col{display:block!important;width:100%!important;padding-right:0!important}
}
</style>
</head>`;
}

export function preheaderHtml(previewText?: string): string {
  return previewText
    // Filler after the preview so clients (Apple Mail shows ~3 lines) don't
    // pull in the next visible text, e.g. the "Your Munchy Pal" tagline.
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escHtml(previewText)}${"&#8199;&#65279;&#847;&zwnj;&nbsp;".repeat(120)}</div>`
    : "";
}
