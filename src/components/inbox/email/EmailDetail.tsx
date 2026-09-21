"use client";

// Right-hand panel (laptop) / full-width body (phone) of Inbox › Email
// drafts: the customer's email, its draft or sent reply, and the review
// actions. Pure presentation: every decision (can act, blocked sender,
// notice copy, eyebrow label) is made by the page and src/lib/inbox/email.ts.

import { Pill, Callout } from "@/components/pm";
import { EDIT_MAX_CHARS, FEEDBACK_MAX_CHARS } from "@/lib/inbox/email-action";
import { ATTENTION_MESSAGE, clipText, draftBlock, type EmailQueueSelected } from "@/lib/inbox/email";
import { formatWhen } from "@/lib/inbox/when";

const BODY_CLIP = 1200;

export function agoText(iso: string): string {
  const w = formatWhen(iso);
  return /^\d+[mhd]$/.test(w) ? `${w} ago` : w;
}

function statusWord(s: EmailQueueSelected): string {
  if (s.tab === "sent") return "Sent";
  if (s.tab === "skipped") return "Skipped";
  if (s.tab === "noreply") return "No reply needed";
  if (s.tab === "approve") return "Updating…";
  if (s.status === "sending") return s.tab === "attention" ? "Stuck sending" : "Sending now";
  if (s.status === "failed") return "Failed to send";
  return s.status;
}

export type EmailDetailProps = {
  s: EmailQueueSelected;
  isPhone: boolean;
  canAct: boolean;
  // Approve hidden (sender can't receive a reply); the sun Callout explains.
  blockedMessage: string | null;
  busy: boolean;
  // Days the email has waited, only when over 3 and still To approve.
  daysOld?: number | null;
  notice: { tone: "crit" | "plain"; message: string } | null;
  rewriting: boolean;
  editing: string | null;
  newerDraftWhileEditing: boolean;
  onEditText: (t: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  rewriteText: string | null;
  onRewriteText: (t: string) => void;
  onRewriteCancel: () => void;
  onRewriteSubmit: (t: string) => void;
  showAll: boolean;
  onShowAll: () => void;
  historyOpen: boolean;
  onToggleHistory: () => void;
  onApprove: () => void;
  onEdit: () => void;
  onRewriteOpen: () => void;
  onSkip: () => void;
};

export function EmailDetail(p: EmailDetailProps) {
  const { s, isPhone, canAct, busy, editing } = p;
  const clip = clipText(s.body_plain, BODY_CLIP);
  const bodyText = p.showAll ? (s.body_plain ?? "") : clip.text;
  const editTrimmed = (editing ?? "").trim();
  const editValid = editTrimmed.length >= 1 && editTrimmed.length <= EDIT_MAX_CHARS;
  const block = draftBlock(s, agoText);
  const showApprove = canAct && !p.blockedMessage;

  // Phone keeps Rewrite inside the Edit sheet; laptop has its own button.
  const rewriteBox =
    canAct && (p.rewriteText !== null || (isPhone && editing !== null)) ? (
      <div className="pm2-composer pm2-draft-edit" style={{ marginTop: 12 }}>
        <input
          type="text"
          className="pm2-draft-input"
          value={p.rewriteText ?? ""}
          maxLength={FEEDBACK_MAX_CHARS}
          placeholder="What should change?"
          aria-label="What should change?"
          onChange={(e) => p.onRewriteText(e.target.value)}
          disabled={busy}
        />
        <div className="row">
          <button type="button" className="pm2-btn sm" disabled={busy} onClick={() => p.onRewriteSubmit(p.rewriteText ?? "")}>
            Rewrite draft
          </button>
          {!isPhone ? (
            <button type="button" className="pm2-btn ghost sm" disabled={busy} onClick={p.onRewriteCancel}>
              Cancel
            </button>
          ) : null}
        </div>
      </div>
    ) : null;

  const historyToggle =
    s.revisions.length > 0 ? (
      <button type="button" className="pm2-btn ghost sm end" aria-expanded={p.historyOpen} onClick={p.onToggleHistory}>
        How this was drafted
      </button>
    ) : null;

  return (
    <section className="pm2-panel" style={{ minWidth: 0 }}>
      <div className="pm2-p-head">
        <h3>{s.subject || "(no subject)"}</h3>
        <span className="basis">
          {s.from_email} · {agoText(s.created_at)}
        </span>
      </div>
      <div className="pm2-p-body">
        {p.notice ? (
          <div className="pm2-draft-gap">
            <Callout tone={p.notice.tone} title={p.notice.message} />
          </div>
        ) : null}
        {s.tab === "attention" ? (
          <div className="pm2-draft-gap">
            <Callout tone="crit" title={ATTENTION_MESSAGE} />
          </div>
        ) : null}
        {canAct && p.blockedMessage ? (
          <div className="pm2-draft-gap">
            <Callout tone="sun" title={p.blockedMessage} />
          </div>
        ) : null}

        <div className="pm2-bub in pm2-draft-gap" style={{ maxWidth: "100%" }}>
          {bodyText || "No preview available."}
          {clip.clipped && !p.showAll ? (
            <>
              {" "}
              <button type="button" className="pm2-btn ghost sm" onClick={p.onShowAll}>
                Show all
              </button>
            </>
          ) : null}
        </div>

        <div className="pm2-draft-pills">
          {s.urgency ? <Pill tone={s.urgency.tone}>{s.urgency.text}</Pill> : null}
          <Pill tone="neu" plain>
            {s.category}
          </Pill>
          {p.daysOld != null ? <Pill tone="warn">{`${p.daysOld} days old`}</Pill> : null}
          {!canAct ? (
            <Pill tone={s.status === "failed" || s.tab === "attention" ? "crit" : "neu"}>{statusWord(s)}</Pill>
          ) : null}
        </div>

        {editing !== null && canAct ? (
          <div className="pm2-composer pm2-draft-edit">
            <textarea
              value={editing}
              maxLength={EDIT_MAX_CHARS}
              onChange={(e) => p.onEditText(e.target.value)}
              aria-label="Edit the draft"
              disabled={busy}
            />
            {p.newerDraftWhileEditing ? (
              <div className="reason" role="status">
                A newer draft arrived. Your edit will replace it.
              </div>
            ) : null}
            <div className="row">
              <button type="button" className="pm2-btn pri sm" disabled={busy || !editValid} onClick={p.onSaveEdit}>
                Save draft
              </button>
              <button type="button" className="pm2-btn ghost sm" disabled={busy} onClick={p.onCancelEdit}>
                Cancel
              </button>
            </div>
          </div>
        ) : block ? (
          <div className={`pm2-draft-block${block.kind === "sent" ? " sent" : ""}${p.rewriting ? " dim" : ""}`}>
            <div className="pm2-draft-eyebrow">{block.label}</div>
            {block.sublabel ? <div className="pm2-draft-sub">{block.sublabel}</div> : null}
            {block.body}
          </div>
        ) : (
          <div className="pm2-empty" style={{ textAlign: "left", padding: "8px 0" }}>
            No draft for this email.
          </div>
        )}

        {p.rewriting ? (
          <div className="pm2-draft-note" role="status">
            Writing a new draft…
          </div>
        ) : null}

        {rewriteBox}

        {canAct && !isPhone && editing === null ? (
          <div className="pm2-draft-actions">
            {showApprove ? (
              <button type="button" className="pm2-btn pri" disabled={busy || !s.draft} onClick={p.onApprove}>
                Approve &amp; send
              </button>
            ) : null}
            <button type="button" className="pm2-btn" disabled={busy} onClick={p.onEdit}>
              Edit
            </button>
            <button type="button" className="pm2-btn" disabled={busy} onClick={p.onRewriteOpen}>
              Rewrite
            </button>
            <button type="button" className="pm2-btn ghost" disabled={busy} onClick={p.onSkip}>
              Skip
            </button>
            {historyToggle}
          </div>
        ) : historyToggle ? (
          <div className="pm2-draft-actions">{historyToggle}</div>
        ) : null}

        {p.historyOpen && s.revisions.length > 0 ? (
          <ul className="pm2-draft-history">
            {s.revisions.map((r) => (
              <li key={r.revision}>
                Draft {r.revision} · {r.feedback?.trim() || "first draft"} · {agoText(r.created_at)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

export default EmailDetail;
