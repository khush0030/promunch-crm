// Dead-man's-switch for WhatsApp monitoring.
//
// wa-health logs a `health_ok` heartbeat every 10 min. If those heartbeats STOP
// — the health probe broke, the WhatsApp API check is failing silently, or
// pg_cron itself died — nothing else would notice. This watchdog checks the age
// of the last health_ok and shouts on Slack (whatsapp-health channel) if it's
// older than STALE_MINUTES.
//
// IMPORTANT: a watchdog must run on a scheduler INDEPENDENT of what it watches.
// wa-health runs on pg_cron, so this is also pinged by an external Vercel cron
// (see src/app/api/cron/wa-watchdog) — if pg_cron dies entirely, the Vercel
// cron still fires this and the stale heartbeat is detected. It is ALSO put on
// pg_cron as a same-fate backstop. Either trigger reaches the same check.

import { db } from "../_shared/supabase.ts";
import { postSlack, slackChannelFor } from "../_shared/connector-log.ts";

const STALE_MINUTES = 20;   // alert if no health_ok within this window
const DEDUPE_MINUTES = 20;  // don't re-ping more than once per window

Deno.serve(async () => {
  const sb = db();

  const { data: last } = await sb
    .from("connector_events")
    .select("created_at")
    .eq("connector", "whatsapp")
    .eq("event", "health_ok")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastMs = last?.created_at ? new Date(last.created_at).getTime() : 0;
  const ageMin = lastMs ? Math.round((Date.now() - lastMs) / 60_000) : Infinity;
  const stale = ageMin > STALE_MINUTES;

  if (!stale) {
    return j({ ok: true, lastHealthAgeMin: ageMin, stale: false });
  }

  // Stale — record + alert (deduped so we don't ping every run).
  const dsince = new Date(Date.now() - DEDUPE_MINUTES * 60_000).toISOString();
  const { data: recent } = await sb
    .from("connector_events")
    .select("id")
    .eq("connector", "whatsapp")
    .eq("event", "watchdog_stale")
    .gte("created_at", dsince)
    .limit(1)
    .maybeSingle();

  const ageLabel = ageMin === Infinity ? "ever (no heartbeat found)" : `${ageMin} min`;
  await sb.from("connector_events").insert({
    connector: "whatsapp",
    level: "error",
    event: "watchdog_stale",
    message: `No WhatsApp health_ok heartbeat in ${ageLabel} — health monitoring or pg_cron may be DOWN. Investigate now.`,
  }).then(() => {}, () => {});

  if (!recent) {
    await postSlack(
      slackChannelFor("whatsapp"),
      [
        ":skull: *WhatsApp monitoring is DARK*",
        `No \`health_ok\` heartbeat in *${ageLabel}* (expected one every ~10 min).`,
        "Likely cause: the wa-health cron stopped, the WhatsApp API check is failing, or pg_cron died.",
        "→ Check Supabase scheduled functions / pg_cron and `supabase functions logs wa-health`.",
      ].join("\n"),
    );
  }

  return j({ ok: false, lastHealthAgeMin: ageMin, stale: true });
});

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
