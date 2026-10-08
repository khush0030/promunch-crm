"use client";

// Reputation (ORM): one feed of every review, comment and mention of PROMUNCH
// across the web. Tabs and the open mention live in the URL
// (?tab=overview|settings, ?m=<id>) so WhatsApp alerts can deep-link a mention.
// Build contract: docs/plans/2026-10-08-orm-build-spec.md §7.

import { Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHead, Tabs } from "@/components/pm";
import { FeedTab } from "./_components/FeedTab";
import { MentionDrawer } from "./_components/MentionDrawer";
import { OverviewTab } from "./_components/OverviewTab";
import { SettingsTab } from "./_components/SettingsTab";
import { useSummary } from "./_components/ui";
import s from "./reputation.module.css";
// Same calm redesign scope as the Influencers page (tokens + fonts). Remove
// together with the Influencers copy when the full redesign merges.
import { REDESIGN_SCOPE } from "../influencers/fonts";
import "../influencers/redesign-scope.css";

type TabKey = "feed" | "overview" | "settings";
const TABS: { key: TabKey; label: string }[] = [
  { key: "feed", label: "Feed" },
  { key: "overview", label: "Overview" },
  { key: "settings", label: "Settings" },
];
const parseTab = (v: string | null): TabKey => (TABS.some((t) => t.key === v) ? (v as TabKey) : "feed");

const SUBTITLE: Record<TabKey, string> = {
  feed: "Reviews, comments and mentions of PROMUNCH across the web, newest first.",
  overview: "How people feel about PROMUNCH and what they talk about.",
  settings: "Where we listen, what counts as a mention, and who gets alerts.",
};

export default function ReputationPage() {
  return (
    <div className={REDESIGN_SCOPE}>
      <Suspense fallback={<div className="pm-page" />}>
        <ReputationInner />
      </Suspense>
    </div>
  );
}

function ReputationInner() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = parseTab(params.get("tab"));
  const mentionId = params.get("m");
  const week = useSummary(7);

  const setQuery = useCallback(
    (next: { tab?: TabKey; m?: string | null }) => {
      const sp = new URLSearchParams(params.toString());
      if (next.tab !== undefined) {
        if (next.tab === "feed") sp.delete("tab");
        else sp.set("tab", next.tab);
      }
      if (next.m !== undefined) {
        if (next.m) sp.set("m", next.m);
        else sp.delete("m");
      }
      const qs = sp.toString();
      router.replace(`/dashboard/reputation${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [params, router],
  );
  const open = useCallback((id: string) => setQuery({ m: id }), [setQuery]);
  const close = useCallback(() => setQuery({ m: null }), [setQuery]);
  const toSettings = useCallback(() => setQuery({ tab: "settings" }), [setQuery]);

  const unanswered = week.data?.unanswered_negative ?? 0;
  const subtitle =
    tab === "feed" && unanswered > 0 ? (
      <>
        <b>
          {unanswered} negative {unanswered === 1 ? "mention needs" : "mentions need"} a reply
        </b>{" "}
        from the last 7 days.
      </>
    ) : (
      SUBTITLE[tab]
    );

  return (
    <div className={`pm-page ${s.page}`}>
      <PageHead title="Reputation" subtitle={<span className={s.sum}>{subtitle}</span>} />
      <Tabs tabs={TABS} active={tab} onSelect={(k) => setQuery({ tab: parseTab(k) })} />
      <div className={s.body}>
        {tab === "feed" && <FeedTab onOpen={open} onSettings={toSettings} />}
        {tab === "overview" && <OverviewTab onSettings={toSettings} />}
        {tab === "settings" && <SettingsTab />}
      </div>
      {mentionId && <MentionDrawer key={mentionId} id={mentionId} onClose={close} />}
    </div>
  );
}
