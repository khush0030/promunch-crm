// Durable campaign engine heartbeat. Called by Supabase pg_cron every ~2 min
// (NOT Vercel — no Hobby cron limit, no CRON_SECRET). Each run is independent
// and idempotent, so scheduling + sending survive any crash:
//
//   1. PROMOTE  — any campaign whose scheduled time has passed goes
//                 scheduled -> sending (recurring ones spawn a child occurrence
//                 and advance the parent).
//   2. DRIVE    — every 'sending' campaign is kicked to send its next batch via
//                 wa-campaign-send. We only kick a campaign that has STALLED
//                 (no new message for STALL_MS) so we never run two batches at
//                 once (which would double-send). A healthy campaign drains via
//                 wa-campaign-send's own self-chain; if that chain ever dies,
//                 the next heartbeat resurrects it within a couple of minutes.
//   3. WATCHDOG — a campaign stalled past ALERT_MS pings Slack (so a freeze can
//                 never again go unnoticed).
//
// Dedup is guaranteed by the wa_messages(campaign_id, contact_id) ledger inside
// wa-campaign-send — honouring the hard "never message a customer twice" rule.
//
// verify_jwt = false (invoked by pg_cron). GET or POST.

import { db } from "../_shared/supabase.ts";
import { postSlack, slackChannelFor } from "../_shared/connector-log.ts";

const STALL_MS = 3 * 60_000;   // no progress for 3 min → re-kick the sender
const ALERT_MS = 12 * 60_000;  // stalled 12 min → Slack alert

Deno.serve(async () => {
  const sb = db();
  const now = Date.now();
  const nowIso = new Date().toISOString();
  const log: string[] = [];

  // 1. PROMOTE due scheduled campaigns ---------------------------------------
  const { data: due } = await sb
    .from("wa_campaigns")
    .select("id,name,scheduled_at,repeat_rule,repeat_until,template_id,template_vars,audience_filter,created_by")
    .eq("status", "scheduled")
    .lte("scheduled_at", nowIso);

  for (const c of due ?? []) {
    if (c.repeat_rule) {
      const next = nextOccurrence(c.scheduled_at, c.repeat_rule);
      const stop = c.repeat_until != null && next.getTime() > new Date(c.repeat_until).getTime();
      // Guarded advance: only the run that flips scheduled_at proceeds (no double-spawn).
      const { data: adv } = await sb.from("wa_campaigns")
        .update(stop ? { status: "completed", completed_at: nowIso } : { scheduled_at: next.toISOString() })
        .eq("id", c.id).eq("status", "scheduled").eq("scheduled_at", c.scheduled_at)
        .select("id").maybeSingle();
      if (!adv) continue;
      const occ = new Date(c.scheduled_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
      const { data: child } = await sb.from("wa_campaigns").insert({
        name: `${c.name} · ${occ}`, template_id: c.template_id, template_vars: c.template_vars ?? {},
        audience_filter: c.audience_filter ?? {}, status: "sending", started_at: nowIso,
        parent_campaign_id: c.id, created_by: c.created_by ?? null,
      }).select("id").single();
      if (child) kick(child.id);
      log.push(`recurring "${c.name}" → child ${child?.id ?? "?"}${stop ? " (series ended)" : ""}`);
    } else {
      const { data: claimed } = await sb.from("wa_campaigns")
        .update({ status: "sending", started_at: nowIso, last_error: null })
        .eq("id", c.id).eq("status", "scheduled")
        .select("id").maybeSingle();
      if (claimed) { kick(c.id); log.push(`started "${c.name}"`); }
    }
  }

  // 2. DRIVE + 3. WATCHDOG in-flight campaigns -------------------------------
  const { data: sending } = await sb
    .from("wa_campaigns")
    .select("id,name,started_at,sent_count,failed_count,resume_at")
    .eq("status", "sending");

  for (const c of sending ?? []) {
    // Cap-aware: a campaign deferred to its next daily wave stays dormant until
    // resume_at passes (don't kick, don't alert). When it passes, the idle check
    // below wakes it for the new wave.
    if (c.resume_at && new Date(c.resume_at).getTime() > now) {
      log.push(`"${c.name}" dormant until ${c.resume_at}`);
      continue;
    }
    const { data: last } = await sb.from("wa_messages")
      .select("created_at").eq("campaign_id", c.id)
      .order("created_at", { ascending: false }).limit(1);
    const lastAt = last?.[0]?.created_at
      ? new Date(last[0].created_at).getTime()
      : new Date(c.started_at ?? nowIso).getTime();
    const idle = now - lastAt;
    if (idle > STALL_MS) {
      kick(c.id);
      log.push(`re-kicked stalled "${c.name}" (idle ${Math.round(idle / 1000)}s)`);
      if (idle > ALERT_MS) {
        await postSlack(
          slackChannelFor("whatsapp"),
          `⚠️ Campaign "${c.name}" stalled ${Math.round(idle / 60000)}m — auto-resuming. ` +
          `Sent ${c.sent_count}, failed ${c.failed_count}. If this repeats, check the WhatsApp token / template.`,
        ).catch(() => {});
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, at: nowIso, log }), {
    headers: { "content-type": "application/json" },
  });
});

// Fire wa-campaign-send for one batch; keep the request alive past our response.
function kick(campaignId: string) {
  const p = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-campaign-send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ campaign_id: campaignId, _continue: true }),
  }).catch(() => {});
  try {
    (globalThis as { EdgeRuntime?: { waitUntil?: (pr: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(p);
  } catch { /* not on edge runtime */ }
}

// Next occurrence for a recurring rule (monthly clamps short months).
function nextOccurrence(fromIso: string, rule: string): Date {
  const d = new Date(fromIso);
  if (rule === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (rule === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (rule === "monthly") {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return d;
}
