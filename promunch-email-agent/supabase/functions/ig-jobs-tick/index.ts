// Cron (every 1 min): durable Instagram background work. Mirrors wa-jobs-tick.
//
// Drains ig_jobs — currently kind='ai_reply'. ig-webhook fires a best-effort
// fast-path ig-ai-reply for instant UX AND enqueues a job here as the safety
// net. If the fast path failed (cold start, crash, timeout), this retries with
// backoff and dead-letters to a human after max_attempts — an inbound DM is
// never silently dropped.
//
// Schedule: supabase functions schedule create ig-jobs-tick "* * * * *"

import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { logConnector } from "../_shared/connector-log.ts";

const JOB_BATCH = 50;

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  const jobs = await drainJobs().catch((e) => ({ error: String(e) }));
  return j({ ok: true, jobs });
});

async function drainJobs() {
  const sb = db();
  const { data: due } = await sb
    .from("ig_jobs")
    .select("*")
    .eq("status", "pending")
    .lte("run_after", new Date().toISOString())
    .order("run_after", { ascending: true })
    .limit(JOB_BATCH);

  let done = 0, retried = 0, dead = 0;
  for (const job of due ?? []) {
    const attempts = (job.attempts ?? 0) + 1;
    const max = job.max_attempts ?? 5;

    // claim first — bump run_after by backoff so a slow run isn't re-grabbed.
    await sb.from("ig_jobs").update({
      attempts,
      run_after: new Date(Date.now() + attempts * 2 * 60_000).toISOString(),
    }).eq("id", job.id);

    const res = await runJob(job).catch((e) => ({ ok: false, error: String(e) }));

    if (res.ok) {
      await sb.from("ig_jobs").update({ status: "done", last_error: null }).eq("id", job.id);
      done++;
    } else if (attempts >= max) {
      await sb.from("ig_jobs").update({ status: "failed", last_error: (res.error ?? "failed").slice(0, 500) }).eq("id", job.id);
      dead++;
      await deadLetter({ ...job, attempts }, res.error ?? "failed");
    } else {
      await sb.from("ig_jobs").update({ last_error: (res.error ?? "failed").slice(0, 500) }).eq("id", job.id);
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
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ig-ai-reply`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          thread_id: p.thread_id,
          last_message: p.last_message,
          inbound_id: p.inbound_id,
          kind: p.kind,
          comment_id: p.comment_id ?? null,
        }),
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) return { ok: false, error: `ig-ai-reply HTTP ${r.status}` };
      if (data?.ok === true) return { ok: true };
      return { ok: false, error: data?.error ?? "ig-ai-reply produced no result" };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }
  return { ok: false, error: `unknown job kind '${job.kind}'` };
}

// A job that exhausted retries — hand the thread to a human + surface on Slack.
async function deadLetter(job: any, error: string) {
  const sb = db();
  if (job.kind === "ai_reply" && job.payload?.thread_id) {
    await sb.from("ig_threads").update({
      status: "human",
      ticket_status: "open",
      ticket_priority: "high",
      ticket_category: "support",
      ticket_opened_at: new Date().toISOString(),
      escalation_reason: `AI auto-reply failed after ${job.attempts} attempts: ${error}`.slice(0, 500),
    }).eq("id", job.payload.thread_id).then(() => {}, () => {});
  }
  await logConnector({
    connector: "instagram",
    level: "error",
    event: "job_dead_letter",
    message: `ig_jobs '${job.kind}' job dead-lettered after ${job.attempts} attempts: ${error}`.slice(0, 300),
    detail: { job_id: job.id, kind: job.kind, payload: job.payload, error },
  });
}

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
