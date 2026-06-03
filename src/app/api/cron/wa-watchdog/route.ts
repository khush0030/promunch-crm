import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Dead-man's-switch for WhatsApp monitoring — runs on VERCEL cron, which is
// independent of Supabase pg_cron. wa-health logs a `health_ok` heartbeat every
// ~10 min; if those stop (probe broke, WhatsApp API failing, or pg_cron itself
// died) this notices within ~20 min and alerts the whatsapp-health Slack channel.
//
// Why here and not only in Supabase: a watchdog must not share fate with what it
// watches. There is also a Supabase wa-watchdog on pg_cron as a same-fate
// backstop, but THIS one is what catches pg_cron dying entirely.
//
// Env required on Vercel: SLACK_BOT_TOKEN, WA_HEALTH_CHANNEL_ID,
// SUPABASE_SERVICE_ROLE_KEY (+ URL). Optional: CRON_SECRET to lock the endpoint.
export const dynamic = "force-dynamic";

const STALE_MINUTES = 20;
const DEDUPE_MINUTES = 20;

export async function GET(req: NextRequest) {
  // If CRON_SECRET is set, require it (Vercel cron sends it as a Bearer token).
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const { data: last } = await supabaseAdmin
    .from("connector_events")
    .select("created_at")
    .eq("connector", "whatsapp")
    .eq("event", "health_ok")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastMs = last?.created_at ? new Date(last.created_at as string).getTime() : 0;
  const ageMin = lastMs ? Math.round((Date.now() - lastMs) / 60_000) : Infinity;
  const stale = ageMin > STALE_MINUTES;

  if (!stale) return NextResponse.json({ ok: true, lastHealthAgeMin: ageMin, stale: false });

  // Stale — record (deduped) and alert.
  const dsince = new Date(Date.now() - DEDUPE_MINUTES * 60_000).toISOString();
  const { data: recent } = await supabaseAdmin
    .from("connector_events")
    .select("id")
    .eq("connector", "whatsapp")
    .eq("event", "watchdog_stale")
    .gte("created_at", dsince)
    .limit(1)
    .maybeSingle();

  const ageLabel = ageMin === Infinity ? "ever (no heartbeat found)" : `${ageMin} min`;

  await supabaseAdmin.from("connector_events").insert({
    connector: "whatsapp",
    level: "error",
    event: "watchdog_stale",
    message: `No WhatsApp health_ok heartbeat in ${ageLabel} — health monitoring or pg_cron may be DOWN (Vercel watchdog).`,
  });

  if (!recent) {
    // Same structured shape as the Supabase alerts (Issue / cause / expected / action).
    await postSlack(
      [
        ":red_circle: *CRITICAL · WhatsApp*",
        `*Issue:* WhatsApp monitoring is DARK — no \`health_ok\` heartbeat in *${ageLabel}* (expected one every ~10 min).`,
        "*Likely cause:* The wa-health cron stopped, the WhatsApp API check is failing silently, or Supabase pg_cron died.",
        "*Expected?:* :rotating_light: Critical — act now",
        "*What to do:* Check Supabase scheduled functions / pg_cron and the wa-health logs. If pg_cron is down, restart it; if the token expired, refresh WHATSAPP_ACCESS_TOKEN.",
        "*Details:* `watchdog_stale` · _detected by the independent Vercel watchdog_",
      ].join("\n"),
    );
  }

  return NextResponse.json({ ok: false, lastHealthAgeMin: ageMin, stale: true });
}

async function postSlack(text: string): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.WA_HEALTH_CHANNEL_ID ?? process.env.SLACK_CHANNEL_ID;
  if (!token || !channel) return;
  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel, text, unfurl_links: false, unfurl_media: false }),
    });
  } catch {
    /* swallow — the Supabase pg_cron watchdog is the backstop */
  }
}
