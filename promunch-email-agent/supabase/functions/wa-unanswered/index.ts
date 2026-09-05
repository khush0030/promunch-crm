// Cron (every 5 min): the customer-side smoke alarm.
//
// Everything else we monitor watches the MACHINERY: wa-health pings the Cloud
// API, wa-watchdog watches the heartbeat, wa-send alerts on failed sends,
// wa-jobs-tick dead-letters a job after max_attempts. On 2026-09-05 all four
// were green while a customer sat unanswered: the reply run threw a 400 AFTER
// taking the per-turn claim, so no send failed, no job gave up, and nothing
// noticed. The only signal that would have caught it is the one nobody was
// watching: a customer asked something and got no answer.
//
// This checks exactly that, on threads the BOT owns (status='bot'), where an
// automated reply is unconditionally expected. Human-owned threads have their
// own SLA and are covered by wa-ticket-watchdog, so they are skipped here to
// avoid double-alerting the same chat.
//
// It also diagnoses WHY, because "customer waiting" alone does not tell you
// where to look:
//   no_job        — the durable job row was never written (enqueue failed)
//   job_pending   — a job exists and is waiting or retrying (usually transient)
//   job_stuck     — a job exhausted its attempts
//   claim_held    — the turn claim is held but nothing was ever sent, which
//                   means a run crashed mid-flight and the turn is frozen
//
// Schedule (Supabase SQL editor):
//   select cron.schedule('wa-unanswered', '*/5 * * * *', ...);

import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { logConnector } from "../_shared/connector-log.ts";

// How long a customer may wait before we call it a fault. The fast path answers
// in ~10s and the durable job retry starts at +2 min, so 8 minutes means
// something genuinely broke rather than "it is busy".
const SILENT_MINUTES = Number(Deno.env.get("WA_UNANSWERED_MINUTES") ?? 8);
// Ignore anything older than this: we are looking for a live outage, not
// archaeology. A thread that has been silent for a day is a backlog problem.
const LOOKBACK_HOURS = 6;
// One alert per thread per this window, so a sustained outage is one standing
// item rather than a message every 5 minutes.
const RE_ALERT_HOURS = 6;

// A bare opt-out is answered with silence BY DESIGN, so it is not a fault.
const OPT_OUT = /^\s*(stop|unsubscribe|cancel subscription|opt\s*out)\s*[.!]?\s*$/i;

interface Msg {
  id: string;
  thread_id: string;
  direction: string;
  type: string;
  body: string | null;
  created_at: string;
}

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;

  const sb = db();
  const now = Date.now();
  const since = new Date(now - LOOKBACK_HOURS * 3600_000).toISOString();

  const { data, error } = await sb
    .from("wa_messages")
    .select("id,thread_id,direction,type,body,created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(3000);
  if (error) return j({ ok: false, error: error.message }, 500);

  // Last message per thread. If it is inbound, nobody has replied since.
  const last = new Map<string, Msg>();
  for (const m of (data ?? []) as Msg[]) {
    if (m.type === "reaction") continue; // a thumbs-up needs no reply
    last.set(m.thread_id, m);
  }

  const waiting: Msg[] = [];
  for (const m of last.values()) {
    if (m.direction !== "inbound") continue;
    const ageMin = (now - Date.parse(m.created_at)) / 60_000;
    if (ageMin < SILENT_MINUTES) continue;
    if (OPT_OUT.test(m.body ?? "")) continue;
    waiting.push(m);
  }
  if (!waiting.length) return j({ ok: true, checked: last.size, waiting: 0 });

  // Only bot-owned threads: those must get an automated reply.
  const { data: threads } = await sb
    .from("wa_threads")
    .select("id, wa_id, status")
    .in("id", waiting.map((m) => m.thread_id));
  const botThreads = new Map(
    (threads ?? []).filter((t: any) => t.status === "bot").map((t: any) => [t.id, t]),
  );

  const alerted: string[] = [];
  const skipped: string[] = [];
  for (const m of waiting) {
    const thread = botThreads.get(m.thread_id);
    if (!thread) { skipped.push(m.thread_id); continue; }

    // Already shouted about this thread recently? One standing item, not a drip.
    const reAlertSince = new Date(now - RE_ALERT_HOURS * 3600_000).toISOString();
    const { data: recent } = await sb
      .from("connector_events")
      .select("id")
      .eq("connector", "whatsapp")
      .eq("event", "reply_missing")
      .eq("ref", m.thread_id)
      .gte("created_at", reAlertSince)
      .limit(1)
      .maybeSingle();
    if (recent) { skipped.push(m.thread_id); continue; }

    const diagnosis = await diagnose(sb, m);
    const waitMin = Math.round((now - Date.parse(m.created_at)) / 60_000);

    await logConnector({
      connector: "whatsapp",
      level: "error",
      event: "reply_missing",
      ref: m.thread_id,
      message:
        `Customer has waited ${waitMin} min with no reply (+${thread.wa_id}): ` +
        `"${(m.body ?? "").slice(0, 120)}" [${diagnosis.code}]`,
      detail: {
        thread_id: m.thread_id,
        wa_id: thread.wa_id,
        inbound_id: m.id,
        waited_minutes: waitMin,
        diagnosis: diagnosis.code,
        diagnosis_detail: diagnosis.detail,
      },
    });
    alerted.push(m.thread_id);
  }

  return j({ ok: true, checked: last.size, waiting: waiting.length, alerted, skipped: skipped.length });
});

// Work out why this turn produced no reply, so the alert points somewhere.
async function diagnose(
  sb: any,
  m: Msg,
): Promise<{ code: string; detail: Record<string, unknown> }> {
  // Is the per-turn reply claim held with nothing ever sent? That is a run that
  // crashed after claiming, which freezes the turn permanently.
  const { data: claim } = await sb
    .from("wa_reply_claims")
    .select("status, claimed_at")
    .eq("thread_id", m.thread_id)
    .eq("inbound_id", m.id)
    .maybeSingle();

  // Is there a durable job for this thread still in flight?
  const { data: jobs } = await sb
    .from("wa_jobs")
    .select("id, status, attempts, max_attempts, last_error, run_after, payload")
    .eq("kind", "ai_reply")
    .neq("status", "done")
    .order("created_at", { ascending: false })
    .limit(100);
  const job = (jobs ?? []).find((jb: any) => jb?.payload?.thread_id === m.thread_id) ?? null;

  if (claim && claim.status !== "sent") {
    return {
      code: "claim_held",
      detail: { claim_status: claim.status, claimed_at: claim.claimed_at, job: job ?? null },
    };
  }
  if (job) {
    const exhausted = (job.attempts ?? 0) >= (job.max_attempts ?? 5);
    return {
      code: exhausted ? "job_stuck" : "job_pending",
      detail: { attempts: job.attempts, max_attempts: job.max_attempts, last_error: job.last_error, run_after: job.run_after },
    };
  }
  return { code: "no_job", detail: { claim: claim ?? null } };
}

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
