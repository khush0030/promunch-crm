// Cron (every 1 min): durable WhatsApp background work.
//
//   1. Drain wa_jobs — currently kind='ai_reply'. wa-webhook fires a
//      best-effort fast-path call to wa-ai-reply for instant UX AND enqueues a
//      job here as the safety net. If the fast path failed (cold start, crash,
//      timeout), this retries with backoff and dead-letters to a human after
//      max_attempts — an inbound message is never silently dropped.
//   2. Sweep stuck campaigns — a wa-campaign-send batch that never chained its
//      successor (network blip) leaves the campaign frozen in 'sending'.
//      Re-invoke it; the send is resumable so a spurious re-invoke is harmless.
//
// Schedule every minute:
//   supabase functions schedule create wa-jobs-tick "* * * * *"

import { db } from "../_shared/supabase.ts";
import { logConnector } from "../_shared/connector-log.ts";

const JOB_BATCH = 50;
const CAMPAIGN_STALE_MIN = 15;

Deno.serve(async () => {
  const jobs = await drainJobs().catch((e) => ({ error: String(e) }));
  const campaigns = await sweepCampaigns().catch((e) => ({ error: String(e) }));
  return j({ ok: true, jobs, campaigns });
});

// ---- 1. wa_jobs queue ------------------------------------------------------
async function drainJobs() {
  const sb = db();
  const { data: due } = await sb
    .from("wa_jobs")
    .select("*")
    .eq("status", "pending")
    .lte("run_after", new Date().toISOString())
    .order("run_after", { ascending: true })
    .limit(JOB_BATCH);

  let done = 0, retried = 0, dead = 0;
  for (const job of due ?? []) {
    const attempts = (job.attempts ?? 0) + 1;
    const max = job.max_attempts ?? 5;

    // claim first — bump run_after by an exponential-ish backoff so a slow
    // invocation isn't re-grabbed by the next tick.
    await sb.from("wa_jobs").update({
      attempts,
      run_after: new Date(Date.now() + attempts * 2 * 60_000).toISOString(),
    }).eq("id", job.id);

    const res = await runJob(job).catch((e) => ({ ok: false, error: String(e) }));

    if (res.ok) {
      await sb.from("wa_jobs").update({ status: "done", last_error: null }).eq("id", job.id);
      done++;
    } else if (attempts >= max) {
      await sb.from("wa_jobs").update({
        status: "failed", last_error: (res.error ?? "failed").slice(0, 500),
      }).eq("id", job.id);
      dead++;
      await deadLetter({ ...job, attempts }, res.error ?? "failed");
    } else {
      await sb.from("wa_jobs").update({
        last_error: (res.error ?? "failed").slice(0, 500),
      }).eq("id", job.id);
      retried++;
    }
  }
  return { processed: due?.length ?? 0, done, retried, dead };
}

async function runJob(job: any): Promise<{ ok: boolean; error?: string }> {
  if (job.kind === "ai_reply") {
    const p = job.payload ?? {};
    if (!p.thread_id) return { ok: false, error: "ai_reply job missing thread_id" };
    try {
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-ai-reply`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ thread_id: p.thread_id, last_message: p.last_message, image_url: p.image_url ?? null }),
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) return { ok: false, error: `wa-ai-reply HTTP ${r.status}` };
      // wa-ai-reply always replies on success — ok:true is the terminal signal
      if (data?.ok === true) return { ok: true };
      return { ok: false, error: data?.error ?? "wa-ai-reply produced no reply" };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }
  return { ok: false, error: `unknown job kind '${job.kind}'` };
}

// A job that exhausted its retries — hand the conversation to a human and
// surface it on the CRM Integrations page (which also pages Slack on errors).
async function deadLetter(job: any, error: string) {
  const sb = db();
  if (job.kind === "ai_reply" && job.payload?.thread_id) {
    await sb.from("wa_threads").update({
      status: "human",
      ticket_status: "open",
      ticket_priority: "high",
      ticket_category: "general",
      ticket_opened_at: new Date().toISOString(),
      escalation_reason: `AI auto-reply failed after ${job.attempts} attempts: ${error}`.slice(0, 500),
    }).eq("id", job.payload.thread_id).then(() => {}, () => {});
  }
  await logConnector({
    connector: "whatsapp",
    level: "error",
    event: "job_dead_letter",
    message: `wa_jobs '${job.kind}' job dead-lettered after ${job.attempts} attempts: ${error}`.slice(0, 300),
    detail: { job_id: job.id, kind: job.kind, payload: job.payload, error },
  });
}

// ---- 2. stuck-campaign sweep ----------------------------------------------
async function sweepCampaigns() {
  const sb = db();
  const cutoff = new Date(Date.now() - CAMPAIGN_STALE_MIN * 60_000).toISOString();
  const { data: stuck } = await sb
    .from("wa_campaigns")
    .select("id, name, started_at")
    .eq("status", "sending")
    .lt("started_at", cutoff)
    .limit(20);

  let resumed = 0;
  for (const c of stuck ?? []) {
    // wa-campaign-send is resumable — it skips already-messaged recipients —
    // so re-invoking a campaign that happens to still be running is harmless.
    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-campaign-send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ campaign_id: c.id, _continue: true }),
    }).catch(() => {});
    resumed++;
    await logConnector({
      connector: "whatsapp",
      level: "warn",
      event: "campaign_resumed",
      message: `Campaign '${c.name}' was stuck in 'sending' for >${CAMPAIGN_STALE_MIN}m — re-invoked.`,
      detail: { campaign_id: c.id },
      throttleMinutes: CAMPAIGN_STALE_MIN,
    });
  }
  return { stuck: stuck?.length ?? 0, resumed };
}

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
