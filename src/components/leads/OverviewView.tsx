"use client";

// B2B · Overview (prototype b2b-home): the guided flow with a count per stage
// and the next step marked, then the lists with their per-stage progress, the
// newest replies and the deals summary. Nothing here sends or runs anything;
// every step opens the screen where that step happens.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Repeat } from "lucide-react";
import s from "./b2b.module.css";
import type { ApiResponse, Lead, ListSummary } from "./types";
import { flowCounts, initials, nf, shortDate } from "./stages";
import { listLabel } from "./format";

export type DealsSummary = { open: number; followUp: number; samples: number; won: number };
export type B2bTab = "overview" | "lists" | "find" | "review" | "replies" | "setup";
export type NextStep = "find" | "check" | "review" | "replies" | "lists";

// The single next thing to do, in priority order. Shared with the header so
// the red button and the red step always agree.
export function nextStep(data: ApiResponse | null): NextStep {
  const c = flowCounts(data?.statusCounts ?? {});
  if (c.total === 0) return "find";
  if (c.toReview > 0) return "review";
  if (c.checking + c.writing > 0) return "check";
  if (c.replied > 0) return "replies";
  return "find";
}

type Step = {
  key: string;
  n: string;
  title: string;
  sub: string;
  subTone?: "red" | "warn";
  count: number;
  state: "done" | "next" | "auto" | "good" | "todo";
  go: () => void;
};

export default function OverviewView({
  data, lists, deals, sender, dailyCap, onGo, onOpenList, onOpenLead, onRun, running, runProgress,
}: {
  data: ApiResponse | null;
  lists: ListSummary[];
  deals: DealsSummary | null;
  sender: string;
  dailyCap: number | null;
  onGo: (tab: B2bTab) => void;
  onOpenList: (id: string) => void;
  onOpenLead: (lead: Lead) => void;
  onRun: () => void;
  running: boolean;
  runProgress: string;
}) {
  const router = useRouter();
  const c = flowCounts(data?.statusCounts ?? {});
  const next = nextStep(data);
  const follow = data?.activeEnrollments ?? 0;
  const paused = !!data?.settings?.paused;

  const state = (key: NextStep, count: number): Step["state"] => (next === key ? "next" : count > 0 ? "done" : "todo");

  const steps: Step[] = [
    { key: "find", n: "1", title: "Find businesses", sub: "Pick a business type and city", count: c.total, state: state("find", c.total), go: () => onGo("find") },
    {
      key: "check", n: "2", title: "Score + find emails",
      sub: c.checking > 0 ? `${nf(c.checking)} still being checked` : `AI fit score, work email, mail server check${c.noEmail ? ` · ${nf(c.noEmail)} had none` : ""}`,
      subTone: c.checking > 0 && next === "check" ? "red" : undefined,
      count: c.withEmail, state: state("check", c.withEmail), go: () => onGo("lists"),
    },
    {
      key: "review", n: "3", title: "Review + send",
      sub: c.toReview > 0 ? `${nf(c.toReview)} emails waiting for you` : c.writing > 0 ? `AI is writing ${nf(c.writing)}` : "AI writes each email from the knowledge base",
      subTone: c.toReview > 0 ? "red" : undefined,
      count: c.toReview, state: state("review", c.toReview), go: () => onGo("review"),
    },
    {
      key: "follow", n: "auto", title: "Follow-ups",
      sub: paused ? "Paused in setup" : "Automatic until someone replies",
      subTone: paused ? "warn" : undefined,
      count: follow, state: "auto", go: () => onGo("setup"),
    },
    {
      key: "replies", n: "4", title: "Replies",
      sub: `${nf(c.sent + c.replied + c.bounced)} emailed so far`,
      count: c.replied, state: next === "replies" ? "next" : c.replied > 0 ? "good" : "todo", go: () => onGo("replies"),
    },
    {
      key: "deals", n: "5", title: "Deals",
      sub: deals ? `${nf(deals.followUp)} need a follow-up` : "Built from the mailbox",
      count: deals?.open ?? 0, state: (deals?.open ?? 0) > 0 ? "done" : "todo",
      go: () => router.push("/dashboard/deals"),
    },
  ];

  const nextCopy: Record<NextStep, { text: React.ReactNode; cta: string; act: () => void }> = {
    find: {
      text: c.total === 0
        ? <>Start here: pick a business type and a city. We find the businesses, check their work emails and write a first email for each.</>
        : <>All caught up. <b>Find more businesses</b> to keep the pipeline full.</>,
      cta: "Find businesses", act: () => onGo("find"),
    },
    review: {
      text: <><b>{nf(c.toReview)} emails are written and waiting.</b> Read each one, edit if needed, and press Send. Nothing goes out without you.</>,
      cta: `Review ${nf(c.toReview)} emails`, act: () => onGo("review"),
    },
    check: {
      text: <><b>{nf(c.checking + c.writing)} businesses are mid-way.</b> Run the next batch to score them, find emails and write drafts. Keep this tab open while it runs.</>,
      cta: running ? `Working ${runProgress}` : "Run next batch", act: onRun,
    },
    replies: {
      text: <><b>{nf(c.replied)} businesses replied.</b> Read them and move the good ones into Deals.</>,
      cta: "Open replies", act: () => onGo("replies"),
    },
    lists: { text: null, cta: "Lists", act: () => onGo("lists") },
  };
  const nc = nextCopy[next];

  // Busiest lists first: anything replied or sent, then most emails found.
  const topLists = [...lists]
    .sort((a, b) => b.replied - a.replied || b.contacted - a.contacted || b.withEmail - a.withEmail)
    .slice(0, 5);

  const replies = (data?.leads ?? []).filter((l) => l.status === "replied").slice(0, 3);

  return (
    <div className={s.body}>
      <section className={s.card} aria-label="How outreach flows">
        <div className={s.secT}>
          <h3>How it flows</h3>
          <span className={s.small}>
            {dailyCap ? `Sends as ${sender}, up to ${dailyCap} a day` : `Sends as ${sender}`}
          </span>
        </div>
        <ol className={s.oflow}>
          {steps.map((st) => (
            <li key={st.key} className={s.of} data-state={st.state}>
              <button type="button" className={s.ofBtn} onClick={st.go}>
                <span className={s.ofN}>{st.n === "auto" ? <Repeat /> : st.n}</span>
                <span className={s.ofC}>{nf(st.count)}</span>
                <span className={s.ofM}>
                  <b>{st.title}</b>
                  <span data-tone={st.subTone}>{st.sub}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
        {nc.text ? (
          <div className={s.nextRow}>
            <p>{nc.text}</p>
            <button type="button" className="pm-btn" onClick={nc.act} disabled={next === "check" && running}>
              {nc.cta} <ArrowRight size={15} />
            </button>
          </div>
        ) : null}
      </section>

      <section className={s.card}>
        <div className={s.secT}>
          <h3>Your lists</h3>
          <button type="button" className={s.txtLink} onClick={() => onGo("lists")}>
            {lists.length > topLists.length ? `All ${lists.length}` : "Lists"} <ArrowRight />
          </button>
        </div>
        {topLists.length === 0 ? (
          <div className={s.empty}>
            <b>No lists yet</b>
            <p>Every search becomes a list, like &ldquo;Corporate gifting · Mumbai&rdquo;. Start with one business type and one city.</p>
            <button type="button" className="pm-btn" onClick={() => onGo("find")}>Find businesses</button>
          </div>
        ) : (
          <>
            <div className={s.olists}>
              {topLists.map((l) => {
                const notSent = Math.max(0, l.withEmail - l.contacted);
                const noEmail = Math.max(0, l.leads - l.withEmail);
                const tag = l.active_sequence
                  ? { t: "Follow-ups running", tone: "info" }
                  : l.replied > 0
                    ? { t: `${l.replied} replied`, tone: "good" }
                    : l.withEmail === 0
                      ? { t: "No emails yet", tone: "warn" }
                      : notSent > 0
                        ? { t: `${nf(notSent)} not emailed yet`, tone: undefined }
                        : { t: "All emailed", tone: undefined };
                return (
                  <button key={l.id} type="button" className={s.ol} onClick={() => onOpenList(l.id)}>
                    <span className={s.olT}>
                      <b>{listLabel(l.name)}</b>
                      <span className={s.tg} data-tone={tag.tone}>{tag.t}</span>
                    </span>
                    <span className={s.olSteps}>
                      <span><b>{nf(l.leads)}</b>found</span>
                      <span><b>{nf(l.withEmail)}</b>emails</span>
                      <span><b>{nf(l.contacted)}</b>sent</span>
                      <span data-tone={l.replied > 0 ? "good" : undefined}><b>{nf(l.replied)}</b>replied</span>
                    </span>
                    {l.leads > 0 ? (
                      <span className={s.olBar} aria-hidden>
                        <i style={{ flex: l.contacted, background: "var(--pm-ink2)" }} />
                        <i style={{ flex: notSent, background: "#E0C9A6" }} />
                        <i style={{ flex: noEmail, background: "var(--pm-card3)" }} />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className={s.keys}>
              <span><i style={{ background: "var(--pm-ink2)" }} />Sent</span>
              <span><i style={{ background: "#E0C9A6" }} />Has an email, not sent yet</span>
              <span><i style={{ background: "var(--pm-card3)", border: "1px solid var(--pm-border)" }} />No email</span>
            </div>
          </>
        )}
      </section>

      <div className={s.grid2}>
        <section className={s.card}>
          <div className={s.secT}>
            <h3>New replies</h3>
            <button type="button" className={s.txtLink} onClick={() => onGo("replies")}>
              {c.replied ? `All ${nf(c.replied)}` : "Replies"} <ArrowRight />
            </button>
          </div>
          {replies.length === 0 ? (
            <p className={s.muted} style={{ margin: "10px 0 0", fontSize: 15 }}>
              No replies yet. Anyone who replies stops getting follow-ups and shows up here.
            </p>
          ) : (
            <div className={s.bizList} style={{ marginTop: 6 }}>
              {replies.map((l) => {
                const r = [...(l.outreach_replies ?? [])].sort((a, b) => +new Date(b.received_at) - +new Date(a.received_at))[0];
                return (
                  <div key={l.id} className={`${s.bz} ${s.bzClick}`} role="button" tabIndex={0}
                    onClick={() => onOpenLead(l)}
                    onKeyDown={(e) => { if (e.key === "Enter") onOpenLead(l); }}>
                    <span className={s.cj} data-tone="good">{initials(l.name)}</span>
                    <span className={s.clM}>
                      <b>{l.name}</b>
                      <span>{r?.body_text ? `“${r.body_text.replace(/\s+/g, " ").slice(0, 90)}”` : r?.subject ?? "Replied"}</span>
                    </span>
                    <span className={s.clO}><time>{shortDate(r?.received_at ?? l.updated_at)}</time></span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
        <section className={s.card}>
          <div className={s.secT}>
            <h3>Deals</h3>
            <Link className={s.txtLink} href="/dashboard/deals">Open <ArrowRight /></Link>
          </div>
          <div className={s.statline} style={{ marginTop: 14 }}>
            <div><b>{deals ? nf(deals.open) : "–"}</b><span>open</span></div>
            <div><b data-tone={deals?.followUp ? "warn" : undefined}>{deals ? nf(deals.followUp) : "–"}</b><span>need follow-up</span></div>
            <div><b data-tone={deals?.won ? "good" : undefined}>{deals ? nf(deals.won) : "–"}</b><span>won</span></div>
          </div>
          <p className={s.muted} style={{ margin: "12px 0 0", fontSize: 14 }}>
            Deals build themselves from the hello@promunch.in mailbox. Drag them between stages on the board.
          </p>
        </section>
      </div>
    </div>
  );
}
