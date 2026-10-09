"use client";

// Batch pitch queue ("blast mode" for manual DMs): tap through a shortlist of
// creators one by one: copy the AI pitch, open the profile, send it from the
// Instagram app, mark sent, auto-advance. The API cannot cold-DM (Meta forbids
// it), so the final tap stays human; everything around it is automated.
// Same call as before: PATCH /api/instagram/prospects/:id {status:"contacted", pitch_dm?}.

import { useCallback, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, ExternalLink, SkipForward, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { er, fmtNum, type Prospect } from "./ig";
import s from "./creators.module.css";

export default function PitchQueue({
  prospects,
  onUpdate,
  onClose,
}: {
  prospects: Prospect[];
  onUpdate: (p: Prospect) => void;
  onClose: () => void;
}) {
  const { push } = useToast();
  const [idx, setIdx] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Record<string, "sent" | "skipped">>({});
  const [busy, setBusy] = useState(false);

  const current = prospects[idx] ?? null;
  const sentCount = useMemo(() => Object.values(done).filter((v) => v === "sent").length, [done]);
  const doneCount = Object.keys(done).length;
  const draftOf = useCallback((p: Prospect) => drafts[p.id] ?? p.pitch_dm ?? "", [drafts]);

  const advance = useCallback(() => {
    setIdx((i) => {
      for (let n = i + 1; n < prospects.length; n++) {
        if (!done[prospects[n].id]) return n;
      }
      return Math.min(i + 1, prospects.length);
    });
  }, [prospects, done]);

  const copyAndOpen = useCallback(async (p: Prospect) => {
    const text = draftOf(p);
    await navigator.clipboard.writeText(text).catch(() => {});
    window.open(`https://instagram.com/${p.handle}`, "_blank", "noopener");
    push({ kind: "success", text: "Pitch copied. Paste it in the DM, then tap Sent." });
  }, [draftOf, push]);

  const markSent = useCallback(async (p: Prospect) => {
    setBusy(true);
    try {
      const edited = drafts[p.id];
      const body: Record<string, unknown> = { status: "contacted" };
      if (edited && edited !== p.pitch_dm) body.pitch_dm = edited; // persist the edit so the outreach log records what was actually sent
      const r = await fetch(`/api/instagram/prospects/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "update failed");
      onUpdate(d.prospect);
      setDone((m) => ({ ...m, [p.id]: "sent" }));
      advance();
    } catch (e) {
      push({ kind: "error", text: `Could not mark sent: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
    }
  }, [drafts, onUpdate, advance, push]);

  const skip = useCallback((p: Prospect) => {
    setDone((m) => ({ ...m, [p.id]: "skipped" }));
    advance();
  }, [advance]);

  const finished = idx >= prospects.length || (current && done[current.id] && idx === prospects.length - 1);

  return (
    <div className={s.qWrap} role="dialog" aria-modal="true" aria-label="Pitch queue">
      <div className={s.qCard}>
        <div className={s.dHead}>
          <div>
            <span className={s.eyebrow}>Pitch queue</span>
            <h2 className={s.dTitle}>
              {Math.min(idx + 1, prospects.length)} of {prospects.length}
              {sentCount > 0 && <span className={s.tg} data-tone="good">{sentCount} sent</span>}
            </h2>
          </div>
          <button type="button" className={s.close} onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className={s.qBar} aria-hidden><span style={{ width: `${(doneCount / Math.max(1, prospects.length)) * 100}%` }} /></div>

        {finished || !current ? (
          <div className={s.empty}>
            <b>Queue done</b>
            <p>{sentCount} pitch{sentCount === 1 ? "" : "es"} sent. Replies show up in Outreach and in the Inbox.</p>
            <button type="button" className="pm-btn primary" onClick={onClose}>Back to Find</button>
          </div>
        ) : (
          <>
            <div className={s.taskTop}>
              <span className={s.who}>
                <b>
                  <a href={`https://instagram.com/${current.handle}`} target="_blank" rel="noreferrer" className={s.inkLink}>
                    @{current.handle} <ExternalLink size={12} />
                  </a>
                </b>
                <span>{current.niche ?? " "}</span>
              </span>
              {current.followers != null && <span className={s.small}><b>{fmtNum(current.followers)}</b> followers</span>}
              {current.engagement_rate != null && <span className={s.small}>{er(current.engagement_rate)} ER</span>}
              {current.fit_score != null && <span className={s.fit}>{current.fit_score}<small>fit</small></span>}
              {done[current.id] && <span className={s.tg}>{done[current.id]}</span>}
            </div>
            <textarea
              className={s.textarea}
              rows={6}
              aria-label="Pitch"
              value={draftOf(current)}
              onChange={(e) => setDrafts((d) => ({ ...d, [current.id]: e.target.value }))}
              style={{ marginTop: 12 }}
            />
            <div className={s.acts}>
              <button type="button" className="pm-btn" onClick={() => copyAndOpen(current)} disabled={!draftOf(current).trim()}>
                <Copy size={14} /> Copy and open profile
              </button>
              <button type="button" className="pm-btn primary" onClick={() => markSent(current)} disabled={busy || done[current.id] === "sent"}>
                <Check size={14} /> {busy ? "Saving" : "Sent"}
              </button>
              <button type="button" className="pm-btn ghost" onClick={() => skip(current)} disabled={busy}>
                <SkipForward size={14} /> Skip
              </button>
              <span className={s.qNav}>
                <button type="button" className="pm-btn" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0} aria-label="Previous">
                  <ChevronLeft size={14} />
                </button>
                <button type="button" className="pm-btn" onClick={() => setIdx((i) => Math.min(prospects.length - 1, i + 1))} disabled={idx >= prospects.length - 1} aria-label="Next">
                  <ChevronRight size={14} />
                </button>
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
