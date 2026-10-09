"use client";

// "New deal" drawer (prototype b2b-deals/new-deal). Adds a deal by hand:
// business, contact, stage, value, notes. One POST /api/deals; nothing is
// emailed to anyone. The deal scanner never moves a hand-set stage.

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { ALL_KINDS, ALL_STAGES, KIND_LABEL, STAGE_LABEL } from "./constants";
import type { Deal, DealKind, DealStage } from "./types";
import n from "./new-deal.module.css";

export function NewDealDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: (deal: Deal) => void }) {
  const titleId = useId();
  const firstRef = useRef<HTMLInputElement>(null);
  const [company, setCompany] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [stage, setStage] = useState<DealStage>("new_inquiry");
  const [kind, setKind] = useState<DealKind>("other");
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!company.trim()) {
      setErr("Add the business name.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: company,
          contact_name: contactName,
          contact_email: contactEmail,
          stage,
          kind,
          value,
          notes,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || `Could not add the deal (${r.status})`);
      onCreated(j.deal as Deal);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not add the deal");
      setBusy(false);
    }
  }

  return (
    <div className={n.scrim} onClick={() => !busy && onClose()}>
      <form
        className={n.drawer}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <div className={n.head}>
          <div>
            <span className={n.eye}>★ New</span>
            <h2 id={titleId}>New deal</h2>
          </div>
          <button type="button" className={n.x} aria-label="Close" onClick={onClose} disabled={busy}>
            <X size={18} />
          </button>
        </div>

        <div className={n.body}>
          <label className={n.field}>
            <span>Business</span>
            <input ref={firstRef} className={n.in} value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Name" maxLength={200} required />
          </label>
          <div className={n.two}>
            <label className={n.field}>
              <span>Contact name</span>
              <input className={n.in} value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Who you talk to" maxLength={120} />
            </label>
            <label className={n.field}>
              <span>Contact email</span>
              <input className={n.in} type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="name@business.com" maxLength={200} />
            </label>
          </div>
          <div className={n.two}>
            <label className={n.field}>
              <span>Stage</span>
              <select className={n.in} value={stage} onChange={(e) => setStage(e.target.value as DealStage)}>
                {ALL_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className={n.field}>
              <span>Type</span>
              <select className={n.in} value={kind} onChange={(e) => setKind(e.target.value as DealKind)}>
                {ALL_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className={n.field}>
            <span>Value</span>
            <input className={n.in} value={value} onChange={(e) => setValue(e.target.value)} placeholder="₹50,000 a month, or 200 packs" maxLength={200} />
          </label>
          <label className={n.field}>
            <span>Notes</span>
            <textarea className={`${n.in} ${n.ta}`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What they want, who referred them, next step" maxLength={4000} />
          </label>
          <p className={n.hint}>
            Only your team sees this. Nobody is emailed. When this business emails us, the scanner adds the mail to this deal and leaves the stage
            you set.
          </p>
          {err && <p className={n.err}>{err}</p>}
        </div>

        <div className={n.foot}>
          <button type="button" className="pm2-btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="pm2-btn pri" disabled={busy || !company.trim()}>
            {busy ? "Adding…" : "Add deal"}
          </button>
        </div>
      </form>
    </div>
  );
}
