"use client";

// B2B Leads v2 — organised around saved Lists. Search results become lists;
// lists get enrolled in template-driven email sequences; Analytics reads the
// Resend event stream. Discovery still runs through the browser-driven tick
// loop ("Keep going") with the hourly pg_cron as the hands-free driver.

import { useCallback, useEffect, useState } from "react";
import {
  Search, Play, RefreshCw, Settings2, X, BookOpen, ChevronRight,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import styles from "./leads.module.css";
import type { ApiResponse, Lead, ListSummary } from "@/components/leads/types";
import { GUIDE_DISMISS_KEY, GUIDE_STEPS, PROCESSING_STATUSES, TABS } from "@/components/leads/constants";
import Kpi from "@/components/leads/Kpi";
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
  const [showStrip, setShowStrip] = useState(true);
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState("");

  useEffect(() => {
    setShowStrip(localStorage.getItem(GUIDE_DISMISS_KEY) !== "1");
  }, []);

  function dismissStrip() {
    localStorage.setItem(GUIDE_DISMISS_KEY, "1");
    setShowStrip(false);
  }

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

  return (
    <div className="pm-page">
      <div className="pm-head">
        <div>
          <h1>B2B Leads</h1>
          <p>
            {running
              ? `Working… discovering companies and sending due emails ${runProgress}`
              : processing > 0
                ? `${processing} leads still processing — hit “Keep going” to push them along.`
                : "Find companies, save them as lists, run email sequences."}
          </p>
        </div>
        <div className={styles.toolbar}>
          <button type="button" className="pm-btn primary" onClick={() => setShowSearch(true)}>
            <Search size={14} /> Find companies
          </button>
          <button type="button" className="pm-btn" onClick={() => runPipeline(10)} disabled={running}>
            <Play size={14} /> {running ? `Working ${runProgress}` : "Keep going"}
          </button>
          <button type="button" className="pm-btn ghost" onClick={() => setShowGuide(true)}>
            <BookOpen size={14} /> Guide
          </button>
          <button type="button" className="pm-btn" onClick={() => setShowSettings(true)} aria-label="Settings">
            <Settings2 size={14} />
          </button>
          <button type="button" className="pm-btn" onClick={reloadAll} aria-label="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {showStrip && (
        <div className={styles.strip}>
          <button type="button" className={styles.stripClose} onClick={dismissStrip} aria-label="Hide guide">
            <X size={14} />
          </button>
          <div className={styles.stripSteps}>
            {GUIDE_STEPS.map((s, i) => (
              <div key={s.title} className={styles.stripStep}>
                <s.icon size={18} className={styles.stripIcon} />
                <div>
                  <div className={styles.stripTitle}>{s.title}</div>
                  <div className={styles.stripBlurb}>{s.blurb}</div>
                </div>
                {i < GUIDE_STEPS.length - 1 && <ChevronRight size={16} className={styles.stripArrow} />}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="pm-kpis" style={{ marginBottom: 18 }}>
        <Kpi
          label="Sent today"
          value={`${data?.sentToday ?? 0}/${data?.settings?.daily_cap ?? "—"}`}
          accent={data?.settings?.paused ? "Paused" : undefined}
        />
        <Kpi label="In sequences now" value={data?.activeEnrollments ?? 0} />
        <Kpi label="Replied" value={counts.replied ?? 0} />
        <Kpi label="Total leads" value={totalLeads} />
      </div>

      <div className={styles.tabsRow}>
        <div className={styles.tabsScroll}>
          <div className="pm-tabs" style={{ marginBottom: 0, border: "none" }}>
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`pm-tab${tab === t.key ? " on" : ""}`}
                onClick={() => { setTab(t.key); setOpenListId(null); }}
              >
                {t.label}
                {t.key === "lists" && lists.length ? ` (${lists.length})` : ""}
                {t.key === "replies" && (counts.replied ?? 0) > 0 ? ` (${counts.replied})` : ""}
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
    </div>
  );
}
