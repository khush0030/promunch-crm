"use client";

import { useState } from "react";
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
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button type="button" className="pm-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="pm-btn" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
