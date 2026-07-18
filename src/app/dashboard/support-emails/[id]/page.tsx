"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  Mail,
  Sparkles,
  Send,
  RefreshCw,
  Pencil,
  User,
  Bot,
  Briefcase,
  CheckCircle2,
  MessageSquare,
} from "lucide-react";
import { PageHead, Panel, StatusBadge } from "@/components/pm";
import type { BadgeTone } from "@/components/pm";
import { apiFetch, ApiError } from "@/lib/api-fetch";

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

const statusMeta: Record<string, { tone: BadgeTone; label: string }> = {
  pending: { tone: "gold", label: "Pending" },
  sent: { tone: "green", label: "Sent" },
  skipped: { tone: "gray", label: "Skipped" },
  failed: { tone: "terra", label: "Failed" },
};
const urgencyLabel: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
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
function timeAgo(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1) : email;
}
function isToday(iso: string): boolean {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

export default function SupportEmailDetail() {
  const { id } = useParams<{ id: string }>();
  const [thread, setThread] = useState<Thread | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [sent, setSent] = useState<Sent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tryKey, setTryKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoaded(false);
      setLoadError(null);
      setNotFound(false);
      try {
        const data = await apiFetch<{ thread?: Thread; drafts?: Draft[]; sent?: Sent[] }>(`/api/support-emails/${id}`);
        if (cancelled) return;
        if (!data?.thread) {
          setNotFound(true);
          return;
        }
        setThread(data.thread);
        setDrafts(data.drafts || []);
        setSent(data.sent || []);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) setNotFound(true);
        else setLoadError(e instanceof Error ? e.message : "Couldn't load this email");
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [id, tryKey]);

  if (!loaded)
    return (
      <div className="pm-page">
        <PageHead title="Support email" subtitle="Loading…" />
      </div>
    );
  if (loadError)
    return (
      <div className="pm-page">
        <PageHead
          title="Couldn’t load this email"
          subtitle={<>{loadError} · <Link href="/dashboard/support-emails" style={{ color: "var(--pm-green)" }}>Back to inbox</Link></>}
          actions={
            <button className="pm-btn primary" onClick={() => setTryKey((k) => k + 1)}>
              <RefreshCw size={15} /> Retry
            </button>
          }
        />
      </div>
    );
  if (notFound)
    return (
      <div className="pm-page">
        <PageHead
          title="Not found"
          subtitle={<>This thread doesn’t exist. <Link href="/dashboard/support-emails" style={{ color: "var(--pm-green)" }}>Back to inbox</Link></>}
        />
      </div>
    );
  if (!thread) return null;

  const st = statusMeta[thread.status] || statusMeta.pending;
  const currentDraft = drafts.find((d) => d.is_current) || drafts[0] || null;
  const olderDrafts = drafts.filter((d) => d !== currentDraft);
  const slack = thread.slack_permalink;

  return (
    <div className="pm-page">
      <PageHead
        back={
          <Link
            href="/dashboard/support-emails"
            className="more"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 8, color: "var(--pm-muted)", fontSize: 12 }}
          >
            <ArrowLeft size={14} /> Back to inbox
          </Link>
        }
        title={thread.subject || "(no subject)"}
        subtitle={`From ${thread.from_name || thread.from_email} · ${thread.from_email} · received ${timeAgo(thread.created_at)}`}
        actions={<StatusBadge tone={st.tone}>{st.label}</StatusBadge>}
      />

      <div className="pm-grid g-2-1">
        {/* LEFT */}
        <div>
          <Panel style={{ marginBottom: 14 }}>
            <div className="pm-emailmeta">
              {thread.lead_category && (
                <div className="m">
                  <div className="k">Category</div>
                  <div className="v">{categoryLabel[thread.lead_category] || thread.lead_category}</div>
                </div>
              )}
              {thread.urgency && (
                <div className="m">
                  <div className="k">Urgency</div>
                  <div className="v">{urgencyLabel[thread.urgency] || thread.urgency}</div>
                </div>
              )}
              {thread.score != null && (
                <div className="m">
                  <div className="k">Lead score</div>
                  <div className="v">{thread.score} / 10</div>
                </div>
              )}
            </div>
            {thread.classification_meta?.rationale && (
              <div style={{ background: "var(--pm-card2)", border: "1px solid var(--pm-line)", borderRadius: 10, padding: "12px 14px", fontSize: 13, color: "var(--pm-muted)" }}>
                {thread.classification_meta.rationale}
              </div>
            )}
          </Panel>

          <Panel title="Incoming email" icon={<Mail className="tic" />} style={{ marginBottom: 14 }}>
            {thread.body_plain ? (
              <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit", fontSize: 13.5, color: "var(--pm-ink)", lineHeight: 1.6, margin: 0 }}>
                {thread.body_plain}
              </pre>
            ) : thread.snippet ? (
              <div style={{ fontSize: 13.5, color: "var(--pm-muted)" }}>{thread.snippet}</div>
            ) : (
              <div className="pm-dim" style={{ fontSize: 13 }}>No body captured.</div>
            )}
          </Panel>

          {currentDraft && (
            <Panel
              title="AI-drafted reply"
              icon={<Sparkles className="tic" />}
              more={currentDraft.revision > 1 ? `v${currentDraft.revision} · regenerated` : `v${currentDraft.revision}`}
              style={{ marginBottom: 14 }}
            >
              <div className="pm-draftbox">{currentDraft.body}</div>
              <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                {slack ? (
                  <>
                    <a className="pm-btn primary" href={slack} target="_blank" rel="noreferrer"><Send size={15} /> Send reply</a>
                    <a className="pm-btn" href={slack} target="_blank" rel="noreferrer"><RefreshCw size={15} /> Rewrite</a>
                    <a className="pm-btn ghost" href={slack} target="_blank" rel="noreferrer"><Pencil size={15} /> Edit</a>
                  </>
                ) : (
                  <>
                    <button className="pm-btn primary" disabled><Send size={15} /> Send reply</button>
                    <button className="pm-btn" disabled><RefreshCw size={15} /> Rewrite</button>
                    <button className="pm-btn ghost" disabled><Pencil size={15} /> Edit</button>
                  </>
                )}
              </div>
              <div className="pm-dim" style={{ fontSize: 11.5, marginTop: 10 }}>
                Sending, rewriting &amp; editing happen in the Slack approval bot.
              </div>
            </Panel>
          )}

          {sent.length > 0 && (
            <Panel title={`Sent repl${sent.length > 1 ? "ies" : "y"}`} icon={<CheckCircle2 className="tic" />} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {sent.map((s) => (
                  <div key={s.id}>
                    <div style={{ fontSize: 12, color: "var(--pm-green)", fontWeight: 600, marginBottom: 6 }}>
                      Sent {fmtDate(s.sent_at)}
                      {s.approved_by_slack_user && <span className="pm-dim" style={{ fontWeight: 400 }}> · approved by {s.approved_by_slack_user}</span>}
                    </div>
                    <div className="pm-draftbox">{s.body}</div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {olderDrafts.length > 0 && (
            <Panel title={`Earlier revisions (${olderDrafts.length})`} icon={<MessageSquare className="tic" />}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {olderDrafts.map((d) => (
                  <div key={d.id} style={{ background: "var(--pm-card2)", border: "1px solid var(--pm-line)", borderRadius: 10, padding: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="pm-b7" style={{ fontSize: 13 }}>v{d.revision}</span>
                        {d.model && <span className="pm-dim" style={{ fontSize: 11 }}>{d.model}</span>}
                      </div>
                      <span className="pm-dim" style={{ fontSize: 11 }}>{fmtDate(d.created_at)}</span>
                    </div>
                    {d.feedback && (
                      <div style={{ fontSize: 12, color: "var(--pm-muted)", marginBottom: 8, paddingLeft: 10, borderLeft: "2px solid var(--pm-border)" }}>
                        Feedback: {d.feedback}
                      </div>
                    )}
                    <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit", fontSize: 13, color: "var(--pm-ink)", lineHeight: 1.6, margin: 0 }}>
                      {d.body}
                    </pre>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>

        {/* RIGHT */}
        <div>
          <Panel title="Sender" icon={<User className="tic" />} style={{ marginBottom: 14 }}>
            <div className="pm-pill"><span className="nm">Email</span><span className="pm-muted">{thread.from_email}</span></div>
            <div className="pm-pill"><span className="nm">Domain</span><span className="pm-muted">{domainOf(thread.from_email)}</span></div>
            <div className="pm-pill"><span className="nm">First seen</span><span className="pm-muted">{isToday(thread.created_at) ? "Today" : fmtDate(thread.created_at)}</span></div>
          </Panel>

          <Panel title="How to handle" icon={<Bot className="tic" />}>
            <div style={{ fontSize: 13, color: "var(--pm-muted)", lineHeight: 1.6 }}>
              {thread.classification_meta?.rationale ||
                "Review the AI draft, approve in Slack, and route high-value wholesale/partnership leads to the B2B pipeline."}
            </div>
            <Link href="/dashboard/leads" className="pm-btn ghost" style={{ marginTop: 12, width: "100%", justifyContent: "center" }}>
              <Briefcase size={15} /> Add to B2B Leads
            </Link>
            {slack && (
              <a href={slack} target="_blank" rel="noreferrer" className="pm-btn ghost" style={{ marginTop: 10, width: "100%", justifyContent: "center" }}>
                Open in Slack <ExternalLink size={14} />
              </a>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
