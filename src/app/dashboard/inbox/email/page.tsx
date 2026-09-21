"use client";

// /dashboard/inbox/email — Email drafts queue (Task 2.8, screens.js `drafts`).
// Laptop: queue on the left, one email and its draft on the right. Phone: no
// list, a "1 of N" stepper on top and Approve / Edit / Skip fixed at the
// bottom. Reads GET /api/inbox/email (read-only); every write goes through
// POST /api/inbox/email/[id]/action, which proxies to the email-draft-action
// edge function and its atomic send claim (the customer can never get the
// same reply twice, even with Slack approving at the same time).
//
// Approve & send emails a real customer. Actions only render when the
// thread's own status puts it in "To approve" (selected.tab === "approve"),
// never on sent, skipped, failed, sending or no-reply threads.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader, Chips, ListRow, Pill, Callout, ConfirmDialog } from "@/components/pm";
import type { ChipItem } from "@/components/pm";
import { useMediaPhone } from "@/components/shell/useMediaPhone";
import { formatWhen } from "@/lib/inbox/when";
import { DRAFT_CHANGED_MESSAGE, EDIT_MAX_CHARS, FEEDBACK_MAX_CHARS, NOT_SENT_MESSAGE } from "@/lib/inbox/email-action";
import {
  clipText,
  isEmailQueueTab,
  stepIndex,
  type EmailQueueResponse,
  type EmailQueueSelected,
  type EmailQueueTab,
} from "@/lib/inbox/email";

const TAB_LABELS: Record<EmailQueueTab, string> = {
  approve: "To approve",
  noreply: "No reply needed",
  sent: "Sent",
  skipped: "Skipped",
};

const BODY_CLIP = 1200;
const POLL_MS = 10_000;

type Notice = { tone: "crit" | "plain"; title: string };

type ActionBody =
  | { action: "approve"; draft_revision_id: string }
  | { action: "skip" }
  | { action: "rewrite"; feedback?: string }
  | { action: "edit"; body: string };

type Confirming =
  | { kind: "approve"; threadId: string; draftRevisionId: string; to: string }
  | { kind: "skip"; threadId: string };

function agoText(iso: string): string {
  const w = formatWhen(iso);
  return /^\d+[mhd]$/.test(w) ? `${w} ago` : w;
}

function statusWord(s: EmailQueueSelected): string {
  if (s.tab === "sent") return "Sent";
  if (s.tab === "skipped") return "Skipped";
  if (s.tab === "noreply") return "No reply needed";
  if (s.tab === "approve") return "Updating…";
  if (s.status === "sending") return "Sending now";
  if (s.status === "failed") return "Failed to send";
  return s.status;
}

function stripStop(s: string): string {
  return s.trim().replace(/[.\s]+$/, "");
}

// Copy for a failed action. The approve wording is fixed by the brief.
function failureTitle(action: ActionBody["action"], error: string): string {
  if (action === "approve") {
    if (error === NOT_SENT_MESSAGE) return NOT_SENT_MESSAGE;
    return `The reply was not sent: ${stripStop(error)}. Nothing went to the customer.`;
  }
  if (action === "skip") return `The email was not skipped: ${stripStop(error)}.`;
  if (action === "edit") return `The draft was not saved: ${stripStop(error)}.`;
  return `The draft was not rewritten: ${stripStop(error)}.`;
}

export default function EmailDraftsPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <EmailDraftsInner />
    </Suspense>
  );
}

function Fallback() {
  return (
    <div className="pm2-body">
      <div className="pm2-skel" style={{ minHeight: 400 }} />
    </div>
  );
}

function EmailDraftsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const isPhone = useMediaPhone();

  const rawTab = params.get("tab");
  const tab: EmailQueueTab = isEmailQueueTab(rawTab) ? rawTab : "approve";
  const idParam = params.get("id");

  const setQuery = useCallback(
    (next: { tab?: EmailQueueTab; id?: string | null }) => {
      const sp = new URLSearchParams(params.toString());
      if (next.tab !== undefined) {
        if (next.tab === "approve") sp.delete("tab");
        else sp.set("tab", next.tab);
      }
      if (next.id !== undefined) {
        if (next.id) sp.set("id", next.id);
        else sp.delete("id");
      }
      const qs = sp.toString();
      router.replace(`/dashboard/inbox/email${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [params, router],
  );

  const q = useQuery({
    queryKey: ["inbox-email", tab, idParam],
    queryFn: async (): Promise<EmailQueueResponse> => {
      const sp = new URLSearchParams({ tab });
      if (idParam) sp.set("id", idParam);
      const r = await fetch(`/api/inbox/email?${sp.toString()}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || `email drafts ${r.status}`);
      return j as EmailQueueResponse;
    },
    refetchInterval: POLL_MS,
    placeholderData: keepPreviousData,
  });

  const data = q.data;
  const items = useMemo(() => data?.items ?? [], [data]);
  const selected = data?.selected ?? null;
  const selectedId = selected?.id ?? null;

  // A link from Conversations carries only ?id=. If that email lives in
  // another tab (say it was already sent), open that tab so the list and
  // stepper match what's on screen.
  useEffect(() => {
    if (params.has("tab") || !selected || !idParam || selected.id !== idParam) return;
    if (selected.tab && selected.tab !== "approve") setQuery({ tab: selected.tab, id: selected.id });
  }, [params, selected, idParam, setQuery]);

  // The thread on screen right now, read after an action finishes to decide
  // whether to move on (don't yank the user if they already moved).
  const shownIdRef = useRef<string | null>(null);
  useEffect(() => {
    shownIdRef.current = selectedId;
  }, [selectedId]);

  // One in-flight flag per thread: all four buttons disable together.
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [notices, setNotices] = useState<Record<string, Notice | undefined>>({});
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [rewriteOpen, setRewriteOpen] = useState<{ id: string; text: string } | null>(null);
  const [pendingRewrite, setPendingRewrite] = useState<{ id: string; fromRevision: number } | null>(null);
  const [showAll, setShowAll] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState<string | null>(null);
  // Threads this page already approved or skipped. Their buttons never come
  // back, even if a stale copy of the row is still on screen for a moment.
  const [doneIds, setDoneIds] = useState<Record<string, boolean>>({});

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ["inbox-email"] }), [qc]);

  const runAction = useCallback(
    async (threadId: string, body: ActionBody) => {
      // Where to go if this email leaves the queue (approve/skip).
      const ids = items.map((i) => i.id);
      const pos = stepIndex(ids, threadId);
      const moveTo = ids.includes(threadId) ? (pos.next ?? pos.prev) : null;

      setBusy((b) => ({ ...b, [threadId]: true }));
      setNotices((n) => ({ ...n, [threadId]: undefined }));
      try {
        const r = await fetch(`/api/inbox/email/${threadId}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = (await r.json().catch(() => ({}))) as { ok?: boolean; status?: string; error?: string; revision?: number };

        if (r.ok && j.ok) {
          if (body.action === "approve" && j.status === "already_sent") {
            // Someone (Slack or another tab) got there first. Stay on this
            // email and let the refetch show its real status.
            setNotices((n) => ({ ...n, [threadId]: { tone: "plain", title: "This email was already handled. Showing where it stands now." } }));
          } else if (body.action === "approve" || body.action === "skip") {
            setDoneIds((d) => ({ ...d, [threadId]: true }));
            if (shownIdRef.current === threadId) setQuery({ id: moveTo });
          } else if (body.action === "edit") {
            setEditing(null);
          } else if (body.action === "rewrite") {
            // Phone keeps Rewrite inside the Edit sheet; close both so the
            // new draft shows once it lands.
            setRewriteOpen(null);
            setEditing(null);
          }
          return;
        }

        if (r.status === 409) {
          const title = j.status === "draft_changed" || !j.error ? DRAFT_CHANGED_MESSAGE : `${stripStop(j.error)}.`;
          setNotices((n) => ({ ...n, [threadId]: { tone: "crit", title } }));
          return;
        }

        if (body.action === "rewrite") setPendingRewrite(null);
        setNotices((n) => ({
          ...n,
          [threadId]: { tone: "crit", title: failureTitle(body.action, j.error || `request failed (${r.status})`) },
        }));
      } catch (e) {
        if (body.action === "rewrite") setPendingRewrite(null);
        const msg = e instanceof Error ? e.message : String(e);
        setNotices((n) => ({ ...n, [threadId]: { tone: "crit", title: failureTitle(body.action, msg) } }));
      } finally {
        setConfirming(null);
        // Keep the buttons disabled until the fresh row is on screen.
        await refresh().catch(() => undefined);
        setBusy((b) => ({ ...b, [threadId]: false }));
      }
    },
    [items, setQuery, refresh],
  );

  const counts = data?.counts;
  const waiting = counts?.approve ?? 0;
  const title = !counts ? "Email drafts" : waiting === 0 ? "No drafts waiting" : `${waiting} draft${waiting === 1 ? "" : "s"} waiting`;
  const chipItems: ChipItem[] = (Object.keys(TAB_LABELS) as EmailQueueTab[]).map((k) => ({
    key: k,
    label: TAB_LABELS[k],
    count: counts ? counts[k] : undefined,
  }));

  const header = (
    <PageHeader
      crumb="Inbox · Email drafts"
      title={title}
      actions={
        <Chips
          items={chipItems}
          value={tab}
          onChange={(k) => {
            if (isEmailQueueTab(k)) setQuery({ tab: k, id: null });
          }}
          ariaLabel="Email drafts list"
        />
      }
    />
  );

  if (q.isError && !data) {
    return (
      <>
        {header}
        <div className="pm2-body">
          <Callout
            tone="crit"
            title="Couldn't load email drafts"
            body={q.error instanceof Error ? q.error.message : "Something went wrong."}
            action={
              <button type="button" className="pm2-btn pri sm" onClick={() => q.refetch()}>
                Retry
              </button>
            }
          />
        </div>
      </>
    );
  }

  if (!data) {
    return (
      <>
        {header}
        <div className="pm2-body">
          <div className="pm2-skel" style={{ minHeight: 400 }} />
        </div>
      </>
    );
  }

  const isBusy = selectedId ? Boolean(busy[selectedId]) : false;
  // Actions only on a live, un-actioned "To approve" row: never on a
  // placeholder from the previous query key, never on a thread this page
  // already approved or skipped.
  const canAct = selected?.tab === "approve" && !q.isPlaceholderData && !doneIds[selected.id];
  const notice = selectedId ? notices[selectedId] : undefined;
  const isEditing = Boolean(selected && editing?.id === selected.id);
  const rewriting =
    selected && pendingRewrite?.id === selected.id && (selected.draft?.revision ?? 0) <= pendingRewrite.fromRevision;

  const onApprove = () => {
    if (!selected?.draft || !canAct) return;
    // Pin the revision rendered right now. If a newer draft lands before the
    // confirm, the edge refuses with "The draft changed".
    setConfirming({ kind: "approve", threadId: selected.id, draftRevisionId: selected.draft.id, to: selected.from_email });
  };
  const onSkip = () => {
    if (!selected || !canAct) return;
    setConfirming({ kind: "skip", threadId: selected.id });
  };
  const onEdit = () => {
    if (!selected || !canAct) return;
    setEditing({ id: selected.id, text: selected.draft?.body ?? "" });
    setRewriteOpen(null);
  };
  const onRewriteOpen = () => {
    if (!selected || !canAct) return;
    setRewriteOpen({ id: selected.id, text: "" });
  };
  const onRewriteSubmit = (text: string) => {
    if (!selected || !canAct) return;
    const feedback = text.trim();
    setPendingRewrite({ id: selected.id, fromRevision: selected.draft?.revision ?? 0 });
    void runAction(selected.id, feedback ? { action: "rewrite", feedback } : { action: "rewrite" });
  };
  const onSaveEdit = () => {
    if (!selected || !editing || editing.id !== selected.id || !canAct) return;
    void runAction(selected.id, { action: "edit", body: editing.text });
  };

  const ids = items.map((i) => i.id);
  const inList = selectedId ? ids.includes(selectedId) : false;
  const step = stepIndex(ids, selectedId);

  const detail = selected ? (
    <Detail
      s={selected}
      isPhone={isPhone}
      canAct={canAct}
      busy={isBusy}
      notice={notice}
      rewriting={Boolean(rewriting)}
      editing={isEditing ? editing!.text : null}
      onEditText={(text) => setEditing({ id: selected.id, text })}
      onCancelEdit={() => setEditing(null)}
      onSaveEdit={onSaveEdit}
      rewriteText={rewriteOpen?.id === selected.id ? rewriteOpen.text : null}
      onRewriteText={(text) => setRewriteOpen({ id: selected.id, text })}
      onRewriteCancel={() => setRewriteOpen(null)}
      onRewriteSubmit={onRewriteSubmit}
      showAll={showAll === selected.id}
      onShowAll={() => setShowAll(selected.id)}
      historyOpen={historyOpen === selected.id}
      onToggleHistory={() => setHistoryOpen((h) => (h === selected.id ? null : selected.id))}
      onApprove={onApprove}
      onEdit={onEdit}
      onRewriteOpen={onRewriteOpen}
      onSkip={onSkip}
    />
  ) : (
    <div className="pm2-panel">
      <div className="pm2-empty">{tab === "approve" ? "Nothing waiting. Every email has been answered or skipped." : "No emails here."}</div>
    </div>
  );

  const dialog = confirming ? (
    confirming.kind === "approve" ? (
      <ConfirmDialog
        title={`Send this reply to ${confirming.to}?`}
        body="It goes out from the support mailbox. This cannot be undone."
        confirmLabel="Send reply"
        busy={Boolean(busy[confirming.threadId])}
        onConfirm={() =>
          void runAction(confirming.threadId, { action: "approve", draft_revision_id: confirming.draftRevisionId })
        }
        onClose={() => setConfirming(null)}
      />
    ) : (
      <ConfirmDialog
        title="Skip this email?"
        body="Similar emails will be skipped automatically."
        confirmLabel="Skip"
        busy={Boolean(busy[confirming.threadId])}
        onConfirm={() => void runAction(confirming.threadId, { action: "skip" })}
        onClose={() => setConfirming(null)}
      />
    )
  ) : null;

  if (isPhone) {
    const showBar = Boolean(selected && canAct && !isEditing);
    return (
      <>
        {header}
        <div className="pm2-body" style={showBar ? { paddingBottom: 96 } : undefined}>
          {selected ? (
            <div className="pm2-drafts-step" style={{ alignItems: "center", gap: 10, fontSize: 13.5 }}>
              {inList ? (
                <b>
                  {step.index + 1} of {step.total}
                </b>
              ) : (
                <b>Not in this list</b>
              )}
              <span style={{ color: "var(--pm-muted)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {(selected.from_name?.trim() || selected.from_email) + " · " + selected.category}
              </span>
              <span style={{ marginLeft: "auto", display: "flex", gap: 12, flexShrink: 0 }}>
                {inList && step.prev ? (
                  <button type="button" className="pm2-btn ghost sm" onClick={() => setQuery({ id: step.prev })}>
                    ← Prev
                  </button>
                ) : null}
                {inList ? (
                  step.next ? (
                    <button type="button" className="pm2-btn ghost sm" onClick={() => setQuery({ id: step.next })}>
                      Next →
                    </button>
                  ) : null
                ) : ids[0] ? (
                  <button type="button" className="pm2-btn ghost sm" onClick={() => setQuery({ id: ids[0] })}>
                    Next →
                  </button>
                ) : null}
              </span>
            </div>
          ) : null}
          {detail}
        </div>
        {showBar && selected ? (
          <div
            style={{
              position: "fixed",
              left: 0,
              right: 0,
              bottom: "calc(62px + env(safe-area-inset-bottom))",
              zIndex: 55,
              display: "flex",
              gap: 8,
              padding: "10px 16px",
              background: "var(--pm-card)",
              borderTop: "1px solid var(--pm-line)",
            }}
          >
            <button type="button" className="pm2-btn pri" disabled={isBusy || !selected.draft} onClick={onApprove}>
              Approve &amp; send
            </button>
            <button type="button" className="pm2-btn" disabled={isBusy} onClick={onEdit}>
              Edit
            </button>
            <button type="button" className="pm2-btn ghost" disabled={isBusy} onClick={onSkip}>
              Skip
            </button>
          </div>
        ) : null}
        {dialog}
      </>
    );
  }

  return (
    <>
      {header}
      <div className="pm2-body">
        <div className="pm2-g12">
          <div className="pm2-panel pm2-drafts-list" style={{ alignSelf: "start", maxHeight: "calc(100dvh - 180px)", overflowY: "auto" }}>
            {items.length === 0 ? (
              <div className="pm2-empty">{tab === "approve" ? "No drafts waiting." : "No emails here."}</div>
            ) : (
              items.map((it) => (
                <ListRow
                  key={it.id}
                  name={it.from_name?.trim() || it.from_email}
                  pill={
                    <Pill tone={it.urgency?.tone ?? "neu"} plain>
                      {it.category}
                    </Pill>
                  }
                  preview={it.subject || "(no subject)"}
                  when={formatWhen(it.created_at)}
                  selected={it.id === selectedId}
                  onClick={() => setQuery({ id: it.id })}
                />
              ))
            )}
          </div>
          {detail}
        </div>
      </div>
      {dialog}
    </>
  );
}

function Detail({
  s,
  isPhone,
  canAct,
  busy,
  notice,
  rewriting,
  editing,
  onEditText,
  onCancelEdit,
  onSaveEdit,
  rewriteText,
  onRewriteText,
  onRewriteCancel,
  onRewriteSubmit,
  showAll,
  onShowAll,
  historyOpen,
  onToggleHistory,
  onApprove,
  onEdit,
  onRewriteOpen,
  onSkip,
}: {
  s: EmailQueueSelected;
  isPhone: boolean;
  canAct: boolean;
  busy: boolean;
  notice: Notice | undefined;
  rewriting: boolean;
  editing: string | null;
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
}) {
  const clip = clipText(s.body_plain, BODY_CLIP);
  const bodyText = showAll ? (s.body_plain ?? "") : clip.text;
  const editTrimmed = (editing ?? "").trim();
  const editValid = editTrimmed.length >= 1 && editTrimmed.length <= EDIT_MAX_CHARS;

  // Phone keeps Rewrite inside the Edit sheet; laptop has its own button.
  const rewriteBox =
    rewriteText !== null || (isPhone && editing !== null) ? (
      <div className="pm2-composer" style={{ marginTop: 12, boxShadow: "none" }}>
        <input
          type="text"
          value={rewriteText ?? ""}
          maxLength={FEEDBACK_MAX_CHARS}
          placeholder="What should change?"
          aria-label="What should change?"
          onChange={(e) => onRewriteText(e.target.value)}
          disabled={busy}
          style={{
            border: 0,
            background: "var(--pm-card2)",
            borderRadius: 8,
            padding: "8px 10px",
            color: "var(--pm-ink)",
            fontFamily: "var(--pm-font)",
            fontSize: 14,
          }}
        />
        <div className="row">
          <button type="button" className="pm2-btn sm" disabled={busy} onClick={() => onRewriteSubmit(rewriteText ?? "")}>
            Rewrite draft
          </button>
          {!isPhone ? (
            <button type="button" className="pm2-btn ghost sm" disabled={busy} onClick={onRewriteCancel}>
              Cancel
            </button>
          ) : null}
        </div>
      </div>
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
        {notice ? (
          <div style={{ marginBottom: 12 }}>
            <Callout tone={notice.tone} title={notice.title} />
          </div>
        ) : null}

        <div className="pm2-bub in" style={{ maxWidth: "100%", marginBottom: 12 }}>
          {bodyText || "No preview available."}
          {clip.clipped && !showAll ? (
            <>
              {" "}
              <button type="button" className="pm2-btn ghost sm" onClick={onShowAll} style={{ display: "inline-flex" }}>
                Show all
              </button>
            </>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {s.urgency ? <Pill tone={s.urgency.tone}>{s.urgency.text}</Pill> : null}
          <Pill tone="neu" plain>
            {s.category}
          </Pill>
          {!canAct ? (
            <Pill tone={s.status === "failed" ? "crit" : "neu"}>{statusWord(s)}</Pill>
          ) : null}
        </div>

        {s.sent ? (
          <div
            style={{
              borderLeft: "3px solid var(--pm-border)",
              background: "var(--pm-card2)",
              borderRadius: "0 8px 8px 0",
              padding: "12px 14px",
              fontSize: 14.5,
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            <div style={eyebrowStyle}>
              Sent reply · {agoText(s.sent.sent_at)} · approved by {s.sent.approved_by ?? "Slack"}
            </div>
            {s.sent.body}
          </div>
        ) : editing !== null && canAct ? (
          <div className="pm2-composer" style={{ boxShadow: "none" }}>
            <textarea
              value={editing}
              maxLength={EDIT_MAX_CHARS}
              onChange={(e) => onEditText(e.target.value)}
              aria-label="Edit the draft"
              disabled={busy}
              style={{ minHeight: 220, maxHeight: "none", resize: "vertical" }}
            />
            <div className="row">
              <button type="button" className="pm2-btn pri sm" disabled={busy || !editValid} onClick={onSaveEdit}>
                Save draft
              </button>
              <button type="button" className="pm2-btn ghost sm" disabled={busy} onClick={onCancelEdit}>
                Cancel
              </button>
            </div>
          </div>
        ) : s.draft ? (
          <div
            style={{
              borderLeft: "3px solid var(--pm-brand)",
              background: "var(--pm-card2)",
              borderRadius: "0 8px 8px 0",
              padding: "12px 14px",
              fontSize: 14.5,
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              opacity: rewriting ? 0.6 : 1,
            }}
          >
            <div style={eyebrowStyle}>
              {canAct ? `Draft · reply goes to ${s.from_email} · grounded in Master KB` : "Draft · not sent"}
            </div>
            {s.draft.body}
          </div>
        ) : (
          <div className="pm2-empty" style={{ textAlign: "left", padding: "8px 0" }}>
            No draft for this email.
          </div>
        )}

        {rewriting ? (
          <div style={{ marginTop: 8, fontSize: 13, color: "var(--pm-muted)" }} role="status">
            Writing a new draft…
          </div>
        ) : null}

        {canAct ? rewriteBox : null}

        {canAct && !isPhone && editing === null ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
            <button type="button" className="pm2-btn pri" disabled={busy || !s.draft} onClick={onApprove}>
              Approve &amp; send
            </button>
            <button type="button" className="pm2-btn" disabled={busy} onClick={onEdit}>
              Edit
            </button>
            <button type="button" className="pm2-btn" disabled={busy} onClick={onRewriteOpen}>
              Rewrite
            </button>
            <button type="button" className="pm2-btn ghost" disabled={busy} onClick={onSkip}>
              Skip
            </button>
            {s.revisions.length > 0 ? (
              <button
                type="button"
                className="pm2-btn ghost sm"
                style={{ marginLeft: "auto" }}
                aria-expanded={historyOpen}
                onClick={onToggleHistory}
              >
                How this was drafted
              </button>
            ) : null}
          </div>
        ) : s.revisions.length > 0 ? (
          <div style={{ marginTop: 12 }}>
            <button type="button" className="pm2-btn ghost sm" aria-expanded={historyOpen} onClick={onToggleHistory}>
              How this was drafted
            </button>
          </div>
        ) : null}

        {historyOpen && s.revisions.length > 0 ? (
          <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none", fontSize: 13, color: "var(--pm-muted)", display: "grid", gap: 4 }}>
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

const eyebrowStyle: React.CSSProperties = {
  fontFamily: "var(--pm-mono)",
  fontSize: 11.5,
  color: "var(--pm-hint)",
  textTransform: "uppercase",
  letterSpacing: ".04em",
  marginBottom: 6,
};
