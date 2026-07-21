// Cron (every 15 min): the Instagram follow-up engine.
//
// Chases collab threads that went quiet (the "influencer agreed to a video,
// then vanished" problem) with per-stage cadences from
// ig_settings.followup_cadences. One ig_followups row = one scheduled nudge.
//
// Loop shape (wa-journey-tick + sequence-engine patterns):
//   1. RECOVER stale 'sending' claims (>15 min): the ig_messages ledger marker
//      ai_meta->>'followup_id' decides — marker present → the send landed,
//      finalize + schedule next; absent → nothing was sent, safe to retry.
//   2. DRAIN due 'scheduled' rows with a compare-and-set claim. Stop/defer
//      guards, then route by messaging-window state:
//        open_24h  + thread owned by bot → auto-send via ig-send
//        anything else                   → 'awaiting_approval' (Tasks tab)
//          channel: ig_dm (window open, human owns thread) →
//                   ig_dm_human_agent (7d lane, if Meta-approved) →
//                   email (bio_email) → whatsapp (phone) → manual
//   3. ARM sweep: quiet collab threads in a cadence stage with no live
//      follow-up get a step-1 row. The partial unique index makes racing arms
//      harmless (unique violation → ignored).
//
// NO-SPAM: unique live-row index + CAS claim + ledger marker + ig-send window
// guard. Every uncertain branch biases to NOT sending.
//
// Master switch: ig_settings.followups_enabled (ships false).
// Schedule: pg_cron 'ig-followup-tick' */15 (see 20260721141000).

import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { logConnector, errStr } from "../_shared/connector-log.ts";
import { windowState } from "../_shared/ig-window.ts";
import { generateFollowupDraft, loadCadences, type CadenceCfg } from "../_shared/ig-followup-draft.ts";

const DRAIN_BATCH = 50;
const ARM_BATCH = 200;
const STALE_CLAIM_MIN = 15;
const MAX_SEND_ATTEMPTS = 5;
const TERMINAL_STAGES = new Set(["posted", "declined"]);

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  const result = await tick().catch((e) => ({ error: errStr(e) }));
  return j({ ok: true, ...result });
});

async function tick() {
  const sb = db();
  const { data: settings } = await sb
    .from("ig_settings")
    .select("paused, followups_enabled, human_agent_enabled, barter_terms")
    .eq("id", 1)
    .maybeSingle();
  if (!settings?.followups_enabled) return { skipped: "followups_disabled" };

  const cadences = await loadCadences();
  if (!Object.keys(cadences).length) return { skipped: "no_cadences" };

  const recovered = await recoverStaleClaims(cadences);
  const drained = settings.paused ? { deferred_all: true } : await drainDue(settings, cadences);
  const armed = await armSweep(cadences);
  return { recovered, ...drained, armed };
}

// ---- 1. recover stale claims ------------------------------------------------
async function recoverStaleClaims(cadences: Record<string, CadenceCfg>) {
  const sb = db();
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MIN * 60_000).toISOString();
  const { data: stale } = await sb
    .from("ig_followups")
    .select("*")
    .eq("status", "sending")
    .lt("claimed_at", staleBefore);

  let finalized = 0, requeued = 0;
  for (const f of stale ?? []) {
    // The durable ledger decides: did the crashed run actually send?
    const { data: sent } = await sb
      .from("ig_messages")
      .select("id")
      .eq("thread_id", f.thread_id)
      .eq("direction", "outbound")
      .filter("ai_meta->>followup_id", "eq", f.id)
      .limit(1)
      .maybeSingle();
    if (sent) {
      await finalizeSent(f, "ig_dm");
      await scheduleNext(f, cadences);
      finalized++;
    } else {
      await sb.from("ig_followups").update({
        status: "scheduled",
        claimed_at: null,
        updated_at: new Date().toISOString(),
      }).eq("id", f.id).eq("status", "sending");
      requeued++;
    }
  }
  return { finalized, requeued };
}

// ---- 2. drain due rows ------------------------------------------------------
async function drainDue(
  settings: { human_agent_enabled: boolean | null; barter_terms: string | null },
  cadences: Record<string, CadenceCfg>,
) {
  const sb = db();
  const { data: due } = await sb
    .from("ig_followups")
    .select("*")
    .eq("status", "scheduled")
    .lte("next_action_at", new Date().toISOString())
    .order("next_action_at", { ascending: true })
    .limit(DRAIN_BATCH);

  let sentNow = 0, queued = 0, cancelled = 0, deferred = 0, failed = 0;
  for (const f of due ?? []) {
    // ATOMIC CLAIM — compare-and-set; exactly one tick run wins this row.
    const { data: won } = await sb
      .from("ig_followups")
      .update({ status: "sending", claimed_at: new Date().toISOString(), attempts: (f.attempts ?? 0) + 1 })
      .eq("id", f.id)
      .eq("status", "scheduled")
      .select("id");
    if (!won?.length) continue;

    const { data: t } = await sb.from("ig_threads").select("*").eq("id", f.thread_id).maybeSingle();

    // ---- stop conditions ----
    if (!t || t.archived_at || TERMINAL_STAGES.has(t.collab_stage ?? "") || t.classification === "spam") {
      await cancel(f, "terminal"); cancelled++; continue;
    }
    if (t.collab_stage !== f.stage) {
      // stage moved — the stage route arms the new cadence; this row is obsolete
      await cancel(f, "stage_changed"); cancelled++; continue;
    }
    if (t.last_inbound_at && f.created_at && new Date(t.last_inbound_at) > new Date(f.created_at)) {
      // they replied since this nudge was armed (webhook cancel is the primary
      // path; this is the belt-and-braces copy)
      await cancel(f, "replied"); cancelled++; continue;
    }
    // ---- defer conditions ----
    if (t.ticket_status === "open" || t.ticket_status === "pending") {
      await defer(f, 12 * 3600_000); deferred++; continue;
    }

    const state = windowState(t.last_inbound_at, !!settings.human_agent_enabled);
    const cad = cadences[f.stage];
    const daysSilent = t.last_inbound_at
      ? Math.max(0, Math.round((Date.now() - new Date(t.last_inbound_at).getTime()) / 86_400_000))
      : 0;

    let draft = f.draft as string | null;
    if (!draft) {
      const { data: recent } = await sb
        .from("ig_messages")
        .select("direction, text")
        .eq("thread_id", f.thread_id)
        .order("created_at", { ascending: false })
        .limit(5);
      draft = await generateFollowupDraft({
        handle: t.handle,
        stage: f.stage,
        goal: cad?.goal ?? "move the collab forward",
        step: f.step,
        totalSteps: cad?.days.length ?? f.step,
        daysSilent,
        collabDraft: t.collab_draft,
        barterTerms: settings.barter_terms,
        lastMessages: (recent ?? []).reverse(),
      }).catch((e) => {
        console.error("[ig-followup-tick] draft failed", errStr(e));
        return null;
      });
      if (!draft) {
        // no draft → no send. Backoff and retry; never send a blank.
        await backoff(f, "draft generation failed"); failed++; continue;
      }
    }

    if (state === "open_24h" && t.status === "bot") {
      // ---- AUTO-SEND (the only automated lane) ----
      const res = await callIgSend({
        thread_id: f.thread_id,
        kind: "text",
        text: draft,
        sent_by: "followup_bot",
        ai_generated: true,
        ai_meta: { followup_id: f.id, step: f.step, stage: f.stage },
      });
      if (res.ok) {
        await finalizeSent(f, "ig_dm", draft);
        await scheduleNext(f, cadences);
        sentNow++;
      } else {
        if ((f.attempts ?? 0) + 1 >= MAX_SEND_ATTEMPTS) {
          await escalate(f, t, res.error ?? "send failed repeatedly"); failed++;
        } else {
          await backoff(f, res.error ?? "send failed"); failed++;
        }
      }
    } else {
      // ---- OUT OF WINDOW or human-owned thread → APPROVAL QUEUE ----
      const channel =
        state === "open_24h" ? "ig_dm"                     // window open, human owns the thread — approve sends a normal DM
        : state === "human_agent_7d" ? "ig_dm_human_agent"
        : t.bio_email ? "email"
        : t.phone ? "whatsapp"
        : "manual";
      await sb.from("ig_followups").update({
        status: "awaiting_approval",
        channel,
        draft,
        claimed_at: null,
        meta: { ...(f.meta ?? {}), window_state: state, days_silent: daysSilent, thread_owned_by: t.status },
        updated_at: new Date().toISOString(),
      }).eq("id", f.id).eq("status", "sending");
      queued++;
    }
  }
  return { due: due?.length ?? 0, sentNow, queued, cancelled, deferred, failed };
}

// ---- 3. arm sweep -----------------------------------------------------------
// Safety net that (re-)arms quiet collab threads: after a reply cancelled the
// pending nudge, after a cadence-stage thread never got one, or after go-live.
async function armSweep(cadences: Record<string, CadenceCfg>) {
  const sb = db();
  const stages = Object.keys(cadences);
  const { data: threads } = await sb
    .from("ig_threads")
    .select("id, collab_stage, last_inbound_at, last_outbound_at")
    .eq("classification", "collab")
    .in("collab_stage", stages)
    .is("archived_at", null)
    .limit(ARM_BATCH);

  let armed = 0;
  for (const t of threads ?? []) {
    const cad = cadences[t.collab_stage!];
    const lastTouch = Math.max(
      t.last_inbound_at ? new Date(t.last_inbound_at).getTime() : 0,
      t.last_outbound_at ? new Date(t.last_outbound_at).getTime() : 0,
    );
    if (!lastTouch) continue; // no conversation yet — nothing to chase
    const quietMs = Date.now() - lastTouch;
    if (quietMs < cad.days[0] * 86_400_000) continue;

    // Decide from the thread's LATEST follow-up row (any status) whether and
    // where to re-arm. Live row → nothing to do. A human skip or an escalation
    // is an opt-out for this stage; a reply-cancel restarts the cadence.
    const { data: last } = await sb
      .from("ig_followups")
      .select("id, stage, step, status, meta, updated_at")
      .eq("thread_id", t.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let nextStep = 1;
    if (last) {
      const liveStatuses = ["scheduled", "sending", "awaiting_approval"];
      if (liveStatuses.includes(last.status)) continue;
      if (last.stage === t.collab_stage) {
        if (last.status === "escalated") continue;               // human already pulled in
        if (last.status === "sent") {
          if (last.step >= cad.days.length) continue;            // cadence exhausted — human decides
          nextStep = last.step + 1;                              // scheduleNext insert must have failed
        } else if (last.status === "cancelled") {
          const reason = (last.meta as { cancelled_reason?: string } | null)?.cancelled_reason;
          if (reason !== "replied") continue;                    // skipped / terminal / stage_changed = opt-out
          nextStep = 1;   // they replied then went quiet again (quietMs check above) — restart the cadence
        }
      }
      // stage differs from the cancelled/sent row → new stage, start at step 1
    }
    const { error } = await sb.from("ig_followups").insert({
      thread_id: t.id,
      stage: t.collab_stage,
      step: nextStep,
      status: "scheduled",
      next_action_at: new Date().toISOString(),
    });
    // 23505 = lost the race against another arm — exactly what the index is for
    if (!error) armed++;
    else if (error.code !== "23505") console.error("[ig-followup-tick] arm failed", errStr(error));
  }
  return armed;
}

// ---- helpers ----------------------------------------------------------------
async function finalizeSent(f: any, channel: string, draft?: string) {
  await db().from("ig_followups").update({
    status: "sent",
    channel,
    ...(draft ? { draft } : {}),
    claimed_at: null,
    last_error: null,
    updated_at: new Date().toISOString(),
  }).eq("id", f.id);
}

async function scheduleNext(f: any, cadences: Record<string, CadenceCfg>) {
  const cad = cadences[f.stage];
  if (!cad || f.step >= cad.days.length) {
    // cadence exhausted — surface it, a human decides what happens next
    await logConnector({
      connector: "instagram",
      level: "info",
      event: "followup_cadence_complete",
      message: `Follow-up cadence complete for thread ${f.thread_id} (stage ${f.stage}, ${f.step} nudges). Needs a human decision.`,
      ref: f.thread_id,
    }).catch(() => {});
    return;
  }
  const deltaDays = cad.days[f.step] - cad.days[f.step - 1];
  const { error } = await db().from("ig_followups").insert({
    thread_id: f.thread_id,
    stage: f.stage,
    step: f.step + 1,
    status: "scheduled",
    next_action_at: new Date(Date.now() + Math.max(1, deltaDays) * 86_400_000).toISOString(),
  });
  if (error && error.code !== "23505") console.error("[ig-followup-tick] scheduleNext failed", errStr(error));
}

async function cancel(f: any, reason: string) {
  await db().from("ig_followups").update({
    status: "cancelled",
    claimed_at: null,
    meta: { ...(f.meta ?? {}), cancelled_reason: reason },
    updated_at: new Date().toISOString(),
  }).eq("id", f.id);
}

async function defer(f: any, ms: number) {
  await db().from("ig_followups").update({
    status: "scheduled",
    claimed_at: null,
    next_action_at: new Date(Date.now() + ms).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", f.id).eq("status", "sending");
}

async function backoff(f: any, error: string) {
  const attempts = (f.attempts ?? 0) + 1;
  await db().from("ig_followups").update({
    status: "scheduled",
    claimed_at: null,
    last_error: error.slice(0, 500),
    next_action_at: new Date(Date.now() + attempts * 2 * 3600_000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", f.id).eq("status", "sending");
}

async function escalate(f: any, t: any, error: string) {
  const sb = db();
  await sb.from("ig_followups").update({
    status: "escalated",
    claimed_at: null,
    last_error: error.slice(0, 500),
    updated_at: new Date().toISOString(),
  }).eq("id", f.id);
  await sb.from("ig_threads").update({
    status: "human",
    escalation_reason: `Follow-up send failed ${MAX_SEND_ATTEMPTS}x: ${error}`.slice(0, 500),
    updated_at: new Date().toISOString(),
  }).eq("id", t.id);
  await logConnector({
    connector: "instagram",
    level: "error",
    event: "followup_escalated",
    message: `Follow-up for @${t.handle ?? t.ig_user_id} escalated to human after repeated send failures: ${error}`.slice(0, 300),
    ref: f.thread_id,
    throttleMinutes: 10,
  }).catch(() => {});
}

async function callIgSend(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ig-send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (data?.ok === true) return { ok: true };
    return { ok: false, error: data?.error ?? `ig-send HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: errStr(e) };
  }
}

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
