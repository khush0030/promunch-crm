"use client";

// "New email campaign" from the page header opens this — a plain "which list?"
// chooser. The send wizard is built around a single list, so we pick one first,
// then hand off to the existing CampaignWizard (no change to the send engine).

import { useMemo, useState } from "react";
import { Search, X, MailX } from "lucide-react";
import styles from "@/app/dashboard/leads/leads.module.css";
import { useEscapeKey } from "./useEscapeKey";
import type { ListSummary } from "./types";

export default function ListPickerModal({
  lists, onPick, onClose, onFind,
}: {
  lists: ListSummary[];
  onPick: (id: string) => void;
  onClose: () => void;
  onFind: () => void;
}) {
  useEscapeKey(onClose);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const withEmail = lists.filter((l) => l.withEmail > 0);
    if (!needle) return withEmail;
    return withEmail.filter((l) => l.name.toLowerCase().includes(needle));
  }, [lists, q]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New email campaign"
        className={`pm-panel ${styles.modal} ${styles.modalMd}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div className="card-title">Which list do you want to email?</div>
          <button type="button" className="pm-btn" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--pm-muted)", margin: "0 0 14px", lineHeight: 1.5 }}>
          Pick a list and we open the campaign builder: choose recipients, write or AI-draft the copy,
          preview every email, then send. Only lists with verified emails are shown.
        </p>

        <label className="field" style={{ marginBottom: 12 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Search size={13} /> Find a list
          </span>
          <input
            className="input"
            autoFocus
            value={q}
            placeholder="e.g. gifting, Mumbai, hotels…"
            onChange={(e) => setQ(e.target.value)}
          />
        </label>

        {filtered.length === 0 ? (
          <div className={styles.pickEmpty}>
            <MailX size={18} />
            <span>
              {lists.length === 0
                ? "No lists yet."
                : "No lists with verified emails match."}{" "}
              <button type="button" className="pm-linkbtn" onClick={() => { onClose(); onFind(); }}>Find companies</button>
            </span>
          </div>
        ) : (
          <div className={styles.pickList}>
            {filtered.map((l) => (
              <button key={l.id} type="button" className={styles.pickRow} onClick={() => onPick(l.id)}>
                <span className={styles.pickName}>{l.name}</span>
                <span className={styles.pickStat}>{l.withEmail} with email · {l.leads} total</span>
                {l.active_sequence
                  ? <span className="pm-badge2 bg-green">● running</span>
                  : l.replied > 0
                    ? <span className="pm-badge2 bg-gold">{l.replied} replied</span>
                    : null}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
