"use client";

// Small shared dialogs for the Leads views, so we stop using the raw browser
// prompt()/confirm() pop-ups. Same overlay markup + Escape-to-close as the other
// leads modals (SettingsModal, SearchModal, …).

import { useState } from "react";
import { X } from "lucide-react";
import styles from "@/app/dashboard/leads/leads.module.css";
import { useEscapeKey } from "./useEscapeKey";

// A one-field "type a name" dialog — replaces prompt().
export function TextPromptModal({
  title, label, placeholder, defaultValue = "", confirmLabel = "Save",
  onSubmit, onClose,
}: {
  title: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  useEscapeKey(onClose);
  const [value, setValue] = useState(defaultValue);
  const trimmed = value.trim();

  function submit() {
    if (!trimmed) return;
    onSubmit(trimmed);
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`pm-panel ${styles.modal} ${styles.modalSm}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div className="card-title">{title}</div>
          <button type="button" className="pm-btn" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <label className="field">
          <span>{label}</span>
          <input
            className="input"
            autoFocus
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          />
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button type="button" className="pm-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="pm-btn primary" onClick={submit} disabled={!trimmed}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// A yes/no confirmation — replaces confirm(). `danger` reddens the confirm button.
export function ConfirmModal({
  title, message, confirmLabel = "Confirm", danger = false, busy = false,
  onConfirm, onClose,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEscapeKey(onClose);
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`pm-panel ${styles.modal} ${styles.modalSm}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div className="card-title">{title}</div>
          <button type="button" className="pm-btn" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <div style={{ fontSize: 13.5, color: "var(--pm-muted)", lineHeight: 1.55 }}>{message}</div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button type="button" className="pm-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            className={`pm-btn ${danger ? "danger" : "primary"}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
