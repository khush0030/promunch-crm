"use client";

// "How it works": the B2B path as six numbered steps, the same pattern as
// Creators' "How it flows". Every step shows its count, the step you are on
// is underlined and the one thing to do next is marked red with a single
// button underneath. Nothing here sends anything.
//   1 Find  2 Pick from a list  3 AI writes  4 You approve  5 Sends  6 Replies
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import s from "./b2b.module.css";
import { nf } from "./api";
import { useLists } from "./ListsView";
import type { StatusResponse } from "./types";

export type B2bTab = "find" | "lists" | "approve" | "replies" | "settings";

type StepKey = "find" | "pick" | "write" | "approve" | "send" | "replies";
type Step = { key: StepKey; title: string; sub: ReactNode; count: number; tone?: "red"; go: () => void };

export default function StatusStrip({
  status, tab, inList, onGo,
}: {
  status: StatusResponse | undefined;
  tab: B2bTab;
  inList: boolean;
  onGo: (tab: B2bTab, extra?: Record<string, string>) => void;
}) {
  const c = status?.counts ?? {};
  const checking = (c.new ?? 0) + (c.crawling ?? 0);
  const lists = useLists().data?.length ?? status?.searches.length ?? 0;
  const activeSearches = status?.searches.filter((x) => x.active).length ?? 0;
  const ready = c.ready ?? 0;
  const writing = c.drafting ?? 0;
  const waiting = c.drafted ?? 0;
  const queued = c.approved ?? 0;
  const sent = (c.contacted ?? 0) + (c.replied ?? 0) + (c.bounced ?? 0);
  const sentToday = status?.sentToday ?? 0;
  const cap = status?.settings?.daily_cap ?? 15;
  const replies = c.replied ?? 0;
  const paused = !!status?.settings?.paused;
  const sender = status?.settings?.from_name?.split(" ")[0] || "Parth";

  const next: StepKey | "paused" =
    paused ? "paused"
      : waiting > 0 ? "approve"
      : writing > 0 ? "write"
      : ready > 0 ? "pick"
      : replies > 0 ? "replies"
      : "find";

  const here: StepKey | null =
    tab === "find" ? "find"
      : tab === "lists" ? "pick"
      : tab === "approve" ? "approve"
      : tab === "replies" ? "replies"
      : null;

  const steps: Step[] = [
    {
      key: "find", title: "Find businesses",
      sub: activeSearches ? `Searching now (${nf(checking)} being checked)` : `${lists === 1 ? "1 list" : `${nf(lists)} lists`} so far. Search by type and city`,
      count: lists, go: () => onGo("find"),
    },
    {
      key: "pick", title: "Pick from a list",
      sub: ready ? `${nf(ready)} ready, tick who to email` : "Businesses with an email show as Ready",
      tone: next === "pick" ? "red" : undefined,
      count: ready, go: () => onGo("lists", ready ? { show: "ready" } : {}),
    },
    {
      key: "write", title: "AI writes",
      sub: writing ? `Writing ${nf(writing)} now` : "One email each, from the PROMUNCH knowledge base",
      count: writing, go: () => onGo("lists", ready ? { show: "ready" } : {}),
    },
    {
      key: "approve", title: "You approve",
      sub: waiting ? `${nf(waiting)} waiting for you` : "Read, edit, approve or skip",
      tone: waiting ? "red" : undefined,
      count: waiting, go: () => onGo("approve"),
    },
    {
      key: "send", title: "It sends",
      sub: queued ? `${nf(queued)} going out · ${nf(sentToday)}/${nf(cap)} today` : `As ${sender}, at most ${nf(cap)} a day`,
      count: sent, go: () => onGo("replies", { view: "contacted" }),
    },
    {
      key: "replies", title: "Replies",
      sub: replies ? `${nf(replies)} wrote back` : "A reply stops follow-ups",
      count: replies, go: () => onGo("replies"),
    },
  ];

  const nextCopy: Record<StepKey | "paused", { text: ReactNode; cta: string; act: () => void } | null> = {
    paused: { text: <><b>Sending is paused.</b> Nothing is written or sent until you turn it back on.</>, cta: "Open settings", act: () => onGo("settings") },
    approve: { text: <><b>{nf(waiting)} {waiting === 1 ? "email waits" : "emails wait"} for you.</b> Read each one, then approve it or skip it. Nothing sends before that.</>, cta: "Approve emails", act: () => onGo("approve") },
    write: { text: <><b>The AI is writing {nf(writing)} {writing === 1 ? "email" : "emails"}.</b> They land in step 4 for you to approve.</>, cta: "Open approve", act: () => onGo("approve") },
    // Inside a list the list's own guide says what to do, so no second hint.
    pick: inList
      ? null
      : { text: <><b>{nf(ready)} {ready === 1 ? "business is" : "businesses are"} ready to email.</b> Open a list, tick who to email and press Write emails.</>, cta: "Pick who to email", act: () => onGo("lists", { show: "ready" }) },
    replies: { text: <><b>{nf(replies)} {replies === 1 ? "business" : "businesses"} replied.</b> Read them and turn the good ones into deals.</>, cta: "Read replies", act: () => onGo("replies") },
    send: null,
    find: { text: <><b>Start here.</b> Find businesses by type and city. Each search makes a list you pick from.</>, cta: "Find businesses", act: () => onGo("find") },
  };
  // Already on the step it points at: the screen below is the next step.
  const nc = next === here ? null : nextCopy[next];

  return (
    <section className={s.card} aria-labelledby="b2b-flow-h">
      <div className={s.secT}>
        <h3 id="b2b-flow-h">How it works</h3>
        <span className={s.small}>Nothing is sent until you approve it</span>
      </div>
      <ol className={s.oflow}>
        {steps.map((x) => {
          const state = next === x.key ? "next" : x.count > 0 ? "done" : "todo";
          return (
            <li key={x.key} className={s.of} data-state={state} data-here={here === x.key}>
              <button type="button" className={s.ofBtn} onClick={x.go} aria-current={here === x.key ? "step" : undefined}>
                <span className={s.ofN}>{steps.indexOf(x) + 1}</span>
                <span className={s.ofC}>{nf(x.count)}</span>
                <span className={s.ofM}>
                  <b>{x.title}</b>
                  <span data-tone={x.tone}>{x.sub}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {nc ? (
        <div className={s.nextRow}>
          <p>{nc.text}</p>
          {nc.cta ? (
            <button type="button" className="pm-btn primary" onClick={nc.act}>
              {nc.cta} <ArrowRight size={15} />
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
