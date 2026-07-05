"use client";

import { ChevronRight, Clock } from "lucide-react";
import styles from "@/app/dashboard/leads/leads.module.css";
import type { SearchRow } from "./types";
import { SEARCH_STATUS_PILL } from "./styles";
import { fmtTime } from "./format";

// Grid of scrape requests — the page's primary view. Click one to drill into
// the leads it produced (the parent filters the lead table by search_id).
export default function ScrapeList({ searches, onOpen }: { searches: SearchRow[]; onOpen: (id: string) => void }) {
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
