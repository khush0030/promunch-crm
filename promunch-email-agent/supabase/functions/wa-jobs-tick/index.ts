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
import { requireInternal } from "../_shared/require-internal.ts";
import { logConnector } from "../_shared/connector-log.ts";
import { getFlowSettings } from "../_shared/flow-settings.ts";
import { claimSend, markSendSent, releaseSend } from "../_shared/confirmations.ts";
import {
  buildVerifyComponents,
  buildVerifyVars,
  codTotalLabel,
  GATE_REMINDER_TEMPLATE,
} from "../_shared/cod-gate.ts";

const JOB_BATCH = 50;
const CAMPAIGN_STALE_MIN = 15;

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  const jobs = await drainJobs().catch((e) => ({ error: String(e) }));
  const campaigns = await sweepCampaigns().catch((e) => ({ error: String(e) }));
  const reports = await sweepReports().catch((e) => ({ error: String(e) }));
  const codGate = await sweepCodGate().catch((e) => ({ error: String(e) }));
  return j({ ok: true, jobs, campaigns, reports, codGate });
});

// Fire the SETTLED analytics report exactly once, ~15 min after a campaign
// completes — late enough that Meta's delivery/read receipts have landed, so
// "received" is accurate. Dedup is the connector_events ledger row that
// wa-campaign-report writes (event 'campaign_report_settled', ref = campaign id).
const REPORT_DELAY_MIN = 15;
async function sweepReports() {
  const sb = db();
  const readyBefore = new Date(Date.now() - REPORT_DELAY_MIN * 60_000).toISOString();
  const window = new Date(Date.now() - 120 * 60_000).toISOString(); // ignore anything >2h old
  const { data: done } = await sb
    .from("wa_campaigns")
    .select("id, name, completed_at")
    .eq("status", "completed")
    .not("completed_at", "is", null)
    .lt("completed_at", readyBefore)
    .gt("completed_at", window)
    .limit(20);

  let reported = 0;
  for (const c of done ?? []) {
    const { data: already } = await sb
      .from("connector_events")
      .select("id")
      .eq("event", "campaign_report_settled")
      .eq("ref", c.id)
      .limit(1)
      .maybeSingle();
    if (already) continue;
    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-campaign-report`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ campaign_id: c.id, settled: true }),
    }).catch(() => {});
    reported++;
  }
  return { candidates: done?.length ?? 0, reported };
}

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
        // suppress_ask is carried through so a retry of a "Report a problem"
        // quick-reply tap keeps the same decision the live call made: no
        // review / restock / cart follow-up rides along with a complaint.
        body: JSON.stringify({
          thread_id: p.thread_id,
          last_message: p.last_message,
          image_url: p.image_url ?? null,
          suppress_ask: p.suppress_ask === true,
        }),
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

  // NOTE: the legacy "order_confirmation" job kind was removed (audit
  // 2026-07-18). Nothing enqueues it, and its implementation violated §0: a
  // read-then-act dedup instead of claimConfirmation, the retired 3-var
  // order_confirmation template, and unclaimed hard-coded journey enrolment
  // that bypassed wa_flow_settings. Order confirmations are owned exclusively
  // by _shared/order-confirmation.ts + wa-confirmation-sweep.

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

// ---- 3. COD confirmation gate sweep ----------------------------------------
// Reminders + needs-call escalation for orders stuck in 'pending'. Every send
// and every ops ping is behind an atomic claimSend key — the cron fires every
// minute, so without the claims each tick would re-send (CLAUDE.md §0).
const norm2 = (s: unknown) => String(s ?? "").trim().replace(/^#/, "");

async function sweepCodGate() {
  const flows = await getFlowSettings();
  if (!flows.cod_gate_enabled) return { skipped: "flag off" };
  const sb = db();
  const now = Date.now();
  const remBefore = new Date(now - flows.cod_reminder_delay_hours * 3600_000).toISOString();
  const callBefore = new Date(now - flows.cod_needs_call_hours * 3600_000).toISOString();

  const { data: due } = await sb.from("shopify_orders")
    .select("shopify_id, order_number, customer_name, customer_phone, total_price, currency, confirmation_sent_at")
    .eq("confirmation_status", "pending")
    .lt("confirmation_sent_at", remBefore)
    .limit(50);

  let reminded = 0, escalated = 0;
  for (const o of due ?? []) {
    const ref = norm2(o.order_number);
    if (!ref) continue;

    if (o.confirmation_sent_at < callBefore) {
      // ESCALATE — one ping ever, then park as needs_call
      if (!(await claimSend(`cod_needs_call:${ref}`))) continue;
      await sb.from("shopify_orders")
        .update({ confirmation_status: "needs_call" })
        .eq("shopify_id", o.shopify_id).eq("confirmation_status", "pending");
      const to = (Deno.env.get("OPS_WA_ID") ?? "").replace(/^\+/, "").replace(/\D/g, "");
      let pinged = true;
      if (to) {
        const res = await callWaSendTick({
          to,
          kind: "template",
          sent_by: "cod_gate_ops",
          template: {
            name: Deno.env.get("OPS_ALERT_TEMPLATE") ?? "ops_ticket_alert",
            language: "en",
            vars: {
              "1": "COD confirm call",
              "2": "—",
              "3": o.customer_name ?? "—",
              "4": o.customer_phone ? `+${o.customer_phone}` : "—",
              "5": `Order ${o.order_number} (${codTotalLabel(o.total_price, o.currency)}) unconfirmed for ${flows.cod_needs_call_hours}h. Call to confirm, then flag it on the dashboard.`,
            },
          },
        });
        pinged = res?.ok === true;
      }
      // Ops ping is an internal message: a duplicate is a minor annoyance but a
      // miss parks the order with nobody told. Retry-bias: only lock the claim
      // when the ping went out; otherwise release so the next tick retries.
      if (pinged) await markSendSent(`cod_needs_call:${ref}`);
      else await releaseSend(`cod_needs_call:${ref}`);
      escalated++;
      continue;
    }

    // REMIND — once per order
    if (!o.customer_phone) continue;
    if (!(await claimSend(`cod_reminder:${ref}`))) continue;
    const vars = buildVerifyVars(
      (o.customer_name ?? "there").split(/\s+/)[0],
      o.order_number,
      codTotalLabel(o.total_price, o.currency),
    );
    const res = await callWaSendTick({
      to: o.customer_phone,
      kind: "template",
      sent_by: `journey:cod_gate_reminder:${ref}`,
      template: {
        name: GATE_REMINDER_TEMPLATE, language: "en",
        vars, components: buildVerifyComponents(vars, o.shopify_id),
      },
    });
    if (res?.ok) { await markSendSent(`cod_reminder:${ref}`); reminded++; }
    else await releaseSend(`cod_reminder:${ref}`);
  }
  return { candidates: due?.length ?? 0, reminded, escalated };
}

async function callWaSendTick(body: unknown): Promise<{ ok?: boolean; error?: string } | null> {
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
