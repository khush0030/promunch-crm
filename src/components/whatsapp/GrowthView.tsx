"use client";

// Growth tab: grow the opted-in WhatsApp audience beyond the ~833 imported
// contacts — entirely from the dashboard, no theme editing.
//   1. Opt-in POPUP + chat WIDGET: configured here, served live to the
//      storefront by /api/public/wa-embed. One "Install on store" button adds
//      the Shopify script tag; copy edits go live within ~5 min, no re-paste.
//   2. QR CODES: named, tracked (wa_link_clicks via /r/<code>), PNG download.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Check, Copy, Download, ExternalLink, MessageCircle, Plus, Power, QrCode, Users,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { cardStyle, inputStyle, primaryBtn, smallBtn } from "./styles";
import { Field } from "./primitives";

type GrowthConfig = {
  popup: { enabled: boolean; headline: string; sub: string; cta: string; delaySec: number; coolDays: number };
  widget: { enabled: boolean; greeting: string; side: "right" | "left"; delaySec: number };
};

type GrowthData = {
  wa_number: string;
  config: GrowthConfig;
  installed: boolean;
  shop_domain: string;
  embed_url: string;
  loader_snippet: string;
  popup: { leads: number };
  widget: { code: string; target: string; clicks: number } | null;
  qrs: { code: string; name: string; target: string; scans: number; created_at: string }[];
};

const origin = () => (typeof window !== "undefined" ? window.location.origin : "");

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

  // Local editable copy of the config; seeded from the server, saved on demand.
  const [cfg, setCfg] = useState<GrowthConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data?.config && !dirty) setCfg(data.config);
  }, [data?.config, dirty]);

  const patch = (fn: (c: GrowthConfig) => GrowthConfig) => {
    setCfg((c) => (c ? fn(c) : c));
    setDirty(true);
  };

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
      toast.push({ kind: "success", text: data?.installed ? "Saved. Live on the store within ~5 minutes." : "Saved." });
      refetch();
    } finally { setSaving(false); }
  }

  // Install / remove the storefront embed via Shopify script tag.
  const [installBusy, setInstallBusy] = useState(false);
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
      toast.push({ kind: "success", text: install ? "Installed on your store. It's live now." : "Removed from your store." });
      refetch();
    } finally { setInstallBusy(false); }
  }

  // QR create
  const [qrName, setQrName] = useState("");
  const [qrPrefill, setQrPrefill] = useState("");
  const [qrBusy, setQrBusy] = useState(false);
  async function createQr() {
    if (!qrName.trim()) { toast.push({ kind: "error", text: "Give the QR a name (e.g. packaging, store-counter)." }); return; }
    setQrBusy(true);
    try {
      const r = await fetch("/api/whatsapp/growth", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "qr", name: qrName, prefill: qrPrefill }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) toast.push({ kind: "error", text: j.error ?? `HTTP ${r.status}` });
      else { setQrName(""); setQrPrefill(""); refetch(); }
    } finally { setQrBusy(false); }
  }

  const totalScans = (data?.qrs ?? []).reduce((a, q) => a + q.scans, 0);
  const [showManual, setShowManual] = useState(false);

  return (
    <div>
      <div style={{ fontSize: 13, color: "var(--pm-muted)", marginBottom: 14 }}>
        Grow the opted-in audience — set it up here, no website code editing. Every tool writes a consent trail, so these contacts are safe to market to.
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

      {/* install status banner */}
      <div style={{ ...cardStyle, marginBottom: 14, borderColor: data?.installed ? "var(--pm-green)" : "var(--pm-border)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
              <Power size={14} color={data?.installed ? "var(--pm-green)" : "var(--pm-muted)"} />
              {data?.installed ? "Live on your store" : "Not installed yet"}
            </div>
            <div style={{ fontSize: 12, color: "var(--pm-hint)", marginTop: 3 }}>
              {data?.installed
                ? `The popup and chat button are running on ${data?.shop_domain}. Edits below go live automatically.`
                : `One click adds the popup + chat button to ${data?.shop_domain ?? "your store"}. No theme editing.`}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {data?.installed ? (
              <button type="button" onClick={() => toggleInstall(false)} disabled={installBusy}
                style={{ ...smallBtn, color: "var(--pm-terra)" }}>
                {installBusy ? "Working…" : "Remove from store"}
              </button>
            ) : (
              <button type="button" onClick={() => toggleInstall(true)} disabled={installBusy} style={primaryBtn}>
                <Power size={13} /> {installBusy ? "Installing…" : "Install on store"}
              </button>
            )}
          </div>
        </div>
        <button type="button" onClick={() => setShowManual((s) => !s)}
          style={{ background: "none", border: "none", padding: 0, marginTop: 10, cursor: "pointer", fontSize: 11.5, color: "var(--pm-muted)", textDecoration: "underline" }}>
          {showManual ? "Hide" : "Not on Shopify? Paste it manually instead"}
        </button>
        {showManual && data && (
          <div style={{ marginTop: 8 }}>
            <CopyBox label="Paste before </body> in any website's HTML" text={data.loader_snippet} />
          </div>
        )}
      </div>

      {/* config editor */}
      {cfg && (
        <>
          {/* popup */}
          <div style={{ ...cardStyle, marginBottom: 14 }}>
            <SectionHead
              title="Opt-in popup"
              desc="Collects phone numbers into WhatsApp contacts (tagged website_popup, consent recorded). After joining, visitors get a one-tap Say hi that opens the free 24h window."
              enabled={cfg.popup.enabled}
              onToggle={(v) => patch((c) => ({ ...c, popup: { ...c.popup, enabled: v } }))}
            />
            {cfg.popup.enabled && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10, marginTop: 12 }}>
                <Field label="Headline"><input value={cfg.popup.headline} onChange={(e) => patch((c) => ({ ...c, popup: { ...c.popup, headline: e.target.value } }))} style={inputStyle} /></Field>
                <Field label="Sub text"><input value={cfg.popup.sub} onChange={(e) => patch((c) => ({ ...c, popup: { ...c.popup, sub: e.target.value } }))} style={inputStyle} /></Field>
                <Field label="Button label"><input value={cfg.popup.cta} onChange={(e) => patch((c) => ({ ...c, popup: { ...c.popup, cta: e.target.value } }))} style={inputStyle} /></Field>
                <Field label="Show after (seconds)"><input type="number" min={1} value={cfg.popup.delaySec} onChange={(e) => patch((c) => ({ ...c, popup: { ...c.popup, delaySec: Number(e.target.value) || 6 } }))} style={inputStyle} aria-label="Popup delay" /></Field>
                <Field label="Snooze after close (days)"><input type="number" min={1} value={cfg.popup.coolDays} onChange={(e) => patch((c) => ({ ...c, popup: { ...c.popup, coolDays: Number(e.target.value) || 15 } }))} style={inputStyle} aria-label="Popup cooldown" /></Field>
              </div>
            )}
          </div>

          {/* widget */}
          <div style={{ ...cardStyle, marginBottom: 14 }}>
            <SectionHead
              title="Website chat button"
              desc="Floating WhatsApp button with an optional greeting bubble. Clicks route through a tracked link, then open a chat with us."
              enabled={cfg.widget.enabled}
              onToggle={(v) => patch((c) => ({ ...c, widget: { ...c.widget, enabled: v } }))}
            />
            {cfg.widget.enabled && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10, marginTop: 12 }}>
                <Field label="Greeting bubble (blank = none)"><input value={cfg.widget.greeting} onChange={(e) => patch((c) => ({ ...c, widget: { ...c.widget, greeting: e.target.value } }))} style={inputStyle} /></Field>
                <Field label="Position">
                  <select value={cfg.widget.side} onChange={(e) => patch((c) => ({ ...c, widget: { ...c.widget, side: e.target.value as "right" | "left" } }))} style={inputStyle} aria-label="Widget position">
                    <option value="right">Bottom right</option>
                    <option value="left">Bottom left</option>
                  </select>
                </Field>
                <Field label="Greeting delay (seconds)"><input type="number" min={0} value={cfg.widget.delaySec} onChange={(e) => patch((c) => ({ ...c, widget: { ...c.widget, delaySec: Number(e.target.value) || 0 } }))} style={inputStyle} aria-label="Greeting delay" /></Field>
              </div>
            )}
          </div>

          {/* save bar */}
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginBottom: 22 }}>
            {dirty && <span style={{ fontSize: 12, color: "var(--pm-gold)" }}>Unsaved changes</span>}
            <button type="button" onClick={saveConfig} disabled={saving || !dirty} style={primaryBtn}>
              <Check size={13} /> {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </>
      )}

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
                <div style={{ fontWeight: 700, fontSize: 13, marginTop: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  {q.name}
                  <a href={`${origin()}/r/${q.code}`} target="_blank" rel="noopener noreferrer" title="Test link" style={{ color: "var(--pm-muted)" }}><ExternalLink size={12} /></a>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--pm-muted)" }}>{q.scans.toLocaleString("en-IN")} scan{q.scans === 1 ? "" : "s"}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SectionHead({ title, desc, enabled, onToggle }: { title: string; desc: string; enabled: boolean; onToggle: (v: boolean) => void }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--pm-hint)", marginTop: 3 }}>{desc}</div>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        {enabled ? "On" : "Off"}
      </label>
    </div>
  );
}

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
              toast.push({ kind: "success", text: "Copied." });
              setTimeout(() => setCopied(false), 2500);
            });
          }}>
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <textarea readOnly value={text} rows={2}
        style={{ ...inputStyle, fontFamily: "ui-monospace, monospace", fontSize: 11, marginBottom: 0, resize: "vertical" }} />
    </div>
  );
}
