// gmail-poll
// ---------------------------------------------------------------------------
// Cron fallback for environments where Pub/Sub isn't set up. Lists unread
// inbox messages and runs each one through processIncomingMessage. Safe to
// run alongside the webhook — processIncomingMessage is idempotent.
//
// Recommended cron: every 2 minutes.
//   supabase functions schedule create gmail-poll "*/2 * * * *"

import { listUnreadInbox } from "../_shared/gmail.ts";
import { processIncomingMessage } from "../_shared/process-email.ts";

Deno.serve(async (_req) => {
  let processed = 0;
  let skipped = 0;
  const errors: string[] = [];

  const messages = await listUnreadInbox(20);
  for (const m of messages) {
    try {
      const r = await processIncomingMessage(m.id);
      if (r.status === "processed") processed++;
      else skipped++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${m.id}: ${msg}`);
      console.error(`Poll failed for ${m.id}:`, e);
    }
  }

  return Response.json({ ok: true, processed, skipped, errors });
});
