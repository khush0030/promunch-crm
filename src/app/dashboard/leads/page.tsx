"use client";

// B2B Leads v2 — organised around saved Lists. Search results become lists;
// lists get enrolled in template-driven email sequences; Analytics reads the
// Resend event stream. Discovery still runs through the browser-driven tick
// loop ("Keep going") with the hourly pg_cron as the hands-free driver.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Search, Play, RefreshCw, Settings2, BookOpen, Send, Repeat, ArrowRight,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import styles from "./leads.module.css";
import type { ApiResponse, Lead, ListSummary } from "@/components/leads/types";
import { PROCESSING_STATUSES, TABS } from "@/components/leads/constants";
import LeadTable from "@/components/leads/LeadTable";
import ListsView from "@/components/leads/ListsView";
import ListDetail from "@/components/leads/ListDetail";
import SequencesView from "@/components/leads/SequencesView";
import TemplatesView from "@/components/leads/TemplatesView";
import AnalyticsView from "@/components/leads/AnalyticsView";
import SearchModal from "@/components/leads/SearchModal";
import SettingsModal from "@/components/leads/SettingsModal";
import GuideModal from "@/components/leads/GuideModal";
import LeadModal from "@/components/leads/LeadModal";
import CampaignWizard from "@/components/leads/CampaignWizard";
import ListPickerModal from "@/components/leads/ListPickerModal";
import { SectionTabs } from "@/components/shell/SectionTabs";

type FlowStep = {
  n: string;
  title: string;
  sub: string;
  subTone?: "warn";
  count: number;
  countTone?: "good";
  onClick: () => void;
};

export default function LeadsPage() {
  const toast = useToast();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [listsLoading, setListsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("lists");
  const [openListId, setOpenListId] = useState<string | null>(null);
  const [listReloadKey, setListReloadKey] = useState(0);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [campaignListId, setCampaignListId] = useState<string | null>(null);

  // KPI numbers + the Replies tab come from the classic leads endpoint.
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/leads?statuses=replied", { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json()).error || "load failed");
      const json = (await res.json()) as ApiResponse;
      setData(json);
      setSelected((prev) => (prev ? json.leads.find((l) => l.id === prev.id) ?? prev : prev));
    } catch (e) {
      toast.push({ kind: "error", text: `Could not load leads: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setLoading(false);
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

  const reloadAll = useCallback(() => {
    load();
    loadLists();
    setListReloadKey((k) => k + 1);
  }, [load, loadLists]);

  async function runPipeline(rounds: number) {
    setRunning(true);
    try {
      for (let i = 1; i <= rounds; i++) {
        setRunProgress(`${i}/${rounds}…`);
        const res = await fetch("/api/leads/tick", { method: "POST" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "tick failed");
        if (!json.discovered && !json.crawled && !json.drafted && !json.sequenceSent) break;
      }
      reloadAll();
      toast.push({ kind: "success", text: "Pipeline run complete." });
    } catch (e) {
      toast.push({ kind: "error", text: `Pipeline: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setRunning(false);
      setRunProgress("");
    }
  }

  const counts = data?.statusCounts ?? {};
  const totalLeads = Object.values(counts).reduce((a, b) => a + b, 0);
  const processing = PROCESSING_STATUSES.reduce((a, s) => a + (counts[s] ?? 0), 0);
  const withEmail = lists.reduce((a, l) => a + l.withEmail, 0);
  const sender = data?.settings?.from_name?.split(" ")[0] || "Parth";
  const dailyCap = data?.settings?.daily_cap;
  const replied = counts.replied ?? 0;

  function goTab(key: string) {
    setTab(key);
    setOpenListId(null);
  }

  // The six steps of the outreach flow. Each one opens the place that step
  // lives (modal or tab); nothing here sends or runs anything.
  const flow: FlowStep[] = [
    { n: "1", title: "Find", sub: "Pick a business type and city", count: totalLeads, onClick: () => setShowSearch(true) },
    { n: "2", title: "Save as a list", sub: `${lists.length} lists · work emails found`, count: withEmail, onClick: () => goTab("lists") },
    { n: "3", title: "Review emails", sub: "Pick a list, preview each email", count: counts.drafted ?? 0, onClick: () => setShowPicker(true) },
    {
      n: "4",
      title: `Send as ${sender}`,
      sub: data?.settings?.paused ? "Paused" : dailyCap ? `Up to ${dailyCap} a day, spread out` : "Spread out over the day",
      subTone: data?.settings?.paused ? "warn" : undefined,
      count: counts.contacted ?? 0,
      onClick: () => goTab("sequences"),
    },
    { n: "auto", title: "Follow-ups", sub: "Automatic until someone replies", count: data?.activeEnrollments ?? 0, onClick: () => goTab("sequences") },
    { n: "5", title: "Replies become deals", sub: "Reply, then track it in Deals", count: replied, countTone: replied > 0 ? "good" : undefined, onClick: () => goTab("replies") },
  ];

  return (
    <div className={`pm-page ${styles.page}`}>
      <div className={`pm-head ${styles.head}`}>
        <div>
          <h1>B2B outreach</h1>
          <p>
            {running
              ? `Working… discovering companies and sending due emails ${runProgress}`
              : processing > 0
                ? `${processing} leads still processing. Hit “Keep going” to push them along.`
                : `Find businesses, save them as lists, email them as ${sender}. Replies are tracked for you.`}
          </p>
        </div>
        <div className={styles.headActs}>
          <button type="button" className={`pm-btn primary ${styles.headPrimary}`} onClick={() => setShowPicker(true)}>
            <Send size={14} /> New email campaign
          </button>
          <button type="button" className="pm-btn" onClick={() => setShowSearch(true)}>
            <Search size={14} /> Find companies
          </button>
          <button type="button" className="pm-btn" onClick={() => runPipeline(10)} disabled={running}>
            <Play size={14} /> {running ? `Working ${runProgress}` : "Keep going"}
          </button>
          <span className={styles.iconActs}>
            <button type="button" className={`pm-btn ghost ${styles.iconBtn}`} onClick={() => setShowGuide(true)} aria-label="Guide" title="Guide">
              <BookOpen size={16} />
            </button>
            <button type="button" className={`pm-btn ghost ${styles.iconBtn}`} onClick={() => setShowSettings(true)} aria-label="Settings" title="Sender and daily limit">
              <Settings2 size={16} />
            </button>
            <button type="button" className={`pm-btn ghost ${styles.iconBtn}`} onClick={reloadAll} aria-label="Refresh" title="Refresh">
              <RefreshCw size={16} />
            </button>
          </span>
        </div>
      </div>
      <SectionTabs />

      <section className={styles.flowCard} aria-label="How outreach flows">
        <div className={styles.secHead}>
          <h3>How it flows</h3>
          <Link href="/dashboard/deals" className={styles.txtLink}>
            Deals <ArrowRight size={14} />
          </Link>
        </div>
        <ol className={styles.flow}>
          {flow.map((f) => (
            <li key={f.title}>
              <button type="button" className={styles.flowStep} onClick={f.onClick}>
                <span className={styles.flowNum} data-auto={f.n === "auto" ? "true" : undefined}>
                  {f.n === "auto" ? <Repeat size={13} /> : f.n}
                </span>
                <span className={styles.flowText}>
                  <b>{f.title}</b>
                  <span data-tone={f.subTone}>{f.sub}</span>
                </span>
                <span className={styles.flowCount} data-tone={f.countTone}>{f.count}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>

      <div className={styles.statLine}>
        <div>
          <b>
            {data?.sentToday ?? 0}
            <small>/{dailyCap ?? "—"}</small>
          </b>
          <span>
            sent today
            {data?.settings?.paused ? <em className={styles.statWarn}> · paused</em> : null}
          </span>
        </div>
        <div><b>{data?.activeEnrollments ?? 0}</b><span>in campaigns now</span></div>
        <div><b data-tone={replied > 0 ? "good" : undefined}>{replied}</b><span>replied</span></div>
        <div><b>{totalLeads}</b><span>total leads</span></div>
      </div>

      <div className={styles.tabsRow}>
        <div className={styles.tabsScroll}>
          <div className={`pm-tabs ${styles.tabs}`}>
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`pm-tab${tab === t.key ? " on" : ""}`}
                onClick={() => goTab(t.key)}
              >
                {t.label}
                {t.key === "lists" && lists.length ? <span className={styles.tabN}>{lists.length}</span> : null}
                {t.key === "replies" && replied > 0 ? <span className={styles.tabN}>{replied}</span> : null}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === "lists" && !openListId && (
        <ListsView
          lists={lists}
          loading={listsLoading}
          onOpen={setOpenListId}
          onEmail={setCampaignListId}
          onChanged={loadLists}
          onFind={() => setShowSearch(true)}
        />
      )}

      {tab === "lists" && openListId && (
        <ListDetail
          key={`${openListId}:${listReloadKey}`}
          listId={openListId}
          onBack={() => { setOpenListId(null); loadLists(); }}
          onOpenLead={setSelected}
        />
      )}

      {tab === "sequences" && <SequencesView onChanged={reloadAll} />}

      {tab === "templates" && <TemplatesView onChanged={reloadAll} />}

      {tab === "replies" && (
        <LeadTable
          data={data}
          loading={loading}
          totalLeads={totalLeads}
          tab="replies"
          selectedSearchId={null}
          setSelected={setSelected}
          setShowSearch={setShowSearch}
          setShowGuide={setShowGuide}
        />
      )}

      {tab === "analytics" && <AnalyticsView />}

      {showSearch && (
        <SearchModal
          onClose={() => setShowSearch(false)}
          onQueued={(rounds) => {
            setShowSearch(false);
            setTab("lists");
            setOpenListId(null);
            runPipeline(rounds);
          }}
        />
      )}

      {showGuide && <GuideModal onClose={() => setShowGuide(false)} />}

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

      {showPicker && (
        <ListPickerModal
          lists={lists}
          onClose={() => setShowPicker(false)}
          onFind={() => setShowSearch(true)}
          onPick={(id) => { setShowPicker(false); setCampaignListId(id); }}
        />
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
