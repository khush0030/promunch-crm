"use client";

// Influencer discovery: start Apify searches, filter scored prospects, and
// reach out (manual DM assist / bio email). Backed by /api/instagram/discovery
// + /api/instagram/prospects. Results import asynchronously (ig-discovery-tick,
// every 5 min) — the runs strip shows progress.

import { useCallback, useEffect, useState } from "react";
import {
  Search, RefreshCw, Sparkles, ExternalLink, Copy, Mail, Star, X, UserPlus, Ban, Send,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import PitchQueue from "./PitchQueue";
import styles from "@/app/dashboard/instagram/instagram.module.css";

export type Prospect = {
  id: string;
  handle: string;
  full_name: string | null;
  biography: string | null;
  followers: number | null;
  media_count: number | null;
  avg_likes: number | null;
  avg_comments: number | null;
  avg_views: number | null;
  engagement_rate: number | null;
  last3: { likes: number | null; comments: number | null; views: number | null; caption: string | null; type: string | null }[] | null;
  niche: string | null;
  fit_score: number | null;
  fit_reason: string | null;
  bio_email: string | null;
  status: "new" | "shortlisted" | "contacted" | "in_convo" | "rejected";
  source: string | null;
  thread_id: string | null;
  pitch_dm: string | null;
  pitch_email_subject: string | null;
  pitch_email_body: string | null;
  scraped_at: string | null;
};

type Run = {
  id: string;
  kind: string;
  query: string | null;
  status: string;
  items_count: number | null;
  usage_usd: number | null;
  error: string | null;
  created_at: string;
};

const STATUS_LABEL: Record<Prospect["status"], string> = {
  new: "New", shortlisted: "Shortlisted", contacted: "Contacted", in_convo: "In convo", rejected: "Rejected",
};

export default function DiscoveryTab() {
  const { push } = useToast();
  const notifyErr = useCallback((label: string, e: unknown) => push({ kind: "error", text: `${label}: ${String(e)}` }), [push]);

  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<Prospect | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [emailing, setEmailing] = useState(false);

  // batch pitch queue
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<Prospect[] | null>(null);
  const [batchProgress, setBatchProgress] = useState<string | null>(null);

  // search form
  const [kind, setKind] = useState<"search" | "hashtag">("search");
  const [query, setQuery] = useState("");
  const [maxItems, setMaxItems] = useState(30);
  const [starting, setStarting] = useState(false);
  const [handlesInput, setHandlesInput] = useState("");

  // filters
  const [status, setStatus] = useState("");
  const [minFollowers, setMinFollowers] = useState("");
  const [maxFollowers, setMaxFollowers] = useState("");
  const [minEr, setMinEr] = useState("");
  const [minFit, setMinFit] = useState("");
  const [hasEmail, setHasEmail] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (minFollowers) params.set("min_followers", minFollowers);
      if (maxFollowers) params.set("max_followers", maxFollowers);
      if (minEr) params.set("min_er", minEr);
      if (minFit) params.set("min_fit", minFit);
      if (hasEmail) params.set("has_email", "1");
      if (q) params.set("q", q);
      const [pr, rr] = await Promise.all([
        fetch(`/api/instagram/prospects?${params}`, { cache: "no-store" }),
        fetch(`/api/instagram/discovery`, { cache: "no-store" }),
      ]);
      const pd = await pr.json();
      if (!pr.ok) throw new Error(pd.error || "load failed");
      setProspects(pd.prospects ?? []);
      setStatusCounts(pd.statusCounts ?? {});
      const rd = await rr.json();
      if (rr.ok) setRuns(rd.runs ?? []);
    } catch (e) {
      notifyErr("Couldn't load prospects", e);
    } finally {
      setLoading(false);
    }
  }, [status, minFollowers, maxFollowers, minEr, minFit, hasEmail, q, notifyErr]);

  useEffect(() => { load(); }, [load]);

  const startSearch = useCallback(async () => {
    if (!query.trim()) return;
    setStarting(true);
    try {
      const r = await fetch(`/api/instagram/discovery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", kind, query: query.trim(), max_items: maxItems }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "start failed");
      push({ kind: "success", text: "Discovery started. Results import within ~10 minutes." });
      setQuery("");
      load();
    } catch (e) {
      notifyErr("Couldn't start discovery", e);
    } finally {
      setStarting(false);
    }
  }, [kind, query, maxItems, push, load, notifyErr]);

  const addHandles = useCallback(async () => {
    const handles = handlesInput.split(/[\s,]+/).map((h) => h.trim()).filter(Boolean);
    if (!handles.length) return;
    try {
      const r = await fetch(`/api/instagram/prospects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handles }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "add failed");
      push({ kind: "success", text: `${d.queued ?? handles.length} handle(s) queued for scoring.` });
      setHandlesInput("");
      load();
    } catch (e) {
      notifyErr("Couldn't add handles", e);
    }
  }, [handlesInput, push, load, notifyErr]);

  const patchProspect = useCallback(async (id: string, patch: Record<string, unknown>) => {
    try {
      const r = await fetch(`/api/instagram/prospects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "update failed");
      setActive((p) => (p && p.id === id ? { ...p, ...d.prospect } : p));
      load();
    } catch (e) {
      notifyErr("Update failed", e);
    }
  }, [load, notifyErr]);

  const generateDraft = useCallback(async (id: string) => {
    setDrafting(true);
    try {
      const r = await fetch(`/api/instagram/prospects/${id}/draft`, { method: "POST" });
      const d = await r.json();
      if (!r.ok || d.ok === false) throw new Error(d.error || "draft failed");
      setActive((p) => (p && p.id === id ? { ...p, ...d.prospect } : p));
      push({ kind: "success", text: "Pitch drafted. Review before sending." });
    } catch (e) {
      notifyErr("Draft failed", e);
    } finally {
      setDrafting(false);
    }
  }, [push, notifyErr]);

  const sendEmail = useCallback(async (id: string) => {
    setEmailing(true);
    try {
      const r = await fetch(`/api/instagram/prospects/${id}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await r.json();
      if (!r.ok || d.ok === false) throw new Error(d.error || "email failed");
      setActive((p) => (p && p.id === id ? { ...p, ...d.prospect } : p));
      push({ kind: "success", text: "Pitch emailed." });
      load();
    } catch (e) {
      notifyErr("Email failed", e);
    } finally {
      setEmailing(false);
    }
  }, [push, load, notifyErr]);

  const copyText = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    push({ kind: "success", text: "Copied. Paste it in the Instagram app." });
  }, [push]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelected((s) => {
      const selectable = prospects.filter((p) => p.status !== "rejected" && p.status !== "in_convo");
      return s.size >= selectable.length ? new Set<string>() : new Set(selectable.map((p) => p.id));
    });
  }, [prospects]);

  // Draft any missing pitches (3 at a time), then open the tap-through queue.
  const openQueue = useCallback(async () => {
    const picked = prospects.filter((p) => selected.has(p.id));
    if (!picked.length) return;
    const missing = picked.filter((p) => !p.pitch_dm);
    const drafted = new Map<string, Prospect>();
    let failed = 0;
    for (let i = 0; i < missing.length; i += 3) {
      const chunk = missing.slice(i, i + 3);
      setBatchProgress(`Drafting pitches ${Math.min(i + chunk.length, missing.length)}/${missing.length}…`);
      await Promise.all(chunk.map(async (p) => {
        try {
          const r = await fetch(`/api/instagram/prospects/${p.id}/draft`, { method: "POST" });
          const d = await r.json();
          if (!r.ok || d.ok === false) throw new Error(d.error || "draft failed");
          drafted.set(p.id, d.prospect);
        } catch {
          failed++;
        }
      }));
    }
    setBatchProgress(null);
    if (failed) push({ kind: "error", text: `${failed} pitch draft(s) failed — those prospects are skipped.` });
    const ready = picked
      .map((p) => drafted.get(p.id) ?? p)
      .filter((p) => p.pitch_dm);
    if (!ready.length) {
      push({ kind: "error", text: "No pitches to queue." });
      return;
    }
    setProspects((prev) => prev.map((p) => drafted.get(p.id) ?? p));
    setQueue(ready);
  }, [prospects, selected, push]);

  const activeRuns = runs.filter((r) => r.status === "running" || r.status === "queued");

  return (
    <div className={styles.discWrap}>
      {/* search + intake */}
      <div className={styles.discCard}>
        <div className={styles.discCardLabel}>Find new influencers</div>
        <div className={styles.discSearchRow}>
          <select className={styles.field} value={kind} onChange={(e) => setKind(e.target.value as "search" | "hashtag")}>
            <option value="search">By niche keyword</option>
            <option value="hashtag">By hashtag</option>
          </select>
          <input
            className={styles.field}
            placeholder={kind === "hashtag" ? "#healthysnacksindia" : "healthy snacks india"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && startSearch()}
          />
          <label className={styles.discMax}>
            up to
            <input
              className={styles.field}
              type="number"
              min={5}
              max={200}
              value={maxItems}
              onChange={(e) => setMaxItems(+e.target.value || 30)}
            />
            profiles
          </label>
          <button className="pm-btn primary" onClick={startSearch} disabled={starting || !query.trim()}>
            <Search size={15} /> {starting ? "Starting…" : "Find influencers"}
          </button>
        </div>
        <div className={styles.discAltRow}>
          <span>or score specific accounts:</span>
          <input
            className={styles.field}
            placeholder="Paste handles, comma or space separated"
            value={handlesInput}
            onChange={(e) => setHandlesInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addHandles()}
          />
          <button className="pm-btn" onClick={addHandles} disabled={!handlesInput.trim()}>
            <UserPlus size={15} /> Score handles
          </button>
        </div>
      </div>

      {/* runs strip */}
      {(activeRuns.length > 0 || runs.some((r) => r.status === "failed")) && (
        <div className={styles.discRuns}>
          {activeRuns.map((r) => (
            <span key={r.id} className={styles.discRunPill}>
              <RefreshCw size={11} className={styles.spin} /> {r.kind}{r.query ? ` "${r.query}"` : ""} scraping…
            </span>
          ))}
          {runs.filter((r) => r.status === "failed").slice(0, 2).map((r) => (
            <span key={r.id} className={`${styles.discRunPill} ${styles.discRunFailed}`} title={r.error ?? ""}>
              {r.kind}{r.query ? ` "${r.query}"` : ""} failed
            </span>
          ))}
        </div>
      )}

      {/* filters */}
      <div className={styles.discFilters}>
        <span className={styles.filterLabel}>Filter</span>
        <select className={styles.field} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}{statusCounts[k] ? ` (${statusCounts[k]})` : ""}</option>
          ))}
        </select>
        <input className={styles.field} placeholder="Min followers" value={minFollowers} onChange={(e) => setMinFollowers(e.target.value.replace(/\D/g, ""))} style={{ width: 110 }} />
        <input className={styles.field} placeholder="Max followers" value={maxFollowers} onChange={(e) => setMaxFollowers(e.target.value.replace(/\D/g, ""))} style={{ width: 110 }} />
        <input className={styles.field} placeholder="Min ER %" value={minEr} onChange={(e) => setMinEr(e.target.value.replace(/[^\d.]/g, ""))} style={{ width: 90 }} />
        <input className={styles.field} placeholder="Min fit" value={minFit} onChange={(e) => setMinFit(e.target.value.replace(/\D/g, ""))} style={{ width: 80 }} />
        <label className={styles.discCheck}>
          <input type="checkbox" checked={hasEmail} onChange={(e) => setHasEmail(e.target.checked)} /> Has email
        </label>
        <input className={styles.field} placeholder="Search handle / bio" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
        <button className="pm-btn" onClick={load} disabled={loading}>
          <RefreshCw size={15} className={loading ? styles.spin : ""} /> Refresh
        </button>
      </div>

      {/* bulk pitch bar */}
      {selected.size > 0 && (
        <div className={styles.bulkBar}>
          <span>{selected.size} selected</span>
          <button className="pm-btn primary" onClick={openQueue} disabled={!!batchProgress}>
            <Send size={14} /> {batchProgress ?? "Draft & queue pitches"}
          </button>
          <button className="pm-btn" onClick={() => setSelected(new Set())} disabled={!!batchProgress}>Clear</button>
        </div>
      )}

      {/* table + drawer */}
      <div className={styles.discBody}>
        <div className={styles.discTableWrap}>
          {prospects.length === 0 && !loading ? (
            <div className={styles.empty}>
              No prospects yet. Run a niche or hashtag search above — scored creators land here in a few minutes.
            </div>
          ) : (
            <table className={styles.discTable}>
              <thead>
                <tr>
                  <th className={styles.checkCell}>
                    <input type="checkbox" checked={selected.size > 0 && selected.size >= prospects.filter((p) => p.status !== "rejected" && p.status !== "in_convo").length} onChange={toggleSelectAll} title="Select all" />
                  </th>
                  <th>Creator</th><th>Followers</th><th>ER</th><th>Avg likes</th><th>Fit</th><th>Niche</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {prospects.map((p) => (
                  <tr key={p.id} className={active?.id === p.id ? styles.discRowOn : ""} onClick={() => setActive(p)}>
                    <td className={styles.checkCell} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        disabled={p.status === "rejected" || p.status === "in_convo"}
                        onChange={() => toggleSelect(p.id)}
                      />
                    </td>
                    <td>
                      <span className={styles.handle}>@{p.handle}</span>
                      {p.bio_email && <Mail size={11} className={styles.discEmailIcon} />}
                      {!p.scraped_at && <span className={styles.discPending}>scoring…</span>}
                    </td>
                    <td>{p.followers != null ? fmtNum(p.followers) : "—"}</td>
                    <td>{p.engagement_rate != null ? `${(p.engagement_rate * 100).toFixed(1)}%` : "—"}</td>
                    <td>{p.avg_likes != null ? fmtNum(Math.round(p.avg_likes)) : "—"}</td>
                    <td>{p.fit_score != null ? <span className={styles.scorePill}>{p.fit_score}</span> : "—"}</td>
                    <td className={styles.discNiche}>{p.niche ?? "—"}</td>
                    <td><span className={styles.stagePill}>{STATUS_LABEL[p.status]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {active && (
          <div className={styles.discDrawer}>
            <div className={styles.discDrawerHead}>
              <a href={`https://instagram.com/${active.handle}`} target="_blank" rel="noreferrer" className={styles.convoHandle}>
                @{active.handle} <ExternalLink size={13} />
              </a>
              <button className={styles.backBtnAlways} onClick={() => setActive(null)}><X size={16} /></button>
            </div>
            <div className={styles.collabMetrics}>
              {active.followers != null && <span>{fmtNum(active.followers)} followers</span>}
              {active.engagement_rate != null && <span>{(active.engagement_rate * 100).toFixed(1)}% ER</span>}
              {active.avg_views != null && <span>{fmtNum(Math.round(active.avg_views))} avg reel views</span>}
              {active.fit_score != null && <span className={styles.scorePill}>{active.fit_score}/100</span>}
            </div>
            {active.fit_reason && <div className={styles.fitReason}>{active.fit_reason}</div>}
            {active.biography && <div className={styles.discBio}>{active.biography}</div>}
            {active.bio_email && <div className={styles.discEmailLine}><Mail size={12} /> {active.bio_email}</div>}
            {Array.isArray(active.last3) && active.last3.length > 0 && (
              <div className={styles.discLast3}>
                {active.last3.map((p, i) => (
                  <div key={i} className={styles.discPost}>
                    <span>{p.likes != null ? `${fmtNum(p.likes)} likes` : "likes —"}</span>
                    <span>{p.comments != null ? `${fmtNum(p.comments)} comments` : ""}</span>
                    {p.views != null && <span>{fmtNum(p.views)} views</span>}
                  </div>
                ))}
              </div>
            )}

            <div className={styles.discActions}>
              {active.status !== "shortlisted" && active.status !== "in_convo" && (
                <button className="pm-btn" onClick={() => patchProspect(active.id, { status: "shortlisted" })}>
                  <Star size={14} /> Shortlist
                </button>
              )}
              {active.status !== "rejected" && active.status !== "in_convo" && (
                <button className="pm-btn" onClick={() => patchProspect(active.id, { status: "rejected" })}>
                  <Ban size={14} /> Reject
                </button>
              )}
              <button className="pm-btn" onClick={() => generateDraft(active.id)} disabled={drafting}>
                <Sparkles size={14} /> {drafting ? "Drafting…" : active.pitch_dm ? "Redraft pitch" : "Draft pitch"}
              </button>
            </div>

            {active.pitch_dm && (
              <div className={styles.draftBox}>
                <div className={styles.draftLabel}>DM pitch (send it from the Instagram app — the API cannot cold-DM)</div>
                <div className={styles.draftText}>{active.pitch_dm}</div>
                <div className={styles.discActions}>
                  <button className="pm-btn" onClick={() => copyText(active.pitch_dm!)}>
                    <Copy size={14} /> Copy DM
                  </button>
                  {active.status !== "contacted" && active.status !== "in_convo" && (
                    <button className="pm-btn" onClick={() => patchProspect(active.id, { status: "contacted" })}>
                      Mark DM sent
                    </button>
                  )}
                </div>
              </div>
            )}

            {active.pitch_email_body && active.bio_email && (
              <div className={styles.draftBox}>
                <div className={styles.draftLabel}>Email pitch → {active.bio_email}</div>
                {active.pitch_email_subject && <div className={styles.discSubject}>{active.pitch_email_subject}</div>}
                <div className={styles.draftText}>{active.pitch_email_body}</div>
                <button className="pm-btn primary" onClick={() => sendEmail(active.id)} disabled={emailing || active.status === "contacted"}>
                  <Mail size={14} /> {emailing ? "Sending…" : active.status === "contacted" ? "Contacted" : "Send email"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {queue && (
        <PitchQueue
          prospects={queue}
          onUpdate={(updated) => {
            setProspects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
            setActive((a) => (a && a.id === updated.id ? updated : a));
          }}
          onClose={() => { setQueue(null); setSelected(new Set()); load(); }}
        />
      )}
    </div>
  );
}

function fmtNum(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}
