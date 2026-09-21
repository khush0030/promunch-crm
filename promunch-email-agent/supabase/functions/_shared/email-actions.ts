// Draft actions shared by Slack (slack-interactivity buttons, slack-events
// thread commands/feedback) and the CRM Inbox (email-draft-action).
//
// None of these send an email. Sending lives only in _shared/approve.ts behind
// its atomic claim. These functions change a thread's draft or status, and
// they refuse once a thread is `sent` or `sending` so a CRM action can never
// race an in-flight send into an inconsistent state (§0).
//
// Slack is optional everywhere: when the caller passes no `slack` target the
// thread row's own slack_channel_id / slack_thread_ts are used, and when the
// thread was never posted to Slack there is no Slack call at all.

import { db } from "./supabase.ts";
import { generateDraft } from "./openai.ts";
import { postDraftRevision, replyInThread } from "./slack.ts";
import { logEvent } from "./log.ts";
import { recordFeedback } from "./brand.ts";
import { insertRevision } from "./process-email.ts";

export type EmailActionResult = {
  ok: boolean;
  status?: "skipped" | "rewritten" | "saved";
  error?: string;
  revision?: number;
};

export type SlackTarget = { channel: string; threadTs: string };

// Where an action came from. Drives the exact Slack wording and log detail so
// the Slack-initiated paths stay textually identical to what they were before
// this module existed.
export type ActionSource =
  | { kind: "slack-button"; slackUser: string }
  | { kind: "slack-command"; slackUser: string | null; command: string }
  | { kind: "slack-feedback"; slackUser: string | null }
  | { kind: "crm"; email: string };

const ALREADY_SENT = "already sent";
const ALREADY_SENT_SLACK = ":information_source: Already sent (or send in progress).";

// The regenerate button's instruction to the model. Internal prompt text (not
// customer copy); kept byte-identical to the old inline slack-interactivity one.
const REGENERATE_FEEDBACK =
  "Please regenerate this draft with a different angle — same intent, fresh wording.";

function actorOf(source: ActionSource): string {
  switch (source.kind) {
    case "crm":
      return source.email;
    case "slack-button":
      return source.slackUser;
    default:
      return source.slackUser ?? "system";
  }
}

function slackTargetFor(
  explicit: SlackTarget | null | undefined,
  row: { slack_channel_id: string | null; slack_thread_ts: string | null },
): SlackTarget | null {
  if (explicit) return explicit;
  if (row.slack_channel_id && row.slack_thread_ts) {
    return { channel: row.slack_channel_id, threadTs: row.slack_thread_ts };
  }
  return null;
}

function isLocked(status: string | null | undefined): boolean {
  return status === "sent" || status === "sending";
}

// Slack must never block or fail a DB action that already happened.
async function slackSafe(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.warn("[email-actions] Slack post failed (non-fatal):", e);
  }
}

// ---------------------------------------------------------------------------
// Skip: mark the thread skipped (no reply will ever be sent for it).
// ---------------------------------------------------------------------------
export async function skipThread(opts: {
  emailThreadId: string;
  source: ActionSource;
  slack?: SlackTarget | null;
}): Promise<EmailActionResult> {
  const { data: t } = await db()
    .from("email_threads")
    .select("from_email, subject, snippet, body_plain, status, slack_channel_id, slack_thread_ts")
    .eq("id", opts.emailThreadId)
    .maybeSingle();
  if (!t) return { ok: false, error: "thread not found" };
  const slack = slackTargetFor(opts.slack, t);

  // Guarded UPDATE: never overwrite a sent/sending thread, even if approve won
  // the claim between our read and this write.
  const { data: updated, error: uErr } = await db()
    .from("email_threads")
    .update({ status: "skipped" })
    .eq("id", opts.emailThreadId)
    .not("status", "in", '("sent","sending")')
    .select("id");
  if (uErr) return { ok: false, error: uErr.message };
  if (!updated || updated.length === 0) {
    if (slack && opts.source.kind !== "crm") {
      await slackSafe(() => replyInThread(slack.channel, slack.threadTs, ALREADY_SENT_SLACK));
    }
    return { ok: false, error: ALREADY_SENT };
  }

  const source = opts.source;
  if (source.kind === "slack-command") {
    await logEvent({
      eventType: "skipped",
      emailThreadId: opts.emailThreadId,
      fromEmail: t.from_email,
      subject: t.subject,
      actor: actorOf(source),
      detail: { via: "slack-thread-command", command: source.command },
    });
  } else {
    await logEvent({
      eventType: "skipped",
      emailThreadId: opts.emailThreadId,
      actor: actorOf(source),
      detail: { via: source.kind === "crm" ? "crm" : "skip-button" },
    });
  }

  // Teach the classifier: this sender/subject pattern is no-reply. Same as the
  // Slack Skip button; the typed "skip" thread command never did this, so it
  // still doesn't.
  if (source.kind !== "slack-command") {
    try {
      await db().from("brand_knowledge").insert({
        kind: "feedback_pattern",
        inbound_subject: t.subject,
        inbound_excerpt: (t.snippet || t.body_plain || "").slice(0, 800),
        feedback: `no_reply (sender=${t.from_email})`,
        tags: [source.kind === "crm" ? "crm-skip" : "skip-button", "no-reply"],
        source_thread_id: opts.emailThreadId,
      });
    } catch (_) { /* non-fatal */ }
  }

  if (slack) {
    const text = source.kind === "slack-button"
      ? `:wastebasket: Skipped by <@${source.slackUser}>. _Future emails like this will be auto-skipped._`
      : source.kind === "slack-command"
      ? ":wastebasket: Skipped — no reply will be sent."
      : `:wastebasket: Skipped in CRM by ${actorOf(source)}.`;
    await slackSafe(() => replyInThread(slack.channel, slack.threadTs, text));
  }

  return { ok: true, status: "skipped" };
}

// ---------------------------------------------------------------------------
// Rewrite: ask the model for a new draft (optionally steered by feedback).
// ---------------------------------------------------------------------------
export async function rewriteDraft(opts: {
  emailThreadId: string;
  source: ActionSource;
  feedback?: string | null;
  slack?: SlackTarget | null;
}): Promise<EmailActionResult> {
  const { data: thread } = await db()
    .from("email_threads")
    .select("from_name, from_email, subject, body_plain, status, slack_channel_id, slack_thread_ts")
    .eq("id", opts.emailThreadId)
    .maybeSingle();
  if (!thread) return { ok: false, error: "thread not found" };
  const slack = slackTargetFor(opts.slack, thread);
  const source = opts.source;

  if (isLocked(thread.status)) {
    if (slack && source.kind !== "crm") {
      await slackSafe(() => replyInThread(slack.channel, slack.threadTs, ALREADY_SENT_SLACK));
    }
    return { ok: false, error: ALREADY_SENT };
  }

  const userFeedback = (opts.feedback ?? "").trim() || null;

  const { data: cur } = await db()
    .from("draft_revisions")
    .select("body, revision")
    .eq("email_thread_id", opts.emailThreadId)
    .eq("is_current", true)
    .maybeSingle();

  const { body: newDraft, model } = await generateDraft({
    fromName: thread.from_name,
    fromEmail: thread.from_email,
    subject: thread.subject,
    body: thread.body_plain ?? "",
    priorDraft: cur?.body ?? null,
    feedback: source.kind === "slack-button" ? REGENERATE_FEEDBACK : userFeedback ?? REGENERATE_FEEDBACK,
  });

  // What is stored on the revision row (unchanged for the Slack paths).
  const storedFeedback = source.kind === "slack-button"
    ? "(regenerate button)"
    : source.kind === "crm"
    ? (userFeedback ?? "(rewritten in CRM)")
    : userFeedback;

  // Backoff-safe insert: null means a concurrent twin already created this
  // revision number and will post it, so we stop (never double-post).
  const rev = await insertRevision(opts.emailThreadId, newDraft, model, storedFeedback);
  if (!rev) return { ok: false, error: "another revision was saved at the same time, try again" };

  if (slack) {
    if (source.kind === "crm") {
      await slackSafe(() =>
        replyInThread(
          slack.channel,
          slack.threadTs,
          `:arrows_counterclockwise: Draft rewritten in CRM by ${source.email}.`,
        )
      );
    }
    await slackSafe(async () => {
      const posted = await postDraftRevision({
        channel: slack.channel,
        threadTs: slack.threadTs,
        revision: rev.revision,
        feedback: source.kind === "slack-button" ? null : userFeedback,
        draftBody: newDraft,
        emailThreadId: opts.emailThreadId,
        draftRevisionId: rev.id,
      });
      await db()
        .from("draft_revisions")
        .update({ slack_message_ts: posted.ts })
        .eq("id", rev.id);
    });
  }

  if (source.kind === "slack-feedback") {
    await logEvent({
      eventType: "revised",
      emailThreadId: opts.emailThreadId,
      fromEmail: thread.from_email,
      subject: thread.subject,
      actor: "claude",
      detail: { revision: rev.revision, model, feedback: userFeedback, trigger: "slack-feedback" },
    });
  } else {
    await logEvent({
      eventType: "regenerated",
      emailThreadId: opts.emailThreadId,
      fromEmail: thread.from_email,
      subject: thread.subject,
      actor: "claude",
      detail: source.kind === "crm"
        ? { revision: rev.revision, model, via: "crm", requested_by: source.email, feedback: userFeedback }
        : { revision: rev.revision, model, via: "regenerate-button" },
    });
  }

  // Teach the brain: this feedback → this corrected reply (Slack feedback and
  // CRM rewrites that carry an instruction; a bare regenerate teaches nothing).
  if (userFeedback && (source.kind === "slack-feedback" || source.kind === "crm")) {
    await recordFeedback({
      threadId: opts.emailThreadId,
      subject: thread.subject,
      feedback: userFeedback,
      resultingReply: newDraft,
    });
  }

  return { ok: true, status: "rewritten", revision: rev.revision };
}

// ---------------------------------------------------------------------------
// Edit: a team member replaces the draft text by hand (CRM only).
// ---------------------------------------------------------------------------
export async function saveEditedDraft(opts: {
  emailThreadId: string;
  body: string;
  actorEmail: string;
}): Promise<EmailActionResult> {
  const { data: thread } = await db()
    .from("email_threads")
    .select("from_email, subject, status, slack_channel_id, slack_thread_ts")
    .eq("id", opts.emailThreadId)
    .maybeSingle();
  if (!thread) return { ok: false, error: "thread not found" };
  if (isLocked(thread.status)) return { ok: false, error: ALREADY_SENT };

  const rev = await insertRevision(opts.emailThreadId, opts.body, "human-edit", "(edited in CRM)");
  if (!rev) return { ok: false, error: "another revision was saved at the same time, try again" };

  const slack = slackTargetFor(null, thread);
  if (slack) {
    await slackSafe(() =>
      replyInThread(
        slack.channel,
        slack.threadTs,
        `:pencil2: Draft edited in CRM by ${opts.actorEmail}.`,
      )
    );
    await slackSafe(async () => {
      const posted = await postDraftRevision({
        channel: slack.channel,
        threadTs: slack.threadTs,
        revision: rev.revision,
        feedback: null,
        draftBody: opts.body,
        emailThreadId: opts.emailThreadId,
        draftRevisionId: rev.id,
      });
      await db()
        .from("draft_revisions")
        .update({ slack_message_ts: posted.ts })
        .eq("id", rev.id);
    });
  }

  await logEvent({
    eventType: "revised",
    emailThreadId: opts.emailThreadId,
    fromEmail: thread.from_email,
    subject: thread.subject,
    actor: opts.actorEmail,
    detail: { revision: rev.revision, model: "human-edit", trigger: "crm-edit" },
  });

  return { ok: true, status: "saved", revision: rev.revision };
}
