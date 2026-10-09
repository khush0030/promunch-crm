"use client";

// Creators · Outreach · Follow-ups (was Instagram → Tasks). The engine
// (ig-followup-tick) auto-sends inside Meta's 24h window; everything else
// lands here for a one-tap human send:
//   ig_dm             window open but a human owns the thread
//   ig_dm_human_agent 24h to 7d lane (HUMAN_AGENT tag; needs Meta approval)
//   email             bio email via Resend
//   whatsapp          wa.me deep link, human sends, then confirms
//   manual            copy the draft, DM from the Instagram app, confirm
// Same calls as before: GET /api/instagram/followups,
// PATCH /api/instagram/followups/:id {action, draft}.

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Send, SkipForward } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import type { Followup, FollowupsResponse } from "./ig";
import { isIgOff } from "./ig";
import s from "./creators.module.css";

const CHANNEL_LABEL: Record<string, string> = {
  ig_dm: "Instagram DM, sends when you approve",
  ig_dm_human_agent: "Instagram DM, late-reply lane",
  email: "Email",
  whatsapp: "WhatsApp, you send it",
  manual: "Manual DM, you send it",
};

const STAGE_WORD: Record<string, string> = {
  new: "First pitch",
  in_convo: "Talking",
  terms_sent: "Terms sent",
  agreed: "Agreed",
  shipped: "Shipped",
};

export function useFollowups() {
  return useQuery({
    queryKey: ["ig", "followups"],
    queryFn: async (): Promise<FollowupsResponse> => {
      const r = await fetch(`/api/instagram/followups`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "load failed");
      // Same "not switched on" contract as useIgCounts (shared query key).
      if (d.off === true) throw new Error(`Could not find the table: ${d.error ?? "instagram"}`);
      return d;
    },
    retry: false,
    refetchInterval: (q) => (isIgOff(q.state.error?.message) ? false : 300_000),
  });
}

export default function FollowUps() {
  const { push } = useToast();
  const qc = useQueryClient();
  const q = useFollowups();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const awaiting = q.data?.awaiting ?? [];
  const escalated = q.data?.escalated ?? [];
  const scheduled = q.data?.scheduled ?? [];

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
      qc.invalidateQueries({ queryKey: ["ig"] });
    } catch (e) {
      push({ kind: "error", text: `${action === "approve" ? "Send failed" : "Skip failed"}: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(null);
    }
  }, [drafts, push, qc]);

  const copyDraft = useCallback(async (f: Followup) => {
    await navigator.clipboard.writeText(drafts[f.id] ?? f.draft ?? "").catch(() => {});
    push({ kind: "success", text: "Copied. Send it, then tap Confirm sent." });
  }, [drafts, push]);

  return (
    <section className={s.card} aria-labelledby="cr-fu-h">
      <div className={s.secT}>
        <h3 id="cr-fu-h">Follow-ups waiting on you</h3>
        <span className={s.small}>{awaiting.length ? `${awaiting.length} to send` : "In-window follow-ups send by themselves"}</span>
      </div>

      {q.isLoading ? (
        <div className={s.empty}><p className={s.muted}>Loading follow-ups</p></div>
      ) : q.error ? (
        <div className={s.empty}><p className={s.err}>Could not load follow-ups: {q.error.message}</p></div>
      ) : awaiting.length === 0 ? (
        <div className={s.empty}>
          <b>Nothing waiting</b>
          <p>Follow-ups inside Instagram&apos;s 24 hour reply window go out by themselves. Ones that need a human (window closed, email, WhatsApp) wait here for your OK.</p>
        </div>
      ) : (
        <ul className={s.rows}>
          {awaiting.map((f) => {
            const t = f.thread;
            const channel = f.channel ?? "manual";
            const draft = drafts[f.id] ?? f.draft ?? "";
            const igLink = t?.handle ? `https://instagram.com/${t.handle}` : null;
            const waLink = t?.phone ? `https://wa.me/${t.phone.replace(/\D/g, "")}?text=${encodeURIComponent(draft)}` : null;
            const needsConfirm = channel === "manual" || channel === "whatsapp";
            const silent = typeof f.meta?.days_silent === "number" ? f.meta.days_silent : null;
            return (
              <li key={f.id} className={s.task}>
                <div className={s.taskTop}>
                  <span className={s.who}>
                    <b>
                      {igLink ? (
                        <a href={igLink} target="_blank" rel="noreferrer" className={s.inkLink}>
                          @{t?.handle} <ExternalLink size={12} />
                        </a>
                      ) : (
                        "Instagram user"
                      )}
                    </b>
                    <span>{CHANNEL_LABEL[channel] ?? channel}</span>
                  </span>
                  <span className={s.tg}>{STAGE_WORD[f.stage] ?? f.stage} · nudge {f.step}</span>
                  {silent != null && <span className={s.tg} data-tone={silent >= 5 ? "warn" : undefined}>{silent} days quiet</span>}
                  {t?.fit_score != null && <span className={s.fit}>{t.fit_score}<small>fit</small></span>}
                </div>
                {t?.last_message_snippet && <p className={s.taskLast}><b>Last message:</b> {t.last_message_snippet}</p>}
                <textarea
                  className={s.textarea}
                  rows={3}
                  aria-label={`Follow-up to ${t?.handle ?? "creator"}`}
                  value={draft}
                  onChange={(e) => setDrafts((d) => ({ ...d, [f.id]: e.target.value }))}
                />
                <div className={s.acts}>
                  {(channel === "ig_dm" || channel === "ig_dm_human_agent" || channel === "email") && (
                    <button type="button" className="pm-btn" onClick={() => act(f, "approve")} disabled={busy === f.id}>
                      <Send size={14} /> {busy === f.id ? "Sending" : channel === "email" ? `Email ${t?.bio_email ?? ""}` : "Approve and send"}
                    </button>
                  )}
                  {needsConfirm && (
                    <>
                      <button type="button" className="pm-btn" onClick={() => copyDraft(f)}>
                        <Copy size={14} /> Copy
                      </button>
                      {channel === "whatsapp" && waLink && (
                        <a className="pm-btn" href={waLink} target="_blank" rel="noreferrer">Open WhatsApp</a>
                      )}
                      {igLink && (
                        <a className="pm-btn" href={igLink} target="_blank" rel="noreferrer">Open profile</a>
                      )}
                      <button type="button" className="pm-btn" onClick={() => act(f, "approve")} disabled={busy === f.id}>
                        <Check size={14} /> {busy === f.id ? "Saving" : "Confirm sent"}
                      </button>
                    </>
                  )}
                  <button type="button" className="pm-btn ghost" onClick={() => act(f, "skip")} disabled={busy === f.id}>
                    <SkipForward size={14} /> Skip
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {escalated.length > 0 && (
        <>
          <div className={s.subH}>Could not be delivered, needs a person</div>
          {escalated.map((f) => (
            <div key={f.id} className={s.upcoming}>
              <b>{f.thread?.handle ? `@${f.thread.handle}` : "Instagram user"}</b>
              <span className={s.tg} data-tone="red">{STAGE_WORD[f.stage] ?? f.stage}</span>
              <span>{f.last_error ?? "Follow-up could not be delivered."}</span>
            </div>
          ))}
        </>
      )}

      {scheduled.length > 0 && (
        <>
          <div className={s.subH}>Coming up, automatic</div>
          {scheduled.map((f) => (
            <div key={f.id} className={s.upcoming}>
              <b>{f.thread?.handle ? `@${f.thread.handle}` : "Instagram user"}</b>
              <span>{STAGE_WORD[f.stage] ?? f.stage} · nudge {f.step}</span>
              <span className={s.muted}>
                {new Date(f.next_action_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
