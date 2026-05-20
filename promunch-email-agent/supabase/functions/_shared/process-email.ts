// Shared pipeline: given a fresh incoming Gmail message id, fetch it,
// generate a draft, post to Slack, and persist all state.
// Called by gmail-webhook (push) and gmail-poll (cron).

import { getMessage, markRead } from "./gmail.ts";
import { generateDraft } from "./anthropic.ts";
import { postEmailWithDraft, postNoReplyCard, SLACK_DEFAULT_CHANNEL } from "./slack.ts";
import { db } from "./supabase.ts";
import { logEvent } from "./log.ts";
import { classifyEmail, type Classification } from "./classify.ts";

const MAILBOX = Deno.env.get("MAILBOX_EMAIL") ?? "hello@promunch.in";

export async function processIncomingMessage(messageId: string): Promise<{
  status: "processed" | "skipped";
  reason?: string;
}> {
  const supabase = db();

  // Idempotency: have we already seen this message?
  const { data: existingByMsg } = await supabase
    .from("email_threads")
    .select("id")
    .eq("gmail_message_id", messageId)
    .maybeSingle();
  if (existingByMsg) {
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

  // If we already have a row for this *thread*, this is a continuation —
  // update the row to point to the newer message id but still draft a reply.
  const { data: existingThread } = await supabase
    .from("email_threads")
    .select("id, slack_channel_id, slack_thread_ts")
    .eq("gmail_thread_id", email.gmail_thread_id)
    .maybeSingle();

  // Short-circuit: if classifier says no human reply is needed
  // (newsletter / transactional / marketing / automated / spam), record
  // the email + post a compact "auto-skipped" card. Do not invoke the
  // drafting model and do not create a draft revision.
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
        console.warn("postNoReplyCard failed:", e instanceof Error ? e.message : e);
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

  // Generate the draft
  const { body: draftBody, model } = await generateDraft({
    fromName: email.from_name,
    fromEmail: email.from_email,
    subject: email.subject,
    body: email.body_plain,
  });

  let threadRowId: string;
  let slackChannel: string;
  let slackThreadTs: string;

  if (existingThread) {
    // Update the existing row's pointers (+ refresh classification)
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
      })
      .eq("id", existingThread.id);
    if (error) throw error;

    threadRowId = existingThread.id;
    slackChannel = existingThread.slack_channel_id ?? SLACK_DEFAULT_CHANNEL;
    slackThreadTs = existingThread.slack_thread_ts ?? "";

    // Insert the new revision under the same thread
    const { data: rev, error: revErr } = await supabase
      .from("draft_revisions")
      .insert({
        email_thread_id: threadRowId,
        revision: await nextRevision(threadRowId),
        body: draftBody,
        model,
        is_current: true,
      })
      .select("id, revision")
      .single();
    if (revErr) throw revErr;

    // Demote prior revisions
    await supabase
      .from("draft_revisions")
      .update({ is_current: false })
      .eq("email_thread_id", threadRowId)
      .neq("id", rev.id);

    // Post the new draft as a thread reply to the existing slack thread
    if (slackThreadTs) {
      const { postDraftRevision } = await import("./slack.ts");
      const posted = await postDraftRevision({
        channel: slackChannel,
        threadTs: slackThreadTs,
        revision: rev.revision,
        feedback: null,
        draftBody,
        emailThreadId: threadRowId,
        draftRevisionId: rev.id,
      });
      await supabase
        .from("draft_revisions")
        .update({ slack_message_ts: posted.ts })
        .eq("id", rev.id);
    }

    await logEvent({
      eventType: "revised",
      emailThreadId: threadRowId,
      gmailThreadId: email.gmail_thread_id,
      gmailMessageId: email.gmail_message_id,
      fromEmail: email.from_email,
      subject: email.subject,
      actor: "claude",
      detail: { revision: rev.revision, model, trigger: "thread-continuation" },
    });
  } else {
    // Brand new thread — insert + post the parent Slack message
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
      })
      .select("id")
      .single();
    if (error) throw error;
    threadRowId = row.id;

    // Insert v1 revision (we'll update slack_message_ts after posting)
    const { data: rev, error: revErr } = await supabase
      .from("draft_revisions")
      .insert({
        email_thread_id: threadRowId,
        revision: 1,
        body: draftBody,
        model,
        is_current: true,
      })
      .select("id")
      .single();
    if (revErr) throw revErr;

    // Post to Slack
    const posted = await postEmailWithDraft({
      fromName: email.from_name,
      fromEmail: email.from_email,
      subject: email.subject,
      bodyPreview: email.body_plain,
      draftBody,
      emailThreadId: threadRowId,
      draftRevisionId: rev.id,
      classification,
    });

    slackChannel = posted.channel;
    slackThreadTs = posted.ts;

    // Persist slack anchor
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
      .eq("id", rev.id);

    await logEvent({
      eventType: "drafted",
      emailThreadId: threadRowId,
      gmailThreadId: email.gmail_thread_id,
      gmailMessageId: email.gmail_message_id,
      fromEmail: email.from_email,
      subject: email.subject,
      actor: "claude",
      detail: { revision: 1, model, slack_permalink: posted.permalink },
    });
  }

  // Mark the Gmail message read so the poll fallback doesn't re-pick it
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
