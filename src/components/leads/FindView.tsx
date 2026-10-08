"use client";

// B2B · Find businesses (prototype b2b-find), inline instead of a modal.
// Same request as before: POST /api/leads/search with
// { categories, cities, maxResults, findEmails, products, offer, subjectHint, listName }.
// Each category × city becomes its own list; the pipeline then scores the
// businesses, finds and MX-checks work emails and writes a first email for
// each (those land in Review). Below the form: recent searches and progress.

import { useState } from "react";
import { ArrowRight, ChevronDown, ChevronRight, Clock, Search } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import s from "./b2b.module.css";
import { CATEGORY_PRESETS, DEFAULT_CITIES, PRODUCT_OPTIONS } from "./constants";
import type { ListSummary, SearchRow } from "./types";
import { nf, shortDate } from "./stages";

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

const SEARCH_TAG: Record<string, { t: string; tone?: "good" | "info" | "warn" | "bad" }> = {
  pending: { t: "Waiting to start", tone: "info" },
  running: { t: "Finding", tone: "info" },
  done: { t: "Done", tone: "good" },
  error: { t: "Stopped", tone: "bad" },
};

export default function FindView({
  searches, lists, running, runProgress, onQueued, onRun, onOpenList,
}: {
  searches: SearchRow[];
  lists: ListSummary[];
  running: boolean;
  runProgress: string;
  onQueued: (rounds: number) => void;
  onRun: () => void;
  onOpenList: (id: string) => void;
}) {
  const toast = useToast();
  const [categories, setCategories] = useState<string[]>([CATEGORY_PRESETS[0].query]);
  const [cities, setCities] = useState<string[]>([DEFAULT_CITIES[0]]);
  const [customCategory, setCustomCategory] = useState("");
  const [target, setTarget] = useState(50);
  const [findEmails, setFindEmails] = useState(true);
  const [products, setProducts] = useState<string[]>([]);
  const [offer, setOffer] = useState("");
  const [subjectHint, setSubjectHint] = useState("");
  const [listName, setListName] = useState("");
  const [busy, setBusy] = useState(false);
  const [showMore, setShowMore] = useState(false);

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
      toast.push({ kind: "error", text: "Pick at least one business type and one city." });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/leads/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categories: cats, cities, maxResults: target, findEmails, products, offer, subjectHint, listName }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "failed");
      toast.push({
        kind: "success",
        text: findEmails
          ? `Finding ~${plan.expectedEmails} businesses with a work email (checking ${plan.actualScan}), about ${fmtDuration(plan.lo)} to ${fmtDuration(plan.hi)}.`
          : `Listing up to ${plan.actualScan} businesses, about ${fmtDuration(plan.lo)} to ${fmtDuration(plan.hi)}.`,
      });
      onQueued(plan.rounds);
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : "Search failed" });
    } finally {
      setBusy(false);
    }
  }

  const listBySearch = new Map(lists.filter((l) => l.source_search_id).map((l) => [l.source_search_id as string, l]));
  const recent = searches.slice(0, 8);
  const inFlight = searches.filter((x) => x.status === "pending" || x.status === "running").length;

  return (
    <div className={s.body}>
      <section className={s.card}>
        <div className={s.field}>
          <span className={s.fieldL}>What kind of business?</span>
          <div className={s.chips}>
            {CATEGORY_PRESETS.map((c) => (
              <button key={c.query} type="button" className={s.chip} data-on={categories.includes(c.query)} aria-pressed={categories.includes(c.query)} onClick={() => toggle(categories, setCategories, c.query)}>
                {c.label}
              </button>
            ))}
          </div>
          <input
            className={s.in}
            placeholder="Or type your own, e.g. corporate caterer"
            value={customCategory}
            onChange={(e) => setCustomCategory(e.target.value)}
            aria-label="Your own business type"
          />
        </div>

        <div className={s.field}>
          <span className={s.fieldL}>Where?</span>
          <div className={s.chips}>
            {DEFAULT_CITIES.map((c) => (
              <button key={c} type="button" className={s.chip} data-on={cities.includes(c)} aria-pressed={cities.includes(c)} onClick={() => toggle(cities, setCities, c)}>
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className={s.field}>
          <span className={s.fieldL}>{findEmails ? "How many businesses with an email?" : "How many businesses?"}</span>
          <div className={s.chips}>
            {COUNT_PRESETS.map((n) => (
              <button key={n} type="button" className={s.chip} data-on={target === n} aria-pressed={target === n} onClick={() => setTarget(n)}>
                {n}
              </button>
            ))}
            <input
              className={s.in}
              style={{ width: 110, minHeight: 38, height: 38, padding: "0 12px" }}
              type="number"
              min={1}
              max={3600}
              value={target}
              onChange={(e) => setTarget(Math.max(1, Math.min(3600, parseInt(e.target.value || "1"))))}
              aria-label="Custom count"
            />
          </div>
        </div>

        <div className={s.field}>
          <span className={s.fieldL}>Products to pitch <span>(optional)</span></span>
          <div className={s.chips}>
            {PRODUCT_OPTIONS.map((p) => (
              <button key={p} type="button" className={s.chip} data-on={products.includes(p)} aria-pressed={products.includes(p)} onClick={() => toggle(products, setProducts, p)}>
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className={s.field}>
          <label className={s.toggle}>
            <input type="checkbox" checked={findEmails} onChange={(e) => setFindEmails(e.target.checked)} />
            <span>
              <b>Find and check work emails, then write a first email for each</b>
              <span className={s.hint}>Off = only save the business list (faster). You can find emails later from the list.</span>
            </span>
          </label>
        </div>

        <button type="button" className={s.txtLink} style={{ marginTop: 18, color: "var(--pm-ink2)" }} onClick={() => setShowMore((v) => !v)}>
          {showMore ? <ChevronDown /> : <ChevronRight />} More options: pitch, subject idea, list name
        </button>

        {showMore ? (
          <div style={{ marginTop: 16 }}>
            {findEmails ? (
              <div className={s.field}>
                <label htmlFor="fd-offer">What are you pitching? <span>(optional)</span></label>
                <textarea
                  id="fd-offer"
                  className={s.ta}
                  style={{ minHeight: 80 }}
                  placeholder="e.g. Edamame as a healthy corporate gifting hamper, free sample box and a 15 minute call."
                  value={offer}
                  onChange={(e) => setOffer(e.target.value)}
                  maxLength={400}
                />
                <input
                  className={s.in}
                  placeholder="Subject line idea (optional)"
                  aria-label="Subject line idea"
                  value={subjectHint}
                  onChange={(e) => setSubjectHint(e.target.value)}
                  maxLength={160}
                />
                <span className={s.hint}>Leave blank and the AI picks the angle. Product facts always come from the knowledge base.</span>
              </div>
            ) : null}
            <div className={s.field}>
              <label htmlFor="fd-list">List name <span>(optional)</span></label>
              <input
                id="fd-list"
                className={s.in}
                placeholder={
                  combos === 1
                    ? `Default: ${allCats[0] ? allCats[0][0].toUpperCase() + allCats[0].slice(1) : "Type"} · ${cities[0] ?? "City"}`
                    : "Each type × city gets its own list, named for you"
                }
                value={listName}
                onChange={(e) => setListName(e.target.value)}
                disabled={combos > 1}
                maxLength={120}
              />
            </div>
          </div>
        ) : null}
      </section>

      <div className={s.actbar}>
        <div className={s.abM}>
          <b>
            {findEmails
              ? `About ${nf(plan.expectedEmails)} businesses with a work email`
              : `About ${nf(plan.actualScan)} businesses`}
          </b>
          <span>
            {combos > 1 ? `${combos} lists · ` : ""}about {fmtDuration(plan.lo)} to {fmtDuration(plan.hi)} · keep this tab open
            {plan.capped ? " · Google caps each search at about 60, add cities for more" : ""}
          </span>
        </div>
        <button type="button" className="pm-btn primary" onClick={submit} disabled={busy || running}>
          <Search /> {busy ? "Starting…" : running ? `Working ${runProgress}` : "Find businesses"}
        </button>
      </div>

      <section className={s.card}>
        <div className={s.secT}>
          <h3>Recent searches</h3>
          {inFlight > 0 ? (
            <button type="button" className={s.txtLink} onClick={onRun} disabled={running}>
              {running ? `Working ${runProgress}` : `Continue ${inFlight} unfinished`} {running ? null : <ArrowRight />}
            </button>
          ) : null}
        </div>
        {recent.length === 0 ? (
          <p className={s.muted} style={{ margin: "8px 0 0", fontSize: 15 }}>Your searches show up here with how many businesses and emails each found.</p>
        ) : (
          <div className={s.bizList}>
            {recent.map((r) => {
              const tag = SEARCH_TAG[r.status] ?? { t: r.status };
              const list = listBySearch.get(r.id);
              return (
                <div key={r.id} className={s.bz}>
                  <span className={s.cj} aria-hidden><Clock size={16} /></span>
                  <span className={s.clM}>
                    <b style={{ textTransform: "capitalize" }}>{r.category} · {r.city}</b>
                    <span>
                      {nf(r.results_count)} found · {nf(r.email_count)} with an email · {shortDate(r.created_at)}
                      {r.error ? ` · ${r.error}` : ""}
                    </span>
                  </span>
                  <span className={s.clO}>
                    <span className={s.tg} data-tone={tag.tone}>{tag.t}</span>
                    {list ? (
                      <button type="button" className={s.txtLink} onClick={() => onOpenList(list.id)}>Open list <ArrowRight /></button>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
