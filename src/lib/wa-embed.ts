// WhatsApp growth embed: the popup + chat-widget JavaScript served to the
// storefront by /api/public/wa-embed. Config is edited in the dashboard
// (WhatsApp → Growth) and stored in app_secrets as WA_GROWTH_CONFIG, so copy
// changes go live on trypromunch.in within minutes — no theme edit, ever.

export type GrowthConfig = {
  popup: {
    enabled: boolean;
    headline: string;
    sub: string;
    cta: string;
    delaySec: number;
    coolDays: number;
  };
  widget: {
    enabled: boolean;
    greeting: string;
    side: "right" | "left";
    delaySec: number;
  };
};

export const GROWTH_DEFAULTS: GrowthConfig = {
  popup: {
    enabled: true,
    headline: "Snacks with 50% protein. Offers on WhatsApp.",
    sub: "Join PROMUNCH for launch drops and member-only deals. Your Munchy Pal is one text away.",
    cta: "Join",
    delaySec: 6,
    coolDays: 15,
  },
  widget: {
    enabled: true,
    greeting: "Questions? Chat with Your Munchy Pal 🌱",
    side: "right",
    delaySec: 4,
  },
};

export function normalizeGrowthConfig(raw: unknown): GrowthConfig {
  const r = (raw ?? {}) as Partial<GrowthConfig>;
  const p = { ...GROWTH_DEFAULTS.popup, ...(r.popup ?? {}) };
  const w = { ...GROWTH_DEFAULTS.widget, ...(r.widget ?? {}) };
  return {
    popup: {
      enabled: !!p.enabled,
      headline: String(p.headline).slice(0, 120),
      sub: String(p.sub).slice(0, 240),
      cta: String(p.cta).slice(0, 30) || "Join",
      delaySec: Math.min(120, Math.max(1, Number(p.delaySec) || 6)),
      coolDays: Math.min(365, Math.max(1, Number(p.coolDays) || 15)),
    },
    widget: {
      enabled: !!w.enabled,
      greeting: String(w.greeting).slice(0, 120),
      side: w.side === "left" ? "left" : "right",
      delaySec: Math.min(120, Math.max(0, Number(w.delaySec) || 0)),
    },
  };
}

// Build the storefront JS. `appOrigin` = this app (for the opt-in POST),
// `widgetLink` = tracked /r/<code> URL, `waNumber` = digits for wa.me.
export function buildEmbedJs(cfg: GrowthConfig, opts: { appOrigin: string; widgetLink: string | null; waNumber: string }): string {
  const parts: string[] = ["/* PROMUNCH WhatsApp embed (auto-generated; configure in CRM → WhatsApp → Growth) */"];

  if (cfg.popup.enabled) {
    const conf = JSON.stringify({
      api: `${opts.appOrigin}/api/public/wa-optin`,
      delay: cfg.popup.delaySec * 1000,
      coolDays: cfg.popup.coolDays,
      headline: cfg.popup.headline,
      sub: cfg.popup.sub,
      cta: cfg.popup.cta,
      wa: opts.waNumber,
    });
    parts.push(`(function(){
  var C=${conf};
  try{var K="pm_wa_popup_at";if(Date.now()-(+localStorage.getItem(K)||0)<C.coolDays*864e5)return;}catch(e){}
  function done(){try{localStorage.setItem("pm_wa_popup_at",String(Date.now()))}catch(e){}}
  setTimeout(function(){
    var w=document.createElement("div");
    w.setAttribute("style","position:fixed;z-index:99999;right:16px;bottom:16px;left:16px;max-width:360px;margin-left:auto;background:#FFF8F0;color:#2B2118;border:1px solid #E8D9C5;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.18);padding:20px;font-family:system-ui,-apple-system,sans-serif");
    w.innerHTML='<div style="display:flex;justify-content:space-between;gap:8px"><div style="font-weight:800;font-size:17px;line-height:1.25">'+C.headline+'</div><button id="pmwa-x" style="border:0;background:none;font-size:18px;cursor:pointer;color:#8a7a66;line-height:1">\\u00d7</button></div>'
      +'<div style="font-size:13px;color:#6d5d4b;margin:6px 0 12px">'+C.sub+'</div>'
      +'<form id="pmwa-f" style="display:flex;gap:8px"><input name="hp" style="display:none" tabindex="-1" autocomplete="off">'
      +'<div style="display:flex;flex:1;align-items:center;background:#fff;border:1px solid #E8D9C5;border-radius:10px;padding:0 10px"><span style="font-size:14px;color:#8a7a66">+91</span>'
      +'<input id="pmwa-p" type="tel" inputmode="numeric" maxlength="10" placeholder="98765 43210" style="border:0;outline:0;padding:11px 8px;font-size:15px;width:100%;background:none;color:#2B2118"></div>'
      +'<button type="submit" style="background:#25D366;color:#fff;border:0;border-radius:10px;padding:0 16px;font-weight:700;font-size:14px;cursor:pointer">'+C.cta+'</button></form>'
      +'<div style="font-size:10.5px;color:#8a7a66;margin-top:8px">By joining you agree to receive WhatsApp updates from PROMUNCH. Reply STOP anytime to leave.</div>';
    document.body.appendChild(w);
    document.getElementById("pmwa-x").onclick=function(){done();w.remove()};
    document.getElementById("pmwa-f").onsubmit=function(ev){
      ev.preventDefault();
      var p=(document.getElementById("pmwa-p").value||"").replace(/\\D/g,"");
      if(p.length!==10){document.getElementById("pmwa-p").style.color="#c0392b";return}
      fetch(C.api,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:p,source:"website_popup",hp:ev.target.hp.value})})
        .then(function(r){return r.json()}).catch(function(){return{ok:false}})
        .then(function(j){
          done();
          w.innerHTML=j&&j.ok
            ?'<div style="font-weight:800;font-size:17px">You are in! \\ud83c\\udf89</div><div style="font-size:13px;color:#6d5d4b;margin:6px 0 12px">Offers and new launches, straight from Your Munchy Pal.</div><a href="https://wa.me/'+C.wa+'?text='+encodeURIComponent("Hi PROMUNCH! Just joined your list \\ud83c\\udf31")+'" target="_blank" rel="noopener" style="display:inline-block;background:#25D366;color:#fff;border-radius:10px;padding:11px 16px;font-weight:700;font-size:14px;text-decoration:none">Say hi on WhatsApp</a>'
            :'<div style="font-size:13px;color:#6d5d4b">Something went wrong. You can also message us directly on WhatsApp: +91 99813 10247</div>';
          setTimeout(function(){w.remove()},15000);
        });
    };
  },C.delay);
})();`);
  }

  if (cfg.widget.enabled && opts.widgetLink) {
    const conf = JSON.stringify({
      link: opts.widgetLink,
      greeting: cfg.widget.greeting,
      side: cfg.widget.side,
      delay: cfg.widget.delaySec * 1000,
    });
    parts.push(`(function(){
  var C=${conf};var s=C.side==="left"?"left:16px":"right:16px";
  var b=document.createElement("a");
  b.href=C.link;b.target="_blank";b.rel="noopener";b.setAttribute("aria-label","Chat with PROMUNCH on WhatsApp");
  b.setAttribute("style","position:fixed;z-index:99998;bottom:16px;"+s+";width:56px;height:56px;border-radius:50%;background:#25D366;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(0,0,0,.25)");
  b.innerHTML='<svg viewBox="0 0 32 32" width="30" height="30" fill="#fff"><path d="M16 3C9.4 3 4 8.3 4 14.9c0 2.1.6 4.1 1.6 5.9L4 29l8.4-1.6c1.7.9 3.6 1.4 5.6 1.4 6.6 0 12-5.3 12-11.9S22.6 3 16 3zm0 21.8c-1.8 0-3.5-.5-5-1.3l-.4-.2-5 1 1-4.8-.3-.4c-1-1.6-1.5-3.4-1.5-5.2 0-5.5 4.6-10 10.2-10s10.2 4.5 10.2 10-4.6 9.9-10.2 9.9zm5.6-7.4c-.3-.2-1.8-.9-2.1-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.2-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.5-.6c.2-.2.2-.3.3-.5.1-.2 0-.4 0-.6-.1-.2-.7-1.7-1-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1.1 1-1.1 2.5s1.1 2.9 1.3 3.1c.2.2 2.2 3.4 5.4 4.7.8.3 1.4.5 1.8.7.8.2 1.5.2 2 .1.6-.1 1.8-.7 2.1-1.5.3-.7.3-1.3.2-1.5-.1-.1-.3-.2-.6-.3z"/></svg>';
  document.body.appendChild(b);
  if(C.greeting){setTimeout(function(){
    try{if(localStorage.getItem("pm_wa_hi"))return}catch(e){}
    var g=document.createElement("div");
    g.setAttribute("style","position:fixed;z-index:99998;bottom:82px;"+s+";max-width:230px;background:#fff;color:#2B2118;border:1px solid #E8D9C5;border-radius:12px;padding:10px 30px 10px 12px;font-size:13px;font-family:system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.15);cursor:pointer");
    g.innerHTML=C.greeting+'<button style="position:absolute;top:2px;right:6px;border:0;background:none;color:#8a7a66;font-size:14px;cursor:pointer">\\u00d7</button>';
    g.querySelector("button").onclick=function(ev){ev.stopPropagation();try{localStorage.setItem("pm_wa_hi","1")}catch(e){};g.remove()};
    g.onclick=function(){window.open(C.link,"_blank")};
    document.body.appendChild(g);
  },C.delay)}
})();`);
  }

  return parts.join("\n");
}
