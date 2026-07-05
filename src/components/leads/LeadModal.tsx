"use client";

import { useEffect, useState } from "react";
import { useEscapeKey } from "./useEscapeKey";
import { Ban, Gauge, MailCheck, MailSearch, Plus, Send, Sparkles, Trash2, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import styles from "@/app/dashboard/leads/leads.module.css";
import type { Lead } from "./types";
import { CONFIDENCE_PILL } from "./styles";
import { fitPill } from "./format";
import PipelineSteps from "./PipelineSteps";

// ------------------------------------------------------------- lead modal --

export default function LeadModal({ lead, onClose, onChanged }: { lead: Lead; onClose: () => void; onChanged: () => void }) {
  useEscapeKey(onClose);
  const toast = useToast();
  const activeDraft = (lead.outreach_drafts ?? []).find((d) =>
    ["draft", "approved", "failed", "sending"].includes(d.status),
  );
  const sentDraft = (lead.outreach_drafts ?? []).find((d) => ["sent", "replied", "bounced"].includes(d.status));
  const [subject, setSubject] = useState(activeDraft?.subject ?? "");
  const [bodyText, setBodyText] = useState(activeDraft?.body_text ?? "");
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const fp = fitPill(lead.fit_score);

  useEffect(() => {
    setSubject(activeDraft?.subject ?? "");
    setBodyText(activeDraft?.body_text ?? "");
  }, [activeDraft?.id, activeDraft?.subject, activeDraft?.body_text]);

  async function call(label: string, url: string, init?: RequestInit): Promise<boolean> {
    setBusy(label);
    try {
      const res = await fetch(url, init);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `${label} failed`);
      onChanged();
      return true;
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : `${label} failed` });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function saveDraftEdits(): Promise<boolean> {
    if (!activeDraft) return true;
    if (subject === activeDraft.subject && bodyText === activeDraft.body_text) return true;
    return call("save", `/api/leads/drafts/${activeDraft.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject, body_text: bodyText }),
    });
  }

  async function approveAndSend() {
    if (!activeDraft) return;
    if (!(await saveDraftEdits())) return;
    if (await call("send", `/api/leads/drafts/${activeDraft.id}/send`, { method: "POST" })) {
      toast.push({ kind: "success", text: `Sent to ${contactEmail(activeDraft.contact_id)}.` });
    }
  }

  function contactEmail(contactId: string): string {
    return lead.lead_contacts.find((c) => c.id === contactId)?.email ?? "contact";
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-label="Lead details"
        className={`pm-panel ${styles.modal} ${styles.modalLg}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div>
            <div className="card-title">
              {lead.name}{" "}
              <span className={`pm-badge2 ${fp.cls}`} title="ProMunch fit score (AI, 0–100)">fit {fp.label}</span>
            </div>
            <div className="pm-muted" style={{ fontSize: 12.5 }}>
              {[lead.category, lead.city].filter(Boolean).join(" · ")}
              {lead.website ? (
                <>
                  {" · "}
                  <a href={lead.website} target="_blank" rel="noreferrer">{lead.domain ?? "website"}</a>
                </>
              ) : null}
            </div>
            {lead.fit_reason ? (
              <div className="pm-muted" style={{ fontSize: 12.5, marginTop: 4 }}>{lead.fit_reason}</div>
            ) : null}
            {lead.products?.length ? (
              <div className="pm-muted" style={{ fontSize: 12, marginTop: 4 }}>
                Pitching: {lead.products.join(", ")}
              </div>
            ) : null}
          </div>
          <button type="button" className="pm-btn" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        {lead.error ? (
          <div className="pm-muted" style={{ fontSize: 12, color: "var(--amber)" }}>Last error: {lead.error}</div>
        ) : null}

        <div className={styles.actionRow} style={{ marginTop: 12 }}>
          <button
            type="button" className="pm-btn"
            disabled={busy !== null}
            title="Re-run the AI fit score (0–100) from this company's data"
            onClick={async () => {
              if (await call("score", `/api/leads/${lead.id}/score`, { method: "POST" })) {
                toast.push({ kind: "success", text: "Fit score refreshed." });
              }
            }}
          >
            <Gauge size={14} /> {busy === "score" ? "Scoring…" : "Re-score fit"}
          </button>
          <button
            type="button" className="pm-btn"
            disabled={busy !== null || !lead.website}
            title={lead.website ? "Re-crawl the website to find & verify more contacts, then re-score" : "No website to crawl"}
            onClick={async () => {
              if (await call("enrich", `/api/leads/${lead.id}/enrich`, { method: "POST" })) {
                toast.push({ kind: "success", text: "Enriched — re-crawled for contacts and re-scored." });
              }
            }}
          >
            <MailSearch size={14} /> {busy === "enrich" ? "Enriching…" : "Enrich (find contacts)"}
          </button>
        </div>

        <PipelineSteps lead={lead} />

        {lead.enrichment && (lead.enrichment.summary || lead.enrichment.fitAngle) ? (
          <div className={styles.intel}>
            <div className={styles.fieldLabel}>Company intel <span className="pm-muted">(AI enrichment)</span></div>
            {lead.enrichment.summary ? <p className={styles.intelLine}>{lead.enrichment.summary}</p> : null}
            <div className={styles.intelGrid}>
              {lead.enrichment.scale ? <div><span className={styles.intelKey}>Scale</span> {lead.enrichment.scale}</div> : null}
              {lead.enrichment.decisionMaker ? <div><span className={styles.intelKey}>Who to pitch</span> {lead.enrichment.decisionMaker}</div> : null}
              {lead.enrichment.fitAngle ? <div><span className={styles.intelKey}>Best angle</span> {lead.enrichment.fitAngle}</div> : null}
            </div>
            {lead.enrichment.talkingPoints?.length ? (
              <ul className={styles.intelPoints}>
                {lead.enrichment.talkingPoints.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div style={{ fontSize: 12.5, fontWeight: 600, margin: "16px 0 6px" }}>
          Contacts ({(lead.lead_contacts ?? []).length})
        </div>
        {(lead.lead_contacts ?? []).length ? (
          <table className="pm-tbl">
            <thead>
              <tr><th>Email</th><th>Type</th><th>Verified</th><th>Confidence</th><th>Source</th></tr>
            </thead>
            <tbody>
              {lead.lead_contacts.map((c) => (
                <tr key={c.id}>
                  <td className="mono" style={{ fontSize: 12.5 }}>
                    {c.email}
                    {c.is_primary ? <span className="pm-badge2 bg-green" style={{ marginLeft: 6 }}>primary</span> : null}
                  </td>
                  <td className="pm-muted">{c.role_hint ?? c.kind}</td>
                  <td className="pm-muted">{c.verify_status}</td>
                  <td><span className={`pm-badge2 ${CONFIDENCE_PILL[c.confidence] ?? "bg-gray"}`}>{c.confidence}</span></td>
                  <td className="pm-muted">
                    {c.source_url ? (
                      <a href={c.source_url} target="_blank" rel="noreferrer">{c.source}</a>
                    ) : (
                      c.source
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="pm-muted" style={{ fontSize: 12.5 }}>
            No contacts found by the crawler — add one manually (check their site or LinkedIn).
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            className="input"
            style={{ maxWidth: 280 }}
            placeholder="add contact email manually…"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <button
            type="button"
            className="pm-btn"
            disabled={!newEmail.trim() || busy === "contact"}
            onClick={async () => {
              if (
                await call("contact", `/api/leads/${lead.id}/contacts`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ email: newEmail }),
                })
              ) {
                setNewEmail("");
              }
            }}
          >
            <Plus size={14} /> Add
          </button>
        </div>

        {(lead.outreach_replies ?? []).length ? (
          <div className={styles.replies}>
            <div className={styles.fieldLabel}>
              <MailCheck size={13} /> Replies ({lead.outreach_replies.length})
            </div>
            {[...lead.outreach_replies]
              .sort((a, b) => +new Date(b.received_at) - +new Date(a.received_at))
              .map((r) => (
                <div key={r.id} className={styles.replyCard}>
                  <div className={styles.replyHead}>
                    <span className="pm-b7">{r.from_name || r.from_email || "Unknown"}</span>
                    <span className="pm-dim"> · {new Date(r.received_at).toLocaleString()}</span>
                    <button
                      type="button"
                      className={styles.replyDelete}
                      title="Delete this reply"
                      disabled={busy !== null}
                      onClick={() => call("delreply", `/api/leads/replies/${r.id}`, { method: "DELETE" })}
                    >
                      <X size={12} />
                    </button>
                  </div>
                  {r.subject ? <div className={styles.replySubject}>{r.subject}</div> : null}
                  {r.body_text ? <div className={styles.replyBody}>{r.body_text}</div> : null}
                </div>
              ))}
          </div>
        ) : null}

        <div style={{ fontSize: 12.5, fontWeight: 600, margin: "18px 0 6px" }}>Outreach email</div>
        {activeDraft ? (
          <>
            {activeDraft.error ? (
              <div className="pm-muted" style={{ fontSize: 12, color: "var(--amber)", marginBottom: 6 }}>
                Last send error: {activeDraft.error}
              </div>
            ) : null}
            <div className="pm-muted" style={{ fontSize: 12, marginBottom: 6 }}>
              To: <span className="mono">{contactEmail(activeDraft.contact_id)}</span>
              {activeDraft.edited ? " · edited" : ""}
            </div>
            <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
            <textarea
              className="input"
              style={{ marginTop: 8, minHeight: 180, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
            />
            <div className={styles.actionRow}>
              <button type="button" className="pm-btn" onClick={approveAndSend} disabled={busy !== null}>
                <Send size={14} /> {busy === "send" ? "Sending…" : "Approve & send"}
              </button>
              <button
                type="button" className="pm-btn"
                disabled={busy !== null}
                onClick={() => call("regen", `/api/leads/${lead.id}/draft`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) })}
              >
                <Sparkles size={14} /> Regenerate
              </button>
              <button
                type="button" className="pm-btn"
                disabled={busy !== null}
                onClick={() => call("discard", `/api/leads/drafts/${activeDraft.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "discarded" }) })}
              >
                <Trash2 size={14} /> Discard
              </button>
            </div>
          </>
        ) : sentDraft ? (
          <div>
            <div className="pm-muted" style={{ fontSize: 12.5, marginBottom: 6 }}>
              Sent to <span className="mono">{contactEmail(sentDraft.contact_id)}</span>
              {sentDraft.sent_at ? ` on ${new Date(sentDraft.sent_at).toLocaleString()}` : ""} — status: {sentDraft.status}
            </div>
            <div className="pm-panel" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
              <strong>{sentDraft.subject}</strong>
              {"\n\n"}
              {sentDraft.body_text}
            </div>
            {sentDraft.status === "sent" ? (
              <button
                type="button" className="pm-btn" style={{ marginTop: 10 }}
                disabled={busy !== null}
                onClick={() => call("replied", `/api/leads/drafts/${sentDraft.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "replied" }) })}
              >
                <MailCheck size={14} /> Mark replied
              </button>
            ) : null}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="pm-muted" style={{ fontSize: 12.5 }}>No draft yet.</span>
            <button
              type="button" className="pm-btn"
              disabled={busy !== null || !(lead.lead_contacts ?? []).some((c) => c.verify_status === "mx_ok")}
              onClick={() => call("draft", `/api/leads/${lead.id}/draft`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) })}
            >
              <Sparkles size={14} /> {busy === "draft" ? "Drafting…" : "Generate draft"}
            </button>
          </div>
        )}

        <div style={{ borderTop: "1px solid var(--border, #eee)", marginTop: 18, paddingTop: 12, display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button" className="pm-btn ghost"
            disabled={busy !== null || !(lead.lead_contacts ?? []).length}
            title="Inject a labelled test reply so you can see the Replies flow"
            onClick={async () => {
              if (await call("sim", `/api/leads/${lead.id}/simulate-reply`, { method: "POST" })) {
                toast.push({ kind: "success", text: "Test reply added — see the Replies tab." });
              }
            }}
          >
            <MailCheck size={14} /> {busy === "sim" ? "Adding…" : "Simulate reply (test)"}
          </button>
          <button
            type="button" className="pm-btn"
            disabled={busy !== null || lead.status === "suppressed"}
            onClick={async () => {
              if (await call("suppress", `/api/leads/${lead.id}/suppress`, { method: "POST" })) {
                toast.push({ kind: "success", text: "Lead suppressed — will never be emailed." });
                onClose();
              }
            }}
          >
            <Ban size={14} /> Suppress (do not contact)
          </button>
        </div>
      </div>
    </div>
  );
}
