"use client";

// Batch pitch queue ("blast mode" for manual DMs): tap through a shortlist of
// prospects one by one — copy the AI pitch, open the profile, send it from the
// Instagram app, mark sent, auto-advance. The API cannot cold-DM (Meta forbids
// it), so the final tap stays human; everything around it is automated.

import { useCallback, useMemo, useState } from "react";
import { Check, Copy, ExternalLink, SkipForward, X, ChevronLeft, ChevronRight } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import styles from "@/app/dashboard/instagram/instagram.module.css";
import type { Prospect } from "./DiscoveryTab";

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
  const draftOf = useCallback(
    (p: Prospect) => drafts[p.id] ?? p.pitch_dm ?? "",
    [drafts],
  );

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
    push({ kind: "success", text: "Pitch copied. Paste it in the DM, then hit Sent." });
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
      push({ kind: "error", text: `Couldn't mark sent: ${String(e)}` });
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
    <div className={styles.queueOverlay} role="dialog" aria-label="Pitch queue">
      <div className={styles.queueCard}>
        <div className={styles.queueHead}>
          <span className={styles.tasksTitle}>
            Pitch queue · {Math.min(idx + 1, prospects.length)}/{prospects.length}
            {sentCount > 0 && <span className={styles.queueSent}> · {sentCount} sent</span>}
          </span>
          <button className={styles.backBtnAlways} onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {finished || !current ? (
          <div className={styles.queueDone}>
            <Check size={28} />
            <p>Queue done. {sentCount} pitch{sentCount === 1 ? "" : "es"} sent.</p>
            <button className="pm-btn primary" onClick={onClose}>Back to Discovery</button>
          </div>
        ) : (
          <>
            <div className={styles.taskTop}>
              <a href={`https://instagram.com/${current.handle}`} target="_blank" rel="noreferrer" className={styles.convoHandle}>
                @{current.handle} <ExternalLink size={12} />
              </a>
              {current.followers != null && <span className={styles.taskSilent}>{fmtNum(current.followers)} followers</span>}
              {current.engagement_rate != null && <span className={styles.taskSilent}>{(current.engagement_rate * 100).toFixed(1)}% ER</span>}
              {current.fit_score != null && <span className={styles.scorePill}>{current.fit_score}</span>}
              {done[current.id] && <span className={styles.stagePill}>{done[current.id]}</span>}
            </div>
            {current.niche && <div className={styles.snippet}>{current.niche}</div>}
            <textarea
              className={styles.taskDraft}
              rows={6}
              value={draftOf(current)}
              onChange={(e) => setDrafts((d) => ({ ...d, [current.id]: e.target.value }))}
            />
            <div className={styles.taskActions}>
              <button className="pm-btn primary" onClick={() => copyAndOpen(current)} disabled={!draftOf(current).trim()}>
                <Copy size={14} /> Copy & open profile
              </button>
              <button className="pm-btn primary" onClick={() => markSent(current)} disabled={busy || done[current.id] === "sent"}>
                <Check size={14} /> {busy ? "Saving…" : "Sent"}
              </button>
              <button className="pm-btn" onClick={() => skip(current)} disabled={busy}>
                <SkipForward size={14} /> Skip
              </button>
              <span className={styles.queueNav}>
                <button className="pm-btn" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0} aria-label="Previous">
                  <ChevronLeft size={14} />
                </button>
                <button className="pm-btn" onClick={() => setIdx((i) => Math.min(prospects.length - 1, i + 1))} disabled={idx >= prospects.length - 1} aria-label="Next">
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

function fmtNum(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}
