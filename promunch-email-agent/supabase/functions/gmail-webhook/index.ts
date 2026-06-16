// gmail-webhook
// ---------------------------------------------------------------------------
// Receives Pub/Sub push notifications from Gmail when new mail arrives.
//
// Gmail's watch() doesn't include the message itself — it just gives us the
// new historyId. We diff against the last known historyId to find new
// messages, then run them through the shared processIncomingMessage pipeline.
//
// Pub/Sub push payload shape:
//   { "message": { "data": "<base64 JSON>", "messageId": "...", ... },
//     "subscription": "projects/X/subscriptions/Y" }
// The decoded data is:
//   { "emailAddress": "hello@promunch.in", "historyId": "12345" }
//
// We optionally verify the Pub/Sub OIDC JWT (set PUBSUB_VERIFICATION_TOKEN
// or use a verified-push audience — see README for setup options).

import { db } from "../_shared/supabase.ts";
import { listHistory } from "../_shared/gmail.ts";
import { processIncomingMessage } from "../_shared/process-email.ts";
import { logConnector, errStr } from "../_shared/connector-log.ts";

const MAILBOX = Deno.env.get("MAILBOX_EMAIL") ?? "hello@promunch.in";
const PUBSUB_TOKEN = Deno.env.get("PUBSUB_VERIFICATION_TOKEN") ?? "";

interface PubSubPush {
  message: { data: string; messageId: string };
  subscription: string;
}

Deno.serve(async (req) => {
  // Optional shared-secret check via query param
  if (PUBSUB_TOKEN) {
    const url = new URL(req.url);
    if (url.searchParams.get("token") !== PUBSUB_TOKEN) {
      return new Response("forbidden", { status: 403 });
    }
  }

  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  let payload: PubSubPush;
  try {
    payload = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }

  // Decode the inner data
  let notification: { emailAddress: string; historyId: string };
  try {
    const decoded = atob(payload.message.data);
    notification = JSON.parse(decoded);
  } catch (e) {
    console.error("Failed to decode pubsub data:", e);
    return new Response("bad data", { status: 400 });
  }

  if (notification.emailAddress.toLowerCase() !== MAILBOX.toLowerCase()) {
    // Not our mailbox — ignore but ack so Pub/Sub stops retrying
    return new Response("ignored", { status: 200 });
  }

  // Look up the last history_id we've processed
  const { data: watch } = await db()
    .from("gmail_watch")
    .select("history_id")
    .eq("email", MAILBOX)
    .maybeSingle();

  const startHistoryId = watch?.history_id ?? notification.historyId;

  let processed = 0;
  let skipped = 0;
  let newestHistoryId = startHistoryId;

  try {
    const { history, historyId } = await listHistory(startHistoryId);
    newestHistoryId = historyId ?? notification.historyId;

    // Collect unique message ids from messagesAdded
    const messageIds = new Set<string>();
    for (const h of history) {
      for (const ma of h.messagesAdded ?? []) {
        messageIds.add(ma.message.id);
      }
    }

    for (const id of messageIds) {
      try {
        const result = await processIncomingMessage(id);
        if (result.status === "processed") processed++;
        else skipped++;
      } catch (e) {
        const msg = errStr(e);
        console.error(`Failed to process message ${id}:`, e);
        // Continue — one bad message shouldn't block the batch.
        // A 404 just means the message was deleted/moved before we fetched it
        // — benign, not a connector outage. Log it as info, not an error.
        const notFound = /\b404\b|not ?found|Requested entity was not found/i.test(msg);
        await logConnector({
          connector: "gmail_pipeline",
          level: notFound ? "info" : "error",
          event: notFound ? "message_skipped_not_found" : "process_failed",
          message: notFound
            ? `Skipped a pushed message that no longer exists in Gmail (${id}).`
            : `Failed to process pushed message: ${msg.slice(0, 300)}`,
          detail: { gmail_message_id: id },
          ref: id,
        });
      }
    }
  } catch (e) {
    // history.list can 404 if startHistoryId is too old. Fall back to
    // using the notification's historyId so the next push starts fresh.
    const msg = errStr(e);
    console.error("listHistory failed, resetting cursor:", e);
    newestHistoryId = notification.historyId;
    await logConnector({
      connector: "gmail_pipeline",
      level: "warn",
      event: "history_reset",
      message: `Gmail history lookup failed (cursor reset, self-heals next push): ${msg.slice(0, 200)}`,
    });
  }

  // Advance the cursor
  await db()
    .from("gmail_watch")
    .upsert(
      { email: MAILBOX, history_id: newestHistoryId, last_renewed_at: new Date().toISOString() },
      { onConflict: "email" },
    );

  return Response.json({ ok: true, processed, skipped, historyId: newestHistoryId });
});
