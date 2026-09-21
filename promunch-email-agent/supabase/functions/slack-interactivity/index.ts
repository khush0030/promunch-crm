// slack-interactivity
// ---------------------------------------------------------------------------
// Handles Slack block_actions payloads from the three buttons on the draft
// message: Approve & Send, Regenerate, Skip.
//
// Slack sends interactivity payloads as form-encoded data with a single
// `payload` field containing a JSON blob.

import { verifySlackSignature } from "../_shared/slack.ts";
import { approveAndSend } from "../_shared/approve.ts";
import { rewriteDraft, skipThread } from "../_shared/email-actions.ts";

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
        await rewriteDraft({
          emailThreadId: routing.t,
          source: { kind: "slack-button", slackUser: payload.user.id },
          slack: {
            channel: payload.container.channel_id,
            threadTs: payload.container.thread_ts ?? payload.container.message_ts,
          },
        });
        break;

      case "skip":
        await skipThread({
          emailThreadId: routing.t,
          source: { kind: "slack-button", slackUser: payload.user.id },
          slack: {
            channel: payload.container.channel_id,
            threadTs: payload.container.thread_ts ?? payload.container.message_ts,
          },
        });
        break;
    }
  } catch (e) {
    console.error("interactivity handler failed:", e);
  }

  return new Response("");
});
