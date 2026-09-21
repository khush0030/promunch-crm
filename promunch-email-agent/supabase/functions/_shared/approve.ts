// Shared approve-and-send pipeline. Triggered by the Approve button
// (slack-interactivity), by typing "approve"/"send" in the Slack thread
// (slack-events), or by Approve & send in the CRM Inbox (email-draft-action).
// All three go through the SAME atomic claim below, so a second click from any
// surface can never send the customer a second email (§0).

import { db } from "./supabase.ts";
import { sendReply } from "./gmail.ts";
import { replyInThread, updateMessage, buildSentBlocks, type Classification } from "./slack.ts";
import { logEvent } from "./log.ts";
import { recordApprovedReply } from "./brand.ts";

export async function approveAndSend(opts: {
  emailThreadId: string;
  approvedBySlackUser: string | null;
  approvedByEmail?: string | null;
  slackChannel?: string | null;
  slackThreadTs?: string | null;
}): Promise<{ ok: boolean; status?: "sent" | "already_sent"; error?: string }> {
  const supabase = db();
  // Slack is optional: CRM approvals of a thread that was never posted to Slack
  // have no channel/ts, so every Slack call below is skipped for them.
  const slack = opts.slackChannel && opts.slackThreadTs
    ? { channel: opts.slackChannel, ts: opts.slackThreadTs }
    : null;
  const actor = opts.approvedBySlackUser ?? opts.approvedByEmail ?? "system";

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
    if (slack) await replyInThread(slack.channel, slack.ts, ":information_source: Already sent.");
    return { ok: true, status: "already_sent" };
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
    if (slack) {
      await replyInThread(slack.channel, slack.ts, ":information_source: Already sent (or send in progress).");
    }
    return { ok: true, status: "already_sent" };
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
      actor,
      detail: { error: msg, stage: "gmail-send" },
    });
    if (slack) {
      await replyInThread(
        slack.channel,
        slack.ts,
        `:warning: Failed to send: ${msg}`,
      );
    }
    return { ok: false, error: msg };
  }

  // Audit log + mark sent
  await supabase.from("sent_replies").insert({
    email_thread_id: thread.id,
    draft_revision_id: draft.id,
    gmail_message_id: sent.id,
    body: draft.body,
    approved_by_slack_user: opts.approvedBySlackUser,
    approved_by_email: opts.approvedByEmail ?? null,
  });
  await supabase.from("email_threads").update({ status: "sent" }).eq("id", thread.id);

  await logEvent({
    eventType: "sent",
    emailThreadId: thread.id,
    gmailThreadId: thread.gmail_thread_id,
    gmailMessageId: sent.id,
    fromEmail: thread.from_email,
    subject: thread.subject,
    actor,
    detail: { draft_revision_id: draft.id, sent_gmail_message_id: sent.id },
  });

  // Feed the approved reply into the brand brain so future drafts learn from it.
  await recordApprovedReply({
    threadId: thread.id,
    subject: thread.subject,
    inboundExcerpt: thread.body_plain || thread.snippet || "",
    finalReply: draft.body,
  });

  if (!slack) return { ok: true, status: "sent" };

  // Confirm in Slack
  const approvedBy = opts.approvedBySlackUser
    ? ` (approved by <@${opts.approvedBySlackUser}>)`
    : opts.approvedByEmail
    ? ` (approved in CRM by ${opts.approvedByEmail})`
    : "";
  await replyInThread(
    slack.channel,
    slack.ts,
    `:white_check_mark: Sent${approvedBy}.`,
  );

  // Rebuild the parent message: keep the original email + the sent reply
  // visible, just drop the action buttons so it can't be re-clicked.
  try {
    await updateMessage({
      channel: slack.channel,
      ts: slack.ts,
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

  return { ok: true, status: "sent" };
}
