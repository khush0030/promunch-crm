"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";

type Thread = {
  id: string;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  snippet: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  lead_category?: string | null;
  urgency?: string | null;
  score?: number | null;
  classification_meta?: { rationale?: string } | null;
};

const statusPill: Record<string, { cls: string; label: string }> = {
  pending: { cls: "amber", label: "Pending" },
  sent: { cls: "green", label: "Sent" },
  skipped: { cls: "grey", label: "Skipped" },
  failed: { cls: "accent", label: "Failed" },
};

const urgencyPill: Record<string, { cls: string; label: string }> = {
  critical: { cls: "accent", label: "Critical" },
  high: { cls: "amber", label: "High" },
  medium: { cls: "blue", label: "Medium" },
  low: { cls: "grey", label: "Low" },
};

const categoryLabel: Record<string, string> = {
  customer_support: "Support",
  order_tracking: "Order Tracking",
  complaint: "Complaint",
  partnership_inquiry: "Partnership",
  wholesale: "Wholesale",
  job_application: "Job",
  spam: "Spam",
  general: "General",
};

const filters = [
  { key: "", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "sent", label: "Sent" },
  { key: "skipped", label: "Skipped" },
  { key: "failed", label: "Failed" },
];

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  const days = Math.floor(sec / 86400);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function SupportEmailsPage() {
  const router = useRouter();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [loaded, setLoaded] = useState(false);

  const fetchData = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: "25" });
    if (status) params.set("status", status);
    if (search) params.set("search", search);
    const res = await fetch(`/api/support-emails?${params}`);
    const data = await res.json();
    setThreads(data.threads || []);
    setTotal(data.total || 0);
    setPages(data.pages || 1);
    setLoaded(true);
  }, [page, status, search]);

  useEffect(() => {
    const t = setTimeout(fetchData, 250);
    return () => clearTimeout(t);
  }, [fetchData]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            <span className="head-icon" style={{ background: "var(--accent-soft)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.9">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="m3 7 9 6 9-6" />
              </svg>
            </span>
            Customer Support Emails
          </h1>
          <div className="sub">
            Inbox replies handled by the Slack approval bot · {total.toLocaleString("en-IN")} threads
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div className="search">
          <Search size={15} />
          <input
            placeholder="Search threads…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="chips">
          {filters.map((f) => (
            <button
              key={f.key || "all"}
              type="button"
              className={`chip${status === f.key ? " active" : ""}`}
              onClick={() => {
                setStatus(f.key);
                setPage(1);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        {threads.length > 0 ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>From</th>
                <th>Subject</th>
                <th>Category</th>
                <th>Urgency</th>
                <th>Score</th>
                <th>Status</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {threads.map((t) => {
                const st = statusPill[t.status] || statusPill.pending;
                const urg = t.urgency ? urgencyPill[t.urgency] : null;
                const displayName = t.from_name || t.from_email.split("@")[0];
                return (
                  <tr
                    key={t.id}
                    className="clickable"
                    onClick={() => router.push(`/dashboard/support-emails/${t.id}`)}
                  >
                    <td>
                      <div className="cell-main">
                        <Avatar name={displayName} size={26} />
                        <div>
                          <div className="nm">{displayName}</div>
                          <div className="cell-sub">{t.from_email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ maxWidth: 320 }}>
                      <div
                        style={{
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          fontWeight: 500,
                        }}
                      >
                        {t.subject || "(no subject)"}
                      </div>
                      {t.snippet && (
                        <div
                          className="cell-sub"
                          style={{
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {t.snippet}
                        </div>
                      )}
                    </td>
                    <td>
                      {t.lead_category ? (
                        <span className="tag">
                          {categoryLabel[t.lead_category] || t.lead_category}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {urg ? (
                        <span className={`pill ${urg.cls}`}>{urg.label}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="num">{t.score != null ? t.score : <span className="muted">—</span>}</td>
                    <td>
                      <span className={`pill ${st.cls}`}>{st.label}</span>
                    </td>
                    <td className="muted">{timeAgo(t.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
            {loaded ? "No support emails yet" : "Loading…"}
          </div>
        )}

        {pages > 1 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 16px",
              borderTop: "1px solid var(--border)",
            }}
          >
            <span className="muted" style={{ fontSize: 12.5 }}>
              Page {page} of {pages}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                className="btn ghost sm"
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn sm"
                disabled={page === pages}
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
