"use client";

import { ChevronLeft } from "lucide-react";
import styles from "@/app/dashboard/leads/leads.module.css";
import type { SearchRow } from "./types";
import { SEARCH_STATUS_PILL } from "./styles";
import { fmtTime } from "./format";

// Header above the lead table when a single scrape is open.
export default function ScrapeDetailBar({ search, count, onBack }: { search?: SearchRow; count: number; onBack: () => void }) {
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
