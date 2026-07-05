"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Search, Play, RefreshCw, Settings2, X, BookOpen, ChevronRight,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import styles from "./leads.module.css";
import type { ApiResponse, Lead } from "@/components/leads/types";
import { GUIDE_DISMISS_KEY, GUIDE_STEPS, PROCESSING_STATUSES, TABS } from "@/components/leads/constants";
import Kpi from "@/components/leads/Kpi";
import LeadTable from "@/components/leads/LeadTable";
import ScrapeList from "@/components/leads/ScrapeList";
import ScrapeDetailBar from "@/components/leads/ScrapeDetailBar";
import SearchModal from "@/components/leads/SearchModal";
import SettingsModal from "@/components/leads/SettingsModal";
import GuideModal from "@/components/leads/GuideModal";
import LeadModal from "@/components/leads/LeadModal";

export default function LeadsPage() {
  const toast = useToast();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("scrapes");
  const [selectedSearchId, setSelectedSearchId] = useState<string | null>(null);
  const [q, setQ] = useState("");
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

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      const statuses = TABS.find((t) => t.key === tab)?.statuses ?? [];
      if (statuses.length) params.set("statuses", statuses.join(","));
      if (tab === "scrapes" && selectedSearchId) params.set("searchId", selectedSearchId);
      // Every lead must have an email — hide no-email leads everywhere except the
      // Skipped tab (which exists to show what was filtered out).
      if (tab !== "skipped") params.set("hasEmail", "1");
      if (q) params.set("q", q);
      const res = await fetch(`/api/leads?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json()).error || "load failed");
      const json = (await res.json()) as ApiResponse;
      setData(json);
      setSelected((prev) => (prev ? json.leads.find((l) => l.id === prev.id) ?? prev : prev));
    } catch (e) {
      toast.push({ kind: "error", text: `Could not load leads: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setLoading(false);
    }
  }, [tab, q, selectedSearchId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function runPipeline(rounds: number) {
    setRunning(true);
    try {
      for (let i = 1; i <= rounds; i++) {
        setRunProgress(`${i}/${rounds}…`);
        const res = await fetch("/api/leads/tick", { method: "POST" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "tick failed");
        await load();
        if (!json.discovered && !json.crawled && !json.drafted) break;
      }
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
  const tabCount = (t: { statuses: string[] }) =>
    t.statuses.length ? t.statuses.reduce((a, s) => a + (counts[s] ?? 0), 0) : totalLeads;

  return (
    <div className="pm-page">
      <div className="pm-head">
        <div>
          <h1>B2B Leads</h1>
          <p>
            {running
              ? `Working… finding emails and writing drafts ${runProgress}`
              : processing > 0
                ? `${processing} leads still processing — hit “Keep going” to push them along.`
                : "Find companies → we find emails & draft → you review and send."}
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
          <button type="button" className="pm-btn" onClick={load} aria-label="Refresh">
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
        <Kpi label="Drafts to review" value={counts.drafted ?? 0} />
        <Kpi
          label="Sent today"
          value={`${data?.sentToday ?? 0}/${data?.settings?.daily_cap ?? "—"}`}
          accent={data?.settings?.paused ? "Paused" : undefined}
        />
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
                onClick={() => { setTab(t.key); setSelectedSearchId(null); }}
              >
                {t.label} ({t.key === "scrapes" ? (data?.searches.length ?? 0) : tabCount(t)})
              </button>
            ))}
          </div>
        </div>
        {tab === "scrapes" && !selectedSearchId ? null : (
          <input
            className={`input ${styles.searchInput}`}
            placeholder="Search name or domain…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        )}
      </div>

      {tab === "scrapes" && !selectedSearchId ? (
        <ScrapeList searches={data?.searches ?? []} onOpen={setSelectedSearchId} />
      ) : (
      <>
      {tab === "scrapes" && selectedSearchId ? (
        <ScrapeDetailBar
          search={data?.searches.find((s) => s.id === selectedSearchId)}
          count={data?.leads.length ?? 0}
          onBack={() => setSelectedSearchId(null)}
        />
      ) : null}
      <LeadTable
        data={data}
        loading={loading}
        totalLeads={totalLeads}
        tab={tab}
        selectedSearchId={selectedSearchId}
        setSelected={setSelected}
        setShowSearch={setShowSearch}
        setShowGuide={setShowGuide}
      />
      </>
      )}

      {showSearch && (
        <SearchModal
          onClose={() => setShowSearch(false)}
          onQueued={(rounds) => {
            setShowSearch(false);
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
        <LeadModal lead={selected} onClose={() => setSelected(null)} onChanged={load} />
      )}
    </div>
  );
}
