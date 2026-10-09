"use client";

// Email → Templates → "New template" (prototype em-templates). Name it, pick
// a starting point (blank or any PROMUNCH library design), and it opens in
// the template editor. Uses the existing POST /api/email-studio/templates
// (copy of a built-in design); sends nothing to anyone.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Modal } from "@/components/whatsapp/primitives";
import { BLANK_START, newTemplateBody } from "@/lib/email-studio/new-template";
import { sendJson } from "./api";
import s from "./studio.module.css";

export type TemplateStart = { key: string; name: string; description: string };

export function NewTemplateButton({ starts }: { starts: TemplateStart[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="pm2-btn pri" onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden /> New template
      </button>
      {open && <NewTemplateModal starts={starts} onClose={() => setOpen(false)} />}
    </>
  );
}

function NewTemplateModal({ starts, onClose }: { starts: TemplateStart[]; onClose: () => void }) {
  const router = useRouter();
  // Blank first, then the library in its usual order.
  const ordered = [...starts.filter((t) => t.key === BLANK_START), ...starts.filter((t) => t.key !== BLANK_START)];
  const [name, setName] = useState("");
  const [start, setStart] = useState(BLANK_START);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const built = newTemplateBody(name, start, starts.map((t) => t.key));
    if (!built.ok) {
      setErr(built.error);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await sendJson<{ template: { id: string } }>("/api/email-studio/templates", "POST", built.body);
      router.push(`/dashboard/email/templates/${r.template.id}`);
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title="New template">
      <form onSubmit={submit} className={s.ntForm}>
        <label className={s.ntField}>
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Festive drop" maxLength={120} className={s.ntIn} />
        </label>
        <fieldset className={s.ntStarts}>
          <legend>Start from</legend>
          {ordered.map((t) => (
            <label key={t.key} className={`${s.ntStart}${start === t.key ? ` ${s.ntOn}` : ""}`}>
              <input type="radio" name="start" value={t.key} checked={start === t.key} onChange={() => setStart(t.key)} />
              <span>
                <b>{t.key === BLANK_START ? "Blank" : t.name}</b>
                <small>{t.description}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <p className={s.ntHint}>It opens in the editor and saves as you go. Colours and fonts come from Brand &amp; email.</p>
        {err && <p className={s.ntErr}>{err}</p>}
        <div className={s.ntFoot}>
          <button type="button" className="pm2-btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="pm2-btn pri" disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "Create and edit"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
