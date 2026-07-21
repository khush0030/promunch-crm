"use client";

// Growth tab: grow the opted-in WhatsApp audience beyond the ~833 imported
// contacts. Three tools, all self-serve:
//   1. Opt-in POPUP  — paste-in snippet for trypromunch.in that collects phone
//      numbers into wa_contacts with a real consent trail (/api/public/wa-optin).
//   2. Chat WIDGET   — floating WhatsApp button snippet; clicks route through a
//      tracked /r/<code> link so we can count them.
//   3. QR CODES      — named, tracked QR codes (packaging, store counter, bio
//      links); scans land in wa_link_clicks via the same /r/ redirect.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Download, MessageCircle, Plus, QrCode, Users } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { cardStyle, inputStyle, primaryBtn, smallBtn } from "./styles";
import { Field } from "./primitives";

type GrowthData = {
  wa_number: string;
  popup: { leads: number };
  widget: { code: string; target: string; clicks: number } | null;
  qrs: { code: string; name: string; target: string; scans: number; created_at: string }[];
};

const origin = () => (typeof window !== "undefined" ? window.location.origin : "");

/* ------------------------- snippet builders ------------------------- */

function popupSnippet(cfg: { headline: string; sub: string; cta: string; delaySec: number; coolDays: number; wa: string }): string {
  const conf = JSON.stringify({
    api: `${origin()}/api/public/wa-optin`,
    delay: Math.max(1, cfg.delaySec) * 1000,
    coolDays: Math.max(1, cfg.coolDays),
    headline: cfg.headline,
    sub: cfg.sub,
    cta: cfg.cta,
    wa: cfg.wa,
  });
  return `<script>
(function(){
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
})();
</script>`;
}

function widgetSnippet(cfg: { link: string; greeting: string; side: "right" | "left"; delaySec: number }): string {
  const conf = JSON.stringify({
    link: cfg.link,
    greeting: cfg.greeting,
    side: cfg.side,
    delay: Math.max(0, cfg.delaySec) * 1000,
  });
  return `<script>
(function(){
  var C=${conf};var s=C.side==="left"?"left:16px":"right:16px";
  var b=document.createElement("a");
  b.href=C.link;b.target="_blank";b.rel="noopener";b.setAttribute("aria-label","Chat with PROMUNCH on WhatsApp");
  b.setAttribute("style","position:fixed;z-index:99998;bottom:16px;"+s+";width:56px;height:56px;border-radius:50%;background:#25D366;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(0,0,0,.25)");
  b.innerHTML='<svg viewBox="0 0 32 32" width="30" height="30" fill="#fff"><path d="M16 3C9.4 3 4 8.3 4 14.9c0 2.1.6 4.1 1.6 5.9L4 29l8.4-1.6c1.7.9 3.6 1.4 5.6 1.4 6.6 0 12-5.3 12-11.9S22.6 3 16 3zm0 21.8c-1.8 0-3.5-.5-5-1.3l-.4-.2-5 1 1-4.8-.3-.4c-1-1.6-1.5-3.4-1.5-5.2 0-5.5 4.6-10 10.2-10s10.2 4.5 10.2 10-4.6 9.9-10.2 9.9zm5.6-7.4c-.3-.2-1.8-.9-2.1-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.2-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.5-.6c.2-.2.2-.3.3-.5.1-.2 0-.4 0-.6-.1-.2-.7-1.7-1-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1.1 1-1.1 2.5s1.1 2.9 1.3 3.1c.2.2 2.2 3.4 5.4 4.7.8.3 1.4.5 1.8.7.8.2 1.5.2 2 .1.6-.1 1.8-.7 2.1-1.5.3-.7.3-1.3.2-1.5-.1-.1-.3-.2-.6-.3z"/></svg>';
  document.body.appendChild(b);
  if(C.greeting){setTimeout(function(){
    try{if(localStorage.getItem("pm_wa_hi"))return}catch(e){}
    var g=document.createElement("div");
    g.setAttribute("style","position:fixed;z-index:99998;bottom:82px;"+s+";max-width:230px;background:#fff;color:#2B2118;border:1px solid #E8D9C5;border-radius:12px;padding:10px 30px 10px 12px;font-size:13px;font-family:system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.15)");
    g.innerHTML=C.greeting+'<button style="position:absolute;top:2px;right:6px;border:0;background:none;color:#8a7a66;font-size:14px;cursor:pointer">\\u00d7</button>';
    g.querySelector("button").onclick=function(ev){ev.stopPropagation();try{localStorage.setItem("pm_wa_hi","1")}catch(e){};g.remove()};
    g.onclick=function(){window.open(C.link,"_blank")};
    document.body.appendChild(g);
  },C.delay)}
})();
</script>`;
}

/* ------------------------- QR rendering ------------------------- */

function QrImage({ url, name }: { url: string; name: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    import("qrcode").then((QR) =>
      QR.toDataURL(url, { width: 180, margin: 1, color: { dark: "#2B2118", light: "#FFFFFF" } })
        .then((d: string) => { if (live) setSrc(d); }),
    ).catch(() => {});
    return () => { live = false; };
  }, [url]);
  async function download() {
    const QR = await import("qrcode");
    const big = await QR.toDataURL(url, { width: 1024, margin: 2, color: { dark: "#2B2118", light: "#FFFFFF" } });
    const a = document.createElement("a");
    a.href = big;
    a.download = `promunch-wa-qr-${name}.png`;
    a.click();
  }
  return (
    <div style={{ textAlign: "center" }}>
      {src
        ? <img src={src} alt={`QR code: ${name}`} width={120} height={120} style={{ borderRadius: 8, border: "1px solid var(--pm-border)" }} />
        : <div style={{ width: 120, height: 120, borderRadius: 8, background: "var(--pm-line)" }} />}
      <button type="button" onClick={download} style={{ ...smallBtn, marginTop: 6, width: "100%", justifyContent: "center" }}>
        <Download size={12} /> PNG
      </button>
    </div>
  );
}

/* ------------------------- main view ------------------------- */

function CopyBox({ label, text }: { label: string; text: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--pm-muted)" }}>{label}</span>
        <button type="button" style={smallBtn}
          onClick={() => {
            navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              toast.push({ kind: "success", text: "Copied. Paste it into the Shopify theme, right before </body>." });
              setTimeout(() => setCopied(false), 2500);
            });
          }}>
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy snippet"}
        </button>
      </div>
      <textarea readOnly value={text} rows={5}
        style={{ ...inputStyle, fontFamily: "ui-monospace, monospace", fontSize: 10.5, marginBottom: 0, resize: "vertical" }} />
    </div>
  );
}

export default function GrowthView() {
  const toast = useToast();
  const { data, refetch } = useQuery({
    queryKey: ["wa-growth"],
    queryFn: async (): Promise<GrowthData | null> => {
      const r = await fetch("/api/whatsapp/growth");
      if (!r.ok) return null;
      return r.json();
    },
    refetchInterval: 30000,
  });

  // Popup config
  const [headline, setHeadline] = useState("Snacks with 50% protein. Offers on WhatsApp.");
  const [sub, setSub] = useState("Join PROMUNCH for launch drops and member-only deals. Your Munchy Pal is one text away.");
  const [cta, setCta] = useState("Join");
  const [delaySec, setDelaySec] = useState(6);
  const [coolDays, setCoolDays] = useState(15);

  // Widget config
  const [greeting, setGreeting] = useState("Questions? Chat with Your Munchy Pal 🌱");
  const [side, setSide] = useState<"right" | "left">("right");
  const [widgetDelay, setWidgetDelay] = useState(4);

  // QR create
  const [qrName, setQrName] = useState("");
  const [qrPrefill, setQrPrefill] = useState("");
  const [qrBusy, setQrBusy] = useState(false);

  const popupCode = useMemo(
    () => popupSnippet({ headline, sub, cta, delaySec, coolDays, wa: data?.wa_number ?? "919981310247" }),
    [headline, sub, cta, delaySec, coolDays, data?.wa_number],
  );
  const widgetCode = useMemo(
    () => data?.widget ? widgetSnippet({ link: `${origin()}/r/${data.widget.code}`, greeting, side, delaySec: widgetDelay }) : null,
    [data?.widget, greeting, side, widgetDelay],
  );

  async function createQr() {
    if (!qrName.trim()) { toast.push({ kind: "error", text: "Give the QR a name (e.g. packaging, store-counter)." }); return; }
    setQrBusy(true);
    try {
      const r = await fetch("/api/whatsapp/growth", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: qrName, prefill: qrPrefill }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) toast.push({ kind: "error", text: j.error ?? `HTTP ${r.status}` });
      else { setQrName(""); setQrPrefill(""); refetch(); }
    } finally { setQrBusy(false); }
  }

  const totalScans = (data?.qrs ?? []).reduce((a, q) => a + q.scans, 0);

  return (
    <div>
      <div style={{ fontSize: 13, color: "var(--pm-muted)", marginBottom: 14 }}>
        Grow the opted-in audience. Every tool here writes a consent trail, so these contacts are safe to market to.
      </div>

      {/* stats strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 10, marginBottom: 18 }}>
        {[
          { n: data?.popup.leads ?? 0, l: "Popup sign-ups", icon: <Users size={13} /> },
          { n: data?.widget?.clicks ?? 0, l: "Widget clicks", icon: <MessageCircle size={13} /> },
          { n: totalScans, l: "QR scans", icon: <QrCode size={13} /> },
        ].map((s) => (
          <div key={s.l} style={cardStyle}>
            <div style={{ fontSize: 24, fontWeight: 800, color: "var(--pm-green)" }}>{s.n.toLocaleString("en-IN")}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--pm-muted)", display: "flex", alignItems: "center", gap: 5 }}>{s.icon} {s.l}</div>
          </div>
        ))}
      </div>

      {/* popup */}
      <div style={{ ...cardStyle, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Opt-in popup for trypromunch.in</div>
        <div style={{ fontSize: 12, color: "var(--pm-hint)", marginBottom: 10 }}>
          Collects phone numbers straight into WhatsApp contacts (tagged <strong>website_popup</strong>, consent recorded).
          After joining, visitors get a one-tap &quot;Say hi&quot; button — their message opens the free 24h window.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
          <Field label="Headline"><input value={headline} onChange={(e) => setHeadline(e.target.value)} style={inputStyle} /></Field>
          <Field label="Sub text"><input value={sub} onChange={(e) => setSub(e.target.value)} style={inputStyle} /></Field>
          <Field label="Button label"><input value={cta} onChange={(e) => setCta(e.target.value)} style={inputStyle} /></Field>
          <Field label="Show after (seconds)">
            <input type="number" min={1} value={delaySec} onChange={(e) => setDelaySec(Number(e.target.value) || 6)} style={inputStyle} aria-label="Popup delay seconds" />
          </Field>
          <Field label="Snooze after close (days)">
            <input type="number" min={1} value={coolDays} onChange={(e) => setCoolDays(Number(e.target.value) || 15)} style={inputStyle} aria-label="Popup cooldown days" />
          </Field>
        </div>
        <CopyBox label="Paste into Shopify → Online Store → Edit code → theme.liquid, before </body>" text={popupCode} />
      </div>

      {/* widget */}
      <div style={{ ...cardStyle, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Website chat widget</div>
        <div style={{ fontSize: 12, color: "var(--pm-hint)", marginBottom: 10 }}>
          Floating WhatsApp button with an optional greeting bubble. Clicks route through a tracked link, then open a chat with us.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
          <Field label="Greeting bubble (blank = none)"><input value={greeting} onChange={(e) => setGreeting(e.target.value)} style={inputStyle} /></Field>
          <Field label="Position">
            <select value={side} onChange={(e) => setSide(e.target.value as "right" | "left")} style={inputStyle} aria-label="Widget position">
              <option value="right">Bottom right</option>
              <option value="left">Bottom left</option>
            </select>
          </Field>
          <Field label="Greeting delay (seconds)">
            <input type="number" min={0} value={widgetDelay} onChange={(e) => setWidgetDelay(Number(e.target.value) || 0)} style={inputStyle} aria-label="Greeting delay seconds" />
          </Field>
        </div>
        {widgetCode
          ? <CopyBox label="Paste into theme.liquid, before </body> (works alongside the popup)" text={widgetCode} />
          : <div style={{ fontSize: 12, color: "var(--pm-hint)" }}>Preparing tracked link…</div>}
      </div>

      {/* QR codes */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>QR codes</div>
        <div style={{ fontSize: 12, color: "var(--pm-hint)", marginBottom: 10 }}>
          One per placement (packaging, store counter, Instagram bio). Each opens WhatsApp with its own first message, so you can tell where a customer scanned from. Scans are counted here.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          <input value={qrName} onChange={(e) => setQrName(e.target.value)} placeholder="Name, e.g. packaging"
            style={{ ...inputStyle, marginBottom: 0, flex: "1 1 160px" }} aria-label="QR name" />
          <input value={qrPrefill} onChange={(e) => setQrPrefill(e.target.value)} placeholder="First message (optional)"
            style={{ ...inputStyle, marginBottom: 0, flex: "2 1 220px" }} aria-label="QR prefill message" />
          <button type="button" onClick={createQr} disabled={qrBusy} style={primaryBtn}><Plus size={13} /> {qrBusy ? "Creating…" : "Create QR"}</button>
        </div>
        {(data?.qrs ?? []).length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--pm-hint)", padding: 12, textAlign: "center" }}>No QR codes yet.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 12 }}>
            {(data?.qrs ?? []).map((q) => (
              <div key={q.code} style={{ border: "1px solid var(--pm-border)", borderRadius: 10, padding: 10 }}>
                <QrImage url={`${origin()}/r/${q.code}`} name={q.name} />
                <div style={{ fontWeight: 700, fontSize: 13, marginTop: 8 }}>{q.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--pm-muted)" }}>{q.scans.toLocaleString("en-IN")} scan{q.scans === 1 ? "" : "s"}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
