// Shared pipeline: given a fresh incoming Gmail message id, fetch it,
// generate a draft, post to Slack, and persist all state.
// Called by gmail-webhook (push) and gmail-poll (cron).
//
// Resilience contract — drafting must NEVER block Slack delivery:
//   • If Claude succeeds  → post the email + draft + Approve buttons.
//   • If Claude fails     → still post the email to Slack (no draft, no
//                           buttons) and mark the thread draft_status='failed'.
//     The message is left UNREAD so the 2-minute poll re-picks it and retries
//     the draft every cycle; once drafting recovers the draft is posted into
//     the existing Slack thread automatically.
// Every failure is recorded in connector_events so the CRM can show it.

import { getMessage, markRead } from "./gmail.ts";
import { generateDraft } from "./openai.ts";
import {
  postEmailWithDraft,
  postEmailNoDraft,
  postNoDraftReply,
  postNoReplyCard,
  postDraftRevision,
  SLACK_DEFAULT_CHANNEL,
} from "./slack.ts";
import { db } from "./supabase.ts";
import { logEvent } from "./log.ts";
import { logConnector } from "./connector-log.ts";
import { classifyEmail, type Classification } from "./classify.ts";

const MAILBOX = Deno.env.get("MAILBOX_EMAIL") ?? "hello@promunch.in";

type FetchedEmail = Awaited<ReturnType<typeof getMessage>>;

type DraftResult =
  | { ok: true; body: string; model: string }
  | { ok: false; error: string; reason: string };

// Attempt a Claude draft. Never throws — a failure is returned as
// { ok:false } and logged to connector_events so the CRM can surface it.
async function attemptDraft(input: {
  fromName: string | null;
  fromEmail: string;
  subject: string | null;
  body: string;
}): Promise<DraftResult> {
  try {
    const { body, model } = await generateDraft(input);
    // Success heartbeat so the CRM can show AI drafting as healthy. Throttled
    // — we don't need a row for every email, just proof it's alive.
    await logConnector({
      connector: "anthropic",
      level: "info",
      event: "draft_ok",
      message: "AI drafting is working.",
      detail: { model },
      throttleMinutes: 30,
    });
    return { ok: true, body, model };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const lowBalance = /credit balance is too low|insufficient.*credit|\bbilling\b/i.test(error);
    const reason = lowBalance
      ? "the OpenAI API quota / billing is exhausted"
      : "the AI drafting service returned an error";
    await logConnector({
      // Internal connector id kept as "anthropic" so historical events line up
      // in the dashboard; the active provider is now OpenAI.
      connector: "anthropic",
      level: "error",
      event: lowBalance ? "credits_exhausted" : "draft_failed",
      message: lowBalance
        ? "OpenAI API billing/quota exhausted — AI drafting is paused. Emails are still delivered to Slack without a draft."
        : `OpenAI draft generation failed: ${error.slice(0, 300)}`,
      detail: { error: error.slice(0, 1000) },
      throttleMinutes: 10, // poll retries every 2 min — log at most once per 10
    });
    return { ok: false, error, reason };
  }
}

export async function processIncomingMessage(messageId: string): Promise<{
  status: "processed" | "skipped";
  reason?: string;
}> {
  const supabase = db();

  // Have we already seen this message? (idempotency)
  const { data: existingByMsg } = await supabase
    .from("email_threads")
    .select(
      "id, draft_status, slack_channel_id, slack_thread_ts, from_email, gmail_thread_id",
    )
    .eq("gmail_message_id", messageId)
    .maybeSingle();

  if (existingByMsg) {
    // Drafting previously failed for this message — the email is already in
    // Slack; just retry the draft (don't re-post the card).
    if (existingByMsg.draft_status === "failed") {
      return await retryFailedDraft(existingByMsg, messageId);
    }
    return { status: "skipped", reason: "already-processed" };
  }

  // Fetch + parse the email
  const email = await getMessage(messageId);

  // Skip our own outgoing replies (Gmail's history includes them)
  if (email.from_email.toLowerCase() === MAILBOX.toLowerCase()) {
    return { status: "skipped", reason: "self-sent" };
  }

  // Classify before drafting so we can both log it and render it in Slack.
  // Classification is best-effort — null means we'll just skip the badges.
  const classification: Classification | null = await classifyEmail({
    fromName: email.from_name,
    fromEmail: email.from_email,
    subject: email.subject,
    body: email.body_plain,
  });

  await logEvent({
    eventType: "received",
    gmailThreadId: email.gmail_thread_id,
    gmailMessageId: email.gmail_message_id,
    fromEmail: email.from_email,
    subject: email.subject,
    actor: "system",
    detail: { snippet: email.snippet, classification },
  });

  // If we already have a row for this *thread*, this is a continuation.
  const { data: existingThread } = await supabase
    .from("email_threads")
    .select("id, slack_channel_id, slack_thread_ts")
    .eq("gmail_thread_id", email.gmail_thread_id)
    .maybeSingle();

  // Short-circuit: classifier says no human reply is needed (newsletter /
  // transactional / marketing / automated / spam). Record + post a compact
  // "auto-skipped" card. No draft model call, no draft revision.
  if (classification && classification.should_reply === false) {
    if (existingThread) {
      await supabase
        .from("email_threads")
        .update({ status: "skipped", should_reply: false })
        .eq("id", existingThread.id);
      await logEvent({
        eventType: "skipped",
        emailThreadId: existingThread.id,
        gmailThreadId: email.gmail_thread_id,
        gmailMessageId: email.gmail_message_id,
        fromEmail: email.from_email,
        subject: email.subject,
        actor: "system",
        detail: { reason: "auto_no_reply", classification },
      });
    } else {
      const { data: row, error } = await supabase
        .from("email_threads")
        .insert({
          gmail_thread_id: email.gmail_thread_id,
          gmail_message_id: email.gmail_message_id,
          gmail_history_id: email.history_id,
          in_reply_to_header: email.in_reply_to_header,
          from_email: email.from_email,
          from_name: email.from_name,
          to_email: email.to_email,
          subject: email.subject,
          snippet: email.snippet,
          body_plain: email.body_plain,
          body_html: email.body_html,
          status: "skipped",
          should_reply: false,
          lead_category: classification.lead_category,
          urgency: classification.urgency,
          score: classification.score,
          classification_meta: classification,
        })
        .select("id")
        .single();
      if (error) throw error;
      try {
        const posted = await postNoReplyCard({
          fromName: email.from_name,
          fromEmail: email.from_email,
          subject: email.subject,
          bodyPreview: email.body_plain,
          snippet: email.snippet,
          classification,
        });
        await supabase
          .from("email_threads")
          .update({
            slack_channel_id: posted.channel,
            slack_thread_ts: posted.ts,
            slack_permalink: posted.permalink,
          })
          .eq("id", row.id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("postNoReplyCard failed:", msg);
        await logConnector({
          connector: "email_slack",
          level: "error",
          event: "post_failed",
          message: `Failed to post auto-skipped card to Slack: ${msg.slice(0, 300)}`,
          ref: row.id,
        });
      }
      await logEvent({
        eventType: "skipped",
        emailThreadId: row.id,
        gmailThreadId: email.gmail_thread_id,
        gmailMessageId: email.gmail_message_id,
        fromEmail: email.from_email,
        subject: email.subject,
        actor: "system",
        detail: { reason: "auto_no_reply", classification },
      });
    }
    try { await markRead(messageId); } catch (_) { /* ignore */ }
    return { status: "processed" };
  }

  // This email needs a human reply. Try to draft — but a draft failure must
  // NOT stop us delivering the email to Slack.
  const draft = await attemptDraft({
    fromName: email.from_name,
    fromEmail: email.from_email,
    subject: email.subject,
    body: email.body_plain,
  });

  if (existingThread) {
    await handleContinuation(existingThread, email, classification, draft, messageId);
  } else {
    await handleNewThread(email, classification, draft, messageId);
  }

  // Mark read only when drafting succeeded. On failure we leave the message
  // unread so the poll re-picks it and retries the draft.
  if (draft.ok) {
    try {
      await markRead(messageId);
    } catch (e) {
      console.warn(`Could not mark message ${messageId} as read:`, e);
    }
  }

  return { status: "processed" };
}

// ---------------------------------------------------------------------------
// Brand new thread
// ---------------------------------------------------------------------------
async function handleNewThread(
  email: FetchedEmail,
  classification: Classification | null,
  draft: DraftResult,
  messageId: string,
): Promise<void> {
  const supabase = db();

  // Insert the thread row FIRST (before any Slack call) so a Slack outage
  // can't cause the email to be reprocessed forever.
  const { data: row, error } = await supabase
    .from("email_threads")
    .insert({
      gmail_thread_id: email.gmail_thread_id,
      gmail_message_id: email.gmail_message_id,
      gmail_history_id: email.history_id,
      in_reply_to_header: email.in_reply_to_header,
      from_email: email.from_email,
      from_name: email.from_name,
      to_email: email.to_email,
      subject: email.subject,
      snippet: email.snippet,
      body_plain: email.body_plain,
      body_html: email.body_html,
      status: "pending",
      lead_category: classification?.lead_category ?? null,
      urgency: classification?.urgency ?? null,
      score: classification?.score ?? null,
      classification_meta: classification ?? null,
      draft_status: draft.ok ? "ok" : "failed",
      draft_error: draft.ok ? null : draft.error.slice(0, 1000),
    })
    .select("id")
    .single();
  if (error) throw error;
  const threadRowId = row.id;

  let draftRevisionId: string | null = null;
  if (draft.ok) {
    const { data: rev, error: revErr } = await supabase
      .from("draft_revisions")
      .insert({
        email_thread_id: threadRowId,
        revision: 1,
        body: draft.body,
        model: draft.model,
        is_current: true,
      })
      .select("id")
      .single();
    if (revErr) throw revErr;
    draftRevisionId = rev.id;
  }

  // Post to Slack — wrapped so a Slack failure is logged, not fatal.
  try {
    if (draft.ok && draftRevisionId) {
      const posted = await postEmailWithDraft({
        fromName: email.from_name,
        fromEmail: email.from_email,
        subject: email.subject,
        bodyPreview: email.body_plain,
        snippet: email.snippet,
        draftBody: draft.body,
        emailThreadId: threadRowId,
        draftRevisionId,
        classification,
      });
      await supabase
        .from("email_threads")
        .update({
          slack_channel_id: posted.channel,
          slack_thread_ts: posted.ts,
          slack_permalink: posted.permalink,
        })
        .eq("id", threadRowId);
      await supabase
        .from("draft_revisions")
        .update({ slack_message_ts: posted.ts })
        .eq("id", draftRevisionId);
      await logConnector({
        connector: "email_slack",
        level: "info",
        event: "post_ok",
        message: `Posted email + AI draft to Slack — ${email.from_email}`,
        ref: threadRowId,
      });
    } else {
      const posted = await postEmailNoDraft({
        fromName: email.from_name,
        fromEmail: email.from_email,
        subject: email.subject,
        bodyPreview: email.body_plain,
        snippet: email.snippet,
        classification,
        reason: draft.ok ? null : draft.reason,
      });
      await supabase
        .from("email_threads")
        .update({
          slack_channel_id: posted.channel,
          slack_thread_ts: posted.ts,
          slack_permalink: posted.permalink,
        })
        .eq("id", threadRowId);
      await logConnector({
        connector: "email_slack",
        level: "warn",
        event: "post_ok_no_draft",
        message: `Posted email to Slack WITHOUT a draft (AI drafting unavailable) — ${email.from_email}`,
        ref: threadRowId,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Slack post failed for new thread:", msg);
    await logConnector({
      connector: "email_slack",
      level: "error",
      event: "post_failed",
      message: `Failed to post email to Slack: ${msg.slice(0, 300)}`,
      detail: { from: email.from_email, subject: email.subject },
      ref: threadRowId,
    });
  }

  await logEvent({
    eventType: draft.ok ? "drafted" : "failed",
    emailThreadId: threadRowId,
    gmailThreadId: email.gmail_thread_id,
    gmailMessageId: email.gmail_message_id,
    fromEmail: email.from_email,
    subject: email.subject,
    actor: draft.ok ? "claude" : "system",
    detail: draft.ok
      ? { revision: 1, model: draft.model }
      : { reason: "draft_failed", error: draft.error.slice(0, 500) },
  });
}

// ---------------------------------------------------------------------------
// Continuation of an existing thread (customer replied again)
// ---------------------------------------------------------------------------
async function handleContinuation(
  existingThread: { id: string; slack_channel_id: string | null; slack_thread_ts: string | null },
  email: FetchedEmail,
  classification: Classification | null,
  draft: DraftResult,
  _messageId: string,
): Promise<void> {
  const supabase = db();
  const threadRowId = existingThread.id;
  const slackChannel = existingThread.slack_channel_id ?? SLACK_DEFAULT_CHANNEL;
  const slackThreadTs = existingThread.slack_thread_ts ?? "";

  const { error } = await supabase
    .from("email_threads")
    .update({
      gmail_message_id: email.gmail_message_id,
      gmail_history_id: email.history_id,
      in_reply_to_header: email.in_reply_to_header,
      subject: email.subject,
      snippet: email.snippet,
      body_plain: email.body_plain,
      body_html: email.body_html,
      status: "pending",
      lead_category: classification?.lead_category ?? null,
      urgency: classification?.urgency ?? null,
      score: classification?.score ?? null,
      classification_meta: classification ?? null,
      draft_status: draft.ok ? "ok" : "failed",
      draft_error: draft.ok ? null : draft.error.slice(0, 1000),
    })
    .eq("id", threadRowId);
  if (error) throw error;

  if (draft.ok) {
    const revision = await nextRevision(threadRowId);
    const { data: rev, error: revErr } = await supabase
      .from("draft_revisions")
      .insert({
        email_thread_id: threadRowId,
        revision,
        body: draft.body,
        model: draft.model,
        is_current: true,
      })
      .select("id, revision")
      .single();
    if (revErr) throw revErr;

    await supabase
      .from("draft_revisions")
      .update({ is_current: false })
      .eq("email_thread_id", threadRowId)
      .neq("id", rev.id);

    try {
      if (slackThreadTs) {
        const posted = await postDraftRevision({
          channel: slackChannel,
          threadTs: slackThreadTs,
          revision: rev.revision,
          feedback: null,
          draftBody: draft.body,
          emailThreadId: threadRowId,
          draftRevisionId: rev.id,
        });
        await supabase
          .from("draft_revisions")
          .update({ slack_message_ts: posted.ts })
          .eq("id", rev.id);
      }
      await logConnector({
        connector: "email_slack",
        level: "info",
        event: "post_ok",
        message: `Posted revised draft to Slack thread — ${email.from_email}`,
        ref: threadRowId,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logConnector({
        connector: "email_slack",
        level: "error",
        event: "post_failed",
        message: `Failed to post revised draft to Slack: ${msg.slice(0, 300)}`,
        ref: threadRowId,
      });
    }

    await logEvent({
      eventType: "revised",
      emailThreadId: threadRowId,
      gmailThreadId: email.gmail_thread_id,
      gmailMessageId: email.gmail_message_id,
      fromEmail: email.from_email,
      subject: email.subject,
      actor: "claude",
      detail: { revision: rev.revision, model: draft.model, trigger: "thread-continuation" },
    });
  } else {
    // Drafting failed — still surface the new customer message in the thread.
    try {
      if (slackThreadTs) {
        await postNoDraftReply({
          channel: slackChannel,
          threadTs: slackThreadTs,
          customerMessage: email.body_plain,
          snippet: email.snippet,
          reason: draft.reason,
        });
      }
      await logConnector({
        connector: "email_slack",
        level: "warn",
        event: "post_ok_no_draft",
        message: `Posted customer reply to Slack WITHOUT a draft (AI drafting unavailable) — ${email.from_email}`,
        ref: threadRowId,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logConnector({
        connector: "email_slack",
        level: "error",
        event: "post_failed",
        message: `Failed to post customer reply to Slack: ${msg.slice(0, 300)}`,
        ref: threadRowId,
      });
    }

    await logEvent({
      eventType: "failed",
      emailThreadId: threadRowId,
      gmailThreadId: email.gmail_thread_id,
      gmailMessageId: email.gmail_message_id,
      fromEmail: email.from_email,
      subject: email.subject,
      actor: "system",
      detail: { reason: "draft_failed", error: draft.error.slice(0, 500), trigger: "thread-continuation" },
    });
  }
}

// ---------------------------------------------------------------------------
// Retry path — a previous draft attempt failed; the email is already in Slack.
// Re-attempt the draft only; on success post it into the existing thread.
// ---------------------------------------------------------------------------
async function retryFailedDraft(
  row: {
    id: string;
    slack_channel_id: string | null;
    slack_thread_ts: string | null;
    gmail_thread_id: string;
  },
  messageId: string,
): Promise<{ status: "processed" | "skipped"; reason?: string }> {
  const supabase = db();
  const email = await getMessage(messageId);

  const draft = await attemptDraft({
    fromName: email.from_name,
    fromEmail: email.from_email,
    subject: email.subject,
    body: email.body_plain,
  });

  if (!draft.ok) {
    // Still failing — leave the row as-is (already logged). Poll retries again.
    return { status: "skipped", reason: "draft-retry-failed" };
  }

  const revision = await nextRevision(row.id);
  const { data: rev, error: revErr } = await supabase
    .from("draft_revisions")
    .insert({
      email_thread_id: row.id,
      revision,
      body: draft.body,
      model: draft.model,
      is_current: true,
    })
    .select("id, revision")
    .single();
  if (revErr) throw revErr;

  await supabase
    .from("draft_revisions")
    .update({ is_current: false })
    .eq("email_thread_id", row.id)
    .neq("id", rev.id);

  try {
    if (row.slack_thread_ts) {
      // Email card is already in Slack — add the recovered draft as a reply.
      const posted = await postDraftRevision({
        channel: row.slack_channel_id ?? SLACK_DEFAULT_CHANNEL,
        threadTs: row.slack_thread_ts,
        revision: rev.revision,
        feedback: null,
        draftBody: draft.body,
        emailThreadId: row.id,
        draftRevisionId: rev.id,
      });
      await supabase
        .from("draft_revisions")
        .update({ slack_message_ts: posted.ts })
        .eq("id", rev.id);
    } else {
      // The original no-draft post had also failed — post a fresh full card.
      const posted = await postEmailWithDraft({
        fromName: email.from_name,
        fromEmail: email.from_email,
        subject: email.subject,
        bodyPreview: email.body_plain,
        snippet: email.snippet,
        draftBody: draft.body,
        emailThreadId: row.id,
        draftRevisionId: rev.id,
        classification: null,
      });
      await supabase
        .from("email_threads")
        .update({
          slack_channel_id: posted.channel,
          slack_thread_ts: posted.ts,
          slack_permalink: posted.permalink,
        })
        .eq("id", row.id);
      await supabase
        .from("draft_revisions")
        .update({ slack_message_ts: posted.ts })
        .eq("id", rev.id);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logConnector({
      connector: "email_slack",
      level: "error",
      event: "post_failed",
      message: `Recovered draft but failed to post it to Slack: ${msg.slice(0, 300)}`,
      ref: row.id,
    });
  }

  await supabase
    .from("email_threads")
    .update({ draft_status: "ok", draft_error: null })
    .eq("id", row.id);

  await logEvent({
    eventType: "drafted",
    emailThreadId: row.id,
    gmailThreadId: email.gmail_thread_id,
    gmailMessageId: email.gmail_message_id,
    fromEmail: email.from_email,
    subject: email.subject,
    actor: "claude",
    detail: { revision: rev.revision, model: draft.model, trigger: "draft-retry" },
  });
  await logConnector({
    connector: "anthropic",
    level: "info",
    event: "draft_recovered",
    message: `AI drafting recovered — draft generated on retry for ${email.from_email}.`,
    ref: row.id,
  });

  try {
    await markRead(messageId);
  } catch (e) {
    console.warn(`Could not mark message ${messageId} as read:`, e);
  }

  return { status: "processed" };
}

async function nextRevision(emailThreadId: string): Promise<number> {
  const { data } = await db()
    .from("draft_revisions")
    .select("revision")
    .eq("email_thread_id", emailThreadId)
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.revision ?? 0) + 1;
}
