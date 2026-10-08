"use client";

// Creators desk (influencer delivery tracker). Barter collabs from "agreed" to "posted":
// brief, box, draft, post. Tabs and the open collab live in the URL
// (?tab=board|creators|kits|settings, ?deal=<id>) so any view can be shared.

import { Suspense, useCallback, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { PageHead, Tabs } from "@/components/pm";
import { AddCollabDrawer } from "./_components/AddCollabDrawer";
import { BoardTab } from "./_components/BoardTab";
import { CreatorsTab } from "./_components/CreatorsTab";
import { DealDrawer } from "./_components/DealDrawer";
import { KitsTab } from "./_components/KitsTab";
import { SettingsTab } from "./_components/SettingsTab";
import { useSummary } from "./_components/ui";
import type { BoardSummary } from "@/lib/influencers/types";
import s from "./influencers.module.css";
import { REDESIGN_SCOPE } from "./fonts";
import "./redesign-scope.css";

type TabKey = "board" | "creators" | "kits" | "settings";
const TABS: { key: TabKey; label: string }[] = [
  { key: "board", label: "Board" },
  { key: "creators", label: "Creators" },
  { key: "kits", label: "Kits" },
  { key: "settings", label: "Settings" },
];

function parseTab(v: string | null): TabKey {
  return TABS.some((t) => t.key === v) ? (v as TabKey) : "board";
}

export default function InfluencersPage() {
  return (
    // REDESIGN_SCOPE (.pm-rd) turns on the redesign look for this page only;
    // the drawers and ConfirmDialogs render inline below it, so they get it too.
    <div className={REDESIGN_SCOPE}>
      <Suspense fallback={<div className="pm-page" />}>
        <InfluencersInner />
      </Suspense>
    </div>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One plain sentence: what is waiting on the team, then who is late. */
function boardSentence(sum: BoardSummary | null | undefined): ReactNode {
  if (!sum) return "Barter collabs from agreed to posted: brief, box, draft and post.";
  const parts = [
    sum.drafts_to_review ? plural(sum.drafts_to_review, "draft to review", "drafts to review") : null,
    sum.briefs_to_approve ? plural(sum.briefs_to_approve, "brief to approve", "briefs to approve") : null,
    sum.kits_to_ship ? plural(sum.kits_to_ship, "box to ship", "boxes to ship") : null,
  ].filter(Boolean);
  const needs = sum.drafts_to_review + sum.briefs_to_approve + sum.kits_to_ship;
  const late = sum.overdue ? ` ${plural(sum.overdue, "creator is", "creators are")} overdue.` : "";
  if (!needs) return <>Nothing needs you right now.{late}</>;
  return (
    <>
      <b>{plural(needs, "thing needs", "things need")} you</b>: {parts.join(", ")}.{late}
    </>
  );
}

const SUBTITLE: Record<Exclude<TabKey, "board">, string> = {
  creators: "Everyone we have worked with, and how reliable they were.",
  kits: "What goes in the box. The right kit is suggested from the creator's niche and size.",
  settings: "How much the desk chases creators, and when you hear about it.",
};

function InfluencersInner() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = parseTab(params.get("tab"));
  const dealId = params.get("deal");
  const [adding, setAdding] = useState(false);
  const summary = useSummary();

  const setQuery = useCallback(
    (next: { tab?: TabKey; deal?: string | null }) => {
      const sp = new URLSearchParams(params.toString());
      if (next.tab !== undefined) {
        if (next.tab === "board") sp.delete("tab");
        else sp.set("tab", next.tab);
      }
      if (next.deal !== undefined) {
        if (next.deal) sp.set("deal", next.deal);
        else sp.delete("deal");
      }
      const qs = sp.toString();
      router.replace(`/dashboard/influencers${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [params, router],
  );

  const openDeal = useCallback((id: string) => setQuery({ deal: id }), [setQuery]);
  const closeDeal = useCallback(() => setQuery({ deal: null }), [setQuery]);
  const closeAdd = useCallback(() => setAdding(false), []);

  return (
    <div className={`pm-page ${s.page}`}>
      <PageHead
        title="Influencers"
        subtitle={<span className={s.sum}>{tab === "board" ? boardSentence(summary.data) : SUBTITLE[tab]}</span>}
        actions={
          <button type="button" className="pm-btn primary" style={{ whiteSpace: "nowrap" }} onClick={() => setAdding(true)}>
            <Plus size={14} /> Add collab
          </button>
        }
      />

      <Tabs tabs={TABS} active={tab} onSelect={(k) => setQuery({ tab: parseTab(k) })} />

      {tab === "board" && <BoardTab onOpenDeal={openDeal} onAdd={() => setAdding(true)} />}
      {tab === "creators" && <CreatorsTab onOpenDeal={openDeal} />}
      {tab === "kits" && <KitsTab />}
      {tab === "settings" && <SettingsTab />}

      {adding && (
        <AddCollabDrawer
          onClose={closeAdd}
          onCreated={(id) => {
            setAdding(false);
            openDeal(id);
          }}
        />
      )}
      {dealId && !adding && <DealDrawer key={dealId} dealId={dealId} onClose={closeDeal} />}
    </div>
  );
}
