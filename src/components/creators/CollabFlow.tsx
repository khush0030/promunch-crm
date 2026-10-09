"use client";

// Creators · "How it flows": the whole pipeline in one strip, a count per
// stage and the next thing to do marked red (same pattern as B2B Overview).
// Find → Outreach run on Instagram (counts from /api/instagram/*, shown as
// "off" while that side is not switched on); Brief → Box → Draft review →
// Live are the collab board's stage groups. Nothing here sends anything:
// every step opens the screen or board filter where that step happens.

import type { ReactNode } from "react";
import { ArrowRight, Search } from "lucide-react";
import { STAGE_GROUP, type BoardSummary, type DealListItem } from "@/lib/influencers/types";
import { useIgCounts } from "./ig";
import s from "./creators.module.css";

export type FlowFocus = "briefs_to_approve" | "kits_to_ship" | "drafts_to_review" | null;
export type FlowNext = "find" | "outreach" | "briefs" | "box" | "drafts" | "none";

type Step = {
  key: FlowNext | "live";
  n: string;
  title: string;
  sub: string;
  subTone?: "red" | "warn";
  count: number | string;
  state: "done" | "next" | "good" | "todo" | "off";
  go: () => void;
};

const nf = (n: number) => n.toLocaleString("en-IN");

export function flowNext(sum: BoardSummary | null | undefined, ig: { off: boolean; followUps: number; toCheck: number }, collabs: number): FlowNext {
  if (sum?.drafts_to_review) return "drafts";
  if (sum?.briefs_to_approve) return "briefs";
  if (sum?.kits_to_ship) return "box";
  if (!ig.off && ig.followUps > 0) return "outreach";
  if (collabs === 0 && !ig.off) return "find";
  return "none";
}

export function CollabFlow({
  summary,
  deals,
  onGo,
  onFocus,
  onAdd,
}: {
  summary: BoardSummary | null | undefined;
  deals: DealListItem[] | undefined;
  onGo: (tab: "find" | "outreach") => void;
  onFocus: (f: FlowFocus) => void;
  onAdd: () => void;
}) {
  const ig = useIgCounts();
  const all = deals ?? [];
  const byGroup = (g: string) => all.filter((d) => STAGE_GROUP[d.stage] === g).length;
  const briefing = byGroup("briefing");
  const shipping = byGroup("shipping");
  const creating = byGroup("creating");
  const review = byGroup("review");
  const live = byGroup("live") + byGroup("done");
  const open = all.filter((d) => STAGE_GROUP[d.stage] !== "done").length;
  const next = flowNext(summary, ig, all.length);

  const st = (key: FlowNext, count: number): Step["state"] => (next === key ? "next" : count > 0 ? "done" : "todo");
  const igCount = (n: number) => (ig.off ? "–" : ig.loading ? "…" : n);

  const steps: Step[] = [
    {
      key: "find", n: "1", title: "Find",
      sub: ig.off ? "Instagram search, not switched on" : ig.toCheck ? `${nf(ig.toCheck)} creators to check` : "Search Instagram by niche",
      count: igCount(ig.toCheck), state: ig.off ? "off" : st("find", ig.toCheck), go: () => onGo("find"),
    },
    {
      key: "outreach", n: "2", title: "Outreach",
      sub: ig.off ? "Pitches and follow-ups" : ig.followUps ? `${nf(ig.followUps)} follow-ups wait for you` : `${nf(ig.pitched)} pitched so far`,
      subTone: !ig.off && ig.followUps ? "red" : undefined,
      count: igCount(ig.talking), state: ig.off ? "off" : st("outreach", ig.talking), go: () => onGo("outreach"),
    },
    {
      key: "briefs", n: "3", title: "Brief",
      sub: summary?.briefs_to_approve ? `${nf(summary.briefs_to_approve)} to approve` : "AI writes it from the knowledge base",
      subTone: summary?.briefs_to_approve ? "red" : undefined,
      count: briefing, state: st("briefs", briefing), go: () => onFocus("briefs_to_approve"),
    },
    {
      key: "box", n: "4", title: "Box",
      sub: summary?.kits_to_ship ? `${nf(summary.kits_to_ship)} to ship` : "₹0 Shopify order, tagged Influencer",
      subTone: summary?.kits_to_ship ? "red" : undefined,
      count: shipping, state: st("box", shipping), go: () => onFocus("kits_to_ship"),
    },
    {
      key: "drafts", n: "5", title: "Draft review",
      sub: summary?.drafts_to_review ? `${nf(summary.drafts_to_review)} drafts to watch` : creating ? `${nf(creating)} creating now` : "Every draft needs your OK",
      subTone: summary?.drafts_to_review ? "red" : summary?.overdue ? "warn" : undefined,
      count: review + creating, state: st("drafts", review + creating), go: () => onFocus("drafts_to_review"),
    },
    {
      key: "live", n: "6", title: "Live",
      sub: "Posted, reminders stop",
      count: live, state: live > 0 ? "good" : "todo", go: () => onFocus(null),
    },
  ];

  const nextCopy: Record<FlowNext, { text: ReactNode; cta: string; act: () => void } | null> = {
    drafts: {
      text: <><b>{nf(summary?.drafts_to_review ?? 0)} {summary?.drafts_to_review === 1 ? "draft is" : "drafts are"} in.</b> The creator can&apos;t post until you approve or ask for changes.</>,
      cta: "Show drafts", act: () => onFocus("drafts_to_review"),
    },
    briefs: {
      text: <><b>{nf(summary?.briefs_to_approve ?? 0)} {summary?.briefs_to_approve === 1 ? "brief needs" : "briefs need"} your OK</b> before the creator gets it.</>,
      cta: "Show briefs", act: () => onFocus("briefs_to_approve"),
    },
    box: {
      text: <><b>{nf(summary?.kits_to_ship ?? 0)} {summary?.kits_to_ship === 1 ? "box is" : "boxes are"} not shipped yet.</b> The creator said yes to the brief.</>,
      cta: "Show boxes", act: () => onFocus("kits_to_ship"),
    },
    outreach: {
      text: <><b>{nf(ig.followUps)} follow-ups wait for your OK.</b> Read each one and send, or skip.</>,
      cta: "Open Outreach", act: () => onGo("outreach"),
    },
    find: {
      text: <>No collabs yet. <b>Find creators</b> on Instagram, or add one you already agreed with.</>,
      cta: "Find creators", act: () => onGo("find"),
    },
    none: open === 0
      ? { text: <>Nothing running. Add a creator you agreed a barter collab with and the desk handles the brief, the box and the reminders.</>, cta: "Add collab", act: onAdd }
      : { text: <><b>Nothing needs you right now.</b> {nf(open)} {open === 1 ? "collab is" : "collabs are"} running and the desk is chasing on its own.</>, cta: "", act: () => {} },
  };
  const nc = nextCopy[next];

  return (
    <section className={s.card} aria-labelledby="cr-flow-h">
      <div className={s.secT}>
        <h3 id="cr-flow-h">How it flows</h3>
        <span className={s.small}>Barter only: product for content, no fees</span>
      </div>
      <ol className={s.oflow}>
        {steps.map((x) => (
          <li key={x.key} className={s.of} data-state={x.state}>
            <button type="button" className={s.ofBtn} onClick={x.go}>
              <span className={s.ofN}>{x.n === "1" && x.state === "off" ? <Search /> : x.n}</span>
              <span className={s.ofC}>{typeof x.count === "number" ? nf(x.count) : x.count}</span>
              <span className={s.ofM}>
                <b>{x.title}</b>
                <span data-tone={x.subTone}>{x.sub}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      {nc?.text ? (
        <div className={s.nextRow}>
          <p>{nc.text}</p>
          {nc.cta ? (
            <button type="button" className="pm-btn" onClick={nc.act}>
              {nc.cta} <ArrowRight size={15} />
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
