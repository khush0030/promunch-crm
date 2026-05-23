// slack-interactivity
// ---------------------------------------------------------------------------
// Handles Slack block_actions payloads from the three buttons on the draft
// message: Approve & Send, Regenerate, Skip.
//
// Slack sends interactivity payloads as form-encoded data with a single
// `payload` field containing a JSON blob.

import { verifySlackSignature, postDraftRevision, replyInThread } from "../_shared/slack.ts";
import { db } from "../_shared/supabase.ts";
import { generateDraft } from "../_shared/openai.ts";
import { approveAndSend } from "../_shared/approve.ts";
import { logEvent } from "../_shared/log.ts";

interface BlockActionsPayload {
  type: "block_actions";
  user: { id: string; name: string };
  container: { channel_id: string; message_ts: string; thread_ts?: string };
  actions: Array<{
    action_id: string;
    block_id: string;
    value: string;
  }>;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const raw = await req.text();
  if (!(await verifySlackSignature(req, raw))) {
    return new Response("invalid signature", { status: 401 });
  }

  // Slack sends form-encoded
  const form = new URLSearchParams(raw);
  const payloadStr = form.get("payload");
  if (!payloadStr) return new Response("missing payload", { status: 400 });

  const payload: BlockActionsPayload = JSON.parse(payloadStr);
  if (payload.type !== "block_actions") return new Response("ok");

  const action = payload.actions[0];
  if (!action) return new Response("ok");

  let routing: { t: string; r: string };
  try {
    routing = JSON.parse(action.value);
  } catch {
    return new Response("ok");
  }

  // Slack expects a 200 within 3 seconds. We process synchronously but
  // catch+log so we always respond fast.
  try {
    switch (action.action_id) {
      case "approve_send":
        await approveAndSend({
          emailThreadId: routing.t,
          slackChannel: payload.container.channel_id,
          slackThreadTs: payload.container.thread_ts ?? payload.container.message_ts,
          approvedBySlackUser: payload.user.id,
        });
        break;

      case "regenerate":
        await regenerate({
          emailThreadId: routing.t,
          slackChannel: payload.container.channel_id,
          slackThreadTs: payload.container.thread_ts ?? payload.container.message_ts,
        });
        break;

      case "skip": {
        const { data: t } = await db()
          .from("email_threads")
          .select("from_email, subject, snippet, body_plain")
          .eq("id", routing.t)
          .maybeSingle();
        await db().from("email_threads").update({ status: "skipped" }).eq("id", routing.t);
        await logEvent({
          eventType: "skipped",
          emailThreadId: routing.t,
          actor: payload.user.id,
          detail: { via: "skip-button" },
        });
        // Teach the classifier: this sender/subject pattern is no-reply.
        if (t) {
          try {
            await db().from("brand_knowledge").insert({
              kind: "feedback_pattern",
              inbound_subject: t.subject,
              inbound_excerpt: (t.snippet || t.body_plain || "").slice(0, 800),
              feedback: `no_reply (sender=${t.from_email})`,
              tags: ["skip-button", "no-reply"],
              source_thread_id: routing.t,
            });
          } catch (_) { /* non-fatal */ }
        }
        await replyInThread(
          payload.container.channel_id,
          payload.container.thread_ts ?? payload.container.message_ts,
          `:wastebasket: Skipped by <@${payload.user.id}>. _Future emails like this will be auto-skipped._`,
        );
        break;
      }
    }
  } catch (e) {
    console.error("interactivity handler failed:", e);
  }

  return new Response("");
});

async function regenerate(opts: {
  emailThreadId: string;
  slackChannel: string;
  slackThreadTs: string;
}) {
  const { data: thread } = await db()
    .from("email_threads")
    .select("from_name, from_email, subject, body_plain")
    .eq("id", opts.emailThreadId)
    .single();
  if (!thread) return;

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
    feedback: "Please regenerate this draft with a different angle — same intent, fresh wording.",
  });

  const nextRev = (cur?.revision ?? 0) + 1;

  await db()
    .from("draft_revisions")
    .update({ is_current: false })
    .eq("email_thread_id", opts.emailThreadId);

  const { data: rev } = await db()
    .from("draft_revisions")
    .insert({
      email_thread_id: opts.emailThreadId,
      revision: nextRev,
      body: newDraft,
      feedback: "(regenerate button)",
      model,
      is_current: true,
    })
    .select("id")
    .single();

  if (!rev) return;

  const posted = await postDraftRevision({
    channel: opts.slackChannel,
    threadTs: opts.slackThreadTs,
    revision: nextRev,
    feedback: null,
    draftBody: newDraft,
    emailThreadId: opts.emailThreadId,
    draftRevisionId: rev.id,
  });
  await db()
    .from("draft_revisions")
    .update({ slack_message_ts: posted.ts })
    .eq("id", rev.id);

  await logEvent({
    eventType: "regenerated",
    emailThreadId: opts.emailThreadId,
    fromEmail: thread.from_email,
    subject: thread.subject,
    actor: "claude",
    detail: { revision: nextRev, model, via: "regenerate-button" },
  });
}
