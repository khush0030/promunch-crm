// WhatsApp growth embed: the opt-in popup + chat widget shown on the storefront.
// Config is edited in the dashboard visual editor (WhatsApp → Growth) and served
// live by /api/public/wa-embed, so copy/colour/targeting changes go live on
// promunch.in within minutes — no theme edit, ever.
//
// The SAME markup functions (renderPopupInner / renderWidgetInner) power both
// the storefront embed and the dashboard live preview, so what staff see is
// exactly what a visitor sees. buildEmbedJs wraps that markup with behaviour
// (targeting triggers, form submit, frequency cap).

import { POPUP_CONSENT_TEXT, POPUP_EMAIL_CONSENT_TEXT } from "./wa-engagement";
import { buildCartRequestEmbed } from "./wa-cart-embed";

/* ----------------------------- types ----------------------------- */

export type PopupTrigger =
  | { type: "immediate" }
  | { type: "delay"; seconds: number }
  | { type: "scroll"; percent: number }
  | { type: "exit" };

export type PageRule = "all" | "home" | "product" | "cart";
export type PopupPosition = "center" | "bottom-right" | "bottom-left" | "bottom-bar";
// Ready-made card layouts the user picks from a gallery.
export type PopupLayout = "promunch" | "text" | "image-top" | "image-left" | "image-right" | "background" | "compact";
export const LAYOUTS_NEEDING_IMAGE: PopupLayout[] = ["image-top", "image-left", "image-right", "background"];

/** Email field on the popup: hidden, optional next to the phone, or required. */
export type PopupEmailMode = "off" | "optional" | "required";

export type PopupConfig = {
  enabled: boolean;
  email: PopupEmailMode;
  /** Shown with a copy button after sign-up. Must exist in Shopify. */
  discountCode: string;
  /** PROMUNCH layout: small mono label ("★ MEMBERS ONLY") and the big offer ("10% OFF"). */
  eyebrow: string;
  badge: string;
  headline: string;
  sub: string;
  cta: string;
  successTitle: string;
  successBody: string;
  imageUrl: string | null;
  layout: PopupLayout;
  theme: {
    bg: string;
    text: string;
    accent: string;
    accentText: string;
    font: string;
    radius: number;
  };
  position: PopupPosition;
  trigger: PopupTrigger;
  frequencyDays: number;
  pages: PageRule;
};

export type WidgetConfig = {
  enabled: boolean;
  greeting: string;
  theme: { button: string; bubbleBg: string; bubbleText: string };
  side: "right" | "left";
  delaySec: number;
  showOnMobile: boolean;
};

export type GrowthConfig = { popup: PopupConfig; widget: WidgetConfig };

/* ----------------------------- fonts ----------------------------- */

// Font stacks use SINGLE quotes on purpose: the markup renders inside a
// double-quoted style="…" attribute, so a double-quoted family name would
// terminate the attribute early and break the whole card's styling.
export const FONTS: Record<string, { label: string; stack: string; google: string | null }> = {
  system: { label: "System (fast)", stack: `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif`, google: null },
  poppins: { label: "Poppins", stack: `'Poppins',sans-serif`, google: "Poppins:wght@400;600;700;800" },
  inter: { label: "Inter", stack: `'Inter',sans-serif`, google: "Inter:wght@400;600;700;800" },
  montserrat: { label: "Montserrat", stack: `'Montserrat',sans-serif`, google: "Montserrat:wght@400;600;700;800" },
  nunito: { label: "Nunito (rounded)", stack: `'Nunito',sans-serif`, google: "Nunito:wght@400;700;800" },
  playfair: { label: "Playfair (elegant serif)", stack: `'Playfair Display',Georgia,serif`, google: "Playfair+Display:wght@500;700;800" },
  georgia: { label: "Georgia (serif)", stack: `Georgia,'Times New Roman',serif`, google: null },
  archivo: { label: "Archivo Black (promunch.in)", stack: `'Archivo Black','Archivo',Impact,sans-serif`, google: "Archivo+Black" },
};

export function fontStack(key: string): string {
  return (FONTS[key] ?? FONTS.system).stack;
}
export function fontHref(key: string): string | null {
  const g = FONTS[key]?.google;
  return g ? `https://fonts.googleapis.com/css2?family=${g}&display=swap` : null;
}

/* --------------------------- defaults --------------------------- */

export const GROWTH_DEFAULTS: GrowthConfig = {
  popup: {
    enabled: true,
    email: "optional",
    discountCode: "",
    eyebrow: "★ Members only",
    badge: "10% off",
    headline: "Get PROMUNCH offers on WhatsApp",
    sub: "Join PROMUNCH for launch drops and member deals. Your Munchy Pal is one text away.",
    cta: "Join on WhatsApp",
    successTitle: "You're in! 🎉",
    successBody: "Offers and new launches, straight from Your Munchy Pal.",
    imageUrl: null,
    layout: "promunch",
    // promunch.in's own palette: brick red, white, near-black ink.
    theme: { bg: "#FFFFFF", text: "#121212", accent: "#AF272F", accentText: "#FFFFFF", font: "archivo", radius: 0 },
    position: "center",
    trigger: { type: "delay", seconds: 6 },
    frequencyDays: 15,
    pages: "all",
  },
  widget: {
    enabled: true,
    greeting: "Questions? Chat with Your Munchy Pal 🌱",
    theme: { button: "#25D366", bubbleBg: "#FFFFFF", bubbleText: "#2B2118" },
    side: "right",
    delaySec: 4,
    showOnMobile: true,
  },
};

/* --------------------------- normalize --------------------------- */

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const clampNum = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
};
const color = (v: unknown, d: string) => (typeof v === "string" && HEX.test(v.trim()) ? v.trim() : d);
const str = (v: unknown, d: string, max: number) => {
  const s = typeof v === "string" ? v : d;
  return s.slice(0, max);
};

function normTrigger(raw: unknown): PopupTrigger {
  const t = (raw ?? {}) as { type?: string; seconds?: number; percent?: number };
  if (t.type === "immediate") return { type: "immediate" };
  if (t.type === "scroll") return { type: "scroll", percent: clampNum(t.percent, 5, 100, 40) };
  if (t.type === "exit") return { type: "exit" };
  return { type: "delay", seconds: clampNum(t.seconds, 0, 300, 6) };
}

export function normalizeGrowthConfig(raw: unknown): GrowthConfig {
  const r = (raw ?? {}) as Partial<GrowthConfig>;
  const p = { ...GROWTH_DEFAULTS.popup, ...(r.popup ?? {}) } as PopupConfig;
  const pt = { ...GROWTH_DEFAULTS.popup.theme, ...((r.popup?.theme ?? {}) as object) };
  const w = { ...GROWTH_DEFAULTS.widget, ...(r.widget ?? {}) } as WidgetConfig;
  const wt = { ...GROWTH_DEFAULTS.widget.theme, ...((r.widget?.theme ?? {}) as object) };

  const pos: PopupPosition = ["center", "bottom-right", "bottom-left", "bottom-bar"].includes(p.position) ? p.position : "center";
  const pages: PageRule = ["all", "home", "product", "cart"].includes(p.pages) ? p.pages : "all";
  const imageUrl = typeof p.imageUrl === "string" && /^https?:\/\//.test(p.imageUrl) ? p.imageUrl : null;

  // Layout: validate; migrate the old imageLayout (none|top|side) if present.
  const LAYOUTS: PopupLayout[] = ["promunch", "text", "image-top", "image-left", "image-right", "background", "compact"];
  const legacy = (p as { imageLayout?: string }).imageLayout;
  const layout: PopupLayout = LAYOUTS.includes(p.layout) ? p.layout
    : legacy === "top" ? "image-top" : legacy === "side" ? "image-left" : "text";

  return {
    popup: {
      enabled: !!p.enabled,
      email: p.email === "off" || p.email === "required" ? p.email : "optional",
      discountCode: str(p.discountCode, "", 40).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, ""),
      eyebrow: str(p.eyebrow, GROWTH_DEFAULTS.popup.eyebrow, 40),
      badge: str(p.badge, GROWTH_DEFAULTS.popup.badge, 16),
      headline: str(p.headline, GROWTH_DEFAULTS.popup.headline, 120),
      sub: str(p.sub, GROWTH_DEFAULTS.popup.sub, 240),
      cta: str(p.cta, GROWTH_DEFAULTS.popup.cta, 40) || "Join",
      successTitle: str(p.successTitle, GROWTH_DEFAULTS.popup.successTitle, 80),
      successBody: str(p.successBody, GROWTH_DEFAULTS.popup.successBody, 200),
      imageUrl,
      layout,
      theme: {
        bg: color(pt.bg, "#FFF8F0"),
        text: color(pt.text, "#2B2118"),
        accent: color(pt.accent, "#25D366"),
        accentText: color(pt.accentText, "#FFFFFF"),
        font: FONTS[pt.font] ? pt.font : "archivo",
        radius: clampNum(pt.radius, 0, 32, 0),
      },
      position: pos,
      trigger: normTrigger(p.trigger),
      frequencyDays: clampNum(p.frequencyDays, 0, 365, 15),
      pages,
    },
    widget: {
      enabled: !!w.enabled,
      greeting: str(w.greeting, GROWTH_DEFAULTS.widget.greeting, 120),
      theme: {
        button: color(wt.button, "#25D366"),
        bubbleBg: color(wt.bubbleBg, "#FFFFFF"),
        bubbleText: color(wt.bubbleText, "#2B2118"),
      },
      side: w.side === "left" ? "left" : "right",
      delaySec: clampNum(w.delaySec, 0, 120, 4),
      showOnMobile: w.showOnMobile !== false,
    },
  };
}

/* ---------------------------- markup ---------------------------- */

/** The exact consent sentence a visitor sees (and that we store with the opt-in). */
export function popupConsentText(cfg: Pick<PopupConfig, "email">): string {
  return cfg.email === "off" ? POPUP_CONSENT_TEXT : POPUP_EMAIL_CONSENT_TEXT;
}

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const WA_ICON = `<svg viewBox="0 0 32 32" width="26" height="26" fill="currentColor"><path d="M16 3C9.4 3 4 8.3 4 14.9c0 2.1.6 4.1 1.6 5.9L4 29l8.4-1.6c1.7.9 3.6 1.4 5.6 1.4 6.6 0 12-5.3 12-11.9S22.6 3 16 3zm0 21.8c-1.8 0-3.5-.5-5-1.3l-.4-.2-5 1 1-4.8-.3-.4c-1-1.6-1.5-3.4-1.5-5.2 0-5.5 4.6-10 10.2-10s10.2 4.5 10.2 10-4.6 9.9-10.2 9.9zm5.6-7.4c-.3-.2-1.8-.9-2.1-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.2-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.5-.6c.2-.2.2-.3.3-.5.1-.2 0-.4 0-.6-.1-.2-.7-1.7-1-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1.1 1-1.1 2.5s1.1 2.9 1.3 3.1c.2.2 2.2 3.4 5.4 4.7.8.3 1.4.5 1.8.7.8.2 1.5.2 2 .1.6-.1 1.8-.7 2.1-1.5.3-.7.3-1.3.2-1.5-.1-.1-.3-.2-.6-.3z"/></svg>`;

/* ------------------ PROMUNCH layout (matches promunch.in) ------------------ */

// Site typography: Archivo Black headlines (uppercase, tight), JetBrains Mono
// labels (uppercase, wide tracking, ★), Assistant body copy, square corners.
export const BRAND_FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Archivo+Black&family=Assistant:wght@400;600;700&family=JetBrains+Mono:wght@400;500&display=swap";
const B_HEAD = `'Archivo Black','Archivo',Impact,sans-serif`;
const B_MONO = `'JetBrains Mono',ui-monospace,Menlo,monospace`;
const B_BODY = `'Assistant',system-ui,-apple-system,'Segoe UI',sans-serif`;

// The hero's diagonal pinstripe, as a background over the accent colour.
function brandPanelBg(accent: string): string {
  return `background-color:${accent};background-image:repeating-linear-gradient(135deg,rgba(255,255,255,.06) 0 2px,transparent 2px 9px),radial-gradient(120% 90% at 15% 10%,rgba(255,255,255,.16),transparent 55%)`;
}

function brandShell(cfg: PopupConfig, left: string, right: string): string {
  const t = cfg.theme;
  return `<div data-pmwa="card" style="position:relative;display:flex;flex-wrap:wrap;align-items:stretch;background:${t.bg};border-radius:${t.radius}px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.35);font-family:${B_BODY};color:${t.text}">
    <button data-pmwa="close" aria-label="Close" style="position:absolute;top:10px;right:10px;z-index:3;width:34px;height:34px;border:0;background:${t.bg};color:${t.text};font:400 22px/1 ${B_MONO};cursor:pointer">&#215;</button>
    <div style="flex:1 1 260px;min-width:0;${brandPanelBg(t.accent)};color:#fff;padding:26px 26px 22px;display:flex;flex-direction:column;justify-content:space-between;gap:14px;min-height:150px">${left}</div>
    <div style="flex:1.25 1 300px;min-width:0;padding:30px 28px 24px">${right}</div>
  </div>`;
}

const brandEyebrow = (txt: string, color: string) =>
  txt ? `<div style="font:500 12px/1.2 ${B_MONO};letter-spacing:3px;text-transform:uppercase;color:${color}">${esc(txt)}</div>` : "";

function brandOfferPanel(cfg: PopupConfig): string {
  return `${brandEyebrow(cfg.eyebrow, "rgba(255,255,255,.82)")}
    <div style="font:400 clamp(56px,11vw,92px)/.88 ${B_HEAD};text-transform:uppercase;letter-spacing:-1px;color:#fff;word-break:break-word">${esc(cfg.badge || "Join")}</div>
    <div style="font:500 11px/1.3 ${B_MONO};letter-spacing:2.5px;text-transform:uppercase;color:rgba(255,255,255,.7)">Your Munchy Pal</div>`;
}

export function renderBrandPopup(cfg: PopupConfig): string {
  const t = cfg.theme;
  const input = `width:100%;box-sizing:border-box;height:48px;border:1.5px solid ${t.text};border-radius:0;background:#fff;color:#121212;font:400 16px ${B_BODY};padding:0 12px;outline:0`;
  const right = `
    <div style="font:400 26px/1.05 ${B_HEAD};text-transform:uppercase;letter-spacing:-.3px;color:${t.text};padding-right:30px">${esc(cfg.headline)}</div>
    ${cfg.sub ? `<div style="font:400 15px/1.5 ${B_BODY};color:${t.text};opacity:.72;margin:10px 0 18px">${esc(cfg.sub)}</div>` : `<div style="height:16px"></div>`}
    <form data-pmwa="form" style="display:grid;gap:10px;margin:0">
      <input name="hp" tabindex="-1" autocomplete="off" style="display:none">
      <div style="display:flex;align-items:center;${input};padding:0">
        <span style="font:500 13px ${B_MONO};letter-spacing:1px;color:${t.text};opacity:.6;padding:0 10px 0 12px;border-right:1.5px solid rgba(18,18,18,.15);align-self:stretch;display:flex;align-items:center">+91</span>
        <input data-pmwa="phone" type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="10" placeholder="Mobile number" style="flex:1;min-width:0;border:0;outline:0;background:none;height:100%;padding:0 12px;font:400 16px ${B_BODY};color:#121212">
      </div>
      ${cfg.email === "off" ? "" : `<input data-pmwa="email" type="email" autocomplete="email" ${cfg.email === "required" ? "required " : ""}placeholder="${cfg.email === "required" ? "Email" : "Email (optional)"}" style="${input}">`}
      <button type="submit" style="height:52px;border:0;border-radius:0;background:${t.accent};color:${t.accentText};font:400 16px/1 ${B_HEAD};text-transform:uppercase;letter-spacing:1px;cursor:pointer">${esc(cfg.cta)}</button>
    </form>
    <div data-pmwa="consent" style="font:400 11.5px/1.45 ${B_BODY};color:${t.text};opacity:.55;margin-top:12px">${esc(popupConsentText(cfg))}</div>`;
  return brandShell(cfg, brandOfferPanel(cfg), right);
}

export function renderBrandSuccess(cfg: PopupConfig): string {
  const t = cfg.theme;
  const left = `${brandEyebrow("★ Welcome to the family", "rgba(255,255,255,.82)")}
    <div style="font:400 clamp(40px,8vw,58px)/.92 ${B_HEAD};text-transform:uppercase;letter-spacing:-1px;color:#fff;word-break:break-word">${esc(cfg.successTitle.replace(/[^\p{L}\p{N}\s!.,'’&-]/gu, "").trim() || "You're in")}</div>
    <div style="font:500 11px/1.3 ${B_MONO};letter-spacing:2.5px;text-transform:uppercase;color:rgba(255,255,255,.7)">Your Munchy Pal</div>`;
  const code = cfg.discountCode ? `
    <div style="font:500 11px/1 ${B_MONO};letter-spacing:2.5px;text-transform:uppercase;color:${t.text};opacity:.6;margin:0 0 8px">Your code</div>
    <div style="display:flex;align-items:stretch;border:2px dashed ${t.accent};margin-bottom:14px">
      <div data-pmwa="code" style="flex:1;min-width:0;font:400 clamp(17px,5.2vw,24px)/1 ${B_HEAD};letter-spacing:1px;color:${t.accent};padding:14px 12px;display:flex;align-items:center;white-space:nowrap;overflow:hidden">${esc(cfg.discountCode)}</div>
      <button type="button" data-pmwa="copy" style="border:0;border-radius:0;background:${t.accent};color:${t.accentText};font:400 14px/1 ${B_HEAD};text-transform:uppercase;letter-spacing:1px;padding:0 14px;cursor:pointer;flex:none">Copy</button>
    </div>` : "";
  const right = `${code}
    <div style="font:400 15px/1.5 ${B_BODY};color:${t.text};opacity:.75;margin:0 0 18px;padding-right:${cfg.discountCode ? 0 : 30}px">${esc(cfg.successBody)}</div>
    <a href="/collections/all" style="display:flex;align-items:center;justify-content:center;height:52px;background:${t.text};color:#fff;font:400 16px/1 ${B_HEAD};text-transform:uppercase;letter-spacing:1px;text-decoration:none">Shop now &#8594;</a>`;
  return brandShell(cfg, left, right);
}

// The popup card, minus outer positioning (the wrapper positions it). Shared by
// the storefront embed and the dashboard preview, so both stay identical.
// Pass { placeholderImage } from the dashboard so an image layout still shows
// its structure before a photo is uploaded; the live embed instead falls back
// to text-only until a real image exists (never a broken image to a shopper).
export function renderPopupInner(cfg: PopupConfig, opts?: { placeholderImage?: boolean }): string {
  if (cfg.layout === "promunch" && cfg.position !== "bottom-bar") return renderBrandPopup(cfg);
  const t = cfg.theme;
  const font = fontStack(t.font);
  const compact = cfg.layout === "compact" || cfg.position === "bottom-bar";
  const hasImg = !!cfg.imageUrl;
  const wantsImg = LAYOUTS_NEEDING_IMAGE.includes(cfg.layout);
  // Effective layout: an image layout with no image degrades to text on the
  // live site; the dashboard passes placeholderImage to preview the structure.
  const layout: PopupLayout = wantsImg && !hasImg && !opts?.placeholderImage ? "text" : cfg.layout;

  const closeBtn = `<button data-pmwa="close" aria-label="Close" style="position:absolute;top:10px;right:12px;z-index:2;border:0;background:none;font-size:20px;line-height:1;cursor:pointer;color:${t.text};opacity:.5">&#215;</button>`;

  const form = (inline: boolean) => `<form data-pmwa="form" style="display:flex;gap:8px;flex-wrap:wrap${inline ? "" : ""}">
    <input name="hp" tabindex="-1" autocomplete="off" style="display:none">
    <div style="display:flex;flex:1;min-width:150px;align-items:center;background:#fff;border:1px solid rgba(0,0,0,.14);border-radius:10px;padding:0 10px">
      <span style="font-size:14px;color:#8a7a66">+91</span>
      <input data-pmwa="phone" type="tel" inputmode="numeric" maxlength="10" placeholder="98765 43210" style="border:0;outline:0;padding:12px 8px;font-size:15px;width:100%;background:none;color:#2B2118;font-family:inherit">
    </div>
    ${cfg.email === "off" ? "" : `<input data-pmwa="email" type="email" autocomplete="email" ${cfg.email === "required" ? "required " : ""}placeholder="${cfg.email === "required" ? "Email" : "Email (optional)"}" style="order:2;flex:1 1 100%;box-sizing:border-box;border:1px solid rgba(0,0,0,.14);border-radius:10px;padding:12px 10px;font-size:15px;background:#fff;color:#2B2118;font-family:inherit;outline:0">`}
    <button type="submit" style="order:3;background:${t.accent};color:${t.accentText};border:0;border-radius:10px;padding:0 18px;min-height:44px;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit;white-space:nowrap${cfg.email === "off" ? "" : ";flex:1 1 100%"}">${esc(cfg.cta)}</button>
  </form>`;

  // The wording a shopper agrees to. It is ALSO posted to /api/public/wa-optin
  // and stored verbatim on the contact, so the consent record and what they read
  // can never drift apart. Every layout must show it — a captured opt-in with no
  // visible consent line is not an opt-in.
  const consent = `<div data-pmwa="consent" style="font-size:10.5px;color:${t.text};opacity:.6;margin-top:9px">${esc(popupConsentText(cfg))}</div>`;

  const headline = (size: number, center = false) => `<div style="font-weight:800;font-size:${size}px;line-height:1.2;color:${t.text}${center ? ";text-align:center" : ""}">${esc(cfg.headline)}</div>`;
  const sub = (center = false) => cfg.sub ? `<div style="font-size:13px;color:${t.text};opacity:.72;margin:6px 0 14px${center ? ";text-align:center" : ""}">${esc(cfg.sub)}</div>` : `<div style="height:10px"></div>`;

  const imageEl = (style: string) => hasImg
    ? `<img src="${esc(cfg.imageUrl!)}" alt="" style="${style};object-fit:cover;display:block">`
    : `<div style="${style};display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#EDE3D4,#E2D3BE);color:#B7A489;font-family:${font};font-size:12px;font-weight:600">Your image</div>`;

  const shell = (innerHtml: string, extraCardStyle = "") =>
    `<div data-pmwa="card" style="position:relative;background:${t.bg};border-radius:${cfg.position === "bottom-bar" ? 0 : t.radius}px;overflow:hidden;font-family:${font};box-shadow:0 12px 40px rgba(0,0,0,.2);${extraCardStyle}">${closeBtn}${innerHtml}</div>`;

  const pad = "padding:20px";

  if (layout === "compact") {
    return shell(`<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:14px 18px">
      <div style="flex:1 1 200px;min-width:180px"><div style="font-weight:800;font-size:15px;color:${t.text}">${esc(cfg.headline)}</div>${cfg.sub ? `<div style="font-size:12px;color:${t.text};opacity:.7">${esc(cfg.sub)}</div>` : ""}</div>
      <div style="flex:1 1 240px;min-width:220px">${form(true)}${consent}</div>
    </div>`);
  }

  if (layout === "background") {
    const bg = hasImg
      ? `background-image:linear-gradient(${t.bg}CC,${t.bg}CC),url('${esc(cfg.imageUrl!)}');background-size:cover;background-position:center`
      : `background:linear-gradient(135deg,#EDE3D4,#E2D3BE)`;
    return shell(`<div style="${bg};padding:26px 22px;text-align:center">
      ${headline(21, true)}${sub(true)}${form(false)}${consent}
    </div>`);
  }

  if (layout === "image-top") {
    return shell(`${imageEl("width:100%;height:140px")}<div style="${pad}">${headline(19)}${sub()}${form(false)}${consent}</div>`);
  }

  if (layout === "image-left" || layout === "image-right") {
    const imgCol = imageEl("flex:1 1 40%;min-width:130px;align-self:stretch;min-height:150px");
    const textCol = `<div style="flex:1 1 55%;min-width:190px;padding:20px">${headline(18)}${sub()}${form(false)}${consent}</div>`;
    const order = layout === "image-left" ? imgCol + textCol : textCol + imgCol;
    return shell(`<div style="display:flex;flex-wrap:wrap;align-items:stretch">${order}</div>`);
  }

  // text
  return shell(`<div style="${pad}">${headline(compact ? 16 : 20)}${sub()}${form(false)}${consent}</div>`);
}

export function popupSuccessInner(cfg: PopupConfig, waNumber: string): string {
  if (cfg.layout === "promunch" && cfg.position !== "bottom-bar") return renderBrandSuccess(cfg);
  const t = cfg.theme;
  return `<div data-pmwa="card" style="position:relative;background:${t.bg};border-radius:${cfg.position === "bottom-bar" ? 0 : t.radius}px;padding:22px;font-family:${fontStack(t.font)};box-shadow:0 12px 40px rgba(0,0,0,.2)">
    <button data-pmwa="close" aria-label="Close" style="position:absolute;top:10px;right:12px;border:0;background:none;font-size:20px;line-height:1;cursor:pointer;color:${t.text};opacity:.5">&#215;</button>
    <div style="font-weight:800;font-size:18px;color:${t.text};padding-right:24px">${esc(cfg.successTitle)}</div>
    <div style="font-size:13px;color:${t.text};opacity:.72;margin:6px 0 12px">${esc(cfg.successBody)}</div>
    ${cfg.discountCode ? `<div style="display:flex;align-items:center;gap:8px;margin:0 0 12px;border:2px dashed ${t.accent};border-radius:10px;padding:10px 12px;background:#fff">
      <div style="flex:1;min-width:0"><div style="font-size:11px;color:#8a7a66">Your code</div><div data-pmwa="code" style="font-weight:800;font-size:20px;letter-spacing:1px;color:#2B2118">${esc(cfg.discountCode)}</div></div>
      <button type="button" data-pmwa="copy" style="background:${t.accent};color:${t.accentText};border:0;border-radius:8px;padding:9px 14px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">Copy</button>
    </div>` : ""}
    <a href="https://wa.me/${waNumber}?text=${encodeURIComponent("Hi PROMUNCH! Just joined your list 🌱")}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;background:${t.accent};color:${t.accentText};border-radius:10px;padding:11px 16px;font-weight:700;font-size:14px;text-decoration:none">${WA_ICON}<span>Say hi on WhatsApp</span></a>
  </div>`;
}

export function widgetButtonInner(cfg: WidgetConfig): string {
  return `<span style="display:flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;background:${cfg.theme.button};color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.25)">${WA_ICON}</span>`;
}

export function widgetBubbleInner(cfg: WidgetConfig): string {
  return `<div style="max-width:230px;background:${cfg.theme.bubbleBg};color:${cfg.theme.bubbleText};border:1px solid rgba(0,0,0,.1);border-radius:12px;padding:10px 30px 10px 12px;font-size:13px;font-family:${fontStack("system")};box-shadow:0 8px 24px rgba(0,0,0,.15);position:relative">${esc(cfg.greeting)}</div>`;
}

/* --------------------- positioning helpers --------------------- */

// Wrapper style for the popup at each position (used by embed + preview).
export function popupWrapStyle(pos: PopupPosition): string {
  if (pos === "center") return "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(18,18,18,.6);z-index:99999;overflow-y:auto";
  if (pos === "bottom-bar") return "position:fixed;left:0;right:0;bottom:0;z-index:99999";
  const side = pos === "bottom-left" ? "left:16px" : "right:16px";
  return `position:fixed;bottom:16px;${side};max-width:360px;z-index:99999`;
}
export function popupCardMax(pos: PopupPosition, layout: PopupLayout = "text"): string {
  const wide = layout === "image-left" || layout === "image-right";
  if (pos === "bottom-bar") return "max-width:100%";
  if (layout === "promunch" && pos === "center") return "width:min(720px,100%);margin:auto";
  if (layout === "promunch") return "width:420px;max-width:calc(100vw - 32px)";
  if (pos === "center") return `width:min(${wide ? 480 : 400}px,100%)`;
  return `width:${wide ? 420 : 360}px;max-width:calc(100vw - 32px)`;
}

/* --------------------------- embed JS --------------------------- */

export function buildEmbedJs(cfg: GrowthConfig, opts: { appOrigin: string; widgetLink: string | null; waNumber: string; cartRequestEnabled?: boolean }): string {
  const parts: string[] = ["/* PROMUNCH WhatsApp embed — configure in CRM → WhatsApp → Growth */"];
  if (opts.cartRequestEnabled) parts.push(buildCartRequestEmbed(opts.appOrigin));
  const fontLinks = new Set<string>();
  const pf = fontHref(cfg.popup.theme.font);
  if (cfg.popup.enabled && cfg.popup.layout === "promunch") fontLinks.add(BRAND_FONT_HREF);
  else if (cfg.popup.enabled && pf) fontLinks.add(pf);
  if (fontLinks.size) {
    parts.push(`(function(){var L=${JSON.stringify([...fontLinks])};L.forEach(function(h){var l=document.createElement("link");l.rel="stylesheet";l.href=h;document.head.appendChild(l)})})();`);
  }

  if (cfg.popup.enabled) {
    const conf = {
      api: `${opts.appOrigin}/api/public/wa-optin`,
      // Posted back with every opt-in so the stored consent record is the exact
      // sentence this visitor saw, not whatever the copy says months later.
      consentText: popupConsentText(cfg.popup),
      emailMode: cfg.popup.email,
      wrap: popupWrapStyle(cfg.popup.position),
      cardMax: popupCardMax(cfg.popup.position, cfg.popup.layout),
      html: renderPopupInner(cfg.popup),
      success: popupSuccessInner(cfg.popup, opts.waNumber),
      trigger: cfg.popup.trigger,
      freqMs: cfg.popup.frequencyDays * 864e5,
      pages: cfg.popup.pages,
      center: cfg.popup.position === "center",
    };
    parts.push(`(function(){
  var C=${JSON.stringify(conf)};
  function pageOk(){var p=location.pathname;if(C.pages==="all")return true;if(C.pages==="home")return p==="/"||p==="";if(C.pages==="product")return p.indexOf("/products/")>-1;if(C.pages==="cart")return p.indexOf("/cart")>-1;return true;}
  if(!pageOk())return;
  try{var K="pm_wa_popup_at";if(C.freqMs>0&&Date.now()-(+localStorage.getItem(K)||0)<C.freqMs)return;}catch(e){}
  var shown=false;
  function done(){try{localStorage.setItem("pm_wa_popup_at",String(Date.now()))}catch(e){}}
  function show(){
    if(shown)return;shown=true;
    var wrap=document.createElement("div");wrap.setAttribute("style",C.wrap);
    var box=document.createElement("div");box.setAttribute("style",C.cardMax);box.innerHTML=C.html;
    wrap.appendChild(box);
    if(C.center)wrap.addEventListener("click",function(e){if(e.target===wrap){done();wrap.remove()}});
    document.body.appendChild(wrap);
    var x=box.querySelector('[data-pmwa="close"]');if(x)x.onclick=function(){done();wrap.remove()};
    var f=box.querySelector('[data-pmwa="form"]');
    if(f)f.onsubmit=function(ev){ev.preventDefault();
      var pn=box.querySelector('[data-pmwa="phone"]');var p=(pn.value||"").replace(/\\D/g,"");
      if(p.length!==10||!/^[6-9]/.test(p)){pn.style.color="#c0392b";pn.focus();return}
      var en=box.querySelector('[data-pmwa="email"]');var em=en?(en.value||"").trim():"";
      if(en&&(em||C.emailMode==="required")&&!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(em)){en.style.borderColor="#c0392b";en.focus();return}
      var hp=f.querySelector('input[name="hp"]');
      var sb=f.querySelector('button[type="submit"]');if(sb){sb.disabled=true;sb.style.opacity=".6"}
      fetch(C.api,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:p,email:em||undefined,source:"website_popup",consent_text:C.consentText,page_url:location.href,hp:hp?hp.value:""})})
        .then(function(r){return r.json()}).catch(function(){return{ok:false}})
        .then(function(j){done();box.innerHTML=j&&j.ok?C.success:'<div style="background:#fff;border-radius:12px;padding:20px;font-family:sans-serif;font-size:13px;color:#6d5d4b">Something went wrong. Message us directly on WhatsApp: +91 99813 10247</div>';var cp=box.querySelector('[data-pmwa="copy"]');if(cp)cp.onclick=function(){var c=box.querySelector('[data-pmwa="code"]');var v=c?c.textContent:"";try{navigator.clipboard.writeText(v);cp.textContent="Copied"}catch(e){}};var cx=box.querySelector('[data-pmwa="close"]');if(cx)cx.onclick=function(){wrap.remove()};if(!(j&&j.ok))setTimeout(function(){wrap.remove()},15000)});
    };
  }
  var T=C.trigger||{type:"delay",seconds:6};
  if(T.type==="immediate"){show()}
  else if(T.type==="scroll"){var onS=function(){var h=document.documentElement;var pct=(h.scrollTop||document.body.scrollTop)/((h.scrollHeight-h.clientHeight)||1)*100;if(pct>=(T.percent||40)){show();window.removeEventListener("scroll",onS)}};window.addEventListener("scroll",onS,{passive:true})}
  else if(T.type==="exit"){var onE=function(e){if(e.clientY<=0){show();document.removeEventListener("mouseout",onE)}};document.addEventListener("mouseout",onE)}
  else{setTimeout(show,(T.seconds||6)*1000)}
})();`);
  }

  if (cfg.widget.enabled && opts.widgetLink) {
    const conf = {
      link: opts.widgetLink,
      side: cfg.widget.side,
      delay: cfg.widget.delaySec * 1000,
      btn: widgetButtonInner(cfg.widget),
      bubble: cfg.widget.greeting ? widgetBubbleInner(cfg.widget) : "",
      mobile: cfg.widget.showOnMobile,
    };
    parts.push(`(function(){
  var C=${JSON.stringify(conf)};
  if(!C.mobile&&window.matchMedia&&window.matchMedia("(max-width:640px)").matches)return;
  var s=C.side==="left"?"left:16px":"right:16px";
  var a=document.createElement("a");a.href=C.link;a.target="_blank";a.rel="noopener";a.setAttribute("aria-label","Chat on WhatsApp");
  a.setAttribute("style","position:fixed;z-index:99998;bottom:16px;"+s);a.innerHTML=C.btn;document.body.appendChild(a);
  if(C.bubble){setTimeout(function(){
    try{if(localStorage.getItem("pm_wa_hi"))return}catch(e){}
    var g=document.createElement("div");g.setAttribute("style","position:fixed;z-index:99998;bottom:82px;"+s+";cursor:pointer");g.innerHTML=C.bubble+'<button aria-label="Close" style="position:absolute;top:2px;right:6px;border:0;background:none;color:#8a7a66;font-size:14px;cursor:pointer">&#215;</button>';
    g.querySelector("button").onclick=function(ev){ev.stopPropagation();try{localStorage.setItem("pm_wa_hi","1")}catch(e){};g.remove()};
    g.onclick=function(){window.open(C.link,"_blank")};document.body.appendChild(g);
  },C.delay)}
})();`);
  }

  return parts.join("\n");
}
