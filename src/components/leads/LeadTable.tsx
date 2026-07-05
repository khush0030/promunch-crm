"use client";

// Lead table (desktop), card list (mobile) and empty states. Extracted from
// dashboard/leads/page.tsx; props are named after the page state they mirror.

import { BookOpen, Search } from "lucide-react";
import styles from "@/app/dashboard/leads/leads.module.css";
import type { ApiResponse, Lead } from "./types";
import { CONFIDENCE_PILL, STATUS_PILL } from "./styles";
import { bestContact, fitPill } from "./format";

export default function LeadTable({
  data, loading, totalLeads, tab, selectedSearchId, setSelected, setShowSearch, setShowGuide,
}: {
  data: ApiResponse | null;
  loading: boolean;
  totalLeads: number;
  tab: string;
  selectedSearchId: string | null;
  setSelected: (lead: Lead) => void;
  setShowSearch: (v: boolean) => void;
  setShowGuide: (v: boolean) => void;
}) {
  return data && data.leads.length > 0 ? (
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
  );
}
