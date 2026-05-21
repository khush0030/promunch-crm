// gmail-watch-renew
// ---------------------------------------------------------------------------
// Gmail watches expire every 7 days. This function re-calls users.watch and
// updates the gmail_watch row with the fresh historyId + expiration.
//
// Schedule daily via supabase cron:
//   supabase functions schedule create gmail-watch-renew "0 6 * * *"

import { startWatch } from "../_shared/gmail.ts";
import { db } from "../_shared/supabase.ts";
import { logConnector } from "../_shared/connector-log.ts";

const TOPIC = Deno.env.get("GMAIL_PUBSUB_TOPIC")!;             // projects/<proj>/topics/<name>
const MAILBOX = Deno.env.get("MAILBOX_EMAIL") ?? "hello@promunch.in";

Deno.serve(async (_req) => {
  try {
    const result = await startWatch(TOPIC);
    const expiration = new Date(Number(result.expiration)).toISOString();
    await db().from("gmail_watch").upsert(
      {
        email: MAILBOX,
        history_id: result.historyId,
        expiration,
        last_renewed_at: new Date().toISOString(),
      },
      { onConflict: "email" },
    );
    await logConnector({
      connector: "gmail_watch",
      level: "info",
      event: "watch_renewed",
      message: `Gmail push watch renewed — valid until ${expiration}.`,
      detail: { expiration, historyId: result.historyId },
    });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("gmail-watch-renew failed:", e);
    await logConnector({
      connector: "gmail_watch",
      level: "error",
      event: "watch_renew_failed",
      message: `Failed to renew the Gmail push watch — new emails may stop arriving once it expires: ${msg.slice(0, 250)}`,
      detail: { error: msg.slice(0, 1000) },
    });
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});
