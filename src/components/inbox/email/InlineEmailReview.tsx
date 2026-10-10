"use client";

// A support email inside Live chats, with its AI draft and the same review
// actions as Inbox › Email drafts (Approve & send, Edit, Rewrite, Skip).
// Reads GET /api/inbox/email?only=selected&id= and writes ONLY through
// POST /api/inbox/email/[id]/action, the exact route the Email drafts page
// uses, which proxies to the email-draft-action edge function and its atomic
// send claim. No new send path: a customer can never get the same reply twice.
// Approve pins the draft revision shown on screen; the edge refuses a stale one.

import { useCallback, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Callout, ConfirmDialog, Tag } from "@/components/pm";
import { ConversationHeader } from "../ConversationHeader";
import { ageTag, topicTagForWord } from "../labels";
import { EmailDetail } from "./EmailDetail";
import {
  actionOutcome,
  oldEmailDays,
  replyBlockedReason,
  settleNotice,
  type DraftAction,
  type EmailQueueResponse,
} from "@/lib/inbox/email";
import { formatWhen } from "@/lib/inbox/when";
import d from "./draft.module.css";

type ActionBody =
  | { action: "approve"; draft_revision_id: string }
  | { action: "skip" }
  | { action: "rewrite"; feedback?: string }
  | { action: "edit"; body: string };

type Notice = { tone: "crit" | "plain"; message: string; uncertain: boolean };

type Confirming = { kind: "approve"; draftRevisionId: string; to: string; daysOld: number | null } | { kind: "skip" };

export function InlineEmailReview({
  id,
  extraActions,
  onChanged,
}: {
  id: string;
  extraActions?: ReactNode;
  /** the host should refresh its list and counts (approved, skipped, edited) */
  onChanged?: () => void;
}) {
  const q = useQuery({
    queryKey: ["inbox-email-one", id],
    queryFn: async (): Promise<EmailQueueResponse> => {
      const r = await fetch(`/api/inbox/email?only=selected&id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || `email ${r.status}`);
      return j as EmailQueueResponse;
    },
    refetchInterval: 10_000,
  });

  const [busy, setBusy] = useState(false);
  // Synchronous in-flight guard: state lands a render later, so a fast double
  // click could otherwise start two requests.
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [editing, setEditing] = useState<{ text: string; baseRevision: number } | null>(null);
  const [rewriteText, setRewriteText] = useState<string | null>(null);
  const [pendingRewrite, setPendingRewrite] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Approved or skipped here: the buttons never come back, even if a stale
  // copy of the email is still on screen for a moment.
  const [done, setDone] = useState(false);

  const run = useCallback(
    async (body: ActionBody) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setNotice(null);
      const action: DraftAction = body.action;
      let httpStatus: number | null = null;
      let json: Record<string, unknown> | null = null;
      try {
        const r = await fetch(`/api/inbox/email/${id}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        httpStatus = r.status;
        json = (await r.json().catch(() => null)) as Record<string, unknown> | null;
      } catch {
        // Network drop: actionOutcome reads a null status as "couldn't confirm".
      }
      try {
        const out = actionOutcome(action, { httpStatus, body: json });
        if (out.kind === "success") {
          if (action === "approve" && out.status === "already_sent") {
            setNotice({ tone: "plain", message: "This email was already handled. Showing where it stands now.", uncertain: false });
          } else if (action === "approve" || action === "skip") {
            setDone(true);
          } else {
            setEditing(null);
            setRewriteText(null);
          }
        } else {
          if (action === "rewrite") setPendingRewrite(null);
          setNotice({ tone: out.tone, message: out.message, uncertain: out.uncertain });
        }
      } finally {
        setConfirming(null);
        await q.refetch().catch(() => undefined);
        onChanged?.();
        inFlight.current = false;
        setBusy(false);
      }
    },
    [id, q, onChanged],
  );

  if (q.isLoading) {
    return (
      <div style={{ padding: 20 }}>
        <div className="pm2-skel" style={{ minHeight: 240 }} />
      </div>
    );
  }
  const s = q.data?.selected ?? null;
  if (q.isError || !s) {
    return (
      <div style={{ padding: 20 }}>
        <Callout
          tone="crit"
          title={q.isError ? "Could not load this email" : "This email was not found"}
          action={
            <button type="button" className="pm2-btn sm" onClick={() => q.refetch()}>
              Retry
            </button>
          }
        />
      </div>
    );
  }

  const name = s.from_name?.trim() || s.from_email;
  const canAct = s.tab === "approve" && !done;
  const blocked = replyBlockedReason(s.from_email, s.body_plain);
  const shownNotice = notice ? settleNotice(notice, s.tab, s.status) : null;
  const daysOld = s.tab === "approve" ? oldEmailDays(s.created_at) : null;
  const newerDraftWhileEditing = Boolean(editing && s.draft && s.draft.revision > editing.baseRevision);
  const rewriting = pendingRewrite != null && (s.draft?.revision ?? 0) <= pendingRewrite;
  const topic = topicTagForWord(s.category);
  const age = s.tab === "approve" ? ageTag(s.created_at) : null;

  const tags = (
    <>
      {s.tab === "approve" && !done ? <Tag kind="draft_ready" size="sm">Draft ready</Tag> : null}
      {s.tab === "sent" || (done && s.tab !== "skipped") ? <Tag kind="sent" size="sm">Replied</Tag> : null}
      {s.tab === "skipped" ? <Tag kind="skipped" size="sm">Skipped</Tag> : null}
      {s.tab === "attention" ? <Tag kind="failed" size="sm">Needs attention</Tag> : null}
      {topic ? <Tag tone={topic.tone} size="sm">{topic.text}</Tag> : <Tag tone="grey" size="sm">{s.category}</Tag>}
      {age ? <Tag tone={age.tone} size="sm">{age.text}</Tag> : null}
    </>
  );

  return (
    <div className="pm2-thread compact">
      <ConversationHeader
        compact
        channel="em"
        name={name}
        crumb={`Inbox · Email · ${s.from_email}`}
        tags={tags}
        facts={
          <>
            <span className={d.fromEmail} title={s.from_email}>{s.from_email}</span>
            <span>{formatWhen(s.created_at)}</span>
            <Link className="pm2-lnk" href={`/dashboard/inbox/email?id=${encodeURIComponent(id)}`}>
              Open in Email drafts →
            </Link>
          </>
        }
        actions={extraActions}
      />
      <div className={`pm2-thread-scroll ${d.detail}`}>
        <EmailDetail
          s={s}
          isPhone={false}
          canAct={canAct}
          blockedMessage={blocked?.message ?? null}
          busy={busy}
          daysOld={daysOld}
          notice={shownNotice}
          rewriting={rewriting}
          editing={editing ? editing.text : null}
          newerDraftWhileEditing={newerDraftWhileEditing}
          onEditText={(text) => setEditing((e) => (e ? { ...e, text } : e))}
          onCancelEdit={() => setEditing(null)}
          onSaveEdit={() => {
            if (editing && canAct) void run({ action: "edit", body: editing.text });
          }}
          rewriteText={rewriteText}
          onRewriteText={setRewriteText}
          onRewriteCancel={() => setRewriteText(null)}
          onRewriteSubmit={(text) => {
            if (!canAct) return;
            const feedback = text.trim();
            setPendingRewrite(s.draft?.revision ?? 0);
            void run(feedback ? { action: "rewrite", feedback } : { action: "rewrite" });
          }}
          showAll={showAll}
          onShowAll={() => setShowAll(true)}
          historyOpen={historyOpen}
          onToggleHistory={() => setHistoryOpen((v) => !v)}
          onApprove={() => {
            if (!s.draft || !canAct || blocked) return;
            setConfirming({ kind: "approve", draftRevisionId: s.draft.id, to: s.from_email, daysOld: oldEmailDays(s.created_at) });
          }}
          onEdit={() => {
            if (!canAct) return;
            setEditing({ text: s.draft?.body ?? "", baseRevision: s.draft?.revision ?? 0 });
            setRewriteText(null);
          }}
          onRewriteOpen={() => {
            if (canAct) setRewriteText("");
          }}
          onSkip={() => {
            if (canAct) setConfirming({ kind: "skip" });
          }}
        />
      </div>
      {confirming ? (
        confirming.kind === "approve" ? (
          <ConfirmDialog
            title={`Send this reply to ${confirming.to}?`}
            body={`It goes out from the support mailbox. This cannot be undone.${
              confirming.daysOld != null ? ` This email is ${confirming.daysOld} days old.` : ""
            }`}
            confirmLabel="Send reply"
            busy={busy}
            onConfirm={() => void run({ action: "approve", draft_revision_id: confirming.draftRevisionId })}
            onClose={() => setConfirming(null)}
          />
        ) : (
          <ConfirmDialog
            title="Skip this email?"
            body="No reply is sent. Similar emails will be skipped automatically."
            confirmLabel="Skip"
            busy={busy}
            onConfirm={() => void run({ action: "skip" })}
            onClose={() => setConfirming(null)}
          />
        )
      ) : null}
    </div>
  );
}

export default InlineEmailReview;
