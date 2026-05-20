// gmail-watch-renew
// ---------------------------------------------------------------------------
// Gmail watches expire every 7 days. This function re-calls users.watch and
// updates the gmail_watch row with the fresh historyId + expiration.
//
// Schedule daily via supabase cron:
//   supabase functions schedule create gmail-watch-renew "0 6 * * *"

import { startWatch } from "../_shared/gmail.ts";
import { db } from "../_shared/supabase.ts";

const TOPIC = Deno.env.get("GMAIL_PUBSUB_TOPIC")!;             // projects/<proj>/topics/<name>
const MAILBOX = Deno.env.get("MAILBOX_EMAIL") ?? "hello@promunch.in";

Deno.serve(async (_req) => {
  const result = await startWatch(TOPIC);
  await db().from("gmail_watch").upsert(
    {
      email: MAILBOX,
      history_id: result.historyId,
      expiration: new Date(Number(result.expiration)).toISOString(),
      last_renewed_at: new Date().toISOString(),
    },
    { onConflict: "email" },
  );
  return Response.json({ ok: true, ...result });
});
