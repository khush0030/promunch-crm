// WhatsApp growth embed: the opt-in popup + chat widget shown on the storefront.
// Config is edited in the dashboard visual editor (WhatsApp → Growth) and served
// live by /api/public/wa-embed, so copy/colour/targeting changes go live on
// trypromunch.in within minutes — no theme edit, ever.
//
// The SAME markup functions (renderPopupInner / renderWidgetInner) power both
// the storefront embed and the dashboard live preview, so what staff see is
// exactly what a visitor sees. buildEmbedJs wraps that markup with behaviour
// (targeting triggers, form submit, frequency cap).

/* ----------------------------- types ----------------------------- */

export type PopupTrigger =
  | { type: "immediate" }
  | { type: "delay"; seconds: number }
  | { type: "scroll"; percent: number }
  | { type: "exit" };

export type PageRule = "all" | "home" | "product" | "cart";
export type PopupPosition = "center" | "bottom-right" | "bottom-left" | "bottom-bar";
// Ready-made card layouts the user picks from a gallery.
export type PopupLayout = "text" | "image-top" | "image-left" | "image-right" | "background" | "compact";
export const LAYOUTS_NEEDING_IMAGE: PopupLayout[] = ["image-top", "image-left", "image-right", "background"];

export type PopupConfig = {
  enabled: boolean;
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
    headline: "Get 50% protein snacks + WhatsApp-only offers",
    sub: "Join PROMUNCH for launch drops and member deals. Your Munchy Pal is one text away.",
    cta: "Join on WhatsApp",
    successTitle: "You're in! 🎉",
    successBody: "Offers and new launches, straight from Your Munchy Pal.",
    imageUrl: null,
    layout: "text",
    theme: { bg: "#FFF8F0", text: "#2B2118", accent: "#25D366", accentText: "#FFFFFF", font: "poppins", radius: 16 },
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
  const LAYOUTS: PopupLayout[] = ["text", "image-top", "image-left", "image-right", "background", "compact"];
  const legacy = (p as { imageLayout?: string }).imageLayout;
  const layout: PopupLayout = LAYOUTS.includes(p.layout) ? p.layout
    : legacy === "top" ? "image-top" : legacy === "side" ? "image-left" : "text";

  return {
    popup: {
      enabled: !!p.enabled,
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
        font: FONTS[pt.font] ? pt.font : "poppins",
        radius: clampNum(pt.radius, 0, 32, 16),
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

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const WA_ICON = `<svg viewBox="0 0 32 32" width="26" height="26" fill="currentColor"><path d="M16 3C9.4 3 4 8.3 4 14.9c0 2.1.6 4.1 1.6 5.9L4 29l8.4-1.6c1.7.9 3.6 1.4 5.6 1.4 6.6 0 12-5.3 12-11.9S22.6 3 16 3zm0 21.8c-1.8 0-3.5-.5-5-1.3l-.4-.2-5 1 1-4.8-.3-.4c-1-1.6-1.5-3.4-1.5-5.2 0-5.5 4.6-10 10.2-10s10.2 4.5 10.2 10-4.6 9.9-10.2 9.9zm5.6-7.4c-.3-.2-1.8-.9-2.1-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.2-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.5-.6c.2-.2.2-.3.3-.5.1-.2 0-.4 0-.6-.1-.2-.7-1.7-1-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1.1 1-1.1 2.5s1.1 2.9 1.3 3.1c.2.2 2.2 3.4 5.4 4.7.8.3 1.4.5 1.8.7.8.2 1.5.2 2 .1.6-.1 1.8-.7 2.1-1.5.3-.7.3-1.3.2-1.5-.1-.1-.3-.2-.6-.3z"/></svg>`;

// The popup card, minus outer positioning (the wrapper positions it). Shared by
// the storefront embed and the dashboard preview, so both stay identical.
// Pass { placeholderImage } from the dashboard so an image layout still shows
// its structure before a photo is uploaded; the live embed instead falls back
// to text-only until a real image exists (never a broken image to a shopper).
export function renderPopupInner(cfg: PopupConfig, opts?: { placeholderImage?: boolean }): string {
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
    <button type="submit" style="background:${t.accent};color:${t.accentText};border:0;border-radius:10px;padding:0 18px;min-height:44px;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit;white-space:nowrap">${esc(cfg.cta)}</button>
  </form>`;

  const consent = `<div style="font-size:10.5px;color:${t.text};opacity:.6;margin-top:9px">By joining you agree to receive WhatsApp updates from PROMUNCH. Reply STOP anytime to leave.</div>`;

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
      <div style="flex:1 1 240px;min-width:220px">${form(true)}</div>
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
  const t = cfg.theme;
  return `<div data-pmwa="card" style="position:relative;background:${t.bg};border-radius:${cfg.position === "bottom-bar" ? 0 : t.radius}px;padding:22px;font-family:${fontStack(t.font)};box-shadow:0 12px 40px rgba(0,0,0,.2)">
    <div style="font-weight:800;font-size:18px;color:${t.text}">${esc(cfg.successTitle)}</div>
    <div style="font-size:13px;color:${t.text};opacity:.72;margin:6px 0 12px">${esc(cfg.successBody)}</div>
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
  if (pos === "center") return "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.45);z-index:99999";
  if (pos === "bottom-bar") return "position:fixed;left:0;right:0;bottom:0;z-index:99999";
  const side = pos === "bottom-left" ? "left:16px" : "right:16px";
  return `position:fixed;bottom:16px;${side};max-width:360px;z-index:99999`;
}
export function popupCardMax(pos: PopupPosition, layout: PopupLayout = "text"): string {
  const wide = layout === "image-left" || layout === "image-right";
  if (pos === "bottom-bar") return "max-width:100%";
  if (pos === "center") return `width:min(${wide ? 480 : 400}px,100%)`;
  return `width:${wide ? 420 : 360}px;max-width:calc(100vw - 32px)`;
}

/* --------------------------- embed JS --------------------------- */

export function buildEmbedJs(cfg: GrowthConfig, opts: { appOrigin: string; widgetLink: string | null; waNumber: string }): string {
  const parts: string[] = ["/* PROMUNCH WhatsApp embed — configure in CRM → WhatsApp → Growth */"];
  const fontLinks = new Set<string>();
  const pf = fontHref(cfg.popup.theme.font);
  if (cfg.popup.enabled && pf) fontLinks.add(pf);
  if (fontLinks.size) {
    parts.push(`(function(){var L=${JSON.stringify([...fontLinks])};L.forEach(function(h){var l=document.createElement("link");l.rel="stylesheet";l.href=h;document.head.appendChild(l)})})();`);
  }

  if (cfg.popup.enabled) {
    const conf = {
      api: `${opts.appOrigin}/api/public/wa-optin`,
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
      if(p.length!==10){pn.style.color="#c0392b";return}
      var hp=f.querySelector('input[name="hp"]');
      fetch(C.api,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:p,source:"website_popup",hp:hp?hp.value:""})})
        .then(function(r){return r.json()}).catch(function(){return{ok:false}})
        .then(function(j){done();box.innerHTML=j&&j.ok?C.success:'<div style="background:#fff;border-radius:12px;padding:20px;font-family:sans-serif;font-size:13px;color:#6d5d4b">Something went wrong. Message us directly on WhatsApp: +91 99813 10247</div>';setTimeout(function(){wrap.remove()},15000)});
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
