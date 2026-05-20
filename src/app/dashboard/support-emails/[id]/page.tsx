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

const statusPill: Record<string, { cls: string; label: string }> = {
  pending: { cls: "amber", label: "Pending Approval" },
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
  customer_support: "Customer Support",
  order_tracking: "Order Tracking",
  complaint: "Complaint",
  partnership_inquiry: "Partnership Inquiry",
  wholesale: "Wholesale",
  job_application: "Job Application",
  spam: "Spam",
  general: "General",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
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
      if (res.status === 404) {
        setNotFound(true);
        setLoaded(true);
        return;
      }
      const data = await res.json();
      setThread(data.thread);
      setDrafts(data.drafts || []);
      setSent(data.sent || []);
      setLoaded(true);
    })();
  }, [id]);

  if (!loaded)
    return (
      <div className="page">
        <div className="muted">Loading…</div>
      </div>
    );
  if (notFound) {
    return (
      <div className="page">
        <div className="muted">
          Thread not found.{" "}
          <Link href="/dashboard/support-emails" style={{ color: "var(--accent)" }}>
            Back to inbox
          </Link>
        </div>
      </div>
    );
  }
  if (!thread) return null;

  const st = statusPill[thread.status] || statusPill.pending;
  const urg = thread.urgency ? urgencyPill[thread.urgency] : null;

  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <Link
        href="/dashboard/support-emails"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          color: "var(--text-2)",
          marginBottom: 16,
        }}
      >
        <ArrowLeft size={14} /> Back to inbox
      </Link>

      <div className="card card-pad section">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 16,
            marginBottom: 16,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.015em", marginBottom: 6 }}>
              {thread.subject || "(no subject)"}
            </h1>
            <div style={{ fontSize: 13, color: "var(--text-2)" }}>
              From <strong style={{ color: "var(--text)" }}>{thread.from_name || thread.from_email}</strong>
              {thread.from_name && <span className="muted"> · {thread.from_email}</span>}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Received {fmtDate(thread.created_at)}
            </div>
          </div>
          <span className={`pill ${st.cls}`}>{st.label}</span>
        </div>

        {(thread.lead_category || urg || thread.score != null) && (
          <div
            style={{
              display: "flex",
              gap: 18,
              flexWrap: "wrap",
              paddingTop: 14,
              borderTop: "1px solid var(--border)",
            }}
          >
            {thread.lead_category && (
              <ChipMeta label="Category" value={categoryLabel[thread.lead_category] || thread.lead_category} />
            )}
            {urg && (
              <ChipMeta label="Urgency">
                <span className={`pill ${urg.cls}`}>{urg.label}</span>
              </ChipMeta>
            )}
            {thread.score != null && <ChipMeta label="Lead Score" value={`${thread.score} / 10`} />}
          </div>
        )}
        {thread.classification_meta?.rationale && (
          <div className="note" style={{ marginTop: 14 }}>
            {thread.classification_meta.rationale}
          </div>
        )}
      </div>

      <Section icon={<Mail size={16} color="var(--accent)" />} title="Incoming Email">
        {thread.body_plain ? (
          <pre
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "inherit",
              fontSize: 13,
              color: "var(--text)",
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            {thread.body_plain}
          </pre>
        ) : (
          thread.snippet && <div style={{ fontSize: 13, color: "var(--text-2)" }}>{thread.snippet}</div>
        )}
      </Section>

      <Section
        icon={<MessageSquare size={16} color="var(--blue)" />}
        title={`Draft Revisions (${drafts.length})`}
      >
        {drafts.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {drafts.map((d) => (
              <div
                key={d.id}
                style={{
                  border: d.is_current ? "1px solid var(--accent)" : "1px solid var(--border)",
                  background: d.is_current ? "var(--accent-soft)" : "var(--hover)",
                  borderRadius: "var(--radius-sm)",
                  padding: 14,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>v{d.revision}</span>
                    {d.is_current && <span className="pill accent">Current</span>}
                    {d.model && <span className="muted" style={{ fontSize: 11 }}>{d.model}</span>}
                  </div>
                  <span className="muted" style={{ fontSize: 11 }}>
                    {fmtDate(d.created_at)}
                  </span>
                </div>
                {d.feedback && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-2)",
                      marginBottom: 8,
                      paddingLeft: 10,
                      borderLeft: "2px solid var(--border-2)",
                    }}
                  >
                    Feedback: {d.feedback}
                  </div>
                )}
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontFamily: "inherit",
                    fontSize: 13,
                    color: "var(--text)",
                    lineHeight: 1.6,
                    margin: 0,
                  }}
                >
                  {d.body}
                </pre>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 13 }}>
            No drafts yet.
          </div>
        )}
      </Section>

      <Section
        icon={<CheckCircle2 size={16} color="var(--green)" />}
        title={`Sent Reply${sent.length > 1 ? `s (${sent.length})` : ""}`}
      >
        {sent.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {sent.map((s) => (
              <div
                key={s.id}
                style={{
                  border: "1px solid var(--green)",
                  background: "var(--green-soft)",
                  borderRadius: "var(--radius-sm)",
                  padding: 14,
                }}
              >
                <div style={{ fontSize: 12, color: "var(--green)", fontWeight: 600, marginBottom: 8 }}>
                  Sent {fmtDate(s.sent_at)}
                  {s.approved_by_slack_user && (
                    <span className="muted" style={{ fontWeight: 400 }}>
                      {" "}· approved by {s.approved_by_slack_user}
                    </span>
                  )}
                </div>
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontFamily: "inherit",
                    fontSize: 13,
                    color: "var(--text)",
                    lineHeight: 1.6,
                    margin: 0,
                  }}
                >
                  {s.body}
                </pre>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 13 }}>
            Not sent yet.
          </div>
        )}
      </Section>

      {thread.slack_permalink && (
        <a
          href={thread.slack_permalink}
          target="_blank"
          rel="noreferrer"
          className="btn"
        >
          Open in Slack <ExternalLink size={14} />
        </a>
      )}
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card card-pad section">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        {icon}
        <div className="card-title" style={{ fontSize: 14 }}>
          {title}
        </div>
      </div>
      {children}
    </div>
  );
}

function ChipMeta({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 10.5,
          color: "var(--text-3)",
          textTransform: "uppercase",
          letterSpacing: 0.5,
          fontWeight: 600,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {children ?? <div style={{ fontSize: 13.5, fontWeight: 500 }}>{value}</div>}
    </div>
  );
}
