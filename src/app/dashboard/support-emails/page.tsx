"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Search, ChevronRight } from "lucide-react";

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

const statusStyle: Record<string, { bg: string; color: string; label: string }> = {
  pending:  { bg: "rgba(245,183,49,0.12)", color: "#B45309", label: "Pending" },
  sent:     { bg: "rgba(16,185,129,0.12)",  color: "#047857", label: "Sent" },
  skipped:  { bg: "rgba(107,114,128,0.12)", color: "#4b5563", label: "Skipped" },
  failed:   { bg: "rgba(239,68,68,0.12)",   color: "#b91c1c", label: "Failed" },
};

const urgencyColor: Record<string, string> = {
  critical: "#b91c1c",
  high: "#c2410c",
  medium: "#0369a1",
  low: "#6b7280",
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

function scoreColor(score: number | null | undefined): string {
  if (score == null) return "#9ca3af";
  if (score >= 8) return "#b91c1c";
  if (score >= 6) return "#c2410c";
  if (score >= 4) return "#0369a1";
  return "#6b7280";
}

export default function SupportEmailsPage() {
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

  const card = {
    backgroundColor: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "12px",
    boxShadow: "0 1px 2px rgba(17,24,39,0.04)",
  } as const;

  return (
    <div style={{ padding: "32px", maxWidth: "1400px", margin: "0 auto" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 700, color: "#111827", letterSpacing: "-0.3px" }}>
          Customer Support Emails
        </h1>
        <p style={{ color: "#6b7280", marginTop: "4px", fontSize: "14px" }}>
          Inbox replies handled by the Slack approval bot · {total.toLocaleString()} threads
        </p>
      </div>

      <div style={{ display: "flex", gap: "12px", marginBottom: "16px", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: "240px", maxWidth: "400px" }}>
          <Search size={16} color="#9ca3af" style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)" }} />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            style={{
              width: "100%", padding: "10px 12px 10px 38px",
              backgroundColor: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "9px",
              color: "#111827", fontSize: "14px", outline: "none",
            }}
          />
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => { setStatus(f.key); setPage(1); }}
              style={{
                padding: "8px 14px", borderRadius: "8px",
                border: status === f.key ? "1px solid #B91C4A" : "1px solid #e5e7eb",
                backgroundColor: status === f.key ? "rgba(185,28,74,0.08)" : "#ffffff",
                color: status === f.key ? "#B91C4A" : "#4b5563",
                fontSize: "13px", fontWeight: status === f.key ? 600 : 500, cursor: "pointer",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div style={card}>
        {threads.length > 0 ? (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ backgroundColor: "#f9fafb" }}>
                {["From", "Subject", "Category", "Urgency", "Score", "Status", "Received", ""].map((h) => (
                  <th key={h} style={{
                    textAlign: "left", fontSize: "11px", fontWeight: 600,
                    color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px",
                    padding: "12px 16px", borderBottom: "1px solid #e5e7eb",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {threads.map((t) => {
                const st = statusStyle[t.status] || statusStyle.pending;
                return (
                  <tr key={t.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "14px 16px", fontSize: "13px", color: "#111827" }}>
                      <div style={{ fontWeight: 600 }}>{t.from_name || t.from_email.split("@")[0]}</div>
                      <div style={{ fontSize: "12px", color: "#6b7280" }}>{t.from_email}</div>
                    </td>
                    <td style={{ padding: "14px 16px", fontSize: "13px", color: "#111827", maxWidth: "320px" }}>
                      <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {t.subject || "(no subject)"}
                      </div>
                      {t.snippet && (
                        <div style={{ fontSize: "12px", color: "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: "2px" }}>
                          {t.snippet}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "14px 16px", fontSize: "13px", color: "#4b5563" }}>
                      {t.lead_category ? (categoryLabel[t.lead_category] || t.lead_category) : ""}
                    </td>
                    <td style={{ padding: "14px 16px", fontSize: "13px" }}>
                      {t.urgency ? (
                        <span style={{ color: urgencyColor[t.urgency] || "#6b7280", textTransform: "capitalize", fontWeight: 500 }}>
                          {t.urgency}
                        </span>
                      ) : ""}
                    </td>
                    <td style={{ padding: "14px 16px", fontSize: "14px", fontWeight: 700, color: scoreColor(t.score) }}>
                      {t.score != null ? t.score : ""}
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <span style={{
                        padding: "4px 10px", borderRadius: "999px",
                        backgroundColor: st.bg, color: st.color,
                        fontSize: "11px", fontWeight: 600,
                      }}>{st.label}</span>
                    </td>
                    <td style={{ padding: "14px 16px", fontSize: "12px", color: "#6b7280" }}>
                      {timeAgo(t.created_at)}
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <Link href={`/dashboard/support-emails/${t.id}`} style={{ color: "#B91C4A", display: "inline-flex", alignItems: "center" }}>
                        <ChevronRight size={18} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div style={{ padding: "48px", textAlign: "center", color: "#6b7280", fontSize: "14px" }}>
            {loaded ? "No support emails yet" : ""}
          </div>
        )}
      </div>

      {pages > 1 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px" }}>
          <div style={{ fontSize: "13px", color: "#6b7280" }}>Page {page} of {pages}</div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              style={{
                padding: "8px 14px", borderRadius: "8px",
                border: "1px solid #e5e7eb", backgroundColor: "#ffffff",
                color: page === 1 ? "#9ca3af" : "#4b5563",
                fontSize: "13px", cursor: page === 1 ? "not-allowed" : "pointer",
              }}
            >Previous</button>
            <button
              disabled={page === pages}
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              style={{
                padding: "8px 14px", borderRadius: "8px",
                border: "1px solid #e5e7eb", backgroundColor: "#ffffff",
                color: page === pages ? "#9ca3af" : "#4b5563",
                fontSize: "13px", cursor: page === pages ? "not-allowed" : "pointer",
              }}
            >Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
