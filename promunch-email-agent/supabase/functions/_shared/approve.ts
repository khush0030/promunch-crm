// Shared approve-and-send pipeline. Triggered either by the Approve button
// (slack-interactivity) or by typing "approve"/"send" in the Slack thread
// (slack-events).

import { db } from "./supabase.ts";
import { sendReply } from "./gmail.ts";
import { replyInThread, updateMessage, buildSentBlocks, type Classification } from "./slack.ts";
import { logEvent } from "./log.ts";
import { recordApprovedReply } from "./brand.ts";

export async function approveAndSend(opts: {
  emailThreadId: string;
  slackChannel: string;
  slackThreadTs: string;
  approvedBySlackUser: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = db();

  // Load thread + current draft
  const { data: thread, error: tErr } = await supabase
    .from("email_threads")
    .select(
      "id, gmail_thread_id, gmail_message_id, from_email, from_name, subject, in_reply_to_header, status, body_plain, snippet, classification_meta",
    )
    .eq("id", opts.emailThreadId)
    .single();
  if (tErr || !thread) {
    return { ok: false, error: "thread not found" };
  }
  if (thread.status === "sent") {
    await replyInThread(opts.slackChannel, opts.slackThreadTs, ":information_source: Already sent.");
    return { ok: true };
  }

  // ATOMIC CLAIM (§0: never message a customer twice). The Approve button, a
  // typed "approve", and Slack event retries can all race into this function;
  // exactly one caller may win the guarded UPDATE. Losers exit silently — a
  // missed send is recoverable, a duplicate email is not.
  const { data: claimed } = await supabase
    .from("email_threads")
    .update({ status: "sending" })
    .eq("id", opts.emailThreadId)
    .not("status", "in", '("sent","sending")')
    .select("id");
  if (!claimed || claimed.length === 0) {
    await replyInThread(opts.slackChannel, opts.slackThreadTs, ":information_source: Already sent (or send in progress).");
    return { ok: true };
  }

  const { data: draft, error: dErr } = await supabase
    .from("draft_revisions")
    .select("id, body")
    .eq("email_thread_id", opts.emailThreadId)
    .eq("is_current", true)
    .single();
  if (dErr || !draft) {
    // Release the claim so a draft added later can still be approved.
    await supabase.from("email_threads").update({ status: thread.status }).eq("id", opts.emailThreadId);
    return { ok: false, error: "no current draft" };
  }

  // Send via Gmail
  let sent: { id: string };
  try {
    sent = await sendReply({
      threadId: thread.gmail_thread_id,
      to: thread.from_email,
      subject: thread.subject ?? "",
      inReplyTo: thread.in_reply_to_header ?? "",
      bodyPlain: draft.body,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase.from("email_threads").update({ status: "failed" }).eq("id", thread.id);
    await logEvent({
      eventType: "failed",
      emailThreadId: thread.id,
      gmailThreadId: thread.gmail_thread_id,
      gmailMessageId: thread.gmail_message_id,
      fromEmail: thread.from_email,
      subject: thread.subject,
      actor: opts.approvedBySlackUser ?? "system",
      detail: { error: msg, stage: "gmail-send" },
    });
    await replyInThread(
      opts.slackChannel,
      opts.slackThreadTs,
      `:warning: Failed to send: ${msg}`,
    );
    return { ok: false, error: msg };
  }

  // Audit log + mark sent
  await supabase.from("sent_replies").insert({
    email_thread_id: thread.id,
    draft_revision_id: draft.id,
    gmail_message_id: sent.id,
    body: draft.body,
    approved_by_slack_user: opts.approvedBySlackUser,
  });
  await supabase.from("email_threads").update({ status: "sent" }).eq("id", thread.id);

  await logEvent({
    eventType: "sent",
    emailThreadId: thread.id,
    gmailThreadId: thread.gmail_thread_id,
    gmailMessageId: sent.id,
    fromEmail: thread.from_email,
    subject: thread.subject,
    actor: opts.approvedBySlackUser ?? "system",
    detail: { draft_revision_id: draft.id, sent_gmail_message_id: sent.id },
  });

  // Feed the approved reply into the brand brain so future drafts learn from it.
  await recordApprovedReply({
    threadId: thread.id,
    subject: thread.subject,
    inboundExcerpt: thread.body_plain || thread.snippet || "",
    finalReply: draft.body,
  });

  // Confirm in Slack
  await replyInThread(
    opts.slackChannel,
    opts.slackThreadTs,
    `:white_check_mark: Sent${opts.approvedBySlackUser ? ` (approved by <@${opts.approvedBySlackUser}>)` : ""}.`,
  );

  // Rebuild the parent message: keep the original email + the sent reply
  // visible, just drop the action buttons so it can't be re-clicked.
  try {
    await updateMessage({
      channel: opts.slackChannel,
      ts: opts.slackThreadTs,
      text: ":white_check_mark: Email sent",
      blocks: buildSentBlocks({
        fromName: thread.from_name,
        fromEmail: thread.from_email,
        subject: thread.subject,
        bodyPreview: thread.body_plain || "",
        snippet: thread.snippet,
        draftBody: draft.body,
        classification: (thread.classification_meta as Classification | null) ?? null,
        approvedBySlackUser: opts.approvedBySlackUser,
      }),
    });
  } catch (e) {
    // Non-fatal — the message exists, we just couldn't clear the buttons
    console.warn("Could not rebuild parent message after send:", e);
  }

  return { ok: true };
}
