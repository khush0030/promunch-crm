"use client";

// Reputation (ORM): one feed of every review, comment and mention of PROMUNCH
// across the web. Tabs (Feed · Overview · Settings) are shell section tabs
// (nav.ts pages, ?tab=overview|settings) and the open mention lives in ?m=<id>,
// so WhatsApp alerts can deep-link a mention.
// Build contract: docs/plans/2026-10-08-orm-build-spec.md §7.
// Audit: docs/audits/2026-10-09-creators-reputation-fidelity.md §2.

import { Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Settings2 } from "lucide-react";
import { PageHeader } from "@/components/pm";
import { FeedTab } from "./_components/FeedTab";
import { MentionDrawer } from "./_components/MentionDrawer";
import { OverviewTab } from "./_components/OverviewTab";
import { SettingsTab } from "./_components/SettingsTab";
import { useSummary } from "./_components/ui";
import s from "./reputation.module.css";

type TabKey = "feed" | "overview" | "settings";
const TAB_KEYS: TabKey[] = ["feed", "overview", "settings"];
const parseTab = (v: string | null): TabKey => (TAB_KEYS.includes(v as TabKey) ? (v as TabKey) : "feed");

const TITLE: Record<TabKey, string> = { feed: "Reputation", overview: "Overview", settings: "Listening setup" };
const SUBTITLE: Record<TabKey, string> = {
  feed: "Reviews, comments and mentions of PROMUNCH across the web, newest first.",
  overview: "How people feel about PROMUNCH and what they talk about.",
  settings: "Where we listen, what counts as a mention, and who gets alerts.",
};

export default function ReputationPage() {
  return (
    <Suspense fallback={null}>
      <ReputationInner />
    </Suspense>
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
  const total = week.data?.total ?? null;
  const summary =
    tab === "feed" && unanswered > 0 ? (
      <>
        <b>
          {unanswered} negative {unanswered === 1 ? "mention needs" : "mentions need"} a reply
        </b>{" "}
        from the last 7 days.
      </>
    ) : tab === "feed" && total != null ? (
      <>
        <b>{total} {total === 1 ? "mention" : "mentions"}</b> in the last 7 days. Nothing negative is waiting for a reply.
      </>
    ) : (
      SUBTITLE[tab]
    );

  return (
    <div className={s.page}>
      <PageHeader
        crumb="Reputation"
        title={TITLE[tab]}
        summary={summary}
        actions={
          tab === "settings" ? undefined : (
            <button type="button" className="pm-btn ghost" onClick={toSettings} title="Sources, keywords and alerts">
              <Settings2 size={15} /> Setup
            </button>
          )
        }
      />
      <div className={s.body}>
        {tab === "feed" && <FeedTab onOpen={open} onSettings={toSettings} />}
        {tab === "overview" && <OverviewTab onSettings={toSettings} />}
        {tab === "settings" && <SettingsTab />}
      </div>
      {mentionId && <MentionDrawer key={mentionId} id={mentionId} onClose={close} />}
    </div>
  );
}
