"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Search, Play, RefreshCw, Settings2, Send, Trash2, Sparkles, Ban, MailCheck, Plus, X,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";

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
  error: string | null;
  updated_at: string;
  lead_contacts: Contact[];
  outreach_drafts: Draft[];
};

type SearchRow = {
  id: string;
  category: string;
  city: string;
  status: string;
  pages_fetched: number;
  results_count: number;
  error: string | null;
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
  new: { cls: "grey", label: "New" },
  crawling: { cls: "amber", label: "Crawling" },
  ready: { cls: "green", label: "Ready" },
  no_contacts: { cls: "grey", label: "No contacts" },
  no_website: { cls: "grey", label: "No website" },
  drafting: { cls: "amber", label: "Drafting" },
  drafted: { cls: "amber", label: "Draft ready" },
  contacted: { cls: "green", label: "Contacted" },
  replied: { cls: "green", label: "Replied" },
  bounced: { cls: "accent", label: "Bounced" },
  suppressed: { cls: "accent", label: "Suppressed" },
};

const CONFIDENCE_PILL: Record<string, string> = { high: "green", medium: "amber", low: "grey" };

const TABS: { key: string; label: string }[] = [
  { key: "", label: "All" },
  { key: "new", label: "New" },
  { key: "ready", label: "Ready" },
  { key: "drafted", label: "Draft ready" },
  { key: "contacted", label: "Contacted" },
  { key: "replied", label: "Replied" },
  { key: "bounced", label: "Bounced" },
  { key: "no_contacts", label: "No contacts" },
];

const DEFAULT_CATEGORIES = [
  "corporate gifting company",
  "airline catering service",
  "corporate office",
  "business hotel",
  "coworking space",
  "event management company",
];

const DEFAULT_CITIES = ["Mumbai", "Delhi", "Bangalore", "Gurgaon", "Pune", "Hyderabad"];

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 60,
  display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
};

export default function LeadsPage() {
  const toast = useToast();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Lead | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState("");

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (tab) params.set("status", tab);
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
  }, [tab, q, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function runPipeline(rounds: number) {
    setRunning(true);
    try {
      for (let i = 1; i <= rounds; i++) {
        setRunProgress(`tick ${i}/${rounds}…`);
        const res = await fetch("/api/leads/tick", { method: "POST" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "tick failed");
        setRunProgress(
          `tick ${i}/${rounds}: +${json.discovered} found, ${json.crawled} crawled, ${json.drafted} drafted`,
        );
        await load();
        // Stop early when a tick does nothing — queue is drained.
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
  const pendingSearches = (data?.searches ?? []).filter((s) => s.status === "pending" || s.status === "running").length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>B2B Leads</h1>
          <div className="sub">
            Places discovery → site crawl → verified contacts → AI drafts → approved sends
            {pendingSearches > 0 ? ` · ${pendingSearches} searches queued` : ""}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={() => setShowSearch(true)}>
            <Search size={14} /> New search
          </button>
          <button type="button" className="btn" onClick={() => runPipeline(10)} disabled={running}>
            <Play size={14} /> {running ? runProgress || "Running…" : "Run pipeline"}
          </button>
          <button type="button" className="btn" onClick={() => setShowSettings(true)} aria-label="Settings">
            <Settings2 size={14} />
          </button>
          <button type="button" className="btn" onClick={load} aria-label="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="kpi-grid" style={{ marginBottom: 18 }}>
        <Kpi label="Total leads" value={totalLeads} />
        <Kpi label="Ready to draft" value={counts.ready ?? 0} />
        <Kpi label="Drafts awaiting review" value={counts.drafted ?? 0} />
        <Kpi label="Contacted" value={(counts.contacted ?? 0) + (counts.replied ?? 0)} />
        <Kpi
          label="Sent today"
          value={`${data?.sentToday ?? 0}/${data?.settings?.daily_cap ?? "—"}`}
          accent={data?.settings?.paused ? "Paused" : undefined}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
        <div className="tabs" style={{ marginBottom: 0, border: "none" }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`tab${tab === t.key ? " active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {t.key && counts[t.key] ? ` (${counts[t.key]})` : ""}
            </button>
          ))}
        </div>
        <input
          className="input"
          style={{ maxWidth: 220 }}
          placeholder="Search name or domain…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {data && data.leads.length > 0 ? (
        <div className="card" style={{ opacity: loading ? 0.7 : 1, transition: "opacity 0.2s" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Company</th>
                <th>City</th>
                <th>Category</th>
                <th>Contacts</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.leads.map((lead) => {
                const sp = STATUS_PILL[lead.status] || { cls: "grey", label: lead.status };
                const best = bestContact(lead);
                return (
                  <tr key={lead.id} className="clickable" onClick={() => setSelected(lead)}>
                    <td>
                      <div className="cell-main">
                        <span className="nm">{lead.name}</span>
                      </div>
                      {lead.domain ? <div className="cell-sub mono">{lead.domain}</div> : null}
                    </td>
                    <td className="muted">{lead.city ?? "—"}</td>
                    <td className="muted">{lead.category ?? "—"}</td>
                    <td>
                      {best ? (
                        <span>
                          <span className="mono" style={{ fontSize: 12.5 }}>{best.email}</span>{" "}
                          <span className={`pill ${CONFIDENCE_PILL[best.confidence] ?? "grey"}`}>
                            {best.confidence}
                          </span>
                          {lead.lead_contacts.length > 1 ? (
                            <span className="muted" style={{ fontSize: 12 }}> +{lead.lead_contacts.length - 1}</span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <span className={`pill ${sp.cls}`}>{sp.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card card-pad empty">
          {loading
            ? "Loading…"
            : "No leads yet. Start with a search — pick categories and cities, then run the pipeline."}
        </div>
      )}

      {showSearch && (
        <SearchModal
          onClose={() => setShowSearch(false)}
          onQueued={(n) => {
            setShowSearch(false);
            toast.push({ kind: "success", text: `${n} searches queued. Run the pipeline to discover leads.` });
            load();
          }}
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
        <LeadModal lead={selected} onClose={() => setSelected(null)} onChanged={load} />
      )}
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="kpi">
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600 }}>
        {value}
        {accent ? <span className="pill accent" style={{ marginLeft: 8 }}>{accent}</span> : null}
      </div>
    </div>
  );
}

function bestContact(lead: Lead): Contact | null {
  const contacts = lead.lead_contacts ?? [];
  return contacts.find((c) => c.is_primary) ?? contacts[0] ?? null;
}

// ----------------------------------------------------------- search modal --

function SearchModal({ onClose, onQueued }: { onClose: () => void; onQueued: (n: number) => void }) {
  const toast = useToast();
  const [categories, setCategories] = useState<string[]>([DEFAULT_CATEGORIES[0]]);
  const [cities, setCities] = useState<string[]>([DEFAULT_CITIES[0]]);
  const [customCategory, setCustomCategory] = useState("");
  const [busy, setBusy] = useState(false);

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  }

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
        body: JSON.stringify({ categories: cats, cities }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "failed");
      onQueued(json.enqueued);
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : "Search failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div className="card card-pad" style={{ width: 560, maxWidth: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div className="card-title">New lead search</div>
          <button type="button" className="btn" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
          Each category × city pair is one Google Places search (up to 60 companies).
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 600, margin: "10px 0 6px" }}>Categories</div>
        <div className="chips" style={{ flexWrap: "wrap" }}>
          {DEFAULT_CATEGORIES.map((c) => (
            <button key={c} type="button" className={`chip${categories.includes(c) ? " active" : ""}`} onClick={() => toggle(categories, setCategories, c)}>
              {c}
            </button>
          ))}
        </div>
        <input
          className="input"
          style={{ marginTop: 8 }}
          placeholder="Custom category (e.g. 'corporate caterer')"
          value={customCategory}
          onChange={(e) => setCustomCategory(e.target.value)}
        />
        <div style={{ fontSize: 12.5, fontWeight: 600, margin: "14px 0 6px" }}>Cities</div>
        <div className="chips" style={{ flexWrap: "wrap" }}>
          {DEFAULT_CITIES.map((c) => (
            <button key={c} type="button" className={`chip${cities.includes(c) ? " active" : ""}`} onClick={() => toggle(cities, setCities, c)}>
              {c}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn" onClick={submit} disabled={busy}>
            <Search size={14} /> {busy ? "Queuing…" : "Queue searches"}
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
    <div style={overlayStyle} onClick={onClose}>
      <div className="card card-pad" style={{ width: 480, maxWidth: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div className="card-title">Outreach settings</div>
          <button type="button" className="btn" onClick={onClose} aria-label="Close"><X size={14} /></button>
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
          <span>From mailbox (fixed — Gmail sends as the Workspace mailbox)</span>
          <input className="input" value={form.from_email} disabled />
        </label>
        <label className="field">
          <span>Reply-to (optional)</span>
          <input className="input" value={form.reply_to}
            onChange={(e) => setForm({ ...form, reply_to: e.target.value })} />
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
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
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
    <div style={overlayStyle} onClick={onClose}>
      <div
        className="card card-pad"
        style={{ width: 720, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div>
            <div className="card-title">{lead.name}</div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              {[lead.category, lead.city].filter(Boolean).join(" · ")}
              {lead.website ? (
                <>
                  {" · "}
                  <a href={lead.website} target="_blank" rel="noreferrer">{lead.domain ?? "website"}</a>
                </>
              ) : null}
            </div>
          </div>
          <button type="button" className="btn" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        {lead.error ? (
          <div className="muted" style={{ fontSize: 12, color: "var(--amber)" }}>Last error: {lead.error}</div>
        ) : null}

        <div style={{ fontSize: 12.5, fontWeight: 600, margin: "16px 0 6px" }}>
          Contacts ({(lead.lead_contacts ?? []).length})
        </div>
        {(lead.lead_contacts ?? []).length ? (
          <table className="tbl">
            <thead>
              <tr><th>Email</th><th>Type</th><th>Verified</th><th>Confidence</th><th>Source</th></tr>
            </thead>
            <tbody>
              {lead.lead_contacts.map((c) => (
                <tr key={c.id}>
                  <td className="mono" style={{ fontSize: 12.5 }}>
                    {c.email}
                    {c.is_primary ? <span className="pill green" style={{ marginLeft: 6 }}>primary</span> : null}
                  </td>
                  <td className="muted">{c.role_hint ?? c.kind}</td>
                  <td className="muted">{c.verify_status}</td>
                  <td><span className={`pill ${CONFIDENCE_PILL[c.confidence] ?? "grey"}`}>{c.confidence}</span></td>
                  <td className="muted">
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
          <div className="muted" style={{ fontSize: 12.5 }}>
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
            className="btn"
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

        <div style={{ fontSize: 12.5, fontWeight: 600, margin: "18px 0 6px" }}>Outreach email</div>
        {activeDraft ? (
          <>
            {activeDraft.error ? (
              <div className="muted" style={{ fontSize: 12, color: "var(--amber)", marginBottom: 6 }}>
                Last send error: {activeDraft.error}
              </div>
            ) : null}
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
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
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button type="button" className="btn" onClick={approveAndSend} disabled={busy !== null}>
                <Send size={14} /> {busy === "send" ? "Sending…" : "Approve & send"}
              </button>
              <button
                type="button" className="btn"
                disabled={busy !== null}
                onClick={() => call("regen", `/api/leads/${lead.id}/draft`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) })}
              >
                <Sparkles size={14} /> Regenerate
              </button>
              <button
                type="button" className="btn"
                disabled={busy !== null}
                onClick={() => call("discard", `/api/leads/drafts/${activeDraft.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "discarded" }) })}
              >
                <Trash2 size={14} /> Discard
              </button>
            </div>
          </>
        ) : sentDraft ? (
          <div>
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>
              Sent to <span className="mono">{contactEmail(sentDraft.contact_id)}</span>
              {sentDraft.sent_at ? ` on ${new Date(sentDraft.sent_at).toLocaleString()}` : ""} — status: {sentDraft.status}
            </div>
            <div className="card card-pad" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
              <strong>{sentDraft.subject}</strong>
              {"\n\n"}
              {sentDraft.body_text}
            </div>
            {sentDraft.status === "sent" ? (
              <button
                type="button" className="btn" style={{ marginTop: 10 }}
                disabled={busy !== null}
                onClick={() => call("replied", `/api/leads/drafts/${sentDraft.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "replied" }) })}
              >
                <MailCheck size={14} /> Mark replied
              </button>
            ) : null}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="muted" style={{ fontSize: 12.5 }}>No draft yet.</span>
            <button
              type="button" className="btn"
              disabled={busy !== null || !(lead.lead_contacts ?? []).some((c) => c.verify_status === "mx_ok")}
              onClick={() => call("draft", `/api/leads/${lead.id}/draft`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) })}
            >
              <Sparkles size={14} /> {busy === "draft" ? "Drafting…" : "Generate draft"}
            </button>
          </div>
        )}

        <div style={{ borderTop: "1px solid var(--border, #eee)", marginTop: 18, paddingTop: 12, display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button" className="btn"
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
