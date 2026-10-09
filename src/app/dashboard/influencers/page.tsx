"use client";

// Creators: one guided pipeline from finding a creator to the live post
// (audit docs/audits/2026-10-09-creators-reputation-fidelity.md). Instagram
// is folded in: Find (discovery) and Outreach (pitches, follow-ups, collab
// chats) run on the Instagram APIs, Collabs is the delivery desk (brief, box,
// draft, post) with Board · Library · Kits, Settings holds both.
// Shell section tabs (nav.ts): Find · Outreach · Collabs · Settings, as
// ?tab=find|outreach|(none)|settings. Collab sub views: ?tab=creators|kits.
// The open collab is ?deal=<id>, Add collab is ?add=1, so every view can be
// shared. Every API call is the one the old pages made.

import { Suspense, useCallback, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/pm";
import { AddCollabDrawer } from "./_components/AddCollabDrawer";
import { BoardTab, type StripKey } from "./_components/BoardTab";
import { CreatorsTab } from "./_components/CreatorsTab";
import { DealDrawer } from "./_components/DealDrawer";
import { KitsTab } from "./_components/KitsTab";
import { SettingsTab } from "./_components/SettingsTab";
import { useDeals, useSummary } from "./_components/ui";
import FindView, { FIND_INPUT_ID } from "@/components/creators/FindView";
import OutreachView from "@/components/creators/OutreachView";
import IgSettings from "@/components/creators/IgSettings";
import { CollabFlow, type FlowFocus } from "@/components/creators/CollabFlow";
import { useIgCounts } from "@/components/creators/ig";
import type { BoardSummary } from "@/lib/influencers/types";
import c from "@/components/creators/creators.module.css";

type View = "find" | "outreach" | "board" | "creators" | "kits" | "settings";
const VIEWS: View[] = ["find", "outreach", "board", "creators", "kits", "settings"];
const COLLAB_TABS = [
  { key: "board", label: "Board" },
  { key: "creators", label: "Library" },
  { key: "kits", label: "Kits" },
];

function parseView(v: string | null): View {
  if (v === "collabs") return "board";
  return VIEWS.includes(v as View) ? (v as View) : "board";
}

export default function InfluencersPage() {
  return (
    <Suspense fallback={null}>
      <CreatorsInner />
    </Suspense>
  );
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

/** One plain sentence: what is waiting on the team, then who is late. */
function boardSentence(sum: BoardSummary | null | undefined): ReactNode {
  if (!sum) return "Barter collabs from agreed to posted: brief, box, draft and post.";
  const parts = [
    sum.drafts_to_review ? plural(sum.drafts_to_review, "draft to review", "drafts to review") : null,
    sum.briefs_to_approve ? plural(sum.briefs_to_approve, "brief to approve", "briefs to approve") : null,
    sum.kits_to_ship ? plural(sum.kits_to_ship, "box to ship", "boxes to ship") : null,
  ].filter(Boolean);
  const needs = sum.drafts_to_review + sum.briefs_to_approve + sum.kits_to_ship;
  const late = sum.overdue ? ` ${plural(sum.overdue, "creator is", "creators are")} overdue and already being nudged.` : "";
  if (!needs) return <>Nothing needs you right now.{late}</>;
  return (
    <>
      <b>{plural(needs, "thing needs", "things need")} you</b>: {parts.join(", ")}.{late}
    </>
  );
}

function CreatorsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const view = parseView(params.get("tab"));
  const dealId = params.get("deal");
  const adding = params.get("add") === "1";
  const focus = (params.get("show") as StripKey | null) || null;
  const summary = useSummary();
  const ig = useIgCounts();
  const allDeals = useDeals();

  const setQuery = useCallback(
    (next: { tab?: View; deal?: string | null; add?: boolean; show?: StripKey | null }, push = false) => {
      const sp = new URLSearchParams(params.toString());
      if (next.tab !== undefined) {
        if (next.tab === "board") sp.delete("tab");
        else sp.set("tab", next.tab);
        sp.delete("show");
      }
      if (next.deal !== undefined) {
        if (next.deal) sp.set("deal", next.deal);
        else sp.delete("deal");
      }
      if (next.add !== undefined) {
        if (next.add) sp.set("add", "1");
        else sp.delete("add");
      }
      if (next.show !== undefined) {
        if (next.show) sp.set("show", next.show);
        else sp.delete("show");
      }
      const qs = sp.toString();
      const url = `/dashboard/influencers${qs ? `?${qs}` : ""}`;
      if (push) router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [params, router],
  );

  const openDeal = useCallback((id: string) => setQuery({ deal: id }), [setQuery]);
  const closeDeal = useCallback(() => setQuery({ deal: null }), [setQuery]);
  const openAdd = useCallback(() => setQuery({ add: true }), [setQuery]);
  const closeAdd = useCallback(() => setQuery({ add: false }), [setQuery]);
  const go = useCallback((t: "find" | "outreach") => setQuery({ tab: t }, true), [setQuery]);
  const setFocus = useCallback((f: FlowFocus | StripKey | null) => setQuery({ show: f }), [setQuery]);

  const addBtn = (primary: boolean) => (
    <button type="button" className={`pm-btn${primary ? " primary" : ""}`} onClick={openAdd}>
      <Plus size={15} /> Add collab
    </button>
  );

  let header: { title: string; summary: ReactNode; actions?: ReactNode };
  switch (view) {
    case "find":
      header = {
        title: "Find creators",
        summary: ig.off ? (
          <>Search Instagram for creators in our niches. <b>Not switched on yet.</b></>
        ) : (
          <>
            {ig.toCheck ? <><b>{plural(ig.toCheck, "creator", "creators")}</b> to check. </> : null}
            Search Instagram by niche or hashtag. Every profile is scored for fit, then you pick who to pitch.
          </>
        ),
        actions: ig.off ? undefined : (
          <button
            type="button"
            className="pm-btn primary"
            onClick={() => {
              const el = document.getElementById(FIND_INPUT_ID);
              el?.scrollIntoView({ behavior: "smooth", block: "center" });
              el?.focus();
            }}
          >
            <Search size={15} /> Start a search
          </button>
        ),
      };
      break;
    case "outreach":
      header = {
        title: "Outreach",
        summary: ig.off ? (
          <>Pitches, replies and follow-ups with creators. <b>Not switched on yet.</b></>
        ) : (
          <>
            {ig.followUps ? <><b>{plural(ig.followUps, "follow-up waits", "follow-ups wait")} for your OK.</b> </> : null}
            {plural(ig.talking, "creator is", "creators are")} talking to us. Agreed? Add the collab and the desk takes over.
          </>
        ),
        actions: (
          <>
            {addBtn(true)}
            {!ig.off && (
              <button type="button" className="pm-btn" onClick={() => go("find")}>
                Find more <ArrowRight size={15} />
              </button>
            )}
          </>
        ),
      };
      break;
    case "creators":
      header = { title: "Library", summary: "Everyone we have worked with, and how reliable they were.", actions: addBtn(true) };
      break;
    case "kits":
      header = { title: "Kits", summary: "What goes in the box. The right kit is suggested from the creator's niche and size." };
      break;
    case "settings":
      header = { title: "Creators settings", summary: "How much the desk chases creators, when you hear about it, and how the Instagram bot handles collab requests." };
      break;
    default:
      header = { title: "Collabs", summary: boardSentence(summary.data), actions: addBtn(true) };
  }

  const collabView = view === "board" || view === "creators" || view === "kits";

  return (
    <div>
      <PageHeader
        crumb="Creators"
        title={header.title}
        summary={header.summary}
        actions={header.actions}
        tabs={collabView ? COLLAB_TABS : undefined}
        activeTab={view}
        onTab={(k) => setQuery({ tab: parseView(k) })}
      />

      {view === "find" && <FindView onGoOutreach={() => go("outreach")} />}
      {view === "outreach" && <OutreachView onFind={() => go("find")} />}

      {view === "board" && (
        <div className={c.body}>
          <CollabFlow summary={summary.data} deals={allDeals.data} onGo={go} onFocus={setFocus} onAdd={openAdd} />
          <div>
            <BoardTab onOpenDeal={openDeal} onAdd={openAdd} focus={focus} onFocus={setFocus} />
          </div>
        </div>
      )}
      {view === "creators" && (
        <div className={c.body}>
          <CreatorsTab onOpenDeal={openDeal} />
        </div>
      )}
      {view === "kits" && (
        <div className={c.body}>
          <KitsTab />
        </div>
      )}
      {view === "settings" && (
        <div className={`${c.body} ${c.bodyTight}`}>
          <SettingsTab />
          <IgSettings />
        </div>
      )}

      {adding && (
        <AddCollabDrawer
          onClose={closeAdd}
          onCreated={(id) => setQuery({ add: false, deal: id })}
        />
      )}
      {dealId && !adding && <DealDrawer key={dealId} dealId={dealId} onClose={closeDeal} />}
    </div>
  );
}
