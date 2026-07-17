// gmail-poll
// ---------------------------------------------------------------------------
// Cron fallback for environments where Pub/Sub isn't set up. Lists unread
// inbox messages and runs each one through processIncomingMessage. Safe to
// run alongside the webhook — processIncomingMessage is idempotent.
//
// This is also the engine of draft auto-retry: emails whose draft failed are
// left unread, so each poll re-picks them and retries the draft.
//
// Recommended cron: every 2 minutes.
//   supabase functions schedule create gmail-poll "*/2 * * * *"

import { listUnreadInbox } from "../_shared/gmail.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { processIncomingMessage } from "../_shared/process-email.ts";
import { logConnector, errStr } from "../_shared/connector-log.ts";
import { nudgeDealScan } from "../_shared/deal-scan-trigger.ts";

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  let processed = 0;
  let skipped = 0;
  const errors: string[] = [];

  try {
    const messages = await listUnreadInbox(20);
    for (const m of messages) {
      try {
        const r = await processIncomingMessage(m.id);
        if (r.status === "processed") processed++;
        else skipped++;
      } catch (e) {
        const msg = errStr(e);
        errors.push(`${m.id}: ${msg}`);
        console.error(`Poll failed for ${m.id}:`, e);
        // A 404 just means the message was deleted/moved before we fetched it
        // — benign, not a connector outage. Log it as info, not an error.
        const notFound = /\b404\b|not ?found|Requested entity was not found/i.test(msg);
        await logConnector({
          connector: "gmail_pipeline",
          level: notFound ? "info" : "error",
          event: notFound ? "message_skipped_not_found" : "process_failed",
          message: notFound
            ? `Skipped a message that no longer exists in Gmail (${m.id}).`
            : `Failed to process inbox message: ${msg.slice(0, 300)}`,
          detail: { gmail_message_id: m.id },
          ref: m.id,
        });
      }
    }
    // Heartbeat: a clean run proves the intake path is alive.
    await logConnector({
      connector: "gmail_pipeline",
      level: "info",
      event: "poll_ok",
      message: `Inbox poll completed — ${processed} processed, ${skipped} skipped${errors.length ? `, ${errors.length} failed` : ""}.`,
      detail: { processed, skipped, errors: errors.length },
      throttleMinutes: 55, // ~hourly heartbeat, not every 2-minute run
    });
  } catch (e) {
    const msg = errStr(e);
    console.error("Poll run failed:", e);
    await logConnector({
      connector: "gmail_pipeline",
      level: "error",
      event: "poll_failed",
      message: `Inbox poll could not run: ${msg.slice(0, 300)}`,
      detail: { error: msg.slice(0, 1000) },
    });
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }

  // New mail landed → sync the deal pipeline right away (soft-locked fn,
  // runs past the response via waitUntil; §0 untouched — deal-scan never sends)
  if (processed > 0) nudgeDealScan("gmail-poll");

  return Response.json({ ok: true, processed, skipped, errors });
});
