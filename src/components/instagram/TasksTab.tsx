"use client";

// Follow-up approval queue. The engine (ig-followup-tick) auto-sends inside
// Meta's 24h window; everything else lands here for a one-tap human send:
//   ig_dm             — window open but a human owns the thread
//   ig_dm_human_agent — 24h–7d lane (HUMAN_AGENT tag; needs Meta approval)
//   email             — bio email via Resend
//   whatsapp          — wa.me deep link, human sends, then confirms
//   manual            — copy the draft, DM from the Instagram app, confirm

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, RefreshCw, SkipForward, Send, AlertTriangle, Clock } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import styles from "@/app/dashboard/instagram/instagram.module.css";

type TaskThread = {
  id: string;
  handle: string | null;
  collab_stage: string | null;
  fit_score: number | null;
  followers: number | null;
  bio_email: string | null;
  phone: string | null;
  status: string;
  last_inbound_at: string | null;
  last_message_snippet: string | null;
};

type Followup = {
  id: string;
  thread_id: string;
  stage: string;
  step: number;
  status: string;
  channel: string | null;
  draft: string | null;
  next_action_at: string;
  last_error: string | null;
  meta: { window_state?: string; days_silent?: number } | null;
  thread: TaskThread | null;
};

const CHANNEL_LABEL: Record<string, string> = {
  ig_dm: "IG DM (approve to send)",
  ig_dm_human_agent: "IG DM · human agent lane",
  email: "Email",
  whatsapp: "WhatsApp",
  manual: "Manual DM",
};

export default function TasksTab({ onCount }: { onCount?: (n: number) => void }) {
  const { push } = useToast();
  const notifyErr = useCallback((label: string, e: unknown) => push({ kind: "error", text: `${label}: ${String(e)}` }), [push]);

  const [awaiting, setAwaiting] = useState<Followup[]>([]);
  const [escalated, setEscalated] = useState<Followup[]>([]);
  const [scheduled, setScheduled] = useState<Followup[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/instagram/followups`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "load failed");
      setAwaiting(d.awaiting ?? []);
      setEscalated(d.escalated ?? []);
      setScheduled(d.scheduled ?? []);
      onCount?.((d.awaiting ?? []).length);
    } catch (e) {
      notifyErr("Couldn't load follow-up tasks", e);
    } finally {
      setLoading(false);
    }
  }, [notifyErr, onCount]);

  useEffect(() => { load(); }, [load]);

  const act = useCallback(async (f: Followup, action: "approve" | "skip") => {
    setBusy(f.id);
    try {
      const r = await fetch(`/api/instagram/followups/${f.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, draft: drafts[f.id] ?? f.draft ?? "" }),
      });
      const d = await r.json();
      if (!r.ok || d.ok === false) throw new Error(d.error || `${action} failed`);
      push({ kind: "success", text: action === "approve" ? "Follow-up sent." : "Skipped." });
      load();
    } catch (e) {
      notifyErr(action === "approve" ? "Send failed" : "Skip failed", e);
    } finally {
      setBusy(null);
    }
  }, [drafts, push, load, notifyErr]);

  const copyDraft = useCallback(async (f: Followup) => {
    await navigator.clipboard.writeText(drafts[f.id] ?? f.draft ?? "").catch(() => {});
    push({ kind: "success", text: "Copied. Send it, then hit Confirm sent." });
  }, [drafts, push]);

  return (
    <div className={styles.tasksWrap}>
      <div className={styles.tasksHead}>
        <span className={styles.tasksTitle}>Follow-ups waiting on you</span>
        <button className="pm-btn" onClick={load} disabled={loading}>
          <RefreshCw size={15} className={loading ? styles.spin : ""} /> Refresh
        </button>
      </div>

      {awaiting.length === 0 && !loading && (
        <div className={styles.empty}>
          Nothing waiting. In-window follow-ups send automatically; out-of-window ones will appear here.
        </div>
      )}

      {awaiting.map((f) => {
        const t = f.thread;
        const channel = f.channel ?? "manual";
        const igLink = t?.handle ? `https://instagram.com/${t.handle}` : null;
        const waLink = t?.phone ? `https://wa.me/${t.phone.replace(/\D/g, "")}?text=${encodeURIComponent(drafts[f.id] ?? f.draft ?? "")}` : null;
        const needsConfirm = channel === "manual" || channel === "whatsapp";
        return (
          <div key={f.id} className={styles.taskCard}>
            <div className={styles.taskTop}>
              <a href={igLink ?? "#"} target="_blank" rel="noreferrer" className={styles.convoHandle}>
                {t?.handle ? `@${t.handle}` : "Instagram user"} <ExternalLink size={12} />
              </a>
              <span className={styles.stagePill}>{f.stage} · nudge {f.step}</span>
              <span className={styles.taskChannel}>{CHANNEL_LABEL[channel] ?? channel}</span>
              {typeof f.meta?.days_silent === "number" && (
                <span className={styles.taskSilent}>{f.meta.days_silent}d silent</span>
              )}
              {t?.fit_score != null && <span className={styles.scorePill}>{t.fit_score}</span>}
            </div>
            {t?.last_message_snippet && <div className={styles.snippet}>Last: {t.last_message_snippet}</div>}
            <textarea
              className={styles.taskDraft}
              rows={3}
              value={drafts[f.id] ?? f.draft ?? ""}
              onChange={(e) => setDrafts((d) => ({ ...d, [f.id]: e.target.value }))}
            />
            <div className={styles.taskActions}>
              {(channel === "ig_dm" || channel === "ig_dm_human_agent" || channel === "email") && (
                <button className="pm-btn primary" onClick={() => act(f, "approve")} disabled={busy === f.id}>
                  <Send size={14} /> {busy === f.id ? "Sending…" : channel === "email" ? `Email ${t?.bio_email ?? ""}` : "Approve & send"}
                </button>
              )}
              {needsConfirm && (
                <>
                  <button className="pm-btn" onClick={() => copyDraft(f)}>
                    <Copy size={14} /> Copy
                  </button>
                  {channel === "whatsapp" && waLink && (
                    <a className="pm-btn" href={waLink} target="_blank" rel="noreferrer">Open WhatsApp</a>
                  )}
                  {igLink && (
                    <a className="pm-btn" href={igLink} target="_blank" rel="noreferrer">Open profile</a>
                  )}
                  <button className="pm-btn primary" onClick={() => act(f, "approve")} disabled={busy === f.id}>
                    <Check size={14} /> {busy === f.id ? "Saving…" : "Confirm sent"}
                  </button>
                </>
              )}
              <button className="pm-btn" onClick={() => act(f, "skip")} disabled={busy === f.id}>
                <SkipForward size={14} /> Skip
              </button>
            </div>
          </div>
        );
      })}

      {escalated.length > 0 && (
        <>
          <div className={styles.tasksSection}><AlertTriangle size={14} /> Escalated (needs a human)</div>
          {escalated.map((f) => (
            <div key={f.id} className={`${styles.taskCard} ${styles.taskCardWarn}`}>
              <div className={styles.taskTop}>
                <span className={styles.handle}>{f.thread?.handle ? `@${f.thread.handle}` : "Instagram user"}</span>
                <span className={styles.stagePill}>{f.stage}</span>
              </div>
              <div className={styles.snippet}>{f.last_error ?? "Follow-up could not be delivered."}</div>
            </div>
          ))}
        </>
      )}

      {scheduled.length > 0 && (
        <>
          <div className={styles.tasksSection}><Clock size={14} /> Coming up (automatic)</div>
          {scheduled.map((f) => (
            <div key={f.id} className={styles.taskUpcoming}>
              <span className={styles.handle}>{f.thread?.handle ? `@${f.thread.handle}` : "Instagram user"}</span>
              <span className={styles.stagePill}>{f.stage} · nudge {f.step}</span>
              <span className={styles.taskSilent}>
                {new Date(f.next_action_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
