"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Mail, MessageSquare, CheckCircle2 } from "lucide-react";

type Thread = {
  id: string;
  gmail_thread_id: string;
  from_email: string;
  from_name: string | null;
  to_email: string | null;
  subject: string | null;
  snippet: string | null;
  body_plain: string | null;
  status: string;
  slack_permalink: string | null;
  created_at: string;
  updated_at: string;
  lead_category?: string | null;
  urgency?: string | null;
  score?: number | null;
  classification_meta?: { rationale?: string } | null;
};

type Draft = {
  id: string;
  revision: number;
  body: string;
  feedback: string | null;
  model: string | null;
  is_current: boolean;
  created_at: string;
};

type Sent = {
  id: string;
  body: string;
  gmail_message_id: string | null;
  approved_by_slack_user: string | null;
  sent_at: string;
};

const statusStyle: Record<string, { bg: string; color: string; label: string }> = {
  pending:  { bg: "rgba(245,183,49,0.12)", color: "#B45309", label: "Pending Approval" },
  sent:     { bg: "rgba(16,185,129,0.12)",  color: "#047857", label: "Sent" },
  skipped:  { bg: "rgba(107,114,128,0.12)", color: "#4b5563", label: "Skipped" },
  failed:   { bg: "rgba(239,68,68,0.12)",   color: "#b91c1c", label: "Failed" },
};

const categoryLabel: Record<string, string> = {
  customer_support: "Customer Support",
  order_tracking: "Order Tracking",
  complaint: "Complaint",
  partnership_inquiry: "Partnership Inquiry",
  wholesale: "Wholesale",
  job_application: "Job Application",
  spam: "Spam",
  general: "General",
};

const urgencyColor: Record<string, string> = {
  critical: "#b91c1c",
  high: "#c2410c",
  medium: "#0369a1",
  low: "#6b7280",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function SupportEmailDetail() {
  const { id } = useParams<{ id: string }>();
  const [thread, setThread] = useState<Thread | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [sent, setSent] = useState<Sent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const res = await fetch(`/api/support-emails/${id}`);
      if (res.status === 404) { setNotFound(true); setLoaded(true); return; }
      const data = await res.json();
      setThread(data.thread);
      setDrafts(data.drafts || []);
      setSent(data.sent || []);
      setLoaded(true);
    })();
  }, [id]);

  if (!loaded) return null;
  if (notFound) {
    return (
      <div style={{ padding: "32px", color: "#6b7280", fontSize: "14px" }}>
        Thread not found. <Link href="/dashboard/support-emails" style={{ color: "#B91C4A" }}>Back to inbox</Link>
      </div>
    );
  }
  if (!thread) return null;

  const st = statusStyle[thread.status] || statusStyle.pending;
  const card = {
    backgroundColor: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "12px",
    padding: "24px",
    boxShadow: "0 1px 2px rgba(17,24,39,0.04)",
  } as const;

  return (
    <div style={{ padding: "32px", maxWidth: "960px", margin: "0 auto" }}>
      <Link href="/dashboard/support-emails" style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "#6b7280", marginBottom: "16px" }}>
        <ArrowLeft size={14} /> Back to inbox
      </Link>

      <div style={{ ...card, marginBottom: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", marginBottom: "16px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#111827", marginBottom: "6px" }}>
              {thread.subject || "(no subject)"}
            </h1>
            <div style={{ fontSize: "13px", color: "#4b5563" }}>
              From <strong style={{ color: "#111827" }}>{thread.from_name || thread.from_email}</strong>
              {thread.from_name && <span style={{ color: "#6b7280" }}> · {thread.from_email}</span>}
            </div>
            <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "4px" }}>
              Received {fmtDate(thread.created_at)}
            </div>
          </div>
          <span style={{
            padding: "6px 12px", borderRadius: "999px",
            backgroundColor: st.bg, color: st.color,
            fontSize: "12px", fontWeight: 600, whiteSpace: "nowrap",
          }}>{st.label}</span>
        </div>

        {(thread.lead_category || thread.urgency || thread.score != null) && (
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", paddingTop: "16px", borderTop: "1px solid #f3f4f6" }}>
            {thread.lead_category && (
              <Chip label="Category" value={categoryLabel[thread.lead_category] || thread.lead_category} color="#111827" />
            )}
            {thread.urgency && (
              <Chip label="Urgency" value={thread.urgency} color={urgencyColor[thread.urgency] || "#6b7280"} capitalize />
            )}
            {thread.score != null && (
              <Chip label="Lead Score" value={`${thread.score} / 10`} color={thread.score >= 8 ? "#b91c1c" : thread.score >= 6 ? "#c2410c" : thread.score >= 4 ? "#0369a1" : "#6b7280"} />
            )}
          </div>
        )}
        {thread.classification_meta?.rationale && (
          <div style={{ marginTop: "10px", fontSize: "12px", color: "#6b7280", fontStyle: "italic" }}>
            {thread.classification_meta.rationale}
          </div>
        )}
      </div>

      <Section icon={<Mail size={16} color="#B91C4A" />} title="Incoming Email">
        {thread.body_plain ? (
          <pre style={{
            whiteSpace: "pre-wrap", wordBreak: "break-word",
            fontFamily: "inherit", fontSize: "13px", color: "#111827", lineHeight: 1.6,
            margin: 0,
          }}>{thread.body_plain}</pre>
        ) : (
          thread.snippet && <div style={{ fontSize: "13px", color: "#4b5563" }}>{thread.snippet}</div>
        )}
      </Section>

      <Section icon={<MessageSquare size={16} color="#0369a1" />} title={`Draft Revisions (${drafts.length})`}>
        {drafts.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {drafts.map((d) => (
              <div key={d.id} style={{
                border: d.is_current ? "1px solid #B91C4A" : "1px solid #e5e7eb",
                backgroundColor: d.is_current ? "rgba(185,28,74,0.03)" : "#f9fafb",
                borderRadius: "10px", padding: "14px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "#111827" }}>v{d.revision}</span>
                    {d.is_current && (
                      <span style={{ padding: "2px 8px", borderRadius: "999px", backgroundColor: "rgba(185,28,74,0.1)", color: "#B91C4A", fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                        Current
                      </span>
                    )}
                    {d.model && (
                      <span style={{ fontSize: "11px", color: "#9ca3af" }}>{d.model}</span>
                    )}
                  </div>
                  <span style={{ fontSize: "11px", color: "#9ca3af" }}>{fmtDate(d.created_at)}</span>
                </div>
                {d.feedback && (
                  <div style={{ fontSize: "12px", color: "#4b5563", marginBottom: "8px", paddingLeft: "10px", borderLeft: "2px solid #e5e7eb" }}>
                    Feedback: {d.feedback}
                  </div>
                )}
                <pre style={{
                  whiteSpace: "pre-wrap", wordBreak: "break-word",
                  fontFamily: "inherit", fontSize: "13px", color: "#111827", lineHeight: 1.6, margin: 0,
                }}>{d.body}</pre>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: "13px", color: "#6b7280" }}>No drafts yet.</div>
        )}
      </Section>

      <Section icon={<CheckCircle2 size={16} color="#047857" />} title={`Sent Reply${sent.length > 1 ? `s (${sent.length})` : ""}`}>
        {sent.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {sent.map((s) => (
              <div key={s.id} style={{
                border: "1px solid #d1fae5", backgroundColor: "rgba(16,185,129,0.05)",
                borderRadius: "10px", padding: "14px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <div style={{ fontSize: "12px", color: "#047857", fontWeight: 600 }}>
                    Sent {fmtDate(s.sent_at)}
                    {s.approved_by_slack_user && <span style={{ color: "#6b7280", fontWeight: 400 }}> · approved by {s.approved_by_slack_user}</span>}
                  </div>
                </div>
                <pre style={{
                  whiteSpace: "pre-wrap", wordBreak: "break-word",
                  fontFamily: "inherit", fontSize: "13px", color: "#111827", lineHeight: 1.6, margin: 0,
                }}>{s.body}</pre>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: "13px", color: "#6b7280" }}>Not sent yet.</div>
        )}
      </Section>

      {thread.slack_permalink && (
        <a href={thread.slack_permalink} target="_blank" rel="noreferrer" style={{
          display: "inline-flex", alignItems: "center", gap: "6px",
          padding: "10px 16px", borderRadius: "9px",
          backgroundColor: "#ffffff", border: "1px solid #e5e7eb",
          color: "#4b5563", fontSize: "13px", fontWeight: 500,
        }}>
          Open in Slack <ExternalLink size={14} />
        </a>
      )}
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div style={{
      backgroundColor: "#ffffff", border: "1px solid #e5e7eb",
      borderRadius: "12px", padding: "24px", marginBottom: "16px",
      boxShadow: "0 1px 2px rgba(17,24,39,0.04)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
        {icon}
        <h2 style={{ fontSize: "15px", fontWeight: 600, color: "#111827" }}>{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Chip({ label, value, color, capitalize }: { label: string; value: string; color: string; capitalize?: boolean }) {
  return (
    <div style={{
      padding: "6px 12px", borderRadius: "8px",
      backgroundColor: "#f3f4f6", border: "1px solid #e5e7eb",
      display: "flex", flexDirection: "column", minWidth: "100px",
    }}>
      <span style={{ fontSize: "10px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: "13px", color, fontWeight: 600, textTransform: capitalize ? "capitalize" : "none" }}>{value}</span>
    </div>
  );
}
