"use client";

// Growth tab: a Klaviyo-style visual editor for the two storefront acquisition
// tools — the opt-in popup and the WhatsApp chat button. Left pane = controls
// (content, design, image, targeting); right pane = a LIVE preview rendered from
// the exact same markup the storefront gets (src/lib/wa-embed.ts), so what staff
// see is what a visitor sees. One "Install on store" button injects it on
// Shopify; config edits go live within minutes — no theme editing.

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Check, Image as ImageIcon, Monitor, Power, Smartphone, Trash2, Upload, Users, MessageCircle,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { cardStyle, inputStyle, primaryBtn, smallBtn } from "./styles";
import { Field } from "./primitives";
import {
  FONTS, GROWTH_DEFAULTS, fontHref, renderPopupInner, widgetBubbleInner, widgetButtonInner,
  type GrowthConfig, type PopupConfig, type PopupPosition, type WidgetConfig,
} from "@/lib/wa-embed";

type GrowthData = {
  wa_number: string;
  config: GrowthConfig;
  installed: boolean;
  shop_domain: string;
  loader_snippet: string;
  popup: { leads: number };
  widget: { code: string; clicks: number } | null;
};

const THEMES: { name: string; t: PopupConfig["theme"] }[] = [
  { name: "Warm (PROMUNCH)", t: { bg: "#FFF8F0", text: "#2B2118", accent: "#25D366", accentText: "#FFFFFF", font: "poppins", radius: 16 } },
  { name: "Clean light", t: { bg: "#FFFFFF", text: "#1A1A1A", accent: "#1A1A1A", accentText: "#FFFFFF", font: "inter", radius: 12 } },
  { name: "Dark", t: { bg: "#1E1B18", text: "#F5EFE7", accent: "#25D366", accentText: "#0B140C", font: "montserrat", radius: 14 } },
  { name: "Elegant", t: { bg: "#F7F3EC", text: "#2B2118", accent: "#B4562A", accentText: "#FFFFFF", font: "playfair", radius: 8 } },
];

/* ---- live preview: reuses the storefront markup for fidelity ---- */

function Preview({ cfg, tab, device }: { cfg: GrowthConfig; tab: "popup" | "widget"; device: "desktop" | "mobile" }) {
  // Load the chosen popup font so the preview matches the storefront.
  useEffect(() => {
    const href = fontHref(cfg.popup.theme.font);
    if (!href) return;
    if (document.querySelector(`link[data-pmfont="${href}"]`)) return;
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = href; l.setAttribute("data-pmfont", href);
    document.head.appendChild(l);
  }, [cfg.popup.theme.font]);

  const frameW = device === "mobile" ? 340 : 720;
  const showPopup = tab === "popup" && cfg.popup.enabled;
  const showWidget = tab === "widget" && cfg.widget.enabled;
  const side = cfg.widget.side === "left" ? { left: 14 } : { right: 14 };

  // Position the popup within the frame (absolute mimic of the fixed embed).
  const pos = cfg.popup.position;
  const wrap: React.CSSProperties =
    pos === "center" ? { inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "rgba(0,0,0,.45)" }
    : pos === "bottom-bar" ? { left: 0, right: 0, bottom: 0 }
    : pos === "bottom-left" ? { left: 14, bottom: 14, maxWidth: 320 }
    : { right: 14, bottom: 14, maxWidth: 320 };
  const cardW = pos === "center" ? Math.min(360, frameW - 40) : pos === "bottom-bar" ? frameW : 300;

  return (
    <div style={{ position: "sticky", top: 12 }}>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div style={{ width: frameW, maxWidth: "100%", border: "1px solid var(--pm-border)", borderRadius: 12, overflow: "hidden", background: "#fff", boxShadow: "0 8px 30px rgba(0,0,0,.10)" }}>
          {/* fake browser chrome */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", background: "#EDE7DF", borderBottom: "1px solid var(--pm-border)" }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: "#E36B5C" }} />
            <span style={{ width: 10, height: 10, borderRadius: 999, background: "#E5B94E" }} />
            <span style={{ width: 10, height: 10, borderRadius: 999, background: "#5FB878" }} />
            <span style={{ marginLeft: 10, fontSize: 11, color: "#8a7a66", background: "#fff", borderRadius: 6, padding: "3px 10px", flex: 1 }}>trypromunch.in</span>
          </div>
          {/* faux storefront body */}
          <div style={{ position: "relative", height: device === "mobile" ? 520 : 440, overflow: "hidden", background: "linear-gradient(180deg,#FBF7F1,#F3ECE1)" }}>
            <div style={{ padding: 18, opacity: 0.55 }}>
              <div style={{ height: 26, width: "44%", background: "#E6DCCB", borderRadius: 6, marginBottom: 14 }} />
              <div style={{ height: 120, background: "#E6DCCB", borderRadius: 10, marginBottom: 14 }} />
              <div style={{ height: 12, width: "88%", background: "#E6DCCB", borderRadius: 6, marginBottom: 8 }} />
              <div style={{ height: 12, width: "72%", background: "#E6DCCB", borderRadius: 6 }} />
            </div>

            {showPopup && (
              <div style={{ position: "absolute", ...wrap, zIndex: 5 }}>
                <div style={{ width: cardW, maxWidth: "100%" }} dangerouslySetInnerHTML={{ __html: renderPopupInner(cfg.popup) }} />
              </div>
            )}
            {showWidget && (
              <>
                <div style={{ position: "absolute", bottom: 14, ...side, zIndex: 5 }} dangerouslySetInnerHTML={{ __html: widgetButtonInner(cfg.widget) }} />
                {cfg.widget.greeting && (
                  <div style={{ position: "absolute", bottom: 80, ...side, zIndex: 5 }} dangerouslySetInnerHTML={{ __html: widgetBubbleInner(cfg.widget) }} />
                )}
              </>
            )}
            {!showPopup && !showWidget && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--pm-hint)", fontSize: 13 }}>
                This {tab === "popup" ? "popup" : "chat button"} is turned off.
              </div>
            )}
          </div>
        </div>
      </div>
      <div style={{ textAlign: "center", fontSize: 11, color: "var(--pm-hint)", marginTop: 8 }}>
        Live preview — exactly what visitors see on trypromunch.in.
      </div>
    </div>
  );
}

/* ------------------------- small controls ------------------------- */

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--pm-muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}
          style={{ width: 34, height: 30, padding: 0, border: "1px solid var(--pm-border)", borderRadius: 6, background: "none", cursor: "pointer" }} />
        <input value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, marginBottom: 0, width: 92, fontFamily: "ui-monospace, monospace", fontSize: 12 }} />
      </div>
    </div>
  );
}

/* ---------------------------- main view ---------------------------- */

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

  const [cfg, setCfg] = useState<GrowthConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"popup" | "widget">("popup");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [installBusy, setInstallBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (data?.config && !dirty) setCfg(data.config); }, [data?.config, dirty]);

  const setPopup = (fn: (p: PopupConfig) => PopupConfig) => { setCfg((c) => c ? { ...c, popup: fn(c.popup) } : c); setDirty(true); };
  const setWidget = (fn: (w: WidgetConfig) => WidgetConfig) => { setCfg((c) => c ? { ...c, widget: fn(c.widget) } : c); setDirty(true); };

  async function saveConfig() {
    if (!cfg) return;
    setSaving(true);
    try {
      const r = await fetch("/api/whatsapp/growth", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "config", config: cfg }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) { toast.push({ kind: "error", text: j.error ?? `HTTP ${r.status}` }); return; }
      setDirty(false);
      toast.push({ kind: "success", text: data?.installed ? "Saved. Live on your store within ~5 minutes." : "Saved." });
      refetch();
    } finally { setSaving(false); }
  }

  async function toggleInstall(install: boolean) {
    if (!install && !confirm("Remove the WhatsApp popup and chat button from trypromunch.in?")) return;
    setInstallBusy(true);
    try {
      const r = await fetch("/api/whatsapp/growth", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: install ? "install" : "uninstall" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) { toast.push({ kind: "error", text: j.error ?? `HTTP ${r.status}` }); return; }
      toast.push({ kind: "success", text: install ? "Installed — it's live on your store now." : "Removed from your store." });
      refetch();
    } finally { setInstallBusy(false); }
  }

  async function uploadImage(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("format", "IMAGE");
      const r = await fetch("/api/whatsapp/media-upload", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) { toast.push({ kind: "error", text: j.error ?? "Upload failed" }); return; }
      setPopup((p) => ({ ...p, imageUrl: j.url, imageLayout: p.imageLayout === "none" ? "top" : p.imageLayout }));
    } finally { setUploading(false); }
  }

  if (!cfg) return <div style={{ padding: 40, textAlign: "center", color: "var(--pm-hint)" }}>Loading…</div>;
  const p = cfg.popup, w = cfg.widget;

  return (
    <div>
      {/* stats + install */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ ...cardStyle, flex: "1 1 150px" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--pm-green)" }}>{(data?.popup.leads ?? 0).toLocaleString("en-IN")}</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--pm-muted)", display: "flex", alignItems: "center", gap: 5 }}><Users size={13} /> Popup sign-ups</div>
        </div>
        <div style={{ ...cardStyle, flex: "1 1 150px" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--pm-green)" }}>{(data?.widget?.clicks ?? 0).toLocaleString("en-IN")}</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--pm-muted)", display: "flex", alignItems: "center", gap: 5 }}><MessageCircle size={13} /> Chat button clicks</div>
        </div>
        <div style={{ ...cardStyle, flex: "2 1 300px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <Power size={14} color={data?.installed ? "var(--pm-green)" : "var(--pm-muted)"} />
              {data?.installed ? "Live on your store" : "Not installed"}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--pm-hint)", marginTop: 3 }}>
              {data?.installed ? `Running on ${data?.shop_domain}. Edits go live automatically.` : `One click adds it to ${data?.shop_domain ?? "your store"} — no theme editing.`}
            </div>
          </div>
          {data?.installed
            ? <button type="button" onClick={() => toggleInstall(false)} disabled={installBusy} style={{ ...smallBtn, color: "var(--pm-terra)", flexShrink: 0 }}>{installBusy ? "…" : "Remove"}</button>
            : <button type="button" onClick={() => toggleInstall(true)} disabled={installBusy} style={{ ...primaryBtn, flexShrink: 0 }}><Power size={13} /> {installBusy ? "Installing…" : "Install on store"}</button>}
        </div>
      </div>

      {/* editor: controls + preview */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 1fr) minmax(340px, 1.1fr)", gap: 16, alignItems: "start" }}>
        {/* LEFT — controls */}
        <div>
          <div className="pm-chips" style={{ marginBottom: 12 }}>
            <button type="button" className={`pm-chip${tab === "popup" ? " on" : ""}`} onClick={() => setTab("popup")}>Opt-in popup</button>
            <button type="button" className={`pm-chip${tab === "widget" ? " on" : ""}`} onClick={() => setTab("widget")}>Chat button</button>
          </div>

          {tab === "popup" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <ToggleRow label="Show the opt-in popup" on={p.enabled} onChange={(v) => setPopup((x) => ({ ...x, enabled: v }))} />

              <Group title="Content">
                <Field label="Headline"><input value={p.headline} onChange={(e) => setPopup((x) => ({ ...x, headline: e.target.value }))} style={inputStyle} /></Field>
                <Field label="Sub text"><textarea value={p.sub} onChange={(e) => setPopup((x) => ({ ...x, sub: e.target.value }))} rows={2} style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} /></Field>
                <Field label="Button label"><input value={p.cta} onChange={(e) => setPopup((x) => ({ ...x, cta: e.target.value }))} style={inputStyle} /></Field>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <Field label="After-signup title"><input value={p.successTitle} onChange={(e) => setPopup((x) => ({ ...x, successTitle: e.target.value }))} style={inputStyle} /></Field>
                  <Field label="After-signup text"><input value={p.successBody} onChange={(e) => setPopup((x) => ({ ...x, successBody: e.target.value }))} style={inputStyle} /></Field>
                </div>
              </Group>

              <Group title="Image">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg" hidden
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.target.value = ""; }} />
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} style={smallBtn}>
                    {uploading ? <>Uploading…</> : <><Upload size={13} /> {p.imageUrl ? "Replace image" : "Upload image"}</>}
                  </button>
                  {p.imageUrl && (
                    <button type="button" onClick={() => setPopup((x) => ({ ...x, imageUrl: null, imageLayout: "none" }))} style={{ ...smallBtn, color: "var(--pm-terra)" }}><Trash2 size={12} /> Remove</button>
                  )}
                  {p.imageUrl && (
                    <select value={p.imageLayout} onChange={(e) => setPopup((x) => ({ ...x, imageLayout: e.target.value as PopupConfig["imageLayout"] }))} style={{ ...inputStyle, marginBottom: 0, width: "auto" }} aria-label="Image layout">
                      <option value="top">Image on top</option>
                      <option value="side">Image on side</option>
                    </select>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "var(--pm-hint)", marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
                  <ImageIcon size={11} /> JPG or PNG, up to 5 MB. A product shot or logo works best.
                </div>
              </Group>

              <Group title="Design">
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {THEMES.map((th) => (
                    <button key={th.name} type="button" onClick={() => setPopup((x) => ({ ...x, theme: { ...th.t } }))}
                      style={{ ...smallBtn, fontSize: 11.5 }}>{th.name}</button>
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10 }}>
                  <ColorField label="Background" value={p.theme.bg} onChange={(v) => setPopup((x) => ({ ...x, theme: { ...x.theme, bg: v } }))} />
                  <ColorField label="Text" value={p.theme.text} onChange={(v) => setPopup((x) => ({ ...x, theme: { ...x.theme, text: v } }))} />
                  <ColorField label="Button" value={p.theme.accent} onChange={(v) => setPopup((x) => ({ ...x, theme: { ...x.theme, accent: v } }))} />
                  <ColorField label="Button text" value={p.theme.accentText} onChange={(v) => setPopup((x) => ({ ...x, theme: { ...x.theme, accentText: v } }))} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                  <Field label="Font">
                    <select value={p.theme.font} onChange={(e) => setPopup((x) => ({ ...x, theme: { ...x.theme, font: e.target.value } }))} style={inputStyle} aria-label="Font">
                      {Object.entries(FONTS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Position">
                    <select value={p.position} onChange={(e) => setPopup((x) => ({ ...x, position: e.target.value as PopupPosition }))} style={inputStyle} aria-label="Position">
                      <option value="center">Center of screen</option>
                      <option value="bottom-right">Bottom right</option>
                      <option value="bottom-left">Bottom left</option>
                      <option value="bottom-bar">Bottom bar (full width)</option>
                    </select>
                  </Field>
                </div>
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--pm-muted)", marginBottom: 4 }}>Corner roundness: {p.theme.radius}px</div>
                  <input type="range" min={0} max={32} value={p.theme.radius} onChange={(e) => setPopup((x) => ({ ...x, theme: { ...x.theme, radius: Number(e.target.value) } }))} style={{ width: "100%" }} aria-label="Corner radius" />
                </div>
              </Group>

              <Group title="Who sees it, and when">
                <Field label="Show the popup">
                  <select value={p.trigger.type} onChange={(e) => {
                    const type = e.target.value as PopupConfig["trigger"]["type"];
                    setPopup((x) => ({ ...x, trigger: type === "delay" ? { type, seconds: 6 } : type === "scroll" ? { type, percent: 40 } : { type } as PopupConfig["trigger"] }));
                  }} style={inputStyle} aria-label="Trigger">
                    <option value="delay">After a few seconds</option>
                    <option value="scroll">After scrolling down the page</option>
                    <option value="exit">When they are about to leave (exit intent)</option>
                    <option value="immediate">Immediately on page load</option>
                  </select>
                </Field>
                {p.trigger.type === "delay" && (
                  <Field label="Seconds to wait"><input type="number" min={0} max={120} value={p.trigger.seconds} onChange={(e) => setPopup((x) => ({ ...x, trigger: { type: "delay", seconds: Number(e.target.value) || 0 } }))} style={inputStyle} /></Field>
                )}
                {p.trigger.type === "scroll" && (
                  <Field label="Scroll depth (%)"><input type="number" min={5} max={100} value={p.trigger.percent} onChange={(e) => setPopup((x) => ({ ...x, trigger: { type: "scroll", percent: Number(e.target.value) || 40 } }))} style={inputStyle} /></Field>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Field label="Don't show again for (days)"><input type="number" min={0} max={365} value={p.frequencyDays} onChange={(e) => setPopup((x) => ({ ...x, frequencyDays: Number(e.target.value) || 0 }))} style={inputStyle} /></Field>
                  <Field label="On which pages">
                    <select value={p.pages} onChange={(e) => setPopup((x) => ({ ...x, pages: e.target.value as PopupConfig["pages"] }))} style={inputStyle} aria-label="Pages">
                      <option value="all">All pages</option>
                      <option value="home">Home page only</option>
                      <option value="product">Product pages</option>
                      <option value="cart">Cart page</option>
                    </select>
                  </Field>
                </div>
              </Group>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <ToggleRow label="Show the chat button" on={w.enabled} onChange={(v) => setWidget((x) => ({ ...x, enabled: v }))} />
              <Group title="Content">
                <Field label="Greeting bubble (blank = none)"><input value={w.greeting} onChange={(e) => setWidget((x) => ({ ...x, greeting: e.target.value }))} style={inputStyle} /></Field>
              </Group>
              <Group title="Design">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10 }}>
                  <ColorField label="Button" value={w.theme.button} onChange={(v) => setWidget((x) => ({ ...x, theme: { ...x.theme, button: v } }))} />
                  <ColorField label="Bubble bg" value={w.theme.bubbleBg} onChange={(v) => setWidget((x) => ({ ...x, theme: { ...x.theme, bubbleBg: v } }))} />
                  <ColorField label="Bubble text" value={w.theme.bubbleText} onChange={(v) => setWidget((x) => ({ ...x, theme: { ...x.theme, bubbleText: v } }))} />
                </div>
              </Group>
              <Group title="Placement">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Field label="Position">
                    <select value={w.side} onChange={(e) => setWidget((x) => ({ ...x, side: e.target.value as "right" | "left" }))} style={inputStyle} aria-label="Widget side">
                      <option value="right">Bottom right</option>
                      <option value="left">Bottom left</option>
                    </select>
                  </Field>
                  <Field label="Greeting delay (seconds)"><input type="number" min={0} max={120} value={w.delaySec} onChange={(e) => setWidget((x) => ({ ...x, delaySec: Number(e.target.value) || 0 }))} style={inputStyle} /></Field>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", marginTop: 4 }}>
                  <input type="checkbox" checked={w.showOnMobile} onChange={(e) => setWidget((x) => ({ ...x, showOnMobile: e.target.checked }))} /> Show on mobile too
                </label>
              </Group>
            </div>
          )}
        </div>

        {/* RIGHT — preview */}
        <div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginBottom: 10 }}>
            <button type="button" onClick={() => setDevice("desktop")} title="Desktop" aria-label="Desktop preview" style={{ ...smallBtn, background: device === "desktop" ? "var(--pm-app)" : undefined }}><Monitor size={14} /></button>
            <button type="button" onClick={() => setDevice("mobile")} title="Mobile" aria-label="Mobile preview" style={{ ...smallBtn, background: device === "mobile" ? "var(--pm-app)" : undefined }}><Smartphone size={14} /></button>
          </div>
          <Preview cfg={cfg} tab={tab} device={device} />
        </div>
      </div>

      {/* sticky save bar */}
      <div style={{ position: "sticky", bottom: 0, marginTop: 18, padding: "12px 0", background: "linear-gradient(transparent, var(--pm-app) 40%)", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
        {dirty && <span style={{ fontSize: 12, color: "var(--pm-gold)", fontWeight: 600 }}>Unsaved changes</span>}
        <button type="button" onClick={() => { setCfg(data?.config ?? GROWTH_DEFAULTS); setDirty(false); }} disabled={!dirty} style={smallBtn}>Discard</button>
        <button type="button" onClick={saveConfig} disabled={saving || !dirty} style={primaryBtn}>
          <Check size={13} /> {saving ? "Saving…" : data?.installed ? "Save & publish" : "Save"}
        </button>
      </div>
    </div>
  );
}

function ToggleRow({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ ...cardStyle, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", padding: "12px 14px" }}>
      <span style={{ fontWeight: 700, fontSize: 13 }}>{label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: on ? "var(--pm-green)" : "var(--pm-muted)" }}>
        <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} /> {on ? "On" : "Off"}
      </span>
    </label>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--pm-muted)", marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}
