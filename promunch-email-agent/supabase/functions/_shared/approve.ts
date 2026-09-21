// Shared approve-and-send pipeline. Triggered by the Approve button
// (slack-interactivity), by typing "approve"/"send" in the Slack thread
// (slack-events), or by Approve & send in the CRM Inbox (email-draft-action).
// All three go through the SAME atomic claim below, so a second click from any
// surface can never send the customer a second email (§0).

import { db } from "./supabase.ts";
import { getThreadParsed, mailboxAddress, sendReply } from "./gmail.ts";
import { replyInThread, updateMessage, buildSentBlocks, type Classification } from "./slack.ts";
import { logEvent } from "./log.ts";
import { recordApprovedReply } from "./brand.ts";
import { claimLossOutcome, isStaleDraft, mailboxRepliedAfter } from "./approve-guard.ts";

export type ApproveResult = {
  ok: boolean;
  status?: "sent" | "already_sent" | "draft_changed" | "already_answered" | "gmail_check_failed";
  error?: string;
};

export async function approveAndSend(opts: {
  emailThreadId: string;
  approvedBySlackUser: string | null;
  approvedByEmail?: string | null;
  slackChannel?: string | null;
  slackThreadTs?: string | null;
  // The draft revision the approver was looking at (CRM passes it). If the
  // current draft is a different revision, nothing is sent. The Slack Approve
  // button passes the revision it was posted with; a typed "approve" in the
  // Slack thread passes nothing and sends the current draft.
  expectedDraftRevisionId?: string | null;
}): Promise<ApproveResult> {
  const supabase = db();
  // Slack is optional: CRM approvals of a thread that was never posted to Slack
  // have no channel/ts, so every Slack call below is skipped for them.
  const slack = opts.slackChannel && opts.slackThreadTs
    ? { channel: opts.slackChannel, ts: opts.slackThreadTs }
    : null;
  const actor = opts.approvedBySlackUser ?? opts.approvedByEmail ?? "system";
  // CRM-initiated approvals (email, no Slack user) get their answer in the
  // CRM, so the Slack "Already sent" / "Could not start" lines are Slack-only.
  const fromCrm = !opts.approvedBySlackUser && !!opts.approvedByEmail;
  const slackStatus = fromCrm ? null : slack;

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
    if (slackStatus) await replyInThread(slackStatus.channel, slackStatus.ts, ":information_source: Already sent.");
    return { ok: true, status: "already_sent" };
  }

  // Already answered straight from Gmail? If anyone replied from the support
  // mailbox after the customer's message, sending our draft too would message
  // the customer twice (§0). If Gmail can't be read, fail closed: send nothing.
  // A thread already 'sending' skips this and loses the claim below as before.
  if (thread.status !== "sending") {
    let answered: boolean;
    try {
      const msgs = await getThreadParsed(thread.gmail_thread_id);
      if (msgs.length === 0) throw new Error("gmail thread has no messages");
      answered = mailboxRepliedAfter(
        msgs.map((m) => ({
          gmailMessageId: m.email.gmail_message_id,
          fromEmail: m.email.from_email,
          internalDateMs: m.internalDateMs,
          labelIds: m.labelIds,
        })),
        mailboxAddress(),
        thread.gmail_message_id,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[approve] gmail check failed for ${opts.emailThreadId}:`, msg);
      await logEvent({
        eventType: "failed",
        emailThreadId: thread.id,
        gmailThreadId: thread.gmail_thread_id,
        fromEmail: thread.from_email,
        subject: thread.subject,
        actor,
        detail: { stage: "gmail-check", error: msg.slice(0, 500) },
      });
      if (slackStatus) {
        await replyInThread(slackStatus.channel, slackStatus.ts, ":warning: Could not check Gmail, nothing was sent.");
      }
      return { ok: false, status: "gmail_check_failed", error: "could not check gmail" };
    }
    if (answered) {
      await logEvent({
        eventType: "failed",
        emailThreadId: thread.id,
        gmailThreadId: thread.gmail_thread_id,
        fromEmail: thread.from_email,
        subject: thread.subject,
        actor,
        detail: { stage: "already-answered-in-gmail" },
      });
      if (slackStatus) {
        await replyInThread(slackStatus.channel, slackStatus.ts, ":information_source: Already answered in Gmail, not sent.");
      }
      return { ok: false, status: "already_answered", error: "already answered in gmail" };
    }
  }

  // ATOMIC CLAIM (§0: never message a customer twice). The Approve button, a
  // typed "approve", and Slack event retries can all race into this function;
  // exactly one caller may win the guarded UPDATE. Losers exit silently — a
  // missed send is recoverable, a duplicate email is not.
  const { data: claimed, error: claimErr } = await supabase
    .from("email_threads")
    .update({ status: "sending" })
    .eq("id", opts.emailThreadId)
    .not("status", "in", '("sent","sending")')
    .select("id");
  if (!claimed || claimed.length === 0) {
    // No row claimed. Only a thread that is really sent/sending is "already
    // sent"; a claim error (e.g. a status constraint rejecting 'sending') means
    // the send never started, and must not be reported as sent.
    if (claimErr) console.warn(`[approve] claim failed for ${opts.emailThreadId}:`, claimErr.message);
    const { data: after } = await supabase
      .from("email_threads")
      .select("status")
      .eq("id", opts.emailThreadId)
      .maybeSingle();
    if (claimLossOutcome(after?.status) === "already_sent") {
      if (slackStatus) {
        await replyInThread(slackStatus.channel, slackStatus.ts, ":information_source: Already sent (or send in progress).");
      }
      return { ok: true, status: "already_sent" };
    }
    if (slackStatus) {
      await replyInThread(slackStatus.channel, slackStatus.ts, ":warning: Could not start the send.");
    }
    return { ok: false, error: "could not start the send" };
  }

  const { data: draft, error: dErr } = await supabase
    .from("draft_revisions")
    .select("id, body")
    .eq("email_thread_id", opts.emailThreadId)
    .eq("is_current", true)
    .single();
  if (dErr || !draft) {
    // Release the claim so a draft added later can still be approved. Only
    // our own 'sending' claim is released, never a status someone else set.
    await supabase.from("email_threads").update({ status: thread.status }).eq("id", opts.emailThreadId)
      .eq("status", "sending");
    return { ok: false, error: "no current draft" };
  }
  if (isStaleDraft(opts.expectedDraftRevisionId, draft.id)) {
    // The approver saw an older draft. Release the claim exactly like the
    // no-draft branch and send nothing; they must review the new version.
    await supabase.from("email_threads").update({ status: thread.status }).eq("id", opts.emailThreadId)
      .eq("status", "sending");
    await logEvent({
      eventType: "failed",
      emailThreadId: thread.id,
      gmailThreadId: thread.gmail_thread_id,
      fromEmail: thread.from_email,
      subject: thread.subject,
      actor,
      detail: {
        stage: "draft-changed",
        expected_draft_revision_id: opts.expectedDraftRevisionId,
        current_draft_revision_id: draft.id,
      },
    });
    if (slackStatus) {
      await replyInThread(
        slackStatus.channel,
        slackStatus.ts,
        ":information_source: The draft changed since this button was posted. Approve the latest version below.",
      );
    }
    return { ok: false, error: "draft changed", status: "draft_changed" };
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
    // Same guard as the other claim releases: only the claim we still hold
    // may be released, so a newer status can never be clobbered.
    await supabase.from("email_threads").update({ status: "failed" }).eq("id", thread.id).eq("status", "sending");
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
  await markSendFinished(thread.id);

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

// Close our 'sending' claim after a successful send. If the customer wrote
// again while we were sending (process-email set requeue_after_send), the
// thread goes back to 'pending' so the new message gets its own review;
// otherwise it is 'sent'. Both updates only touch a row still in 'sending'.
async function markSendFinished(threadId: string): Promise<void> {
  const supabase = db();
  const { data: sentRows, error: sentErr } = await supabase
    .from("email_threads")
    .update({ status: "sent" })
    .eq("id", threadId)
    .eq("status", "sending")
    .eq("requeue_after_send", false)
    .select("id");
  if (sentErr) console.warn(`[approve] mark sent failed for ${threadId}:`, sentErr.message);
  if (sentRows && sentRows.length > 0) return;

  const { data: requeued, error: rqErr } = await supabase
    .from("email_threads")
    .update({ status: "pending", requeue_after_send: false })
    .eq("id", threadId)
    .eq("status", "sending")
    .eq("requeue_after_send", true)
    .select("id");
  if (rqErr) console.warn(`[approve] requeue after send failed for ${threadId}:`, rqErr.message);
  if (sentErr && rqErr) {
    // Both guarded updates errored (e.g. requeue_after_send not migrated yet):
    // still close the claim so the thread doesn't sit in 'sending' forever.
    await supabase.from("email_threads").update({ status: "sent" }).eq("id", threadId).eq("status", "sending");
    return;
  }
  if (!requeued || requeued.length === 0) {
    console.warn(`[approve] thread ${threadId} was not in 'sending' after a successful send; status left as is`);
  }
}
