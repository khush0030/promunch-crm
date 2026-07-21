"use client";

// Growth editor — a clean visual builder for the two storefront acquisition
// tools (opt-in popup + WhatsApp chat button). Left = controls, right = a live
// preview rendered from the SAME markup the storefront gets (src/lib/wa-embed.ts),
// so what staff design is what a visitor sees. One "Publish to store" button
// installs it on Shopify via a script tag; edits go live automatically — no
// theme editing. Styling lives in GrowthView.module.css.

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, Check, Clock, ExternalLink, Image as ImageIcon, LogOut, MessageCircle,
  Monitor, MousePointerClick, Power, RefreshCw, Smartphone, Store, Trash2, Upload, Users, Zap,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import {
  FONTS, GROWTH_DEFAULTS, LAYOUTS_NEEDING_IMAGE, fontHref, renderPopupInner, widgetBubbleInner, widgetButtonInner,
  type GrowthConfig, type PopupConfig, type PopupLayout, type PopupPosition, type WidgetConfig,
} from "@/lib/wa-embed";
import s from "./GrowthView.module.css";

type GrowthData = {
  wa_number: string;
  config: GrowthConfig;
  installed: boolean;
  shop_domain: string;
  popup: { leads: number };
  widget: { code: string; clicks: number } | null;
};
type Probe = { state: "connected" | "no_scope" | "no_token" | "error"; shop: string; reason?: string };

const THEMES: { name: string; t: PopupConfig["theme"] }[] = [
  { name: "Warm", t: { bg: "#FFF8F0", text: "#2B2118", accent: "#25D366", accentText: "#FFFFFF", font: "poppins", radius: 16 } },
  { name: "Clean", t: { bg: "#FFFFFF", text: "#1A1A1A", accent: "#1A1A1A", accentText: "#FFFFFF", font: "inter", radius: 12 } },
  { name: "Dark", t: { bg: "#1E1B18", text: "#F5EFE7", accent: "#25D366", accentText: "#0B140C", font: "montserrat", radius: 14 } },
  { name: "Elegant", t: { bg: "#F7F3EC", text: "#2B2118", accent: "#B4562A", accentText: "#FFFFFF", font: "playfair", radius: 8 } },
];

/* ============================ small components ============================ */

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className={s.switch} aria-label={label}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className={s.track} /><span className={s.thumb} />
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className={s.section}><div className={s.sectionHead}>{title}</div>{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className={s.field}><label className={s.label}>{label}</label>{children}</div>;
}

function Swatch({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className={s.swatch}>
      <div className={s.swatchBtn} style={{ background: value }}>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
      </div>
      <span className={s.swatchLbl}>{label}</span>
    </div>
  );
}

function Stepper({ value, onChange, min = 0, max = 999 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  return (
    <div className={s.stepper}>
      <button type="button" className={s.stepBtn} onClick={() => set(value - 1)} aria-label="Decrease">−</button>
      <input className={s.stepVal} value={value} inputMode="numeric" onChange={(e) => set(Number(e.target.value.replace(/\D/g, "")) || 0)} aria-label="Value" />
      <button type="button" className={s.stepBtn} onClick={() => set(value + 1)} aria-label="Increase">+</button>
    </div>
  );
}

function LayoutGallery({ value, onChange }: { value: PopupLayout; onChange: (v: PopupLayout) => void }) {
  // Schematic thumbnails (not the real render) so the gallery reads instantly.
  const thumbs: Record<PopupLayout, React.ReactNode> = {
    text: <div className={`${s.lt} ${s.center}`}><div className={s.ltBody}><span className={s.ltLine} /><span className={s.ltLine} /><span className={s.ltBtn} style={{ alignSelf: "center" }} /></div></div>,
    "image-top": <div className={`${s.lt} ${s.col}`}><span className={s.ltImg} style={{ height: 16 }} /><div className={s.ltBody}><span className={s.ltLine} /><span className={s.ltBtn} /></div></div>,
    "image-left": <div className={s.lt}><span className={s.ltImg} style={{ width: 20 }} /><div className={s.ltBody}><span className={s.ltLine} /><span className={s.ltLine} /><span className={s.ltBtn} /></div></div>,
    "image-right": <div className={s.lt}><div className={s.ltBody}><span className={s.ltLine} /><span className={s.ltLine} /><span className={s.ltBtn} /></div><span className={s.ltImg} style={{ width: 20 }} /></div>,
    background: <div className={s.lt} style={{ padding: 0 }}><span className={s.ltImg} style={{ width: "100%", borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center" }}><span className={s.ltBgLines}><span className={s.ltLine} style={{ width: 34, background: "rgba(255,255,255,.85)" }} /><span className={s.ltBtn} style={{ marginTop: 3 }} /></span></span></div>,
    compact: <div className={s.lt} style={{ alignItems: "center" }}><span className={s.ltLine} style={{ flex: 1 }} /><span className={s.ltBtn} style={{ width: 24, marginTop: 0 }} /></div>,
  };
  const names: Record<PopupLayout, string> = {
    text: "Text only", "image-top": "Image on top", "image-left": "Image left",
    "image-right": "Image right", background: "Full background", compact: "Compact bar",
  };
  const order: PopupLayout[] = ["text", "image-top", "image-left", "image-right", "background", "compact"];
  return (
    <div className={s.layoutGrid}>
      {order.map((k) => (
        <button key={k} type="button" onClick={() => onChange(k)} className={`${s.layoutCard} ${value === k ? s.on : ""}`}>
          {thumbs[k]}
          <div className={s.layoutName}>{names[k]}</div>
        </button>
      ))}
    </div>
  );
}

function PositionPicker({ value, onChange }: { value: PopupPosition; onChange: (v: PopupPosition) => void }) {
  const cells: { key: PopupPosition; name: string; mark: React.CSSProperties }[] = [
    { key: "center", name: "Center", mark: { top: "35%", left: "30%", right: "30%", bottom: "35%" } },
    { key: "bottom-right", name: "Corner", mark: { right: "14%", bottom: "16%", width: "40%", height: "34%" } },
    { key: "bottom-left", name: "Corner L", mark: { left: "14%", bottom: "16%", width: "40%", height: "34%" } },
    { key: "bottom-bar", name: "Bar", mark: { left: "8%", right: "8%", bottom: "12%", height: "24%" } },
  ];
  return (
    <div>
      <div className={s.posGrid}>
        {cells.map((c) => (
          <button key={c.key} type="button" onClick={() => onChange(c.key)} title={c.name}
            className={`${s.posCell} ${value === c.key ? s.on : ""}`}>
            <span className={s.posMark} style={c.mark} />
          </button>
        ))}
      </div>
      <div className={s.posGrid} style={{ marginTop: 4 }}>
        {cells.map((c) => <div key={c.key} className={s.posName}>{c.name}</div>)}
      </div>
    </div>
  );
}

function TriggerPresets({ value, onChange }: { value: PopupConfig["trigger"]; onChange: (t: PopupConfig["trigger"]) => void }) {
  const items = [
    { type: "delay", icon: <Clock size={15} />, name: "After a delay", desc: "Show a few seconds after the page loads" },
    { type: "scroll", icon: <MousePointerClick size={15} />, name: "On scroll", desc: "Show once they scroll down the page" },
    { type: "exit", icon: <LogOut size={15} />, name: "Exit intent", desc: "Show when they move to leave the tab" },
    { type: "immediate", icon: <Zap size={15} />, name: "Immediately", desc: "Show the moment the page opens" },
  ] as const;
  return (
    <div className={s.triggers}>
      {items.map((it) => (
        <button key={it.type} type="button" onClick={() => onChange(
          it.type === "delay" ? { type: "delay", seconds: 6 } : it.type === "scroll" ? { type: "scroll", percent: 40 } : { type: it.type } as PopupConfig["trigger"],
        )} className={`${s.trigCard} ${value.type === it.type ? s.on : ""}`}>
          <span className={s.trigIcon}>{it.icon}</span>
          <span><span className={s.trigName}>{it.name}</span><span className={s.trigDesc}>{it.desc}</span></span>
        </button>
      ))}
    </div>
  );
}

/* ============================ preview ============================ */

function Preview({ cfg, tab, device }: { cfg: GrowthConfig; tab: "popup" | "widget"; device: "desktop" | "mobile" }) {
  useEffect(() => {
    const href = fontHref(cfg.popup.theme.font);
    if (!href || document.querySelector(`link[data-pmfont="${href}"]`)) return;
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = href; l.setAttribute("data-pmfont", href);
    document.head.appendChild(l);
  }, [cfg.popup.theme.font]);

  const frameW = device === "mobile" ? 320 : 640;
  const showPopup = tab === "popup" && cfg.popup.enabled;
  const showWidget = tab === "widget" && cfg.widget.enabled;
  const side = cfg.widget.side === "left" ? { left: 14 } : { right: 14 };
  const pos = cfg.popup.position;
  const wrap: React.CSSProperties =
    pos === "center" ? { inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "rgba(0,0,0,.45)" }
    : pos === "bottom-bar" ? { left: 0, right: 0, bottom: 0 }
    : pos === "bottom-left" ? { left: 14, bottom: 14, maxWidth: 300 }
    : { right: 14, bottom: 14, maxWidth: 300 };
  const wide = cfg.popup.layout === "image-left" || cfg.popup.layout === "image-right";
  const cardW = pos === "bottom-bar" ? frameW
    : pos === "center" ? Math.min(wide ? 440 : 360, frameW - 32)
    : wide ? Math.min(400, frameW - 24) : 290;

  return (
    <div className={s.stage}>
      <div className={s.device} style={{ width: frameW, maxWidth: "100%" }}>
        <div className={s.chrome}>
          <span className={s.chromeDot} style={{ background: "#E36B5C" }} />
          <span className={s.chromeDot} style={{ background: "#E5B94E" }} />
          <span className={s.chromeDot} style={{ background: "#5FB878" }} />
          <span className={s.chromeUrl}>trypromunch.in</span>
        </div>
        <div className={s.viewport} style={{ height: device === "mobile" ? 500 : 420 }}>
          <div className={s.faux}>
            <div className={s.fauxBlock} style={{ height: 26, width: "44%", marginBottom: 14 }} />
            <div className={s.fauxBlock} style={{ height: 120, marginBottom: 14 }} />
            <div className={s.fauxBlock} style={{ height: 12, width: "88%", marginBottom: 8 }} />
            <div className={s.fauxBlock} style={{ height: 12, width: "70%" }} />
          </div>
          {showPopup && (
            <div style={{ position: "absolute", ...wrap, zIndex: 5 }}>
              <div style={{ width: cardW, maxWidth: "100%" }} dangerouslySetInnerHTML={{ __html: renderPopupInner(cfg.popup, { placeholderImage: true }) }} />
            </div>
          )}
          {showWidget && (
            <>
              <div style={{ position: "absolute", bottom: 14, ...side, zIndex: 5 }} dangerouslySetInnerHTML={{ __html: widgetButtonInner(cfg.widget) }} />
              {cfg.widget.greeting && <div style={{ position: "absolute", bottom: 80, ...side, zIndex: 5 }} dangerouslySetInnerHTML={{ __html: widgetBubbleInner(cfg.widget) }} />}
            </>
          )}
          {!showPopup && !showWidget && <div className={s.stageOff}>This {tab === "popup" ? "popup" : "chat button"} is turned off.</div>}
        </div>
      </div>
      <div className={s.stageBar} style={{ marginTop: 8, justifyContent: "center" }}>
        <span className={s.stageHint}>Live preview — exactly what visitors see on trypromunch.in</span>
      </div>
    </div>
  );
}

/* ============================ connection card ============================ */

function ConnectionCard({ data, probe, busy, onInstall, onRemove, onRecheck }: {
  data: GrowthData | null; probe: Probe | null; busy: boolean;
  onInstall: () => void; onRemove: () => void; onRecheck: () => void;
}) {
  const installed = !!data?.installed;
  const shop = data?.shop_domain ?? probe?.shop ?? "your store";
  let cls = s.conn, dot = "var(--pm-muted)", title = "Checking Shopify…", note = "", fix: React.ReactNode = null, actions: React.ReactNode = null;

  if (probe?.state === "connected" && installed) {
    cls = `${s.conn} ${s.live}`; dot = "var(--pm-green)";
    title = "Live on your store"; note = `Running on ${shop}. Every change you publish appears automatically — no theme editing.`;
    actions = (
      <>
        <a className={s.btn} href="https://trypromunch.in" target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> View live</a>
        <button type="button" className={`${s.btn} ${s.danger}`} onClick={onRemove} disabled={busy}>{busy ? "…" : "Remove"}</button>
      </>
    );
  } else if (probe?.state === "connected") {
    dot = "var(--pm-green)";
    title = "Connected to Shopify"; note = `Ready to go live on ${shop} with one click.`;
    actions = <button type="button" className={`${s.btn} ${s.primary}`} onClick={onInstall} disabled={busy}><Power size={14} /> {busy ? "Publishing…" : "Publish to store"}</button>;
  } else if (probe?.state === "no_scope") {
    cls = `${s.conn} ${s.warn}`; dot = "var(--pm-gold)";
    title = "Almost there — one permission needed"; note = "The Shopify app is connected but can't add scripts yet.";
    fix = <div className={s.connFix}>In Shopify: <strong>Settings → Apps → Develop apps → your app → API scopes</strong>, enable <code>write_script_tags</code>, then reinstall the app and update the token in <strong>Settings → API keys</strong>.</div>;
    actions = <button type="button" className={s.btn} onClick={onRecheck} disabled={busy}><RefreshCw size={13} /> Re-check</button>;
  } else if (probe?.state === "no_token") {
    cls = `${s.conn} ${s.warn}`; dot = "var(--pm-gold)";
    title = "Shopify not connected"; note = "Add your Shopify Admin token to publish the popup with one click.";
    fix = <div className={s.connFix}>Add <code>SHOPIFY_ACCESS_TOKEN</code> in <strong>Settings → API keys</strong> (needs the <code>write_script_tags</code> scope). You can still design here in the meantime.</div>;
    actions = <button type="button" className={s.btn} onClick={onRecheck} disabled={busy}><RefreshCw size={13} /> Re-check</button>;
  } else if (probe?.state === "error") {
    cls = `${s.conn} ${s.warn}`; dot = "var(--pm-gold)";
    title = "Couldn't reach Shopify"; note = probe.reason ?? "Try again in a moment.";
    actions = <button type="button" className={s.btn} onClick={onRecheck} disabled={busy}><RefreshCw size={13} /> Re-check</button>;
  }

  return (
    <div className={cls}>
      <span className={s.connDot} style={{ background: dot, color: dot }} />
      <div className={s.connBody}>
        <div className={s.connTitle}><Store size={14} /> {title}</div>
        {note && <div className={s.connNote}>{note}</div>}
        {fix}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}</div>
    </div>
  );
}

/* ============================ main ============================ */

export default function GrowthView() {
  const toast = useToast();
  const { data, refetch } = useQuery({
    queryKey: ["wa-growth"],
    queryFn: async (): Promise<GrowthData | null> => {
      const r = await fetch("/api/whatsapp/growth");
      return r.ok ? r.json() : null;
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
  const [probe, setProbe] = useState<Probe | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (data?.config && !dirty) setCfg(data.config); }, [data?.config, dirty]);

  async function runProbe() {
    try {
      const r = await fetch("/api/whatsapp/growth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "probe" }) });
      const j = await r.json().catch(() => null);
      if (j?.state) setProbe(j);
    } catch { /* leave as loading */ }
  }
  useEffect(() => { runProbe(); }, []);

  const setPopup = (fn: (p: PopupConfig) => PopupConfig) => { setCfg((c) => c ? { ...c, popup: fn(c.popup) } : c); setDirty(true); };
  const setWidget = (fn: (w: WidgetConfig) => WidgetConfig) => { setCfg((c) => c ? { ...c, widget: fn(c.widget) } : c); setDirty(true); };

  async function saveConfig() {
    if (!cfg) return;
    setSaving(true);
    try {
      const r = await fetch("/api/whatsapp/growth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "config", config: cfg }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) { toast.push({ kind: "error", text: j.error ?? `HTTP ${r.status}` }); return; }
      setDirty(false);
      toast.push({ kind: "success", text: data?.installed ? "Saved — live on your store within ~5 minutes." : "Saved." });
      refetch();
    } finally { setSaving(false); }
  }

  async function toggleInstall(install: boolean) {
    if (!install && !confirm("Remove the WhatsApp popup and chat button from trypromunch.in?")) return;
    setInstallBusy(true);
    try {
      const r = await fetch("/api/whatsapp/growth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: install ? "install" : "uninstall" }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) { toast.push({ kind: "error", text: j.error ?? `HTTP ${r.status}` }); return; }
      toast.push({ kind: "success", text: install ? "Published — it's live on your store now." : "Removed from your store." });
      refetch(); runProbe();
    } finally { setInstallBusy(false); }
  }

  async function uploadImage(file: File) {
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("format", "IMAGE");
      const r = await fetch("/api/whatsapp/media-upload", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) { toast.push({ kind: "error", text: j.error ?? "Upload failed" }); return; }
      // If they upload while on a text layout, switch to an image layout so the
      // photo actually appears; otherwise keep their chosen layout.
      setPopup((p) => ({ ...p, imageUrl: j.url, layout: LAYOUTS_NEEDING_IMAGE.includes(p.layout) ? p.layout : "image-top" }));
    } finally { setUploading(false); }
  }

  if (!cfg) return <div style={{ padding: 40, textAlign: "center", color: "var(--pm-hint)" }}>Loading…</div>;
  const p = cfg.popup, w = cfg.widget;
  const needsImage = LAYOUTS_NEEDING_IMAGE.includes(p.layout);

  return (
    <div className={s.wrap}>
      {/* header */}
      <div className={s.topbar}>
        <div>
          <div className={s.title}>Grow your WhatsApp list</div>
          <div className={s.subtitle}>Design the popup and chat button, then publish to your store in one click.</div>
        </div>
      </div>

      {/* stats */}
      <div className={s.stats}>
        <div className={s.stat}>
          <div className={s.statNum}>{(data?.popup.leads ?? 0).toLocaleString("en-IN")}</div>
          <div className={s.statLbl}><Users size={13} /> Popup sign-ups</div>
        </div>
        <div className={s.stat}>
          <div className={s.statNum}>{(data?.widget?.clicks ?? 0).toLocaleString("en-IN")}</div>
          <div className={s.statLbl}><MessageCircle size={13} /> Chat button clicks</div>
        </div>
      </div>

      {/* Shopify connection */}
      <ConnectionCard data={data ?? null} probe={probe} busy={installBusy}
        onInstall={() => toggleInstall(true)} onRemove={() => toggleInstall(false)} onRecheck={runProbe} />

      {/* editor */}
      <div className={s.shell}>
        {/* controls */}
        <div>
          <div className={s.seg} style={{ marginBottom: 14, width: "100%" }}>
            <button type="button" className={`${s.segBtn} ${tab === "popup" ? s.on : ""}`} style={{ flex: 1, justifyContent: "center" }} onClick={() => setTab("popup")}>Opt-in popup</button>
            <button type="button" className={`${s.segBtn} ${tab === "widget" ? s.on : ""}`} style={{ flex: 1, justifyContent: "center" }} onClick={() => setTab("widget")}>Chat button</button>
          </div>

          {tab === "popup" ? (
            <>
              <div className={s.switchRow}>
                <strong>Show the opt-in popup</strong>
                <Switch checked={p.enabled} onChange={(v) => setPopup((x) => ({ ...x, enabled: v }))} label="Enable popup" />
              </div>

              <Section title="Content">
                <Field label="Headline"><input className={s.input} value={p.headline} onChange={(e) => setPopup((x) => ({ ...x, headline: e.target.value }))} /></Field>
                <Field label="Sub text"><textarea className={s.textarea} value={p.sub} onChange={(e) => setPopup((x) => ({ ...x, sub: e.target.value }))} /></Field>
                <Field label="Button label"><input className={s.input} value={p.cta} onChange={(e) => setPopup((x) => ({ ...x, cta: e.target.value }))} /></Field>
                <div className={s.row2}>
                  <Field label="After-signup title"><input className={s.input} value={p.successTitle} onChange={(e) => setPopup((x) => ({ ...x, successTitle: e.target.value }))} /></Field>
                  <Field label="After-signup text"><input className={s.input} value={p.successBody} onChange={(e) => setPopup((x) => ({ ...x, successBody: e.target.value }))} /></Field>
                </div>
              </Section>

              <Section title="Layout">
                <LayoutGallery value={p.layout} onChange={(v) => setPopup((x) => ({ ...x, layout: v }))} />
                <div style={{ fontSize: 11, color: "var(--pm-hint)", marginTop: 10 }}>Pick a ready-made layout, then edit the text, colours and image below.</div>
              </Section>

              <Section title="Image">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.target.value = ""; }} />
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <button type="button" className={s.btn} onClick={() => fileRef.current?.click()} disabled={uploading}>
                    {uploading ? "Uploading…" : <><Upload size={13} /> {p.imageUrl ? "Replace image" : "Upload image"}</>}
                  </button>
                  {p.imageUrl && <button type="button" className={`${s.btn} ${s.danger}`} onClick={() => setPopup((x) => ({ ...x, imageUrl: null }))}><Trash2 size={12} /> Remove</button>}
                </div>
                {needsImage && !p.imageUrl ? (
                  <div style={{ fontSize: 11.5, color: "var(--pm-terra)", marginTop: 8, display: "flex", alignItems: "center", gap: 4 }}>
                    <ImageIcon size={12} /> This layout needs an image — upload one, or it shows as text-only on your site.
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: "var(--pm-hint)", marginTop: 8, display: "flex", alignItems: "center", gap: 4 }}><ImageIcon size={11} /> JPG or PNG, up to 5 MB. Used by image and background layouts.</div>
                )}
              </Section>

              <Section title="Design">
                <div className={s.themes}>
                  {THEMES.map((th) => (
                    <button key={th.name} type="button" className={s.themeCard} onClick={() => setPopup((x) => ({ ...x, theme: { ...th.t } }))}>
                      <div className={s.themeSwatch} style={{ background: th.t.bg, color: th.t.text }}><span style={{ color: th.t.accent }}>●</span>&nbsp;Aa</div>
                      <div className={s.themeName}>{th.name}</div>
                    </button>
                  ))}
                </div>
                <div className={s.swatches}>
                  <Swatch label="Background" value={p.theme.bg} onChange={(v) => setPopup((x) => ({ ...x, theme: { ...x.theme, bg: v } }))} />
                  <Swatch label="Text" value={p.theme.text} onChange={(v) => setPopup((x) => ({ ...x, theme: { ...x.theme, text: v } }))} />
                  <Swatch label="Button" value={p.theme.accent} onChange={(v) => setPopup((x) => ({ ...x, theme: { ...x.theme, accent: v } }))} />
                  <Swatch label="Button text" value={p.theme.accentText} onChange={(v) => setPopup((x) => ({ ...x, theme: { ...x.theme, accentText: v } }))} />
                </div>
                <div className={s.row2} style={{ marginTop: 12 }}>
                  <Field label="Font">
                    <select className={s.select} value={p.theme.font} onChange={(e) => setPopup((x) => ({ ...x, theme: { ...x.theme, font: e.target.value } }))} aria-label="Font">
                      {Object.entries(FONTS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
                    </select>
                  </Field>
                  <Field label={`Corner roundness · ${p.theme.radius}px`}>
                    <input type="range" className={s.range} min={0} max={32} value={p.theme.radius} onChange={(e) => setPopup((x) => ({ ...x, theme: { ...x.theme, radius: Number(e.target.value) } }))} aria-label="Corner radius" />
                  </Field>
                </div>
                <div style={{ marginTop: 12 }}>
                  <label className={s.label}>Position</label>
                  <PositionPicker value={p.position} onChange={(v) => setPopup((x) => ({ ...x, position: v }))} />
                </div>
              </Section>

              <Section title="Who sees it, and when">
                <TriggerPresets value={p.trigger} onChange={(t) => setPopup((x) => ({ ...x, trigger: t }))} />
                {p.trigger.type === "delay" && (
                  <div className={s.field} style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
                    <span className={s.label} style={{ margin: 0 }}>Wait</span>
                    <Stepper value={p.trigger.seconds} onChange={(v) => setPopup((x) => ({ ...x, trigger: { type: "delay", seconds: v } }))} min={0} max={120} />
                    <span className={s.label} style={{ margin: 0 }}>seconds</span>
                  </div>
                )}
                {p.trigger.type === "scroll" && (
                  <div className={s.field} style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
                    <span className={s.label} style={{ margin: 0 }}>At</span>
                    <Stepper value={p.trigger.percent} onChange={(v) => setPopup((x) => ({ ...x, trigger: { type: "scroll", percent: v } }))} min={5} max={100} />
                    <span className={s.label} style={{ margin: 0 }}>% scrolled</span>
                  </div>
                )}
                <div className={s.row2} style={{ marginTop: 12 }}>
                  <Field label="Don't show again (days)">
                    <Stepper value={p.frequencyDays} onChange={(v) => setPopup((x) => ({ ...x, frequencyDays: v }))} min={0} max={365} />
                  </Field>
                  <Field label="On which pages">
                    <select className={s.select} value={p.pages} onChange={(e) => setPopup((x) => ({ ...x, pages: e.target.value as PopupConfig["pages"] }))} aria-label="Pages">
                      <option value="all">All pages</option><option value="home">Home only</option><option value="product">Product pages</option><option value="cart">Cart page</option>
                    </select>
                  </Field>
                </div>
              </Section>
            </>
          ) : (
            <>
              <div className={s.switchRow}>
                <strong>Show the chat button</strong>
                <Switch checked={w.enabled} onChange={(v) => setWidget((x) => ({ ...x, enabled: v }))} label="Enable chat button" />
              </div>
              <Section title="Content">
                <Field label="Greeting bubble (leave blank for none)"><input className={s.input} value={w.greeting} onChange={(e) => setWidget((x) => ({ ...x, greeting: e.target.value }))} /></Field>
              </Section>
              <Section title="Design">
                <div className={s.swatches}>
                  <Swatch label="Button" value={w.theme.button} onChange={(v) => setWidget((x) => ({ ...x, theme: { ...x.theme, button: v } }))} />
                  <Swatch label="Bubble" value={w.theme.bubbleBg} onChange={(v) => setWidget((x) => ({ ...x, theme: { ...x.theme, bubbleBg: v } }))} />
                  <Swatch label="Bubble text" value={w.theme.bubbleText} onChange={(v) => setWidget((x) => ({ ...x, theme: { ...x.theme, bubbleText: v } }))} />
                </div>
              </Section>
              <Section title="Placement">
                <div className={s.row2}>
                  <Field label="Position">
                    <select className={s.select} value={w.side} onChange={(e) => setWidget((x) => ({ ...x, side: e.target.value as "right" | "left" }))} aria-label="Widget side">
                      <option value="right">Bottom right</option><option value="left">Bottom left</option>
                    </select>
                  </Field>
                  <Field label="Greeting delay (s)">
                    <Stepper value={w.delaySec} onChange={(v) => setWidget((x) => ({ ...x, delaySec: v }))} min={0} max={120} />
                  </Field>
                </div>
                <label className={s.check} style={{ marginTop: 6 }}>
                  <input type="checkbox" checked={w.showOnMobile} onChange={(e) => setWidget((x) => ({ ...x, showOnMobile: e.target.checked }))} /> Show on mobile too
                </label>
              </Section>
            </>
          )}
        </div>

        {/* preview */}
        <div>
          <div className={s.stageBar}>
            <span className={s.stageHint}>Preview</span>
            <div className={s.seg}>
              <button type="button" className={`${s.segBtn} ${device === "desktop" ? s.on : ""}`} onClick={() => setDevice("desktop")} aria-label="Desktop"><Monitor size={14} /></button>
              <button type="button" className={`${s.segBtn} ${device === "mobile" ? s.on : ""}`} onClick={() => setDevice("mobile")} aria-label="Mobile"><Smartphone size={14} /></button>
            </div>
          </div>
          <Preview cfg={cfg} tab={tab} device={device} />
        </div>
      </div>

      {/* save bar */}
      <div className={s.saveBar}>
        {dirty && <span className={s.dirty}><AlertTriangle size={13} /> Unsaved changes</span>}
        <button type="button" className={s.btn} onClick={() => { setCfg(data?.config ?? GROWTH_DEFAULTS); setDirty(false); }} disabled={!dirty}>Discard</button>
        <button type="button" className={`${s.btn} ${s.primary}`} onClick={saveConfig} disabled={saving || !dirty}>
          <Check size={14} /> {saving ? "Saving…" : data?.installed ? "Save & publish" : "Save"}
        </button>
      </div>
    </div>
  );
}
