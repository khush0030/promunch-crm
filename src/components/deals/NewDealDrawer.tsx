"use client";

// "Add a deal" sheet. Business, contact (name, email, phone), type, stage,
// value in ₹, owner, next step + follow-up date, notes. One POST /api/deals;
// if an open deal already has this email or phone, that deal opens instead
// of a duplicate. Nobody is emailed or messaged.

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { ALL_KINDS, KIND_LABEL, istToday, type Deal, type DealKind, type TeamPerson } from "@/lib/deals/model";
import { ALL_STAGES, STAGE_LABEL, isClosedStage, type DealStage } from "@/lib/deals/stages";
import n from "./new-deal.module.css";

const OPEN_STAGE_CHOICES = ALL_STAGES.filter((s) => !isClosedStage(s));

export function NewDealDrawer({
  people,
  me,
  onClose,
  onCreated,
}: {
  people: TeamPerson[];
  me: string | null;
  onClose: () => void;
  onCreated: (deal: Deal, existing: boolean) => void;
}) {
  const titleId = useId();
  const firstRef = useRef<HTMLInputElement>(null);
  const [company, setCompany] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [stage, setStage] = useState<DealStage>("new");
  const [kind, setKind] = useState<DealKind>("other");
  const [value, setValue] = useState("");
  const [owner, setOwner] = useState(me ?? "");
  const [nextStep, setNextStep] = useState("");
  const [followUp, setFollowUp] = useState("");
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
          company,
          contact_name: contactName,
          contact_email: contactEmail,
          contact_phone: contactPhone,
          stage,
          kind,
          value,
          owner_email: owner || null,
          next_step: nextStep,
          follow_up_at: followUp || null,
          notes,
          source: "manual",
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || `Could not add the deal (${r.status})`);
      onCreated(j.deal as Deal, j.existing === true);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not add the deal");
      setBusy(false);
    }
  }

  return (
    <div className={n.scrim} onClick={() => !busy && onClose()}>
      <form className={n.drawer} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className={n.head}>
          <h2 id={titleId}>Add a deal</h2>
          <button type="button" className={n.x} aria-label="Close" onClick={onClose} disabled={busy}>
            <X size={20} />
          </button>
        </div>

        <div className={n.body}>
          <label className={n.field}>
            <span>Business</span>
            <input ref={firstRef} className={n.in} value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Business name" maxLength={200} required />
          </label>
          <div className={n.two}>
            <label className={n.field}>
              <span>Contact name</span>
              <input className={n.in} value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Who you talk to" maxLength={120} />
            </label>
            <label className={n.field}>
              <span>Phone</span>
              <input className={n.in} type="tel" inputMode="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="+91 98765 43210" maxLength={40} />
            </label>
          </div>
          <label className={n.field}>
            <span>Email</span>
            <input className={n.in} type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="name@business.com" maxLength={200} />
          </label>
          <div className={n.two}>
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
            <label className={n.field}>
              <span>Stage</span>
              <select className={n.in} value={stage} onChange={(e) => setStage(e.target.value as DealStage)}>
                {OPEN_STAGE_CHOICES.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className={n.two}>
            <label className={n.field}>
              <span>Value in ₹</span>
              <input className={n.in} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="50000 or 1.5L" maxLength={40} />
            </label>
            <label className={n.field}>
              <span>Owner</span>
              <select className={n.in} value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="">No owner</option>
                {people.map((p) => (
                  <option key={p.email} value={p.email}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className={n.two}>
            <label className={n.field}>
              <span>Next step</span>
              <input className={n.in} value={nextStep} onChange={(e) => setNextStep(e.target.value)} placeholder="Send the price list" maxLength={500} />
            </label>
            <label className={n.field}>
              <span>Follow up on</span>
              <input className={n.in} type="date" value={followUp} min={istToday()} onChange={(e) => setFollowUp(e.target.value)} />
            </label>
          </div>
          <label className={n.field}>
            <span>Notes</span>
            <textarea className={`${n.in} ${n.ta}`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What they want, who referred them" maxLength={4000} />
          </label>
          <p className={n.hint}>Only your team sees this. Nobody is emailed or messaged. If this email or phone already has an open deal, that deal opens instead.</p>
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
