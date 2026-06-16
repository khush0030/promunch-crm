// slack-events
// ---------------------------------------------------------------------------
// Handles Slack Events API webhooks. The only events we care about are
// `message` events that are *thread replies* on a draft message we posted.
// Those replies are treated as user feedback: we regenerate the draft with
// Claude and post the new revision as another reply in the same thread.
//
// Slack URL verification: when you point the Events API at this endpoint
// Slack will first POST a `{"type":"url_verification","challenge":"..."}`
// payload. We echo the challenge back.

import { verifySlackSignature, postDraftRevision } from "../_shared/slack.ts";
import { db } from "../_shared/supabase.ts";
import { generateDraft, mayaChat } from "../_shared/openai.ts";
import { logEvent } from "../_shared/log.ts";
import { recordFeedback } from "../_shared/brand.ts";

const BOT_USER_ID = Deno.env.get("SLACK_BOT_USER_ID") ?? "";

interface SlackEventEnvelope {
  type: string;
  challenge?: string;
  event?: SlackMessageEvent;
}

interface SlackMessageEvent {
  type: "message";
  channel: string;
  user?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
  channel_type?: string;   // "im" for direct messages to the bot
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const raw = await req.text();
  if (!(await verifySlackSignature(req, raw))) {
    return new Response("invalid signature", { status: 401 });
  }

  const envelope: SlackEventEnvelope = JSON.parse(raw);

  // URL verification handshake
  if (envelope.type === "url_verification" && envelope.challenge) {
    return new Response(envelope.challenge, {
      headers: { "content-type": "text/plain" },
    });
  }

  // ACK quickly. We process synchronously here for simplicity; if drafting
  // gets slow, move the heavy work into queueing.
  const isRetry = (req.headers.get("x-slack-retry-num") ?? "") !== "";
  if (envelope.type === "event_callback" && envelope.event?.type === "message") {
    try {
      await handleMessage(envelope.event, isRetry);
    } catch (e) {
      console.error("slack-events handler failed:", e);
    }
  }

  return new Response("ok");
});

async function handleMessage(ev: SlackMessageEvent, isRetry = false): Promise<void> {
  // Filter out: edits, deletes, bot messages, our own messages, parent messages
  if (ev.subtype) return;                          // edits, joins, etc.
  if (ev.bot_id) return;                           // ignore bot replies (incl. ours)
  if (BOT_USER_ID && ev.user === BOT_USER_ID) return;

  // Direct message to Maya → conversational ops assistant (sales / orders / KB).
  if (ev.channel_type === "im") {
    if (isRetry) return;                           // Slack retried a slow ACK; the first run already replies
    const prompt = (ev.text ?? "").trim();
    if (!prompt) return;
    const reply = await mayaChat(prompt);
    const { replyInThread } = await import("../_shared/slack.ts");
    await replyInThread(ev.channel, ev.ts, reply);  // thread under the user's DM so it stays tidy
    return;
  }

  if (!ev.thread_ts || ev.thread_ts === ev.ts) return; // must be a thread reply

  const feedback = (ev.text ?? "").trim();
  if (!feedback) return;

  // Find the email thread this Slack thread refers to
  const { data: thread } = await db()
    .from("email_threads")
    .select("id, from_email, from_name, subject, body_plain, slack_channel_id, slack_thread_ts, status")
    .eq("slack_thread_ts", ev.thread_ts)
    .eq("slack_channel_id", ev.channel)
    .maybeSingle();

  if (!thread) return;                              // unrelated thread
  if (thread.status === "sent") return;             // already sent, ignore further chatter

  // Check for explicit approval / cancellation phrases as a convenience
  // (the buttons are the canonical path, but typing "send" should work too).
  const lower = feedback.toLowerCase();
  if (lower === "approve" || lower === "send" || lower === "ship it" || lower === "lgtm") {
    // Trigger approve via the same code path the button uses.
    const { approveAndSend } = await import("../_shared/approve.ts");
    await approveAndSend({
      emailThreadId: thread.id,
      slackChannel: thread.slack_channel_id!,
      slackThreadTs: thread.slack_thread_ts!,
      approvedBySlackUser: ev.user ?? null,
    });
    return;
  }
  if (lower === "skip" || lower === "ignore" || lower === "discard") {
    await db().from("email_threads").update({ status: "skipped" }).eq("id", thread.id);
    await logEvent({
      eventType: "skipped",
      emailThreadId: thread.id,
      fromEmail: thread.from_email,
      subject: thread.subject,
      actor: ev.user ?? "system",
      detail: { via: "slack-thread-command", command: lower },
    });
    const { replyInThread } = await import("../_shared/slack.ts");
    await replyInThread(ev.channel, ev.thread_ts!, ":wastebasket: Skipped — no reply will be sent.");
    return;
  }

  // Anything else is feedback that drives a regeneration.
  await logEvent({
    eventType: "feedback",
    emailThreadId: thread.id,
    fromEmail: thread.from_email,
    subject: thread.subject,
    actor: ev.user ?? "system",
    detail: { feedback },
  });

  // Otherwise: regenerate the draft using the feedback
  const { data: currentDraft } = await db()
    .from("draft_revisions")
    .select("body, revision")
    .eq("email_thread_id", thread.id)
    .eq("is_current", true)
    .maybeSingle();

  const { body: newDraft, model } = await generateDraft({
    fromName: thread.from_name,
    fromEmail: thread.from_email,
    subject: thread.subject,
    body: thread.body_plain ?? "",
    priorDraft: currentDraft?.body ?? null,
    feedback,
  });

  const nextRev = (currentDraft?.revision ?? 0) + 1;

  // Demote prior revisions, insert new one
  await db()
    .from("draft_revisions")
    .update({ is_current: false })
    .eq("email_thread_id", thread.id);

  const { data: rev, error: revErr } = await db()
    .from("draft_revisions")
    .insert({
      email_thread_id: thread.id,
      revision: nextRev,
      body: newDraft,
      feedback,
      model,
      is_current: true,
    })
    .select("id")
    .single();
  if (revErr) throw revErr;

  // Post the new revision back in the same Slack thread
  const posted = await postDraftRevision({
    channel: ev.channel,
    threadTs: ev.thread_ts!,
    revision: nextRev,
    feedback,
    draftBody: newDraft,
    emailThreadId: thread.id,
    draftRevisionId: rev.id,
  });

  await db()
    .from("draft_revisions")
    .update({ slack_message_ts: posted.ts })
    .eq("id", rev.id);

  await logEvent({
    eventType: "revised",
    emailThreadId: thread.id,
    fromEmail: thread.from_email,
    subject: thread.subject,
    actor: "claude",
    detail: { revision: nextRev, model, feedback, trigger: "slack-feedback" },
  });

  // Teach the brain: this feedback → this corrected reply.
  await recordFeedback({
    threadId: thread.id,
    subject: thread.subject,
    feedback,
    resultingReply: newDraft,
  });
}
