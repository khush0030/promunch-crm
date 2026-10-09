"use client";

// Creators · Find (was Instagram → Discovery). Start an Apify search by niche
// or hashtag, or score pasted handles; filter the scored prospects; open one
// to shortlist, reject, draft the pitch (DM to copy, or email when the bio
// has one); select several and tap through the pitch queue.
// Every call and body is the one the old DiscoveryTab made:
//   GET  /api/instagram/prospects?…   GET /api/instagram/discovery
//   POST /api/instagram/discovery {action:"start", kind, query, max_items}
//   POST /api/instagram/prospects {handles}
//   PATCH /api/instagram/prospects/:id {status}
//   POST /api/instagram/prospects/:id/draft
//   POST /api/instagram/prospects/:id/email {}
// Results import asynchronously (ig-discovery-tick, every 5 min).

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Ban, Copy, ExternalLink, Mail, RefreshCw, Search, Send, Sparkles, Star, UserPlus, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import PitchQueue from "./PitchQueue";
import { IgOff } from "./IgOff";
import { CREATOR_HASHTAGS, GOOD_MATCH, PROSPECT_LABEL, PROSPECT_STATUS, er, fmtNum, isIgOff, useEscape, type Prospect } from "./ig";
import s from "./creators.module.css";

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

const STATUS_TONE: Record<Prospect["status"], string | undefined> = {
  new: "info",
  shortlisted: "warn",
  contacted: undefined,
  in_convo: "good",
  rejected: "mute",
};

export const FIND_INPUT_ID = "cr-find-query";

export default function FindView({ onGoOutreach }: { onGoOutreach: () => void }) {
  const { push } = useToast();
  const qc = useQueryClient();
  const notifyErr = useCallback((label: string, e: unknown) => push({ kind: "error", text: `${label}: ${e instanceof Error ? e.message : String(e)}` }), [push]);

  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [off, setOff] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [active, setActive] = useState<Prospect | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [emailing, setEmailing] = useState(false);

  // batch pitch queue
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<Prospect[] | null>(null);
  const [batchProgress, setBatchProgress] = useState<string | null>(null);

  // search form
  const [kind, setKind] = useState<"search" | "hashtag">("hashtag");
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
  // Default to good matches only; typed filters override the matching default.
  const [view, setView] = useState<"good" | "all">("good");
  const [presetBusy, setPresetBusy] = useState(false);

  const refreshCounts = useCallback(() => qc.invalidateQueries({ queryKey: ["ig"] }), [qc]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      const good = view === "good";
      const minF = minFollowers || (good ? String(GOOD_MATCH.minFollowers) : "");
      const maxF = maxFollowers || (good ? String(GOOD_MATCH.maxFollowers) : "");
      const fitMin = minFit || (good ? String(GOOD_MATCH.minFit) : "");
      if (minF) params.set("min_followers", minF);
      if (maxF) params.set("max_followers", maxF);
      if (minEr) params.set("min_er", minEr);
      if (fitMin) params.set("min_fit", fitMin);
      if (hasEmail) params.set("has_email", "1");
      if (q) params.set("q", q);
      const [pr, rr] = await Promise.all([
        fetch(`/api/instagram/prospects?${params}`, { cache: "no-store" }),
        fetch(`/api/instagram/discovery`, { cache: "no-store" }),
      ]);
      const pd = await pr.json().catch(() => ({}));
      if (!pr.ok) throw new Error(pd.error || "load failed");
      if (pd.off === true) { setOff(true); setLoadErr(null); return; }
      setProspects(pd.prospects ?? []);
      setStatusCounts(pd.statusCounts ?? {});
      setTotal(pd.total ?? 0);
      const rd = await rr.json().catch(() => ({}));
      if (rr.ok) setRuns(rd.runs ?? []);
      setOff(false);
      setLoadErr(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isIgOff(msg)) setOff(true);
      else setLoadErr(msg);
    } finally {
      setLoading(false);
    }
  }, [status, minFollowers, maxFollowers, minEr, minFit, hasEmail, q, view]);

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
      push({ kind: "success", text: "Search started. Scored creators land here within about 10 minutes." });
      setQuery("");
      load();
    } catch (e) {
      notifyErr("Could not start the search", e);
    } finally {
      setStarting(false);
    }
  }, [kind, query, maxItems, push, load, notifyErr]);

  // One click: run every creator hashtag (same start call as a manual search).
  const findMicroCreators = useCallback(async () => {
    setPresetBusy(true);
    let started = 0;
    try {
      for (const tag of CREATOR_HASHTAGS) {
        const r = await fetch(`/api/instagram/discovery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start", kind: "hashtag", query: tag, max_items: 30 }),
        });
        if (r.ok) started++;
      }
      if (started) push({ kind: "success", text: `Searching ${started} creator hashtags. Good matches land here within about 10 to 15 minutes.` });
      else push({ kind: "error", text: "Could not start the searches. Check today's search budget in Settings." });
      load();
    } catch (e) {
      notifyErr("Could not start the searches", e);
    } finally {
      setPresetBusy(false);
    }
  }, [push, load, notifyErr]);

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
      refreshCounts();
    } catch (e) {
      notifyErr("Could not add handles", e);
    }
  }, [handlesInput, push, load, notifyErr, refreshCounts]);

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
      refreshCounts();
    } catch (e) {
      notifyErr("Update failed", e);
    }
  }, [load, notifyErr, refreshCounts]);

  const generateDraft = useCallback(async (id: string) => {
    setDrafting(true);
    try {
      const r = await fetch(`/api/instagram/prospects/${id}/draft`, { method: "POST" });
      const d = await r.json();
      if (!r.ok || d.ok === false) throw new Error(d.error || "draft failed");
      setActive((p) => (p && p.id === id ? { ...p, ...d.prospect } : p));
      push({ kind: "success", text: "Pitch written. Read it before sending." });
    } catch (e) {
      notifyErr("Could not write the pitch", e);
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
      refreshCounts();
    } catch (e) {
      notifyErr("Email failed", e);
    } finally {
      setEmailing(false);
    }
  }, [push, load, notifyErr, refreshCounts]);

  const copyText = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    push({ kind: "success", text: "Copied. Paste it in the Instagram app." });
  }, [push]);

  const selectable = prospects.filter((p) => p.status !== "rejected" && p.status !== "in_convo");
  const toggleSelect = useCallback((id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const toggleSelectAll = () =>
    setSelected((cur) => (cur.size >= selectable.length ? new Set<string>() : new Set(selectable.map((p) => p.id))));

  // Draft any missing pitches (3 at a time), then open the tap-through queue.
  const openQueue = useCallback(async () => {
    const picked = prospects.filter((p) => selected.has(p.id));
    if (!picked.length) return;
    const missing = picked.filter((p) => !p.pitch_dm);
    const drafted = new Map<string, Prospect>();
    let failed = 0;
    for (let i = 0; i < missing.length; i += 3) {
      const chunk = missing.slice(i, i + 3);
      setBatchProgress(`Writing pitches ${Math.min(i + chunk.length, missing.length)}/${missing.length}`);
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
    if (failed) push({ kind: "error", text: `${failed} pitch draft(s) failed. Those creators are skipped.` });
    const ready = picked.map((p) => drafted.get(p.id) ?? p).filter((p) => p.pitch_dm);
    if (!ready.length) {
      push({ kind: "error", text: "No pitches to queue." });
      return;
    }
    setProspects((prev) => prev.map((p) => drafted.get(p.id) ?? p));
    setQueue(ready);
  }, [prospects, selected, push]);

  const closeActive = useCallback(() => setActive(null), []);
  useEscape(!!active && !queue, closeActive);

  if (off) return <div className={s.body}><IgOff part="Find" /></div>;

  const activeRuns = runs.filter((r) => r.status === "running" || r.status === "queued");
  const failedRuns = runs.filter((r) => r.status === "failed").slice(0, 2);
  const allCount = Object.values(statusCounts).reduce((a, b) => a + b, 0);
  const anyFilter = !!(status || minFollowers || maxFollowers || minEr || minFit || hasEmail || q);

  return (
    <div className={s.body}>
      <section className={s.card} aria-labelledby="cr-find-h">
        <div className={s.secT}>
          <h3 id="cr-find-h">Search Instagram</h3>
          <span className={s.small}>Each profile is scored for fit, size and engagement</span>
        </div>
        <div className={s.form}>
          <select className={s.select} aria-label="Search by" value={kind} onChange={(e) => setKind(e.target.value as "search" | "hashtag")}>
            <option value="search">By niche keyword</option>
            <option value="hashtag">By hashtag</option>
          </select>
          <input
            id={FIND_INPUT_ID}
            className={`${s.input} ${s.grow}`}
            aria-label={kind === "hashtag" ? "Hashtag" : "Niche keyword"}
            placeholder={kind === "hashtag" ? "#gymfoodindia" : "nutritionist"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && startSearch()}
          />
          <label className={s.inline}>
            up to
            <input
              className={`${s.input} ${s.num}`}
              type="number"
              min={5}
              max={200}
              value={maxItems}
              onChange={(e) => setMaxItems(+e.target.value || 30)}
            />
            profiles
          </label>
          <button type="button" className="pm-btn" onClick={startSearch} disabled={starting || !query.trim()}>
            <Search size={15} /> {starting ? "Starting" : "Find creators"}
          </button>
        </div>
        <div className={s.form}>
          <span>Or let PROMUNCH search the best Indian creator hashtags for micro-influencers (1k to 15k followers)</span>
          <button type="button" className="pm-btn primary" onClick={findMicroCreators} disabled={presetBusy}>
            <Search size={15} /> {presetBusy ? "Starting" : "Find Indian micro-creators"}
          </button>
        </div>
        <div className={s.form}>
          <span>Or score accounts you already know</span>
          <input
            className={`${s.input} ${s.grow}`}
            aria-label="Instagram handles"
            placeholder="Paste handles, comma or space separated"
            value={handlesInput}
            onChange={(e) => setHandlesInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addHandles()}
          />
          <button type="button" className="pm-btn" onClick={addHandles} disabled={!handlesInput.trim()}>
            <UserPlus size={15} /> Score handles
          </button>
        </div>
        {(activeRuns.length > 0 || failedRuns.length > 0) && (
          <div className={s.runs}>
            {activeRuns.map((r) => (
              <span key={r.id} className={s.tg} data-tone="info">
                Searching {r.kind === "hashtag" ? "hashtag" : "for"}{r.query ? ` "${r.query}"` : ""}
              </span>
            ))}
            {failedRuns.map((r) => (
              <span key={r.id} className={s.tg} data-tone="red" title={r.error ?? ""}>
                Search{r.query ? ` "${r.query}"` : ""} failed
              </span>
            ))}
          </div>
        )}
      </section>

      <div className={s.tiles} role="group" aria-label="Show creators by status">
        <button type="button" className={s.tile} aria-pressed={status === ""} onClick={() => setStatus("")}>
          <b>{fmtCount(allCount)}</b>
          <span>All</span>
        </button>
        {PROSPECT_STATUS.map((st) => (
          <button key={st.key} type="button" className={s.tile} aria-pressed={status === st.key} onClick={() => setStatus(status === st.key ? "" : st.key)}>
            <b>{fmtCount(statusCounts[st.key] ?? 0)}</b>
            <span>{st.label}</span>
          </button>
        ))}
      </div>

      <section className={`${s.card} ${s.cardFlush}`} aria-label="Creators found">
        <div className={s.filters}>
          <div className={s.seg} role="group" aria-label="Which creators to show">
            <button type="button" aria-pressed={view === "good"} onClick={() => setView("good")}>Good matches</button>
            <button type="button" aria-pressed={view === "all"} onClick={() => setView("all")}>Everything</button>
          </div>
          <input className={`${s.input} ${s.grow}`} aria-label="Search handle or bio" placeholder="Search handle or bio" value={q} onChange={(e) => setQ(e.target.value)} />
          <input className={`${s.input} ${s.num}`} aria-label="Min followers" placeholder="Min followers" inputMode="numeric" value={minFollowers} onChange={(e) => setMinFollowers(e.target.value.replace(/\D/g, ""))} />
          <input className={`${s.input} ${s.num}`} aria-label="Max followers" placeholder="Max followers" inputMode="numeric" value={maxFollowers} onChange={(e) => setMaxFollowers(e.target.value.replace(/\D/g, ""))} />
          <input className={`${s.input} ${s.num}`} aria-label="Min engagement %" placeholder="Min ER %" inputMode="decimal" value={minEr} onChange={(e) => setMinEr(e.target.value.replace(/[^\d.]/g, ""))} />
          <input className={`${s.input} ${s.num}`} aria-label="Min fit score" placeholder="Min fit" inputMode="numeric" value={minFit} onChange={(e) => setMinFit(e.target.value.replace(/\D/g, ""))} />
          <label className={s.check}>
            <input type="checkbox" checked={hasEmail} onChange={(e) => setHasEmail(e.target.checked)} /> Has email
          </label>
          <button type="button" className="pm-btn ghost" onClick={load} disabled={loading} aria-label="Refresh">
            <RefreshCw size={15} className={loading ? s.spin : undefined} />
          </button>
        </div>

        {loadErr ? (
          <div className={s.empty}><p className={s.err}>Could not load creators: {loadErr}</p></div>
        ) : loading && prospects.length === 0 ? (
          <div className={s.empty}><p className={s.muted}>Loading creators</p></div>
        ) : prospects.length === 0 ? (
          <div className={s.empty}>
            {anyFilter ? (
              <>
                <b>Nothing matches</b>
                <p>No creators match these filters. Clear one to see more.</p>
              </>
            ) : (
              <>
                <b>No creators found yet</b>
                <p>Search a niche like &ldquo;fitness mumbai&rdquo; or a hashtag above. Each profile is scored for fit, followers and engagement and lands here in a few minutes.</p>
              </>
            )}
          </div>
        ) : (
          <>
            <div className={s.rowHead} aria-hidden>
              <span className={s.rowCheck}>
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={selected.size > 0 && selected.size >= selectable.length}
                  onChange={toggleSelectAll}
                />
              </span>
              <span>Creator</span><span>Followers</span><span>ER</span><span>Fit</span><span>Niche</span><span>Status</span>
            </div>
            <ul className={s.rows}>
              {prospects.map((p) => (
                <li key={p.id}>
                  <div
                    className={s.row}
                    data-on={active?.id === p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setActive(p)}
                    onKeyDown={(e) => { if (e.key === "Enter") setActive(p); }}
                  >
                    <span className={s.rowCheck} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select @${p.handle}`}
                        checked={selected.has(p.id)}
                        disabled={p.status === "rejected" || p.status === "in_convo"}
                        onChange={() => toggleSelect(p.id)}
                      />
                    </span>
                    <span className={s.who}>
                      <b>@{p.handle}</b>
                      <span>
                        {[p.full_name, p.bio_email ? "has email" : null, !p.scraped_at ? "scoring" : null].filter(Boolean).join(" · ") || " "}
                      </span>
                    </span>
                    <span className={s.n} data-empty={p.followers == null}>{p.followers != null ? fmtNum(p.followers) : ""}</span>
                    <span className={s.n} data-empty={p.engagement_rate == null}>{er(p.engagement_rate) ?? ""}</span>
                    <span className={s.fit} data-tone={p.fit_score != null && p.fit_score >= 70 ? "good" : undefined}>
                      {p.fit_score != null ? <>{p.fit_score}<small>fit</small></> : <small>not scored</small>}
                    </span>
                    <span className={s.cellNiche}>{p.niche ?? ""}</span>
                    <span className={s.tg} data-tone={STATUS_TONE[p.status]}>{PROSPECT_LABEL[p.status]}</span>
                  </div>
                </li>
              ))}
            </ul>
            {total > prospects.length && (
              <p className={`${s.small} ${s.more}`}>Showing the best {prospects.length} of {total} by fit. Filter to narrow down.</p>
            )}
          </>
        )}
      </section>

      {selected.size > 0 && (
        <div className={s.bulk} role="region" aria-label="Selected creators">
          <span>{selected.size} selected</span>
          <button type="button" className="pm-btn primary" onClick={openQueue} disabled={!!batchProgress}>
            <Send size={14} /> {batchProgress ?? "Write and queue pitches"}
          </button>
          <button type="button" className="pm-btn" onClick={() => setSelected(new Set())} disabled={!!batchProgress}>Clear</button>
        </div>
      )}

      {active && (
        <div className={s.backdrop} onClick={() => setActive(null)}>
          <aside className={s.drawer} role="dialog" aria-modal="true" aria-label={`@${active.handle}`} onClick={(e) => e.stopPropagation()}>
            <div className={s.dHead}>
              <div style={{ minWidth: 0 }}>
                <span className={s.eyebrow}>Creator found · {PROSPECT_LABEL[active.status]}</span>
                <h2 className={s.dTitle}>
                  <a href={`https://instagram.com/${active.handle}`} target="_blank" rel="noreferrer">@{active.handle}</a>
                  <ExternalLink aria-hidden />
                </h2>
                <div className={s.stats}>
                  {active.followers != null && <span><b>{fmtNum(active.followers)}</b> followers</span>}
                  {active.engagement_rate != null && <span><b>{er(active.engagement_rate)}</b> engagement</span>}
                  {active.avg_views != null && <span><b>{fmtNum(Math.round(active.avg_views))}</b> avg reel views</span>}
                  {active.fit_score != null && <span><b>{active.fit_score}</b>/100 fit</span>}
                </div>
              </div>
              <button type="button" className={s.close} onClick={() => setActive(null)} aria-label="Close"><X size={16} /></button>
            </div>

            <div className={s.acts}>
              <button type="button" className="pm-btn" onClick={() => generateDraft(active.id)} disabled={drafting}>
                <Sparkles size={14} /> {drafting ? "Writing" : active.pitch_dm ? "Rewrite pitch" : "Write pitch"}
              </button>
              {active.status !== "shortlisted" && active.status !== "in_convo" && (
                <button type="button" className="pm-btn" onClick={() => patchProspect(active.id, { status: "shortlisted" })}>
                  <Star size={14} /> Shortlist
                </button>
              )}
              {active.status !== "rejected" && active.status !== "in_convo" && (
                <button type="button" className="pm-btn ghost" onClick={() => patchProspect(active.id, { status: "rejected" })}>
                  <Ban size={14} /> Not a fit
                </button>
              )}
            </div>

            {active.fit_reason && (
              <div className={s.dSec}>
                <h4>Why this fit score</h4>
                <p>{active.fit_reason}</p>
              </div>
            )}
            {(active.biography || active.bio_email) && (
              <div className={s.dSec}>
                <h4>Bio</h4>
                {active.biography && <p>{active.biography}</p>}
                {active.bio_email && <p className={s.note}><Mail size={13} style={{ verticalAlign: "-2px" }} /> {active.bio_email}</p>}
              </div>
            )}
            {Array.isArray(active.last3) && active.last3.length > 0 && (
              <div className={s.dSec}>
                <h4>Last {active.last3.length} posts</h4>
                {active.last3.map((p, i) => (
                  <div key={i} className={s.stats} style={{ marginTop: i ? 4 : 0 }}>
                    <span><b>{p.likes != null ? fmtNum(p.likes) : "?"}</b> likes</span>
                    {p.comments != null && <span><b>{fmtNum(p.comments)}</b> comments</span>}
                    {p.views != null && <span><b>{fmtNum(p.views)}</b> views</span>}
                  </div>
                ))}
              </div>
            )}

            {active.pitch_dm && (
              <div className={s.dSec}>
                <h4>DM pitch</h4>
                <p className={s.note}>Send it from the Instagram app. Instagram does not let anyone cold-DM through the API.</p>
                <div className={s.draft}>{active.pitch_dm}</div>
                <div className={s.acts}>
                  <button type="button" className="pm-btn" onClick={() => copyText(active.pitch_dm!)}>
                    <Copy size={14} /> Copy DM
                  </button>
                  {active.status !== "contacted" && active.status !== "in_convo" && (
                    <button type="button" className="pm-btn" onClick={() => patchProspect(active.id, { status: "contacted" })}>
                      Mark DM sent
                    </button>
                  )}
                  {(active.status === "contacted" || active.status === "in_convo") && (
                    <button type="button" className={s.txtLink} onClick={onGoOutreach}>Track in Outreach</button>
                  )}
                </div>
              </div>
            )}

            {active.pitch_email_body && active.bio_email && (
              <div className={s.dSec}>
                <h4>Email pitch to {active.bio_email}</h4>
                {active.pitch_email_subject && <p className={s.subject}>{active.pitch_email_subject}</p>}
                <div className={s.draft}>{active.pitch_email_body}</div>
                <div className={s.acts}>
                  <button type="button" className="pm-btn primary" onClick={() => sendEmail(active.id)} disabled={emailing || active.status === "contacted"}>
                    <Mail size={14} /> {emailing ? "Sending" : active.status === "contacted" ? "Pitched" : "Send email"}
                  </button>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      {queue && (
        <PitchQueue
          prospects={queue}
          onUpdate={(updated) => {
            setProspects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
            setActive((a) => (a && a.id === updated.id ? updated : a));
          }}
          onClose={() => { setQueue(null); setSelected(new Set()); load(); refreshCounts(); }}
        />
      )}
    </div>
  );
}

function fmtCount(n: number): string {
  return n.toLocaleString("en-IN");
}
