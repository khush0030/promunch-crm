"use client";

// B2B & deals, rebuilt to the prototype (docs/plans/2026-10-07-app-redesign/
// b2b.html; audit docs/audits/2026-10-09-b2b-deals-fidelity.md). One guided
// flow: Find → Score + emails → Review + send → Follow-ups → Replies → Deals.
// Tabs are real URLs (?tab=) listed in the shell nav as the B2B section tabs:
// Overview · Lists · Review · Replies · Deals; Find and Setup are sub pages.
// Every API call is the one the old page made, with the same body.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Plus, Search, Send, Settings2 } from "lucide-react";
import { PageHeader } from "@/components/pm";
import { useToast } from "@/components/ui/Toast";
import type { ApiResponse, Lead, ListSummary } from "@/components/leads/types";
import OverviewView, { nextStep, type B2bTab, type DealsSummary } from "@/components/leads/OverviewView";
import ListsView from "@/components/leads/ListsView";
import ListDetail from "@/components/leads/ListDetail";
import FindView from "@/components/leads/FindView";
import ReviewView from "@/components/leads/ReviewView";
import RepliesView from "@/components/leads/RepliesView";
import SetupView from "@/components/leads/SetupView";
import SettingsModal from "@/components/leads/SettingsModal";
import LeadModal from "@/components/leads/LeadModal";
import CampaignWizard from "@/components/leads/CampaignWizard";
import { flowCounts, nf } from "@/components/leads/stages";
import { listLabel } from "@/components/leads/format";
import { BUCKET_OF, DEFAULT_HIDDEN_KINDS } from "@/components/deals/constants";
import type { DealsResponse } from "@/components/deals/types";
import b from "@/components/leads/b2b.module.css";

const TABS: B2bTab[] = ["overview", "lists", "find", "review", "replies", "setup"];

export default function LeadsPage() {
  return (
    <Suspense fallback={null}>
      <B2bPage />
    </Suspense>
  );
}

function B2bPage() {
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const rawTab = params.get("tab") as B2bTab | null;
  const tab: B2bTab = rawTab && TABS.includes(rawTab) ? rawTab : "overview";
  const openListId = tab === "lists" ? params.get("list") : null;

  const [data, setData] = useState<ApiResponse | null>(null);
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [listsLoading, setListsLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState("");
  const [campaignListId, setCampaignListId] = useState<string | null>(null);

  // Counts, settings, recent searches and the newest replies.
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/leads?statuses=replied", { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json()).error || "load failed");
      const json = (await res.json()) as ApiResponse;
      setData(json);
      setSelected((prev) => (prev ? json.leads.find((l) => l.id === prev.id) ?? prev : prev));
    } catch (e) {
      toast.push({ kind: "error", text: `Could not load leads: ${e instanceof Error ? e.message : "unknown"}` });
    }
  }, [toast]);

  const loadLists = useCallback(async () => {
    try {
      const res = await fetch("/api/leads/lists", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "load failed");
      setLists(json.lists ?? []);
    } catch (e) {
      toast.push({ kind: "error", text: `Could not load lists: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setListsLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); loadLists(); }, [load, loadLists]);

  // Same query key as the Deals page, so the two share one cache.
  const dealsQ = useQuery({
    queryKey: ["deals"],
    queryFn: async (): Promise<DealsResponse> => {
      const res = await fetch("/api/deals", { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "failed to load deals");
      return d;
    },
    refetchInterval: 120_000,
  });
  const allDeals = useMemo(() => dealsQ.data?.deals ?? [], [dealsQ.data?.deals]);
  const dealsSummary: DealsSummary | null = useMemo(() => {
    if (!dealsQ.data) return null;
    const live = allDeals.filter((d) => !(DEFAULT_HIDDEN_KINDS as string[]).includes(d.kind));
    const open = live.filter((d) => ["inquiries", "discussions", "samples"].includes(BUCKET_OF[d.stage]));
    return {
      open: open.length,
      followUp: open.filter((d) => d.follow_up_needed).length,
      samples: live.filter((d) => BUCKET_OF[d.stage] === "samples").length,
      won: live.filter((d) => d.stage === "won").length,
    };
  }, [dealsQ.data, allDeals]);

  const reloadAll = useCallback(() => {
    load();
    loadLists();
    setReloadKey((k) => k + 1);
  }, [load, loadLists]);

  const go = useCallback((t: B2bTab, extra?: Record<string, string>) => {
    const q = new URLSearchParams();
    if (t !== "overview") q.set("tab", t);
    for (const [k, v] of Object.entries(extra ?? {})) q.set(k, v);
    const qs = q.toString();
    router.push(`/dashboard/leads${qs ? `?${qs}` : ""}`);
  }, [router]);
  const openList = useCallback((id: string) => go("lists", { list: id }), [go]);

  // The browser-driven pipeline ("run next batch"): each tick discovers,
  // scores, finds emails, writes drafts and sends due follow-up steps, exactly
  // as the old "Keep going" button did. The hourly pg_cron does the same.
  async function runPipeline(rounds: number) {
    setRunning(true);
    try {
      for (let i = 1; i <= rounds; i++) {
        setRunProgress(`${i}/${rounds}`);
        const res = await fetch("/api/leads/tick", { method: "POST" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "tick failed");
        if (!json.discovered && !json.crawled && !json.drafted && !json.sequenceSent) break;
        if (i % 3 === 0) { load(); loadLists(); }
      }
      reloadAll();
      toast.push({ kind: "success", text: "Batch done. New emails to review are in Review." });
    } catch (e) {
      toast.push({ kind: "error", text: `Pipeline: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setRunning(false);
      setRunProgress("");
    }
  }

  const c = flowCounts(data?.statusCounts ?? {});
  const sender = data?.settings?.from_name?.split(" ")[0] || "Parth";
  const dailyCap = data?.settings?.daily_cap ?? null;
  const next = nextStep(data);
  const openList_ = openListId ? lists.find((l) => l.id === openListId) ?? null : null;

  const settingsBtn = (
    <Link href="/dashboard/leads?tab=setup" className="pm-btn ghost" aria-label="Outreach setup" title="Sender, follow-ups, email starters, results">
      <Settings2 /> Setup
    </Link>
  );

  let header: { crumb: React.ReactNode; title: React.ReactNode; summary?: React.ReactNode; actions?: React.ReactNode };
  switch (tab) {
    case "lists":
      header = openListId
        ? {
            crumb: <Link href="/dashboard/leads?tab=lists" className={b.back}><ArrowLeft size={14} aria-hidden /> Lists</Link>,
            title: openList_ ? listLabel(openList_.name) : "List",
            summary: openList_ ? (
              <><b>{nf(openList_.leads)} businesses</b>, {nf(openList_.withEmail)} with a work email, {nf(openList_.contacted)} emailed, {nf(openList_.replied)} replied.</>
            ) : null,
            actions: (
              <>
                <button type="button" className="pm-btn primary" onClick={() => openListId && setCampaignListId(openListId)}>
                  <Send /> Email this list
                </button>
                <button type="button" className="pm-btn" onClick={() => go("find")}><Plus /> Find more</button>
              </>
            ),
          }
        : {
            crumb: "B2B & deals",
            title: "Lists",
            summary: <><b>{nf(lists.length)} lists</b> with {nf(c.withEmail)} businesses that have a checked work email. Open one to see every business and its stage.</>,
            actions: <button type="button" className="pm-btn primary" onClick={() => go("find")}><Search /> Find businesses</button>,
          };
      break;
    case "find":
      header = {
        crumb: <Link href="/dashboard/leads?tab=lists" className={b.back}><ArrowLeft size={14} aria-hidden /> Lists</Link>,
        title: "Find businesses",
        summary: <>Pick a type and a city. We find the businesses, score the fit, check their work emails and write a first email for each. <b>Nothing is sent from here.</b></>,
      };
      break;
    case "review":
      header = {
        crumb: "B2B & deals",
        title: "Review",
        summary: c.toReview > 0
          ? <>Read each email once. Nothing sends until you press Send. <b>{nf(c.toReview)} waiting.</b></>
          : <>AI-written emails wait here for you. <b>All caught up.</b></>,
        actions: settingsBtn,
      };
      break;
    case "replies":
      header = {
        crumb: "B2B & deals",
        title: "Replies",
        summary: <>{nf(c.sent + c.replied + c.bounced)} emailed so far. <b>{nf(c.replied)} replied.</b> A reply stops any follow-ups.</>,
      };
      break;
    case "setup":
      header = {
        crumb: <Link href="/dashboard/leads" className={b.back}><ArrowLeft size={14} aria-hidden /> B2B outreach</Link>,
        title: "Outreach setup",
        summary: <>Rarely changed. Sender, daily limit, follow-up campaigns and email starters.</>,
      };
      break;
    default: {
      const primary =
        next === "review" ? <button type="button" className="pm-btn primary" onClick={() => go("review")}>Review {nf(c.toReview)} emails <ArrowRight /></button>
        : next === "check" ? <button type="button" className="pm-btn primary" onClick={() => runPipeline(10)} disabled={running}>{running ? `Working ${runProgress}` : "Run next batch"}</button>
        : next === "replies" ? <button type="button" className="pm-btn primary" onClick={() => go("replies")}>Open {nf(c.replied)} replies</button>
        : <button type="button" className="pm-btn primary" onClick={() => go("find")}><Search /> Find businesses</button>;
      header = {
        crumb: "B2B & deals",
        title: "B2B outreach",
        summary: running
          ? <>Working through the next batch <b>{runProgress}</b>. Keep this tab open.</>
          : <>Find businesses, check the emails, send as {sender}. <b>{nf(c.toReview)} emails</b> are waiting for you.</>,
        actions: (
          <>
            {primary}
            {next !== "find" ? <button type="button" className="pm-btn" onClick={() => go("find")}><Search /> Find</button> : null}
            {settingsBtn}
          </>
        ),
      };
    }
  }

  return (
    <div>
      <PageHeader crumb={header.crumb} title={header.title} summary={header.summary} actions={header.actions} />

      {tab === "overview" && (
        <OverviewView
          data={data}
          lists={lists}
          deals={dealsSummary}
          sender={sender}
          dailyCap={dailyCap}
          onGo={(t) => go(t)}
          onOpenList={openList}
          onOpenLead={setSelected}
          onRun={() => runPipeline(10)}
          running={running}
          runProgress={runProgress}
        />
      )}

      {tab === "lists" && !openListId && (
        <div className={b.body}>
          <ListsView
            lists={lists}
            loading={listsLoading}
            onOpen={openList}
            onEmail={setCampaignListId}
            onChanged={loadLists}
            onFind={() => go("find")}
          />
        </div>
      )}

      {tab === "lists" && openListId && (
        <ListDetail
          key={`${openListId}:${reloadKey}`}
          listId={openListId}
          onOpenLead={setSelected}
          onReview={() => go("review")}
          onListChanged={() => { load(); loadLists(); }}
        />
      )}

      {tab === "find" && (
        <FindView
          searches={data?.searches ?? []}
          lists={lists}
          running={running}
          runProgress={runProgress}
          onQueued={(rounds) => { load(); loadLists(); runPipeline(rounds); }}
          onRun={() => runPipeline(10)}
          onOpenList={openList}
        />
      )}

      {tab === "review" && (
        <ReviewView
          key={reloadKey}
          settings={data?.settings ?? null}
          sentToday={data?.sentToday ?? 0}
          onChanged={load}
          onOpenLead={setSelected}
          onFind={() => go("find")}
          onRun={() => runPipeline(10)}
          running={running}
          writing={c.writing}
        />
      )}

      {tab === "replies" && (
        <RepliesView
          counts={data?.statusCounts ?? {}}
          following={data?.activeEnrollments ?? 0}
          deals={allDeals}
          onOpenLead={setSelected}
          reloadKey={reloadKey}
        />
      )}

      {tab === "setup" && (
        <SetupView
          settings={data?.settings ?? null}
          sentToday={data?.sentToday ?? 0}
          onEditSender={() => setShowSettings(true)}
          onChanged={reloadAll}
        />
      )}

      {showSettings && data?.settings && (
        <SettingsModal
          settings={data.settings}
          onClose={() => setShowSettings(false)}
          onSaved={() => {
            setShowSettings(false);
            load();
          }}
        />
      )}

      {selected && (
        <LeadModal lead={selected} onClose={() => setSelected(null)} onChanged={reloadAll} />
      )}

      {campaignListId && (
        <CampaignWizard
          listId={campaignListId}
          onClose={() => setCampaignListId(null)}
          onDone={() => { setCampaignListId(null); reloadAll(); }}
        />
      )}
    </div>
  );
}
