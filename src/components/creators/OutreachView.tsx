"use client";

// Creators · Outreach. Everyone we pitched or who asked us for a collab on
// Instagram: follow-ups waiting for your OK, then the collab chats ranked by
// fit with their stage. Opening a chat shows the fit score, the AI-suggested
// barter terms and the stage; reading and replying happens in Inbox (the IG
// channel), never here, so DMs are not duplicated.
// Same calls as the old Instagram page:
//   GET   /api/instagram/threads?tab=collab[&stage=]
//   POST  /api/instagram/threads/:id/analyze
//   PATCH /api/instagram/threads/:id/stage {collab_stage}

import { useCallback, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Copy, ExternalLink, MessageCircle, Sparkles, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { ROUTES } from "@/components/shell/nav";
import FollowUps, { useFollowups } from "./FollowUps";
import { IgOff } from "./IgOff";
import { COLLAB_STAGES, COLLAB_STAGE_LABEL, er, fmtNum, isIgOff, useEscape, type CollabStage } from "./ig";
import s from "./creators.module.css";

type Thread = {
  id: string;
  handle: string | null;
  full_name: string | null;
  status: "bot" | "human";
  classification: string;
  collab_stage: CollabStage | null;
  followers: number | null;
  engagement_rate: number | null;
  band_fit: boolean | null;
  fit_score: number | null;
  fit_reason: string | null;
  collab_draft: string | null;
  biography: string | null;
  last_activity_at: string | null;
  last_message_snippet: string | null;
  unread_count: number;
  ticket_status: string | null;
};

type ThreadsResponse = { threads: Thread[]; total: number; stageCounts: Record<string, number> };

const STAGE_TONE: Partial<Record<CollabStage, string>> = {
  new: "info",
  in_convo: "info",
  terms_sent: "warn",
  agreed: "good",
  shipped: "good",
  posted: "good",
  declined: "mute",
};

function ago(iso: string | null): string {
  if (!iso) return "";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function useCollabThreads(stage: CollabStage | "") {
  return useQuery({
    queryKey: ["ig", "collab-threads", stage],
    queryFn: async (): Promise<ThreadsResponse> => {
      const p = new URLSearchParams({ tab: "collab" });
      if (stage) p.set("stage", stage);
      const r = await fetch(`/api/instagram/threads?${p}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "load failed");
      return d;
    },
    retry: false,
    refetchInterval: 120_000,
  });
}

export default function OutreachView({ onFind }: { onFind: () => void }) {
  const { push } = useToast();
  const qc = useQueryClient();
  const [stage, setStage] = useState<CollabStage | "">("");
  const threads = useCollabThreads(stage);
  const followups = useFollowups();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const list = threads.data?.threads ?? [];
  const counts = threads.data?.stageCounts ?? {};
  const allCount = COLLAB_STAGES.reduce((a, k) => a + (counts[k] ?? 0), 0);
  const active = list.find((t) => t.id === activeId) ?? null;

  const analyze = useCallback(async (id: string) => {
    setAnalyzing(true);
    try {
      const r = await fetch(`/api/instagram/threads/${id}/analyze`, { method: "POST" });
      const d = await r.json();
      if (!r.ok || d.ok === false) throw new Error(d.error || "analyze failed");
      push({ kind: "success", text: `Scored ${d.fit_score}/100${d.discovery_ok ? "" : " (public numbers not available)"}` });
      qc.invalidateQueries({ queryKey: ["ig"] });
    } catch (e) {
      push({ kind: "error", text: `Could not score: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setAnalyzing(false);
    }
  }, [push, qc]);

  const setThreadStage = useCallback(async (id: string, collab_stage: CollabStage) => {
    try {
      const r = await fetch(`/api/instagram/threads/${id}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collab_stage }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "update failed");
      qc.invalidateQueries({ queryKey: ["ig"] });
    } catch (e) {
      push({ kind: "error", text: `Update failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, [push, qc]);

  const copy = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    push({ kind: "success", text: "Copied. Paste it in the chat in Inbox." });
  }, [push]);

  const closeActive = useCallback(() => setActiveId(null), []);
  useEscape(!!activeId, closeActive);

  if (isIgOff(threads.error?.message) || isIgOff(followups.error?.message)) {
    return <div className={s.body}><IgOff part="Outreach" /></div>;
  }

  return (
    <div className={s.body}>
      <FollowUps />

      <section className={`${s.card} ${s.cardFlush}`} aria-labelledby="cr-chats-h">
        <div className={s.secT} style={{ paddingTop: 16 }}>
          <h3 id="cr-chats-h">Collab chats</h3>
          <span className={s.small}>Best fit first. Reply in Inbox, track the stage here.</span>
        </div>
        <div className={s.tiles} role="group" aria-label="Show chats by stage" style={{ marginTop: 12 }}>
          <button type="button" className={s.tile} aria-pressed={stage === ""} onClick={() => setStage("")}>
            <b>{allCount}</b>
            <span>All</span>
          </button>
          {COLLAB_STAGES.map((k) => (
            <button key={k} type="button" className={s.tile} aria-pressed={stage === k} onClick={() => setStage(stage === k ? "" : k)}>
              <b>{counts[k] ?? 0}</b>
              <span>{COLLAB_STAGE_LABEL[k]}</span>
            </button>
          ))}
        </div>

        {threads.isLoading ? (
          <div className={s.empty}><p className={s.muted}>Loading chats</p></div>
        ) : threads.error ? (
          <div className={s.empty}><p className={s.err}>Could not load chats: {threads.error.message}</p></div>
        ) : list.length === 0 ? (
          <div className={s.empty}>
            <b>{stage ? `No chats at ${COLLAB_STAGE_LABEL[stage]}` : "No collab chats yet"}</b>
            <p>
              When a creator replies to a pitch, or DMs us asking for a collab, the chat shows up here with an AI fit
              score and suggested barter terms.
            </p>
            {!stage && (
              <button type="button" className="pm-btn" onClick={onFind}>
                Find creators to pitch <ArrowRight size={15} />
              </button>
            )}
          </div>
        ) : (
          <ul className={s.rows}>
            {list.map((t) => (
              <li key={t.id}>
                <div
                  className={s.chat}
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveId(t.id)}
                  onKeyDown={(e) => { if (e.key === "Enter") setActiveId(t.id); }}
                >
                  <span className={s.av} aria-hidden>{(t.handle ?? "?").slice(0, 1)}</span>
                  <span className={s.who}>
                    <b>{t.handle ? `@${t.handle}` : "Instagram user"}</b>
                    <span>{t.last_message_snippet || " "}</span>
                  </span>
                  <span className={s.chatMeta}>
                    {t.collab_stage && <span className={s.tg} data-tone={STAGE_TONE[t.collab_stage]}>{COLLAB_STAGE_LABEL[t.collab_stage]}</span>}
                    {t.fit_score != null && <span className={s.fit}>{t.fit_score}<small>fit</small></span>}
                    {t.followers != null && <span className={s.small}>{fmtNum(t.followers)}</span>}
                    {t.ticket_status === "open" && <span className={s.tg} data-tone="red">Needs a reply</span>}
                    <span className={s.small}>{ago(t.last_activity_at)}</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {active && (
        <div className={s.backdrop} onClick={() => setActiveId(null)}>
          <aside className={s.drawer} role="dialog" aria-modal="true" aria-label={active.handle ? `@${active.handle}` : "Collab chat"} onClick={(e) => e.stopPropagation()}>
            <div className={s.dHead}>
              <div style={{ minWidth: 0 }}>
                <span className={s.eyebrow}>Collab chat · {active.status === "human" ? "you are handling it" : "bot is handling it"}</span>
                <h2 className={s.dTitle}>
                  {active.handle ? (
                    <>
                      <a href={`https://instagram.com/${active.handle}`} target="_blank" rel="noreferrer">@{active.handle}</a>
                      <ExternalLink aria-hidden />
                    </>
                  ) : (
                    "Instagram user"
                  )}
                </h2>
                <div className={s.stats}>
                  {active.fit_score != null ? <span><b>{active.fit_score}</b>/100 fit</span> : <span>Not scored yet</span>}
                  {active.followers != null && <span><b>{fmtNum(active.followers)}</b> followers</span>}
                  {active.engagement_rate != null && <span><b>{er(active.engagement_rate)}</b> engagement</span>}
                  {active.band_fit != null && (
                    <span className={s.tg} data-tone={active.band_fit ? "good" : "warn"}>{active.band_fit ? "In our follower band" : "Outside our follower band"}</span>
                  )}
                </div>
              </div>
              <button type="button" className={s.close} onClick={() => setActiveId(null)} aria-label="Close"><X size={16} /></button>
            </div>

            <div className={s.acts}>
              <Link href={ROUTES.conversation(`ig-${active.id}`)} className="pm-btn">
                <MessageCircle size={14} /> Open chat in Inbox
              </Link>
              <button type="button" className="pm-btn" onClick={() => analyze(active.id)} disabled={analyzing}>
                <Sparkles size={14} /> {analyzing ? "Scoring" : active.fit_score != null ? "Score again" : "Score and suggest terms"}
              </button>
            </div>

            <div className={s.dSec}>
              <h4>Stage</h4>
              <div className={s.stage} role="group" aria-label="Collab stage">
                {COLLAB_STAGES.map((k) => {
                  const cur = active.collab_stage ? COLLAB_STAGES.indexOf(active.collab_stage) : -1;
                  const i = COLLAB_STAGES.indexOf(k);
                  const state = k === active.collab_stage ? "on" : k !== "declined" && i < cur && active.collab_stage !== "declined" ? "done" : undefined;
                  return (
                    <button
                      key={k}
                      type="button"
                      className={s.stageBtn}
                      data-state={state}
                      aria-pressed={k === active.collab_stage}
                      onClick={() => k !== active.collab_stage && setThreadStage(active.id, k)}
                    >
                      {COLLAB_STAGE_LABEL[k]}
                    </button>
                  );
                })}
              </div>
              <p className={s.note}>
                Agreed? Add them in <Link href="/dashboard/influencers?add=1" className={s.inkLink}>Collabs</Link> and the desk takes over the brief, the box and the reminders.
              </p>
            </div>

            {active.fit_reason && (
              <div className={s.dSec}>
                <h4>Why this fit score</h4>
                <p>{active.fit_reason}</p>
              </div>
            )}
            {active.collab_draft && (
              <div className={s.dSec}>
                <h4>Suggested barter terms</h4>
                <p className={s.note}>AI draft from our barter terms. Read it before you send it.</p>
                <div className={s.draft}>{active.collab_draft}</div>
                <div className={s.acts}>
                  <button type="button" className="pm-btn" onClick={() => copy(active.collab_draft!)}>
                    <Copy size={14} /> Copy terms
                  </button>
                </div>
              </div>
            )}
            {active.biography && (
              <div className={s.dSec}>
                <h4>Bio</h4>
                <p>{active.biography}</p>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
