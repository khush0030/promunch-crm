"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Search, Play, RefreshCw, Settings2, Send, Trash2, Sparkles, Ban, MailCheck, Plus, X,
  BookOpen, ChevronRight, ChevronLeft, MapPin, MailSearch, PenLine, CheckCircle2, Gauge, Clock,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import styles from "./leads.module.css";

type Contact = {
  id: string;
  email: string;
  source: string;
  source_url: string | null;
  kind: string;
  role_hint: string | null;
  verify_status: string;
  confidence: string;
  is_primary: boolean;
};

type Draft = {
  id: string;
  contact_id: string;
  subject: string;
  body_text: string;
  status: string;
  edited: boolean;
  error: string | null;
  sent_at: string | null;
};

type Lead = {
  id: string;
  name: string;
  website: string | null;
  domain: string | null;
  address: string | null;
  city: string | null;
  category: string | null;
  status: string;
  fit_score: number | null;
  fit_reason: string | null;
  enrichment: Enrichment | null;
  enriched_at: string | null;
  products: string[] | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  lead_contacts: Contact[];
  outreach_drafts: Draft[];
  outreach_replies: Reply[];
};

type Reply = {
  id: string;
  from_email: string | null;
  from_name: string | null;
  subject: string | null;
  body_text: string | null;
  received_at: string;
};

type Enrichment = {
  summary?: string;
  scale?: string;
  fitAngle?: string;
  decisionMaker?: string;
  talkingPoints?: string[];
};

type SearchRow = {
  id: string;
  category: string;
  city: string;
  status: string;
  pages_fetched: number;
  results_count: number;
  email_count: number;
  products: string[] | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

type OutreachSettings = {
  daily_cap: number;
  paused: boolean;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  footer_address: string;
};

type ApiResponse = {
  leads: Lead[];
  total: number;
  statusCounts: Record<string, number>;
  searches: SearchRow[];
  sentToday: number;
  settings: OutreachSettings | null;
};

const STATUS_PILL: Record<string, { cls: string; label: string }> = {
  new: { cls: "bg-gray", label: "Queued" },
  crawling: { cls: "bg-gold", label: "Crawling" },
  ready: { cls: "bg-gold", label: "Needs draft" },
  no_contacts: { cls: "bg-gray", label: "No contacts" },
  no_website: { cls: "bg-gray", label: "No website" },
  listed: { cls: "bg-gray", label: "Listed (no email)" },
  drafting: { cls: "bg-gold", label: "Drafting" },
  drafted: { cls: "bg-green", label: "Review draft" },
  contacted: { cls: "bg-green", label: "Sent" },
  replied: { cls: "bg-green", label: "Replied" },
  bounced: { cls: "bg-terra", label: "Bounced" },
  suppressed: { cls: "bg-terra", label: "Suppressed" },
};

const CONFIDENCE_PILL: Record<string, string> = { high: "bg-green", medium: "bg-gold", low: "bg-gray" };

// Simple workflow tabs instead of one tab per raw status.
const TABS: { key: string; label: string; statuses: string[] }[] = [
  { key: "scrapes", label: "Scrapes", statuses: [] },
  { key: "review", label: "To review", statuses: ["drafted"] },
  { key: "replies", label: "Replies", statuses: ["replied"] },
  { key: "sent", label: "Sent", statuses: ["contacted", "replied", "bounced"] },
  { key: "all", label: "All leads", statuses: [] },
  { key: "skipped", label: "Skipped", statuses: ["no_contacts", "no_website", "listed", "suppressed"] },
];

const PROCESSING_STATUSES = ["new", "crawling", "ready", "drafting"];

const DEFAULT_CATEGORIES = [
  "corporate gifting company",
  "airline catering service",
  "corporate office",
  "business hotel",
  "coworking space",
  "event management company",
];

const DEFAULT_CITIES = ["Mumbai", "Delhi", "Bangalore", "Gurgaon", "Pune", "Hyderabad"];

// PROMUNCH products a scrape can be aimed at (drives the cold-email pitch).
const PRODUCT_OPTIONS = ["Edamame", "Soya Crunchies", "Soya Sticks", "Soya Chips"];

// Plain-language walkthrough of the whole pipeline, shown in the strip + Guide modal.
const GUIDE_STEPS: { icon: typeof MapPin; title: string; blurb: string }[] = [
  {
    icon: MapPin,
    title: "1. Find companies",
    blurb: "Pick the kinds of business you sell to (corporate gifting, vending, hotels…) and the cities. We search Google for matching companies.",
  },
  {
    icon: MailSearch,
    title: "2. We find the emails",
    blurb: "The pipeline visits each company's site, pulls real email addresses, verifies them, and an AI scores how good a fit they are (0–100) with a reason.",
  },
  {
    icon: PenLine,
    title: "3. AI writes the email",
    blurb: "For good-fit leads with a verified email, AI drafts a personal cold email grounded in the PROMUNCH knowledge base. Drafts land in “To review”.",
  },
  {
    icon: CheckCircle2,
    title: "4. Review & send",
    blurb: "Open a lead, tweak the subject or body if you want, then hit Approve & send. Replies come to your inbox — mark them “Replied” here.",
  },
];

const GUIDE_DISMISS_KEY = "leads_guide_dismissed_v1";

function fitPill(score: number | null): { cls: string; label: string } {
  if (score == null) return { cls: "bg-gray", label: "—" };
  if (score >= 70) return { cls: "bg-green", label: String(score) };
  if (score >= 50) return { cls: "bg-gold", label: String(score) };
  return { cls: "bg-terra", label: String(score) };
}

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
      {data && data.leads.length > 0 ? (
        <>
        <div className={`pm-tablewrap ${styles.tableWrap}`} style={{ opacity: loading ? 0.7 : 1, transition: "opacity 0.2s" }}>
          <table className="pm-tbl">
            <thead>
              <tr>
                <th style={{ width: 60 }}>Fit</th>
                <th>Company</th>
                <th>Why this fit</th>
                <th>Contact</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.leads.map((lead) => {
                const sp = STATUS_PILL[lead.status] || { cls: "bg-gray", label: lead.status };
                const fp = fitPill(lead.fit_score);
                const best = bestContact(lead);
                return (
                  <tr key={lead.id} className="clickable" onClick={() => setSelected(lead)}>
                    <td>
                      <span className={`pm-badge2 ${fp.cls}`} title="ProMunch fit score (AI, 0–100)">{fp.label}</span>
                    </td>
                    <td>
                      <div className="pm-cellname">
                        <span className="pm-b7">{lead.name}</span>
                      </div>
                      <div className="pm-dim">
                        {[lead.domain, lead.city].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </td>
                    <td className="pm-muted" style={{ fontSize: 12.5, maxWidth: 260 }}>
                      {lead.fit_reason ?? "—"}
                    </td>
                    <td>
                      {best ? (
                        <span>
                          <span className="mono" style={{ fontSize: 12.5 }}>{best.email}</span>{" "}
                          <span className={`pm-badge2 ${CONFIDENCE_PILL[best.confidence] ?? "bg-gray"}`}>
                            {best.confidence}
                          </span>
                        </span>
                      ) : (
                        <span className="pm-muted">—</span>
                      )}
                    </td>
                    <td>
                      <span className={`pm-badge2 ${sp.cls}`}>{sp.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className={styles.cards}>
          {data.leads.map((lead) => {
            const sp = STATUS_PILL[lead.status] || { cls: "bg-gray", label: lead.status };
            const fp = fitPill(lead.fit_score);
            const best = bestContact(lead);
            return (
              <div key={lead.id} className={styles.cardRow} onClick={() => setSelected(lead)}>
                <div className={styles.cardTop}>
                  <div>
                    <div className={styles.cardName}>{lead.name}</div>
                    <div className={styles.cardMeta}>
                      {[lead.domain, lead.city].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <span className={`pm-badge2 ${fp.cls}`}>fit {fp.label}</span>
                </div>
                {lead.fit_reason ? <div className={styles.cardReason}>{lead.fit_reason}</div> : null}
                <div className={styles.cardFoot}>
                  {best ? (
                    <span className={styles.cardEmail}>
                      {best.email}{" "}
                      <span className={`pm-badge2 ${CONFIDENCE_PILL[best.confidence] ?? "bg-gray"}`}>
                        {best.confidence}
                      </span>
                    </span>
                  ) : (
                    <span className="pm-muted" style={{ fontSize: 12 }}>no contact</span>
                  )}
                  <span className={`pm-badge2 ${sp.cls}`}>{sp.label}</span>
                </div>
              </div>
            );
          })}
        </div>
        </>
      ) : (
        loading ? (
          <div className="pm-empty">Loading…</div>
        ) : totalLeads === 0 ? (
          <div className={styles.getStarted}>
            <div className={styles.getStartedTitle}>Let’s find your first leads</div>
            <p className={styles.getStartedText}>
              Tell us the kind of businesses you sell to and where. We find the companies,
              dig up real email addresses, and an AI writes a personal first email for each —
              you just review and send.
            </p>
            <div className={styles.getStartedActions}>
              <button type="button" className="pm-btn primary" onClick={() => setShowSearch(true)}>
                <Search size={14} /> Find companies
              </button>
              <button type="button" className="pm-btn ghost" onClick={() => setShowGuide(true)}>
                <BookOpen size={14} /> How it works
              </button>
            </div>
          </div>
        ) : (
          <div className="pm-empty">
            {tab === "scrapes" && selectedSearchId
              ? "This scrape produced no leads yet — it may still be running."
              : tab === "review"
                ? "No drafts waiting. Click “Find companies” or “Keep going” — drafts appear here for approval."
                : tab === "replies"
                  ? "No replies yet. When someone replies to a cold email, it lands here automatically."
                  : "Nothing in this tab yet."}
          </div>
        )
      )}
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

function Kpi({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="pm-kpi">
      <div className="pm-muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600 }}>
        {value}
        {accent ? <span className="pm-badge2 bg-terra" style={{ marginLeft: 8 }}>{accent}</span> : null}
      </div>
    </div>
  );
}

function bestContact(lead: Lead): Contact | null {
  const contacts = lead.lead_contacts ?? [];
  return contacts.find((c) => c.is_primary) ?? contacts[0] ?? null;
}

// The three pipeline stages, with each lead's progress through them.
function PipelineSteps({ lead }: { lead: Lead }) {
  const hasSite = !!lead.website;
  const analyzed = lead.fit_score != null;
  const emailFound = (lead.lead_contacts ?? []).some((c) => c.verify_status === "mx_ok");
  const enriched = !!(lead.enrichment && (lead.enrichment.summary || lead.enrichment.fitAngle));
  const steps: { label: string; done: boolean; skipped?: boolean }[] = [
    { label: "1. Analysis", done: analyzed },
    { label: "2. Email finding", done: emailFound, skipped: !hasSite },
    { label: "3. Enrichment", done: enriched, skipped: !hasSite },
  ];
  return (
    <div className={styles.steps}>
      {steps.map((s) => (
        <div key={s.label} className={`${styles.step} ${s.done ? styles.stepDone : s.skipped ? styles.stepSkip : styles.stepWait}`}>
          {s.done ? <CheckCircle2 size={13} /> : s.skipped ? <Ban size={13} /> : <Clock size={13} />}
          <span>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

// ----------------------------------------------------------- search modal --

const COUNT_PRESETS = [25, 50, 100, 200];

function fmtDuration(sec: number): string {
  if (sec < 90) return `${Math.max(15, Math.round(sec / 5) * 5)} sec`;
  return `${Math.round(sec / 60)} min`;
}

// Honest estimate. When findEmails is on, `target` is the number of leads WITH
// an email; ~40% of crawled companies yield one, so we scan ~2.5x that many
// (capped at the Places 60/search max). One tick = 1 discovery page + up to 5
// crawls + 5 drafts. Returns expected email-leads, scan size, time, and ticks.
const EMAIL_YIELD = 0.4;
function planScrape(target: number, combos: number, findEmails: boolean) {
  const maxScan = 60 * combos; // Places caps each search at ~60
  const wantScan = findEmails ? Math.ceil(target / EMAIL_YIELD) : target;
  const scan = Math.max(combos, Math.min(wantScan, maxScan));
  const perCombo = Math.min(60, Math.ceil(scan / combos));
  const actualScan = Math.min(scan, perCombo * combos);
  const expectedEmails = findEmails ? Math.round(actualScan * EMAIL_YIELD) : actualScan;
  const discoverPages = combos * Math.ceil(perCombo / 20);

  let lo = discoverPages * 2.5;
  let hi = discoverPages * 4;
  if (findEmails) {
    lo += actualScan * 5 + expectedEmails * 3; // crawl+MX + drafting the hits
    hi += actualScan * 11 + expectedEmails * 5;
  }

  const crawlRounds = findEmails ? Math.ceil(actualScan / 5) : 0;
  const draftRounds = findEmails ? Math.ceil(expectedEmails / 5) : 0;
  const rounds = Math.min(150, discoverPages + crawlRounds + draftRounds + 3);

  // capped = couldn't scan enough companies to likely reach the email target.
  const capped = findEmails && wantScan > maxScan;
  return { actualScan, expectedEmails, capped, lo, hi, rounds };
}

function SearchModal({ onClose, onQueued }: { onClose: () => void; onQueued: (rounds: number) => void }) {
  const toast = useToast();
  const [categories, setCategories] = useState<string[]>([DEFAULT_CATEGORIES[0]]);
  const [cities, setCities] = useState<string[]>([DEFAULT_CITIES[0]]);
  const [customCategory, setCustomCategory] = useState("");
  const [target, setTarget] = useState(50);
  const [findEmails, setFindEmails] = useState(true);
  const [products, setProducts] = useState<string[]>([]);
  const [offer, setOffer] = useState("");
  const [subjectHint, setSubjectHint] = useState("");
  const [busy, setBusy] = useState(false);

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  }

  const allCats = customCategory.trim() ? [...categories, customCategory.trim()] : categories;
  const combos = Math.max(1, allCats.length * cities.length);
  const plan = planScrape(target || 1, combos, findEmails);

  async function submit() {
    const cats = [...categories];
    if (customCategory.trim()) cats.push(customCategory.trim());
    if (!cats.length || !cities.length) {
      toast.push({ kind: "error", text: "Pick at least one category and one city." });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/leads/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categories: cats, cities, maxResults: target, findEmails, products, offer, subjectHint }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "failed");
      toast.push({
        kind: "success",
        text: findEmails
          ? `Finding ~${plan.expectedEmails} leads with email (scanning ${plan.actualScan} companies) — about ${fmtDuration(plan.lo)}–${fmtDuration(plan.hi)}.`
          : `Scraping up to ${plan.actualScan} companies — about ${fmtDuration(plan.lo)}–${fmtDuration(plan.hi)}.`,
      });
      onQueued(plan.rounds);
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : "Search failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={`pm-panel ${styles.modal} ${styles.modalMd}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <div className="card-title">Find companies</div>
          <button type="button" className="pm-btn" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <p className={styles.modalIntro}>
          Pick who you sell to and where. Each category × city is one Google search (up to ~60 companies).
          Start small — 1–2 categories and cities — then hit “Find”.
        </p>

        <div className={styles.fieldGroup}>
          <div className={styles.fieldLabel}>Categories</div>
          <div className="pm-chips" style={{ flexWrap: "wrap" }}>
            {DEFAULT_CATEGORIES.map((c) => (
              <button key={c} type="button" className={`pm-chip${categories.includes(c) ? " on" : ""}`} onClick={() => toggle(categories, setCategories, c)}>
                {c}
              </button>
            ))}
          </div>
          <input
            className={`input ${styles.customInput}`}
            placeholder="Custom category (e.g. 'corporate caterer')"
            value={customCategory}
            onChange={(e) => setCustomCategory(e.target.value)}
          />
        </div>

        <div className={styles.fieldGroup}>
          <div className={styles.fieldLabel}>Cities</div>
          <div className="pm-chips" style={{ flexWrap: "wrap" }}>
            {DEFAULT_CITIES.map((c) => (
              <button key={c} type="button" className={`pm-chip${cities.includes(c) ? " on" : ""}`} onClick={() => toggle(cities, setCities, c)}>
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.fieldGroup}>
          <div className={styles.fieldLabel}>{findEmails ? "How many leads (with email)?" : "How many companies?"}</div>
          <div className={styles.countRow}>
            {COUNT_PRESETS.map((n) => (
              <button key={n} type="button" className={`pm-chip${target === n ? " on" : ""}`} onClick={() => setTarget(n)}>
                {n}
              </button>
            ))}
            <input
              className={`input ${styles.countInput}`}
              type="number"
              min={1}
              max={3600}
              value={target}
              onChange={(e) => setTarget(Math.max(1, Math.min(3600, parseInt(e.target.value || "1"))))}
              aria-label="Custom lead count"
            />
          </div>
        </div>

        <div className={styles.fieldGroup}>
          <div className={styles.fieldLabel}>Which product(s) is this for? <span className="pm-muted">(optional — the email leads with these)</span></div>
          <div className="pm-chips" style={{ flexWrap: "wrap" }}>
            {PRODUCT_OPTIONS.map((p) => (
              <button key={p} type="button" className={`pm-chip${products.includes(p) ? " on" : ""}`} onClick={() => toggle(products, setProducts, p)}>
                {p}
              </button>
            ))}
          </div>
        </div>

        <label className={styles.toggleCard}>
          <input type="checkbox" checked={findEmails} onChange={(e) => setFindEmails(e.target.checked)} />
          <span className={styles.toggleCopy}>
            <b>Find email addresses</b> — crawl each company’s site for verified emails and draft a cold email.
            <span className={styles.toggleHint}>Turn off to just collect the company list (much faster); you can enrich any lead later.</span>
          </span>
        </label>

        {findEmails ? (
          <div className={styles.fieldGroup}>
            <div className={styles.fieldLabel}>What are you pitching? <span className="pm-muted">(optional, steers the AI)</span></div>
            <textarea
              className="input"
              rows={2}
              placeholder="e.g. Our new edamame snack as a healthy corporate gifting hamper — free sample box + 15-min call."
              value={offer}
              onChange={(e) => setOffer(e.target.value)}
              maxLength={400}
            />
            <input
              className={`input ${styles.customInput}`}
              placeholder="Subject line idea (optional) — e.g. 'A healthier snack for your gift hampers'"
              value={subjectHint}
              onChange={(e) => setSubjectHint(e.target.value)}
              maxLength={160}
            />
            <div className={styles.toggleHint} style={{ marginTop: 6 }}>
              Leave blank and the AI picks the best angle from your knowledge base. Anything you write here leads the email; product facts still come only from the KB.
            </div>
          </div>
        ) : null}

        <div className={styles.estimate}>
          <div className={styles.estimateMain}>
            <Clock size={15} className={styles.estimateIcon} />
            <span>
              {findEmails ? (
                <>Estimated <b>{fmtDuration(plan.lo)}–{fmtDuration(plan.hi)}</b> to find <b>~{plan.expectedEmails} leads with email</b> (scanning <b>{plan.actualScan}</b> companies across <b>{combos}</b> search{combos > 1 ? "es" : ""}).</>
              ) : (
                <>Estimated <b>{fmtDuration(plan.lo)}–{fmtDuration(plan.hi)}</b> to list <b>{plan.actualScan}</b> companies across <b>{combos}</b> search{combos > 1 ? "es" : ""}.</>
              )}
            </span>
          </div>
          {plan.capped ? (
            <div className={styles.estimateNote}>
              Google caps each search at ~60 companies, so this can find about {plan.expectedEmails} with email. Add more cities or categories to get more.
            </div>
          ) : null}
          <div className={styles.estimateNote}>
            Runs in your browser — keep this tab open. It also continues automatically every night.
          </div>
        </div>

        <div className={styles.modalActions}>
          <button type="button" className="pm-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="pm-btn primary" onClick={submit} disabled={busy}>
            <Search size={14} /> {busy ? "Starting…" : "Find companies"}
          </button>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------- settings modal --

function SettingsModal({
  settings, onClose, onSaved,
}: { settings: OutreachSettings; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ ...settings, reply_to: settings.reply_to ?? "" });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/leads/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "failed");
      toast.push({ kind: "success", text: "Outreach settings saved." });
      onSaved();
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={`pm-panel ${styles.modal} ${styles.modalSm}`} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div className="card-title">Outreach settings</div>
          <button type="button" className="pm-btn" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <label className="field">
          <span>Daily send cap (warm-up: raise weekly 15 → 30 → 50)</span>
          <input className="input" type="number" min={0} max={500} value={form.daily_cap}
            onChange={(e) => setForm({ ...form, daily_cap: parseInt(e.target.value || "0") })} />
        </label>
        <label className="field">
          <span>From name</span>
          <input className="input" value={form.from_name}
            onChange={(e) => setForm({ ...form, from_name: e.target.value })} />
        </label>
        <label className="field">
          <span>From mailbox (fixed — sends as Parth, founder, on the verified domain)</span>
          <input className="input" value={form.from_email} disabled />
        </label>
        <label className="field">
          <span>Footer address (legal/physical address line)</span>
          <input className="input" value={form.footer_address}
            onChange={(e) => setForm({ ...form, footer_address: e.target.value })} />
        </label>
        <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={form.paused}
            onChange={(e) => setForm({ ...form, paused: e.target.checked })} />
          <span>Pause all sends</span>
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button type="button" className="pm-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="pm-btn" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- lead modal --

function LeadModal({ lead, onClose, onChanged }: { lead: Lead; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const activeDraft = (lead.outreach_drafts ?? []).find((d) =>
    ["draft", "approved", "failed", "sending"].includes(d.status),
  );
  const sentDraft = (lead.outreach_drafts ?? []).find((d) => ["sent", "replied", "bounced"].includes(d.status));
  const [subject, setSubject] = useState(activeDraft?.subject ?? "");
  const [bodyText, setBodyText] = useState(activeDraft?.body_text ?? "");
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const fp = fitPill(lead.fit_score);

  useEffect(() => {
    setSubject(activeDraft?.subject ?? "");
    setBodyText(activeDraft?.body_text ?? "");
  }, [activeDraft?.id, activeDraft?.subject, activeDraft?.body_text]);

  async function call(label: string, url: string, init?: RequestInit): Promise<boolean> {
    setBusy(label);
    try {
      const res = await fetch(url, init);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `${label} failed`);
      onChanged();
      return true;
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : `${label} failed` });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function saveDraftEdits(): Promise<boolean> {
    if (!activeDraft) return true;
    if (subject === activeDraft.subject && bodyText === activeDraft.body_text) return true;
    return call("save", `/api/leads/drafts/${activeDraft.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject, body_text: bodyText }),
    });
  }

  async function approveAndSend() {
    if (!activeDraft) return;
    if (!(await saveDraftEdits())) return;
    if (await call("send", `/api/leads/drafts/${activeDraft.id}/send`, { method: "POST" })) {
      toast.push({ kind: "success", text: `Sent to ${contactEmail(activeDraft.contact_id)}.` });
    }
  }

  function contactEmail(contactId: string): string {
    return lead.lead_contacts.find((c) => c.id === contactId)?.email ?? "contact";
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={`pm-panel ${styles.modal} ${styles.modalLg}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div>
            <div className="card-title">
              {lead.name}{" "}
              <span className={`pm-badge2 ${fp.cls}`} title="ProMunch fit score (AI, 0–100)">fit {fp.label}</span>
            </div>
            <div className="pm-muted" style={{ fontSize: 12.5 }}>
              {[lead.category, lead.city].filter(Boolean).join(" · ")}
              {lead.website ? (
                <>
                  {" · "}
                  <a href={lead.website} target="_blank" rel="noreferrer">{lead.domain ?? "website"}</a>
                </>
              ) : null}
            </div>
            {lead.fit_reason ? (
              <div className="pm-muted" style={{ fontSize: 12.5, marginTop: 4 }}>{lead.fit_reason}</div>
            ) : null}
            {lead.products?.length ? (
              <div className="pm-muted" style={{ fontSize: 12, marginTop: 4 }}>
                Pitching: {lead.products.join(", ")}
              </div>
            ) : null}
          </div>
          <button type="button" className="pm-btn" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        {lead.error ? (
          <div className="pm-muted" style={{ fontSize: 12, color: "var(--amber)" }}>Last error: {lead.error}</div>
        ) : null}

        <div className={styles.actionRow} style={{ marginTop: 12 }}>
          <button
            type="button" className="pm-btn"
            disabled={busy !== null}
            title="Re-run the AI fit score (0–100) from this company's data"
            onClick={async () => {
              if (await call("score", `/api/leads/${lead.id}/score`, { method: "POST" })) {
                toast.push({ kind: "success", text: "Fit score refreshed." });
              }
            }}
          >
            <Gauge size={14} /> {busy === "score" ? "Scoring…" : "Re-score fit"}
          </button>
          <button
            type="button" className="pm-btn"
            disabled={busy !== null || !lead.website}
            title={lead.website ? "Re-crawl the website to find & verify more contacts, then re-score" : "No website to crawl"}
            onClick={async () => {
              if (await call("enrich", `/api/leads/${lead.id}/enrich`, { method: "POST" })) {
                toast.push({ kind: "success", text: "Enriched — re-crawled for contacts and re-scored." });
              }
            }}
          >
            <MailSearch size={14} /> {busy === "enrich" ? "Enriching…" : "Enrich (find contacts)"}
          </button>
        </div>

        <PipelineSteps lead={lead} />

        {lead.enrichment && (lead.enrichment.summary || lead.enrichment.fitAngle) ? (
          <div className={styles.intel}>
            <div className={styles.fieldLabel}>Company intel <span className="pm-muted">(AI enrichment)</span></div>
            {lead.enrichment.summary ? <p className={styles.intelLine}>{lead.enrichment.summary}</p> : null}
            <div className={styles.intelGrid}>
              {lead.enrichment.scale ? <div><span className={styles.intelKey}>Scale</span> {lead.enrichment.scale}</div> : null}
              {lead.enrichment.decisionMaker ? <div><span className={styles.intelKey}>Who to pitch</span> {lead.enrichment.decisionMaker}</div> : null}
              {lead.enrichment.fitAngle ? <div><span className={styles.intelKey}>Best angle</span> {lead.enrichment.fitAngle}</div> : null}
            </div>
            {lead.enrichment.talkingPoints?.length ? (
              <ul className={styles.intelPoints}>
                {lead.enrichment.talkingPoints.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div style={{ fontSize: 12.5, fontWeight: 600, margin: "16px 0 6px" }}>
          Contacts ({(lead.lead_contacts ?? []).length})
        </div>
        {(lead.lead_contacts ?? []).length ? (
          <table className="pm-tbl">
            <thead>
              <tr><th>Email</th><th>Type</th><th>Verified</th><th>Confidence</th><th>Source</th></tr>
            </thead>
            <tbody>
              {lead.lead_contacts.map((c) => (
                <tr key={c.id}>
                  <td className="mono" style={{ fontSize: 12.5 }}>
                    {c.email}
                    {c.is_primary ? <span className="pm-badge2 bg-green" style={{ marginLeft: 6 }}>primary</span> : null}
                  </td>
                  <td className="pm-muted">{c.role_hint ?? c.kind}</td>
                  <td className="pm-muted">{c.verify_status}</td>
                  <td><span className={`pm-badge2 ${CONFIDENCE_PILL[c.confidence] ?? "bg-gray"}`}>{c.confidence}</span></td>
                  <td className="pm-muted">
                    {c.source_url ? (
                      <a href={c.source_url} target="_blank" rel="noreferrer">{c.source}</a>
                    ) : (
                      c.source
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="pm-muted" style={{ fontSize: 12.5 }}>
            No contacts found by the crawler — add one manually (check their site or LinkedIn).
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            className="input"
            style={{ maxWidth: 280 }}
            placeholder="add contact email manually…"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <button
            type="button"
            className="pm-btn"
            disabled={!newEmail.trim() || busy === "contact"}
            onClick={async () => {
              if (
                await call("contact", `/api/leads/${lead.id}/contacts`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ email: newEmail }),
                })
              ) {
                setNewEmail("");
              }
            }}
          >
            <Plus size={14} /> Add
          </button>
        </div>

        {(lead.outreach_replies ?? []).length ? (
          <div className={styles.replies}>
            <div className={styles.fieldLabel}>
              <MailCheck size={13} /> Replies ({lead.outreach_replies.length})
            </div>
            {[...lead.outreach_replies]
              .sort((a, b) => +new Date(b.received_at) - +new Date(a.received_at))
              .map((r) => (
                <div key={r.id} className={styles.replyCard}>
                  <div className={styles.replyHead}>
                    <span className="pm-b7">{r.from_name || r.from_email || "Unknown"}</span>
                    <span className="pm-dim"> · {new Date(r.received_at).toLocaleString()}</span>
                  </div>
                  {r.subject ? <div className={styles.replySubject}>{r.subject}</div> : null}
                  {r.body_text ? <div className={styles.replyBody}>{r.body_text}</div> : null}
                </div>
              ))}
          </div>
        ) : null}

        <div style={{ fontSize: 12.5, fontWeight: 600, margin: "18px 0 6px" }}>Outreach email</div>
        {activeDraft ? (
          <>
            {activeDraft.error ? (
              <div className="pm-muted" style={{ fontSize: 12, color: "var(--amber)", marginBottom: 6 }}>
                Last send error: {activeDraft.error}
              </div>
            ) : null}
            <div className="pm-muted" style={{ fontSize: 12, marginBottom: 6 }}>
              To: <span className="mono">{contactEmail(activeDraft.contact_id)}</span>
              {activeDraft.edited ? " · edited" : ""}
            </div>
            <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
            <textarea
              className="input"
              style={{ marginTop: 8, minHeight: 180, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
            />
            <div className={styles.actionRow}>
              <button type="button" className="pm-btn" onClick={approveAndSend} disabled={busy !== null}>
                <Send size={14} /> {busy === "send" ? "Sending…" : "Approve & send"}
              </button>
              <button
                type="button" className="pm-btn"
                disabled={busy !== null}
                onClick={() => call("regen", `/api/leads/${lead.id}/draft`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) })}
              >
                <Sparkles size={14} /> Regenerate
              </button>
              <button
                type="button" className="pm-btn"
                disabled={busy !== null}
                onClick={() => call("discard", `/api/leads/drafts/${activeDraft.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "discarded" }) })}
              >
                <Trash2 size={14} /> Discard
              </button>
            </div>
          </>
        ) : sentDraft ? (
          <div>
            <div className="pm-muted" style={{ fontSize: 12.5, marginBottom: 6 }}>
              Sent to <span className="mono">{contactEmail(sentDraft.contact_id)}</span>
              {sentDraft.sent_at ? ` on ${new Date(sentDraft.sent_at).toLocaleString()}` : ""} — status: {sentDraft.status}
            </div>
            <div className="pm-panel" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
              <strong>{sentDraft.subject}</strong>
              {"\n\n"}
              {sentDraft.body_text}
            </div>
            {sentDraft.status === "sent" ? (
              <button
                type="button" className="pm-btn" style={{ marginTop: 10 }}
                disabled={busy !== null}
                onClick={() => call("replied", `/api/leads/drafts/${sentDraft.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "replied" }) })}
              >
                <MailCheck size={14} /> Mark replied
              </button>
            ) : null}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="pm-muted" style={{ fontSize: 12.5 }}>No draft yet.</span>
            <button
              type="button" className="pm-btn"
              disabled={busy !== null || !(lead.lead_contacts ?? []).some((c) => c.verify_status === "mx_ok")}
              onClick={() => call("draft", `/api/leads/${lead.id}/draft`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) })}
            >
              <Sparkles size={14} /> {busy === "draft" ? "Drafting…" : "Generate draft"}
            </button>
          </div>
        )}

        <div style={{ borderTop: "1px solid var(--border, #eee)", marginTop: 18, paddingTop: 12, display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button" className="pm-btn"
            disabled={busy !== null || lead.status === "suppressed"}
            onClick={async () => {
              if (await call("suppress", `/api/leads/${lead.id}/suppress`, { method: "POST" })) {
                toast.push({ kind: "success", text: "Lead suppressed — will never be emailed." });
                onClose();
              }
            }}
          >
            <Ban size={14} /> Suppress (do not contact)
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------- scrape history modal --

const SEARCH_STATUS_PILL: Record<string, { cls: string; label: string }> = {
  pending: { cls: "bg-gray", label: "Queued" },
  running: { cls: "bg-gold", label: "Running" },
  done: { cls: "bg-green", label: "Done" },
  error: { cls: "bg-terra", label: "Error" },
};

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

// Grid of scrape requests — the page's primary view. Click one to drill into
// the leads it produced (the parent filters the lead table by search_id).
function ScrapeList({ searches, onOpen }: { searches: SearchRow[]; onOpen: (id: string) => void }) {
  if (!searches.length) {
    return (
      <div className={styles.getStarted}>
        <div className={styles.getStartedTitle}>No scrapes yet</div>
        <p className={styles.getStartedText}>
          Hit “Find companies” at the top to run your first scrape. Every request shows up here —
          click one to see the companies it pulled and their contacts.
        </p>
      </div>
    );
  }
  return (
    <div className={styles.scrapeGrid}>
      {searches.map((s) => {
        const sp = SEARCH_STATUS_PILL[s.status] ?? { cls: "bg-gray", label: s.status };
        const running = ["pending", "running"].includes(s.status);
        return (
          <button key={s.id} type="button" className={styles.scrapeCard} onClick={() => onOpen(s.id)}>
            <div className={styles.scrapeCardTop}>
              <div className={styles.scrapeTitle}>
                <span className="pm-b7">{s.category}</span>
                <span className="pm-dim"> · {s.city}</span>
              </div>
              <span className={`pm-badge2 ${sp.cls}`}>{sp.label}</span>
            </div>
            <div className={styles.scrapeStat}>
              <span className={styles.scrapeNum}>{s.email_count ?? 0}</span>
              <span className="pm-muted">{running ? " leads with email so far" : " leads with email"}</span>
            </div>
            <div className={styles.scrapeMeta}>
              <Clock size={12} /> {fmtTime(s.created_at)} · {s.results_count ?? 0} scanned · {s.pages_fetched}/3 pages
            </div>
            {s.products?.length ? (
              <div className={styles.scrapeMeta} style={{ color: "var(--pm-green, #2f7d5b)" }}>
                {s.products.join(" · ")}
              </div>
            ) : null}
            {s.error ? <div className={styles.scrapeErr} title={s.error}>{s.error.slice(0, 70)}</div> : null}
            <div className={styles.scrapeOpen}>View leads <ChevronRight size={13} /></div>
          </button>
        );
      })}
    </div>
  );
}

// Header above the lead table when a single scrape is open.
function ScrapeDetailBar({ search, count, onBack }: { search?: SearchRow; count: number; onBack: () => void }) {
  const sp = search ? SEARCH_STATUS_PILL[search.status] ?? { cls: "bg-gray", label: search.status } : null;
  return (
    <div className={styles.detailBar}>
      <button type="button" className="pm-btn" onClick={onBack}>
        <ChevronLeft size={14} /> All scrapes
      </button>
      {search ? (
        <div className={styles.detailInfo}>
          <span className="pm-b7">{search.category}</span>
          <span className="pm-dim"> · {search.city}</span>
          <span className="pm-muted">{` — ${count} lead${count === 1 ? "" : "s"} · ${fmtTime(search.created_at)}`}</span>
          {sp ? <span className={`pm-badge2 ${sp.cls} ${styles.detailPill}`}>{sp.label}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

// -------------------------------------------------------------- guide modal --

function GuideModal({ onClose }: { onClose: () => void }) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={`pm-panel ${styles.modal} ${styles.modalMd}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.guideHead}>
          <div className="card-title">How B2B outreach works</div>
          <button type="button" className="pm-btn" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <p className="pm-muted" style={{ fontSize: 13, marginTop: 4 }}>
          From a list of company types to sent emails — four steps, mostly automatic.
        </p>

        <ol className={styles.guideList}>
          {GUIDE_STEPS.map((s) => (
            <li key={s.title} className={styles.guideItem}>
              <s.icon size={20} className={styles.guideIcon} />
              <div>
                <div className={styles.guideTitle}>{s.title}</div>
                <div className={styles.guideBlurb}>{s.blurb}</div>
              </div>
            </li>
          ))}
        </ol>

        <div className={styles.guideTips}>
          <div className={styles.guideTipsTitle}>Good to know</div>
          <ul className={styles.guideTipList}>
            <li><b>Find companies</b> queues the searches and starts the work right away. Hit <b>Keep going</b> any time to push leads further along — it also runs automatically every night.</li>
            <li>Each <b>category × city</b> is one Google search of up to ~60 companies. Start small (1–2 categories, 1–2 cities) to keep results focused.</li>
            <li>No contact found? Open the lead and add an email by hand (check their site or LinkedIn).</li>
            <li>In <b>Settings</b>, set a daily send cap and warm up slowly (15 → 30 → 50) so your domain stays trusted. Flip <b>Pause</b> to stop all sends.</li>
            <li><b>Suppress</b> a lead to make sure it’s never emailed.</li>
          </ul>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
          <button type="button" className="pm-btn primary" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}
