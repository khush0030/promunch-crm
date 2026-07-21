// Serves the storefront email signup popup as a self-contained script. Paste
// one tag into the Shopify theme; it renders a PROMUNCH popup and posts captures
// to /api/public/email-optin. Public GET (middleware allowlists /api/public/*).
//
// Config via data-attributes on the script tag:
//   data-discount="WELCOME10"  data-delay="6"  data-cooldown-days="14"
//   data-headline="..."        data-sub="..."   data-cta="..."

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function appBaseUrl(): string {
  return (process.env.SITE_APP_URL || "https://promunch-crm.vercel.app").replace(/\/+$/, "");
}

export function GET() {
  const base = appBaseUrl();

  const js = `(function(){
  var s = document.currentScript;
  function attr(n, d){ return (s && s.getAttribute(n)) || d; }
  var API = ${JSON.stringify(base)} + "/api/public/email-optin";
  var DISCOUNT = attr("data-discount", "");
  var DELAY = parseInt(attr("data-delay", "6"), 10) || 6;
  var COOLDOWN = (parseInt(attr("data-cooldown-days", "14"), 10) || 14) * 86400000;
  var HEADLINE = attr("data-headline", DISCOUNT ? "Get 10% off your first munch" : "Join the PROMUNCH club");
  var SUB = attr("data-sub", "Tasty drops, restocks and members-only offers.");
  var CTA = attr("data-cta", DISCOUNT ? "Unlock my offer" : "Sign me up");
  var KEY = "pm_email_popup_at";

  try {
    var last = parseFloat(localStorage.getItem(KEY) || "0");
    if (last && (Date.now() - last) < COOLDOWN) return;
  } catch(e){}

  function el(tag, css, txt){ var e = document.createElement(tag); if(css) e.style.cssText = css; if(txt) e.textContent = txt; return e; }

  function show(){
    if (document.getElementById("pm-email-popup")) return;
    var scrim = el("div", "position:fixed;inset:0;background:rgba(27,42,32,.45);z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;");
    scrim.id = "pm-email-popup";
    var box = el("div", "width:340px;max-width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.3);font-family:system-ui,-apple-system,'Segoe UI',sans-serif;");
    var top = el("div", "background:#1B2A20;color:#fff;padding:18px 20px 16px;position:relative;");
    var x = el("div", "position:absolute;top:10px;right:14px;color:rgba(255,255,255,.7);font-size:18px;cursor:pointer;", "\\u00d7");
    x.onclick = close;
    var h = el("div", "font-size:17px;font-weight:700;margin-top:4px;", HEADLINE);
    var sub = el("div", "font-size:12px;color:#C3D2BE;margin-top:4px;", SUB);
    top.appendChild(x); top.appendChild(h); top.appendChild(sub);
    var form = el("form", "padding:16px 20px 18px;");
    var input = el("input", "width:100%;box-sizing:border-box;border:1px solid #E8DFD0;border-radius:10px;padding:11px 12px;font-size:13px;margin-bottom:9px;");
    input.type = "email"; input.required = true; input.placeholder = "you@email.com";
    var hp = el("input", "position:absolute;left:-9999px;"); hp.type = "text"; hp.tabIndex = -1; hp.setAttribute("autocomplete","off"); hp.name = "company";
    var btn = el("button", "width:100%;background:#E0A24E;color:#241a0b;font-weight:700;border:none;border-radius:10px;padding:11px;font-size:13px;cursor:pointer;");
    btn.type = "submit"; btn.textContent = CTA;
    var note = el("div", "font-size:9.5px;color:#9A9081;text-align:center;margin-top:9px;line-height:1.4;", "By joining you agree to receive PROMUNCH marketing email. Unsubscribe anytime.");
    form.appendChild(input); form.appendChild(hp); form.appendChild(btn); form.appendChild(note);
    form.onsubmit = function(ev){
      ev.preventDefault();
      btn.disabled = true; btn.textContent = "Joining...";
      fetch(API, { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({ email: input.value, source: "website_popup", hp: hp.value }) })
        .then(function(r){ return r.json(); })
        .then(function(){
          h.textContent = "You are in!";
          sub.textContent = DISCOUNT ? ("Use code " + DISCOUNT + " at checkout.") : "Welcome to Your Munchy Pal.";
          form.innerHTML = "";
          var okc = el("div", "text-align:center;padding:6px 0 2px;font-size:13px;color:#3F6B4F;font-weight:600;", DISCOUNT ? DISCOUNT : "Thanks for joining");
          form.appendChild(okc);
          try { localStorage.setItem(KEY, String(Date.now())); } catch(e){}
          setTimeout(close, 2600);
        })
        .catch(function(){ btn.disabled = false; btn.textContent = "Try again"; });
    };
    box.appendChild(top); box.appendChild(form); scrim.appendChild(box);
    scrim.onclick = function(ev){ if (ev.target === scrim) close(); };
    document.body.appendChild(scrim);
    try { localStorage.setItem(KEY, String(Date.now())); } catch(e){}
  }
  function close(){ var p = document.getElementById("pm-email-popup"); if (p) p.remove(); }

  setTimeout(show, DELAY * 1000);
})();`;

  return new NextResponse(js, {
    status: 200,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
