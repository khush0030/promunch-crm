// Storefront bulk order form widget (approved mockup, Oct 7 2026).
// Rendered into <div id="promunch-bulk-form"></div> on promunch.in/pages/bulk-orders
// by one script tag. Styles are scoped under .pmbf so the theme is untouched.
// Posts to /api/public/bulk-inquiry. No em dashes in any copy.
//
// The JS below is plain ES5-ish browser code inside a template string: it must
// not contain backticks or "${", only the injected API_URL/PROMISE values.

import { PRODUCTS, QUANTITY_BANDS, USE_CASES } from "./schema";

export function bulkFormScript(apiUrl: string): string {
  const useCases = Object.entries(USE_CASES).map(([k, v]) => [k, v.label]);
  // Chip labels are shorter than the email's QUANTITY_BANDS wording.
  const chipLabel: Record<keyof typeof QUANTITY_BANDS, string> = {
    "50-100": "50 to 100", "100-500": "100 to 500", "500-2000": "500 to 2,000", "2000+": "2,000+", unsure: "Not sure yet",
  };
  const qty = Object.keys(QUANTITY_BANDS).map((k) => [k, chipLabel[k as keyof typeof QUANTITY_BANDS]]);
  const products = Object.entries(PRODUCTS);

  return `(function(){
  var s = document.currentScript;
  function attr(n, d){ return (s && s.getAttribute(n)) || d; }
  var API = ${JSON.stringify(apiUrl)};
  var USES = ${JSON.stringify(useCases)};
  var QTY = ${JSON.stringify(qty)};
  var PRODUCTS = ${JSON.stringify(products)};
  var PROMISE = attr("data-promise", "Quote within one working day");
  var TARGET_ID = attr("data-target", "promunch-bulk-form");

  function mount(){
    var host = document.getElementById(TARGET_ID);
    if (!host) { host = document.createElement("div"); host.id = TARGET_ID; if (s && s.parentNode) s.parentNode.insertBefore(host, s); else document.body.appendChild(host); }
    if (host.getAttribute("data-pmbf")) return;
    host.setAttribute("data-pmbf", "1");

    if (!document.getElementById("pmbf-fonts")) {
      var l = document.createElement("link"); l.id = "pmbf-fonts"; l.rel = "stylesheet";
      l.href = "https://fonts.googleapis.com/css2?family=Archivo+Black&family=Assistant:wght@400;600;700&family=JetBrains+Mono:wght@500;700&display=swap";
      document.head.appendChild(l);
    }
    var st = document.createElement("style");
    st.textContent = CSS;
    document.head.appendChild(st);

    host.innerHTML = HTML();
    wire(host);
  }

  var CSS = [
    ".pmbf{--red:#AF272F;--red2:#8E1F26;--ink:#1A1714;--ink2:#4A453F;--mute:#8A8278;--hair:#E5E0D6;--paper:#fff;--cream:#F4F1EA;--ok:#1F6B45;",
    "--disp:'Archivo Black','Arial Black',Arial,sans-serif;--body:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;--mono:'JetBrains Mono',ui-monospace,'Courier New',monospace;",
    "background:var(--cream);color:var(--ink);font-family:var(--body);font-size:16px;line-height:1.55;padding:48px 20px 56px;box-sizing:border-box}",
    ".pmbf *,.pmbf *:before,.pmbf *:after{box-sizing:border-box}",
    ".pmbf-in{max-width:1120px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:44px;align-items:start}",
    ".pmbf-copy{display:grid;gap:18px;position:sticky;top:110px}",
    ".pmbf-eb{font-family:var(--mono);font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:var(--red);font-weight:700}",
    ".pmbf h2.pmbf-h{font-family:var(--disp);font-weight:400;font-size:clamp(36px,5vw,60px);line-height:.95;margin:0;text-transform:uppercase;color:var(--ink);letter-spacing:0}",
    ".pmbf-h em{font-style:normal;color:var(--red)}",
    ".pmbf-copy p{margin:0;color:var(--ink2);max-width:44ch}",
    ".pmbf-uses{border-top:1px solid var(--hair)}",
    ".pmbf-uses div{display:grid;grid-template-columns:140px minmax(0,1fr);gap:12px;padding:12px 0;border-bottom:1px solid var(--hair);font-size:15px}",
    ".pmbf-uses b{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--red);padding-top:3px}",
    ".pmbf-promise{display:flex;gap:10px;align-items:center;font-size:14px;color:var(--ink2)}",
    ".pmbf-promise i{width:8px;height:8px;border-radius:50%;background:var(--ok);flex:none}",
    ".pmbf form,.pmbf .pmbf-done{background:var(--paper);border-radius:18px;padding:28px;display:grid;gap:20px;margin:0}",
    ".pmbf-top{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap}",
    ".pmbf-top h3{font-family:var(--disp);font-weight:400;font-size:20px;margin:0;text-transform:uppercase;color:var(--ink);letter-spacing:0}",
    ".pmbf-top span{font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--mute);text-transform:uppercase}",
    ".pmbf-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}",
    ".pmbf-f{display:grid;gap:6px;min-width:0;border:0;padding:0;margin:0}",
    ".pmbf label.pmbf-l,.pmbf legend{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink);font-weight:700;padding:0;margin:0 0 6px}",
    ".pmbf .pmbf-opt{color:var(--mute);font-weight:500;letter-spacing:.08em}",
    ".pmbf input[type=text],.pmbf input[type=email],.pmbf input[type=tel],.pmbf input[type=date],.pmbf textarea,.pmbf select{font:inherit;font-size:16px;color:var(--ink);background:var(--paper);border:1.5px solid var(--hair);border-radius:12px;padding:12px 14px;width:100%;min-width:0;margin:0;box-shadow:none;height:auto;-webkit-appearance:none;appearance:none}",
    ".pmbf input:focus,.pmbf textarea:focus,.pmbf select:focus{outline:none;border-color:var(--ink)}",
    ".pmbf textarea{min-height:92px;resize:vertical}",
    ".pmbf-ph{display:grid;grid-template-columns:84px minmax(0,1fr);gap:8px}",
    ".pmbf-chips{display:flex;flex-wrap:wrap;gap:8px}",
    ".pmbf-chip{position:relative;margin:0}",
    ".pmbf-chip input{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}",
    ".pmbf-chip span{display:inline-block;border:1.5px solid var(--hair);border-radius:999px;padding:8px 14px;font-size:15px;cursor:pointer;background:var(--paper);color:var(--ink);user-select:none;transition:background .15s,border-color .15s,color .15s}",
    ".pmbf-chip input:checked+span{background:var(--ink);border-color:var(--ink);color:#fff}",
    ".pmbf-chip input:focus-visible+span,.pmbf input:focus-visible,.pmbf textarea:focus-visible{outline:2px solid var(--red);outline-offset:2px}",
    ".pmbf-btn{font-family:var(--disp);font-weight:400;text-transform:uppercase;letter-spacing:.04em;font-size:16px;color:#fff;background:var(--red);border:0;border-radius:14px;padding:16px 22px;cursor:pointer;width:100%}",
    ".pmbf-btn:hover{background:var(--red2)}",
    ".pmbf-btn[disabled]{opacity:.7;cursor:wait}",
    ".pmbf-fine{font-size:13px;color:var(--mute);margin:0}",
    ".pmbf-err{color:var(--red);font-size:13px;font-weight:600}",
    ".pmbf-err:empty{display:none}",
    ".pmbf-bad{border-color:var(--red)!important}",
    ".pmbf-hp{position:absolute!important;left:-10000px!important;width:1px;height:1px;overflow:hidden}",
    ".pmbf-done h3{font-family:var(--disp);font-weight:400;font-size:28px;margin:0;text-transform:uppercase;letter-spacing:0;color:var(--ink)}",
    ".pmbf-done p{margin:0;color:var(--ink2)}",
    "@media (max-width:900px){.pmbf-in{grid-template-columns:minmax(0,1fr);gap:28px}.pmbf-copy{position:static}.pmbf{padding:32px 16px 40px}}",
    "@media (max-width:560px){.pmbf-row{grid-template-columns:minmax(0,1fr)}.pmbf-uses div{grid-template-columns:minmax(0,1fr);gap:2px}.pmbf form,.pmbf .pmbf-done{padding:20px}}"
  ].join("");

  function esc(t){ return String(t).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]; }); }
  function chips(name, type, items){
    return items.map(function(it){
      return '<label class="pmbf-chip"><input type="' + type + '" name="' + name + '" value="' + esc(it[0]) + '"><span>' + esc(it[1]) + '</span></label>';
    }).join("");
  }

  function HTML(){
    return '<section class="pmbf" aria-label="Bulk order form"><div class="pmbf-in">' +
      '<div class="pmbf-copy">' +
        '<span class="pmbf-eb">\\u2605 Bulk &amp; corporate orders</span>' +
        '<h2 class="pmbf-h">Snacks for the <em>whole team.</em></h2>' +
        '<p>High-protein roasted edamame and soya snacks for offices, gifting and events. Tell us what you need and we will come back with a quote.</p>' +
        '<div class="pmbf-uses">' +
          '<div><b>Gifting</b><span>Diwali and festive hampers, client gifts, custom-branded packs</span></div>' +
          '<div><b>Office pantry</b><span>Monthly supply for teams and cafeterias</span></div>' +
          '<div><b>Events</b><span>Conferences, marathons, gyms and college fests</span></div>' +
          '<div><b>Resale</b><span>Cafes, gyms, stores and distributors</span></div>' +
        '</div>' +
        '<span class="pmbf-promise"><i aria-hidden="true"></i>' + esc(PROMISE) + '</span>' +
      '</div>' +
      '<div class="pmbf-card">' + FORM() + '</div>' +
    '</div></section>';
  }

  function FORM(){
    return '<form novalidate>' +
      '<div class="pmbf-top"><h3>Get a bulk quote</h3><span>Takes 1 minute</span></div>' +
      '<div class="pmbf-row">' +
        field("name", "Full name", '<input type="text" id="pmbf-name" name="name" autocomplete="name" required>') +
        field("company", "Company / organisation", '<input type="text" id="pmbf-company" name="company" autocomplete="organization" required>') +
      '</div>' +
      '<div class="pmbf-row">' +
        field("email", "Work email", '<input type="email" id="pmbf-email" name="email" autocomplete="email" required>') +
        field("phone", "Phone (WhatsApp)", '<div class="pmbf-ph"><select id="pmbf-cc" name="cc" aria-label="Country code"><option value="+91">+91</option><option value="+971">+971</option><option value="+1">+1</option><option value="+44">+44</option><option value="+65">+65</option><option value="+61">+61</option></select><input type="tel" id="pmbf-phone" name="phone" inputmode="tel" autocomplete="tel-national" required></div>') +
      '</div>' +
      '<fieldset class="pmbf-f" data-f="useCase"><legend>What is this for?</legend><div class="pmbf-chips">' + chips("useCase", "radio", USES) + '</div><div class="pmbf-err" data-err="useCase"></div></fieldset>' +
      '<fieldset class="pmbf-f" data-f="quantityBand"><legend>Roughly how many units?</legend><div class="pmbf-chips">' + chips("quantityBand", "radio", QTY) + '</div><div class="pmbf-err" data-err="quantityBand"></div></fieldset>' +
      '<fieldset class="pmbf-f"><legend>Products you like <span class="pmbf-opt">\\u00b7 optional</span></legend><div class="pmbf-chips">' + chips("products", "checkbox", PRODUCTS) + '</div></fieldset>' +
      '<div class="pmbf-row">' +
        field("city", "Delivery city", '<input type="text" id="pmbf-city" name="city" autocomplete="address-level2" required>') +
        field("neededBy", 'Needed by <span class="pmbf-opt">\\u00b7 optional</span>', '<input type="date" id="pmbf-date" name="neededBy">') +
      '</div>' +
      field("notes", 'Anything else? <span class="pmbf-opt">\\u00b7 optional</span>', '<textarea id="pmbf-notes" name="notes" maxlength="1500" placeholder="Occasion, branding ideas, delivery details..."></textarea>') +
      '<div class="pmbf-hp" aria-hidden="true"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>' +
      '<button class="pmbf-btn" type="submit">Get my quote</button>' +
      '<div class="pmbf-err" data-err="form" role="alert"></div>' +
      '<p class="pmbf-fine">We will email you a few quick questions and reply with pricing. No spam, and we never share your details.</p>' +
    '</form>';
  }

  function field(name, label, control){
    var idm = control.match(/id="([^"]+)"/);
    return '<div class="pmbf-f" data-f="' + name + '"><label class="pmbf-l" for="' + (idm ? idm[1] : "") + '">' + label + '</label>' + control + '<div class="pmbf-err" data-err="' + name + '"></div></div>';
  }

  function key(){
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, ""); } catch(e){}
    return String(Date.now()) + Math.random().toString(36).slice(2, 12);
  }

  function wire(host){
    var form = host.querySelector("form");
    var btn = form.querySelector(".pmbf-btn");
    var sub = key();
    function setErr(name, msg){
      var e = form.querySelector('[data-err="' + name + '"]'); if (e) e.textContent = msg || "";
      var f = form.querySelector('[data-f="' + name + '"] input:not([type=radio]):not([type=checkbox]), [data-f="' + name + '"] textarea');
      if (f) { if (msg) f.classList.add("pmbf-bad"); else f.classList.remove("pmbf-bad"); }
    }
    form.addEventListener("submit", function(ev){
      ev.preventDefault();
      ["name","company","email","phone","city","useCase","quantityBand","neededBy","form"].forEach(function(n){ setErr(n, ""); });
      var fd = new FormData(form);
      var phone = String(fd.get("phone") || "").replace(/[^0-9]/g, "");
      var cc = String(fd.get("cc") || "+91");
      var payload = {
        submissionKey: sub,
        name: fd.get("name"), company: fd.get("company"), email: fd.get("email"),
        phone: phone ? cc + phone.replace(/^0+/, "") : "",
        city: fd.get("city"), useCase: fd.get("useCase"), quantityBand: fd.get("quantityBand"),
        products: fd.getAll("products"), neededBy: fd.get("neededBy"), notes: fd.get("notes"),
        website: fd.get("website"), pageUrl: location.href
      };
      btn.disabled = true; btn.textContent = "Sending...";
      fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
        .then(function(r){ return r.json().catch(function(){ return { ok:false }; }); })
        .then(function(j){
          if (j && j.ok) {
            var first = String(payload.name || "").trim().split(/\\s+/)[0] || "there";
            host.querySelector(".pmbf-card").innerHTML = '<div class="pmbf-done" role="status"><span class="pmbf-eb">\\u2605 Request received' + (j.ref ? ' \\u00b7 ' + esc(j.ref) : '') + '</span><h3>Thanks, ' + esc(first) + '.</h3><p>We have sent a few quick questions to <b>' + esc(payload.email) + '</b>. Reply when you can and we will come back with pricing. ' + esc(PROMISE) + '.</p></div>';
            try { if (window.gtag) gtag("event", "generate_lead", { form_name: "bulk_order", lead_type: payload.useCase }); } catch(e){}
            return;
          }
          if (j && j.errors) { Object.keys(j.errors).forEach(function(n){ setErr(n === "submissionKey" ? "form" : n, j.errors[n]); }); }
          else setErr("form", (j && j.error) || "Could not send. Please try again or email hello@promunch.in.");
          btn.disabled = false; btn.textContent = "Get my quote";
        })
        .catch(function(){
          setErr("form", "Network problem. Please try again or email hello@promunch.in.");
          btn.disabled = false; btn.textContent = "Get my quote";
        });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();`;
}
