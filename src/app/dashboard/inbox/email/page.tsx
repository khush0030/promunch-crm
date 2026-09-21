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
// never on sent, skipped, failed, sending or no-reply threads. Approve is
// also hidden when the sender can't receive a reply (replyBlockedReason).

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader, Chips, ListRow, Pill, Callout, ConfirmDialog } from "@/components/pm";
import type { ChipItem } from "@/components/pm";
import { useMediaPhone } from "@/components/shell/useMediaPhone";
import { EmailDetail } from "@/components/inbox/email/EmailDetail";
import { PhoneStepBar } from "@/components/inbox/email/PhoneStepBar";
import { PhoneActionBar } from "@/components/inbox/email/PhoneActionBar";
import { formatWhen } from "@/lib/inbox/when";
import {
  actionOutcome,
  isEmailQueueTab,
  oldEmailDays,
  replyBlockedReason,
  settleNotice,
  stepIndex,
  type DraftAction,
  type EmailQueueResponse,
  type EmailQueueTab,
} from "@/lib/inbox/email";

const TAB_LABELS: Record<EmailQueueTab, string> = {
  approve: "To approve",
  attention: "Needs attention",
  noreply: "No reply needed",
  sent: "Sent",
  skipped: "Skipped",
};

const POLL_MS = 10_000;

type Notice = { tone: "crit" | "plain"; message: string; uncertain: boolean };

type ActionBody =
  | { action: "approve"; draft_revision_id: string }
  | { action: "skip" }
  | { action: "rewrite"; feedback?: string }
  | { action: "edit"; body: string };

type Confirming =
  | { kind: "approve"; threadId: string; draftRevisionId: string; to: string; daysOld: number | null }
  | { kind: "skip"; threadId: string };

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

  // One in-flight flag per thread: all four buttons disable together. The ref
  // is the synchronous guard (state updates land a render later, so a fast
  // double click could otherwise start two requests).
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const inFlightRef = useRef<Record<string, boolean>>({});
  const [notices, setNotices] = useState<Record<string, Notice | undefined>>({});
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  // baseRevision: the draft the edit started from, to warn when a newer one lands.
  const [editing, setEditing] = useState<{ id: string; text: string; baseRevision: number } | null>(null);
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
      const action: DraftAction = body.action;

      if (inFlightRef.current[threadId]) return;
      inFlightRef.current[threadId] = true;
      setBusy((b) => ({ ...b, [threadId]: true }));
      setNotices((n) => ({ ...n, [threadId]: undefined }));
      let httpStatus: number | null = null;
      let json: Record<string, unknown> | null = null;
      try {
        const r = await fetch(`/api/inbox/email/${threadId}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        httpStatus = r.status;
        json = (await r.json().catch(() => null)) as Record<string, unknown> | null;
      } catch {
        // Network drop: httpStatus stays null, actionOutcome reads it as
        // "couldn't confirm" for approve.
      }

      try {
        const out = actionOutcome(action, { httpStatus, body: json });
        if (out.kind === "success") {
          if (action === "approve" && out.status === "already_sent") {
            // Someone (Slack or another tab) got there first. Stay on this
            // email and let the refetch show its real status.
            setNotices((n) => ({
              ...n,
              [threadId]: { tone: "plain", message: "This email was already handled. Showing where it stands now.", uncertain: false },
            }));
          } else if (action === "approve" || action === "skip") {
            setDoneIds((d) => ({ ...d, [threadId]: true }));
            if (shownIdRef.current === threadId) setQuery({ id: moveTo });
          } else if (action === "edit") {
            setEditing(null);
          } else {
            // Phone keeps Rewrite inside the Edit sheet; close both so the
            // new draft shows once it lands.
            setRewriteOpen(null);
            setEditing(null);
          }
        } else {
          if (action === "rewrite") setPendingRewrite(null);
          setNotices((n) => ({ ...n, [threadId]: { tone: out.tone, message: out.message, uncertain: out.uncertain } }));
        }
      } finally {
        setConfirming(null);
        // Keep the buttons disabled until the fresh row is on screen. For an
        // uncertain send this refetch is what settles the notice.
        await refresh().catch(() => undefined);
        inFlightRef.current[threadId] = false;
        setBusy((b) => ({ ...b, [threadId]: false }));
      }
    },
    [items, setQuery, refresh],
  );

  const counts = data?.counts;
  const waiting = counts?.approve ?? null;
  const title =
    waiting == null ? "Email drafts" : waiting === 0 ? "No drafts waiting" : `${waiting} draft${waiting === 1 ? "" : "s"} waiting`;
  const chipItems: ChipItem[] = (Object.keys(TAB_LABELS) as EmailQueueTab[]).map((k) => ({
    key: k,
    label: TAB_LABELS[k],
    count: counts?.[k] ?? undefined,
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
  const blocked = selected ? replyBlockedReason(selected.from_email, selected.body_plain) : null;
  const rawNotice = selectedId ? notices[selectedId] : undefined;
  const notice = rawNotice && selected ? settleNotice(rawNotice, selected.tab, selected.status) : null;
  // "N days old" warning, only for emails still waiting in To approve.
  const selectedDaysOld = selected?.tab === "approve" ? oldEmailDays(selected.created_at) : null;
  const edit = selected && editing?.id === selected.id ? editing : null;
  const newerDraftWhileEditing = Boolean(edit && selected?.draft && selected.draft.revision > edit.baseRevision);
  const rewriting = Boolean(
    selected && pendingRewrite?.id === selected.id && (selected.draft?.revision ?? 0) <= pendingRewrite.fromRevision,
  );

  const onApprove = () => {
    if (!selected?.draft || !canAct || blocked) return;
    // Pin the revision rendered right now. If a newer draft lands before the
    // confirm, the edge refuses with "The draft changed".
    setConfirming({
      kind: "approve",
      threadId: selected.id,
      draftRevisionId: selected.draft.id,
      to: selected.from_email,
      daysOld: oldEmailDays(selected.created_at),
    });
  };
  const onSkip = () => {
    if (!selected || !canAct) return;
    setConfirming({ kind: "skip", threadId: selected.id });
  };
  const onEdit = () => {
    if (!selected || !canAct) return;
    setEditing({ id: selected.id, text: selected.draft?.body ?? "", baseRevision: selected.draft?.revision ?? 0 });
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
    if (!selected || !edit || !canAct) return;
    void runAction(selected.id, { action: "edit", body: edit.text });
  };

  const ids = items.map((i) => i.id);
  const inList = selectedId ? ids.includes(selectedId) : false;
  const step = stepIndex(ids, selectedId);

  const detail = selected ? (
    <EmailDetail
      s={selected}
      isPhone={isPhone}
      canAct={canAct}
      blockedMessage={blocked?.message ?? null}
      busy={isBusy}
      daysOld={selectedDaysOld}
      notice={notice}
      rewriting={rewriting}
      editing={edit ? edit.text : null}
      newerDraftWhileEditing={newerDraftWhileEditing}
      onEditText={(text) => setEditing((e) => (e && e.id === selected.id ? { ...e, text } : e))}
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
      <div className="pm2-empty">
        {tab === "approve"
          ? "Nothing waiting. Every email has been answered or skipped."
          : tab === "attention"
            ? "Nothing needs attention."
            : "No emails here."}
      </div>
    </div>
  );

  const dialog = confirming ? (
    confirming.kind === "approve" ? (
      <ConfirmDialog
        title={`Send this reply to ${confirming.to}?`}
        body={`It goes out from the support mailbox. This cannot be undone.${
          confirming.daysOld != null ? ` This email is ${confirming.daysOld} days old.` : ""
        }`}
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
    const showBar = Boolean(selected && canAct && !edit);
    return (
      <>
        {header}
        <div className={`pm2-body${showBar ? " pm2-has-bar" : ""}`}>
          {selected ? (
            <PhoneStepBar
              inList={inList}
              index={step.index}
              total={step.total}
              who={`${selected.from_name?.trim() || selected.from_email} · ${selected.category}`}
              prevId={inList ? step.prev : null}
              nextId={inList ? step.next : (ids[0] ?? null)}
              onGo={(id) => setQuery({ id })}
            />
          ) : null}
          {detail}
        </div>
        {showBar && selected ? (
          <PhoneActionBar
            busy={isBusy}
            showApprove={!blocked}
            canApprove={Boolean(selected.draft)}
            onApprove={onApprove}
            onEdit={onEdit}
            onSkip={onSkip}
          />
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
          <div className="pm2-panel pm2-drafts-list">
            {items.length === 0 ? (
              <div className="pm2-empty">{tab === "approve" ? "No drafts waiting." : "No emails here."}</div>
            ) : (
              items.map((it) => {
                const daysOld = tab === "approve" ? oldEmailDays(it.created_at) : null;
                return (
                <ListRow
                  key={it.id}
                  name={it.from_name?.trim() || it.from_email}
                  pill={
                    <>
                      <Pill tone={it.urgency?.tone ?? "neu"} plain>
                        {it.category}
                      </Pill>
                      {daysOld != null ? <Pill tone="warn">{`${daysOld} days old`}</Pill> : null}
                    </>
                  }
                  preview={it.subject || "(no subject)"}
                  when={formatWhen(it.created_at)}
                  selected={it.id === selectedId}
                  onClick={() => setQuery({ id: it.id })}
                />
                );
              })
            )}
          </div>
          {detail}
        </div>
      </div>
      {dialog}
    </>
  );
}
