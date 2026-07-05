"use client";

import { useState } from "react";
import { useEscapeKey } from "./useEscapeKey";
import { Clock, Search, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import styles from "@/app/dashboard/leads/leads.module.css";
import { DEFAULT_CATEGORIES, DEFAULT_CITIES, PRODUCT_OPTIONS } from "./constants";

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

export default function SearchModal({ onClose, onQueued }: { onClose: () => void; onQueued: (rounds: number) => void }) {
  useEscapeKey(onClose);
  const toast = useToast();
  const [categories, setCategories] = useState<string[]>([DEFAULT_CATEGORIES[0]]);
  const [cities, setCities] = useState<string[]>([DEFAULT_CITIES[0]]);
  const [customCategory, setCustomCategory] = useState("");
  const [target, setTarget] = useState(50);
  const [findEmails, setFindEmails] = useState(true);
  const [products, setProducts] = useState<string[]>([]);
  const [offer, setOffer] = useState("");
  const [subjectHint, setSubjectHint] = useState("");
  const [listName, setListName] = useState("");
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
        body: JSON.stringify({ categories: cats, cities, maxResults: target, findEmails, products, offer, subjectHint, listName }),
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
      <div role="dialog" aria-modal="true" aria-label="Find companies" className={`pm-panel ${styles.modal} ${styles.modalMd}`} onClick={(e) => e.stopPropagation()}>
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

        <div className={styles.fieldGroup}>
          <div className={styles.fieldLabel}>Save results as a list</div>
          <input
            className="input"
            placeholder={
              combos === 1
                ? `List name (default: ${allCats[0] ? allCats[0][0].toUpperCase() + allCats[0].slice(1) : "Category"} — ${cities[0] ?? "City"})`
                : "Each category × city gets its own auto-named list"
            }
            value={listName}
            onChange={(e) => setListName(e.target.value)}
            disabled={combos > 1}
            maxLength={120}
          />
          <div className={styles.toggleHint} style={{ marginTop: 6 }}>
            Results land in the Lists tab; from there you enroll the list in an email sequence.
          </div>
        </div>

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
            Runs in your browser — keep this tab open. It also continues automatically every hour once the cron migration is applied.
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
