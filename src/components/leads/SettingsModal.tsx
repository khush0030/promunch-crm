"use client";

import { useEffect, useState } from "react";
import { useEscapeKey } from "./useEscapeKey";
import { X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import styles from "@/app/dashboard/leads/leads.module.css";
import type { OutreachSettings } from "./types";

// --------------------------------------------------------- settings modal --

export default function SettingsModal({
  settings, onClose, onSaved,
}: { settings: OutreachSettings; onClose: () => void; onSaved: () => void }) {
  useEscapeKey(onClose);
  const toast = useToast();
  const [form, setForm] = useState({ ...settings, reply_to: settings.reply_to ?? "" });
  const [busy, setBusy] = useState(false);
  type FinderProvider = { provider: string; enabled: boolean; monthly_credit_cap: number; used_this_month: number };
  const [finders, setFinders] = useState<FinderProvider[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/leads/buyers/providers")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && j?.providers) setFinders(j.providers); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  async function saveFinder(p: FinderProvider) {
    try {
      const res = await fetch("/api/leads/buyers/providers", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: p.provider, enabled: p.enabled, monthly_credit_cap: p.monthly_credit_cap }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "failed");
      toast.push({ kind: "success", text: "Finder settings saved." });
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : "Save failed" });
    }
  }

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/leads/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "failed");
      toast.push({ kind: "success", text: "Outreach settings saved." });
      onSaved();
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Outreach settings" className={`pm-panel ${styles.modal} ${styles.modalSm}`} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div className="card-title">Outreach settings</div>
          <button type="button" className="pm-btn" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <label className="field">
          <span>Daily send cap (warm-up: raise weekly 15 → 30 → 50)</span>
          <input className="input" type="number" min={0} max={500} value={form.daily_cap}
            onChange={(e) => setForm({ ...form, daily_cap: parseInt(e.target.value || "0") })} />
        </label>
        <label className="field">
          <span>From name</span>
          <input className="input" value={form.from_name}
            onChange={(e) => setForm({ ...form, from_name: e.target.value })} />
        </label>
        <label className="field">
          <span>From mailbox (fixed — sends as Parth, founder, on the verified domain)</span>
          <input className="input" value={form.from_email} disabled />
        </label>
        <label className="field">
          <span>Footer address (legal/physical address line)</span>
          <input className="input" value={form.footer_address}
            onChange={(e) => setForm({ ...form, footer_address: e.target.value })} />
        </label>
        <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={form.paused}
            onChange={(e) => setForm({ ...form, paused: e.target.checked })} />
          <span>Pause all sends</span>
        </label>
        {finders?.length ? (
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--line, #e5e0d6)" }}>
            <div className="card-title" style={{ fontSize: 14 }}>Decision-maker email finder</div>
            <div className="pm-muted" style={{ fontSize: 12, margin: "2px 0 8px" }}>
              Pay-as-you-go. Off until you set a monthly credit cap. Owner only. The API key goes in Settings, API keys.
            </div>
            {finders.map((p) => (
              <div key={p.provider} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13 }}>
                <label style={{ display: "flex", gap: 6, alignItems: "center", minWidth: 130 }}>
                  <input type="checkbox" checked={p.enabled}
                    onChange={(e) => setFinders((fs) => fs!.map((f) => (f.provider === p.provider ? { ...f, enabled: e.target.checked } : f)))} />
                  {p.provider}
                </label>
                <input className="input" type="number" min={0} max={100000} style={{ width: 90 }} value={p.monthly_credit_cap}
                  onChange={(e) => setFinders((fs) => fs!.map((f) => (f.provider === p.provider ? { ...f, monthly_credit_cap: parseInt(e.target.value || "0") } : f)))} />
                <span className="pm-muted">credits/month, {p.used_this_month} used</span>
                <button type="button" className="pm-btn" onClick={() => saveFinder(p)}>Save</button>
              </div>
            ))}
          </div>
        ) : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button type="button" className="pm-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="pm-btn" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
