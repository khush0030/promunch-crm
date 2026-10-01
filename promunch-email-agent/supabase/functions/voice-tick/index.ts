// Cron (pg_cron, every minute): the ONLY place voice calls are dialled.
//   1. cart:      wa_journey_runs voice rows due now (enrolled by shopify-wa at +15 min)
//   2. cod:       pending COD orders past reminder + cod_voice_delay_hours
//   3. reconcile: calls stuck on 'dialing' -> Sarvam analytics -> finaliseVoiceCall
// Design: docs/plans/2026-10-01-voice-agent-cart-cod-design.md
import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { getFlowSettings, type FlowSettings } from "../_shared/flow-settings.ts";
import { cartVoiceEligibility, codCallDueBefore, codVoiceEligibility, inCallWindow } from "../_shared/voice-eligibility.ts";
import { placeVoiceCall, voiceAllowList, voiceAllowlisted } from "../_shared/voice-dial.ts";
import { fetchTranscript, listAttempts, type VoicePurpose } from "../_shared/sarvam.ts";
import { clampOutcome, finaliseVoiceCall } from "../_shared/voice-outcome.ts";
import { escalateNeedsCall } from "../_shared/cod-gate.ts";
import { errStr, logConnector } from "../_shared/connector-log.ts";

const BATCH = 20;

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  const flows = await getFlowSettings();
  const nowMs = Date.now();
  const safe = async <T>(name: string, f: () => Promise<T>) => {
    try { return await f(); } catch (e) {
      await logConnector({ connector: "shopify_wa", level: "error", event: "voice_tick_error", message: `voice-tick ${name}: ${errStr(e)}`, throttleMinutes: 15 }).catch(() => {});
      return { error: errStr(e) };
    }
  };
  const cart = await safe("cart", () => cartPass(flows, nowMs));
  const cod = await safe("cod", () => codPass(flows, nowMs));
  const reconcile = await safe("reconcile", () => reconcilePass(nowMs));
  return j({ ok: true, cart, cod, reconcile });
});

async function cartPass(flows: FlowSettings, nowMs: number) {
  const sb = db();
  const nowIso = new Date(nowMs).toISOString();
  const { data: due, error: dueErr } = await sb.from("wa_journey_runs")
    .select("id, wa_id, order_ref, created_at, context")
    .eq("status", "active").eq("journey_key", "abandoned_checkout").eq("context->>channel", "voice")
    .lte("next_action_at", nowIso).order("next_action_at").limit(BATCH);
  if (dueErr) throw new Error(`cart due query: ${dueErr.message}`);
  let called = 0, cancelled = 0, deferred = 0, failed = 0;
  for (const run of due ?? []) {
    const ctx = (run.context ?? {}) as Record<string, unknown>;
    const [{ data: contact }, { data: th }, { data: calls }] = await Promise.all([
      sb.from("wa_contacts").select("opted_in, voice_dnd").eq("wa_id", run.wa_id).maybeSingle(),
      sb.from("wa_threads").select("last_inbound_at, ticket_status").eq("wa_id", run.wa_id).maybeSingle(),
      sb.from("voice_calls").select("order_ref, created_at, status, attempt_id").eq("wa_id", run.wa_id).eq("purpose", "cart"),
    ]);
    const cartCalls = (calls ?? []).filter((c) => c.order_ref === run.order_ref);
    const verdict = cartVoiceEligibility({
      enabled: flows.voice_call_enabled && flows.abandoned_cart_enabled,
      inWindow: inCallWindow(Date.now(), flows.voice_call_start_hour, flows.voice_call_end_hour),
      cartTotal: Number(ctx.total ?? 0),
      minCartValue: flows.voice_min_cart_value,
      voiceDnd: contact?.voice_dnd === true,
      optedIn: contact?.opted_in !== false,
      inboundSinceEnrol: !!th?.last_inbound_at && Date.parse(th.last_inbound_at) > Date.parse(run.created_at),
      openTicket: th?.ticket_status === "open" || th?.ticket_status === "pending",
      allowlisted: voiceAllowlisted(run.wa_id),
      // A REAL dial = Sarvam accepted it (has attempt_id). start_failed never rang.
      cartDialled: cartCalls.some((c) => !!c.attempt_id && c.status !== "start_failed"),
      cartInFlight: cartCalls.some((c) => c.status === "dialing"),
      connectedWithin7d: (calls ?? []).some((c) => c.status === "connected" && Date.parse(c.created_at) >= Date.now() - 7 * 86400_000),
    });
    if (verdict.action === "cancel") {
      await sb.from("wa_journey_runs").update({ status: "cancelled", last_error: `voice: ${verdict.reason}` }).eq("id", run.id).eq("status", "active");
      cancelled++; continue;
    }
    if (verdict.action === "defer") {
      await sb.from("wa_journey_runs").update({ next_action_at: new Date(Date.now() + verdict.minutes * 60_000).toISOString(), last_error: `voice: ${verdict.reason}` }).eq("id", run.id).eq("status", "active");
      deferred++; continue;
    }
    // ATOMIC CLAIM: active -> completed. Crash after this loses the call, never doubles it.
    const { data: claimed } = await sb.from("wa_journey_runs").update({ status: "completed", last_error: null })
      .eq("id", run.id).eq("status", "active").select("id");
    if (!claimed?.length) continue;
    const res = await placeVoiceCall({ purpose: "cart", wa_id: run.wa_id, order_ref: run.order_ref, run_id: run.id });
    if (res.ok) { called++; continue; }
    if (res.stage === "unknown") {
      // voice-call-start's response was lost: Sarvam may have dialled. Treat as
      // placed (never risk a second call); reconcile settles the row.
      failed++; continue;
    }
    // No retry for a 15-minute call: by the next attempt it is no longer "15
    // minutes after". The WhatsApp + email sequence carries the cart.
    await sb.from("wa_journey_runs").update({ status: "failed", last_error: `voice: ${res.stage} failed: ${res.error}` }).eq("id", run.id);
    await logConnector({ connector: "shopify_wa", level: "warn", event: "voice_start_failed", message: `Cart ${run.order_ref}: ${res.error}`, ref: run.order_ref ?? run.id, throttleMinutes: 30 }).catch(() => {});
    failed++;
  }
  return { due: due?.length ?? 0, called, cancelled, deferred, failed };
}

async function codPass(flows: FlowSettings, nowMs: number) {
  if (!flows.cod_gate_enabled || !flows.cod_voice_enabled) return { skipped: "flag off" };
  if (!inCallWindow(nowMs, flows.voice_call_start_hour, flows.voice_call_end_hour)) return { skipped: "outside call window" };
  const sb = db();
  const spacingCutoffIso = new Date(nowMs - flows.cod_voice_retry_hours * 3600_000).toISOString();
  const needsCallCutoffIso = new Date(nowMs - flows.cod_needs_call_hours * 3600_000).toISOString();
  let q = sb.from("shopify_orders")
    .select("shopify_id, order_number, customer_phone, confirmation_status, voice_attempts, voice_last_dial_at")
    .eq("confirmation_status", "pending")
    .lt("confirmation_sent_at", codCallDueBefore(nowMs, flows.cod_reminder_delay_hours, flows.cod_voice_delay_hours))
    // Past the needs-call sweep window the order is ops' job: never call days late.
    .gt("confirmation_sent_at", needsCallCutoffIso)
    .lt("voice_attempts", flows.cod_voice_max_attempts)
    .or(`voice_last_dial_at.is.null,voice_last_dial_at.lt.${spacingCutoffIso}`);
  // Test allowlist: filter in SQL so skipped rows cannot starve the batch.
  const allowList = voiceAllowList();
  if (allowList.length) q = q.in("customer_phone", allowList);
  const { data: due, error: dueErr } = await q.order("confirmation_sent_at").limit(BATCH);
  if (dueErr) throw new Error(`cod due query: ${dueErr.message}`);
  let called = 0, skipped = 0, failed = 0;
  for (const o of due ?? []) {
    // Re-check per item so a long run cannot dial after the window closes.
    if (!inCallWindow(Date.now(), flows.voice_call_start_hour, flows.voice_call_end_hour)) break;
    const waId = String(o.customer_phone ?? "").replace(/\D/g, "");
    if (!waId) { skipped++; continue; }
    const [{ data: contact }, { data: last }] = await Promise.all([
      sb.from("wa_contacts").select("voice_dnd").eq("wa_id", waId).maybeSingle(),
      sb.from("voice_calls").select("status, created_at").eq("purpose", "cod_confirm").eq("shopify_id", o.shopify_id)
        .neq("status", "start_failed").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const attempts = Number(o.voice_attempts ?? 0);
    const verdict = codVoiceEligibility({
      enabled: true, inWindow: true, status: o.confirmation_status, voiceDnd: contact?.voice_dnd === true,
      allowlisted: voiceAllowlisted(waId), attempts, maxAttempts: flows.cod_voice_max_attempts,
      lastCallStatus: last?.status ?? null, lastCallAtMs: last ? Date.parse(last.created_at) : null,
      nowMs, retryHours: flows.cod_voice_retry_hours,
    });
    if (verdict.action === "skip") { skipped++; continue; }
    // ATOMIC CLAIM on the order row: only one tick can move n -> n+1, only while
    // pending, and only if the retry spacing has elapsed (checked inside the CAS).
    const nowIso = new Date().toISOString();
    const { data: won } = await sb.from("shopify_orders").update({ voice_attempts: attempts + 1, voice_last_dial_at: nowIso })
      .eq("shopify_id", o.shopify_id).eq("voice_attempts", attempts).eq("confirmation_status", "pending")
      .or(`voice_last_dial_at.is.null,voice_last_dial_at.lt.${spacingCutoffIso}`).select("shopify_id");
    if (!won?.length) continue;
    const res = await placeVoiceCall({
      purpose: "cod_confirm", wa_id: waId, order_ref: String(o.order_number).replace(/^#/, ""),
      shopify_id: o.shopify_id, attempt_no: attempts + 1,
    });
    if (res.ok) { called++; continue; }
    failed++;
    // Lost response: Sarvam may have dialled, so the attempt stays consumed.
    if (res.stage === "unknown") continue;
    // The phone never rang: hand the attempt back (CAS), bounded by 3 start failures.
    await sb.from("shopify_orders").update({ voice_attempts: attempts, voice_last_dial_at: o.voice_last_dial_at })
      .eq("shopify_id", o.shopify_id).eq("voice_attempts", attempts + 1).eq("voice_last_dial_at", nowIso);
    const { count } = await sb.from("voice_calls").select("id", { count: "exact", head: true })
      .eq("purpose", "cod_confirm").eq("shopify_id", o.shopify_id).eq("status", "start_failed");
    if ((count ?? 0) >= 3) {
      await escalateNeedsCall(o.shopify_id, `Order ${o.order_number}: COD voice call could not be started 3 times (${res.error}). Call to confirm.`);
    }
  }
  return { due: due?.length ?? 0, called, skipped, failed };
}

async function reconcilePass(nowMs: number) {
  const sb = db();
  // No attempt_id after 30 min: Sarvam may or may not have dialled (the attempt_id
  // write can be lost), so this is 'unknown', never start_failed (which would
  // free the COD retry spacing). Refused starts are already start_failed.
  await sb.from("voice_calls").update({ status: "unknown", failure_reason: "start outcome unknown (no attempt id recorded)", updated_at: new Date(nowMs).toISOString() })
    .eq("status", "dialing").is("attempt_id", null).lt("created_at", new Date(nowMs - 30 * 60_000).toISOString());
  // Still unresolved after 2h: unknown (counts as not reached; a late webhook can still land).
  await sb.from("voice_calls").update({ status: "unknown", updated_at: new Date(nowMs).toISOString() })
    .eq("status", "dialing").lt("created_at", new Date(nowMs - 2 * 3600_000).toISOString());
  const { data: stuck, error: stuckErr } = await sb.from("voice_calls").select("id, purpose, attempt_id, created_at")
    .eq("status", "dialing").not("attempt_id", "is", null)
    .lt("created_at", new Date(nowMs - 3 * 60_000).toISOString())
    .gt("created_at", new Date(nowMs - 48 * 3600_000).toISOString())
    .order("created_at").limit(50);
  if (stuckErr) throw new Error(`reconcile stuck query: ${stuckErr.message}`);
  if (!stuck?.length) return { stuck: 0 };
  let finalised = 0;
  for (const purpose of ["cart", "cod_confirm"] as VoicePurpose[]) {
    const rows = stuck.filter((r) => r.purpose === purpose);
    if (!rows.length) continue;
    const since = new Date(Math.min(...rows.map((r) => Date.parse(r.created_at))) - 5 * 60_000).toISOString();
    const attempts = await listAttempts(purpose, since, new Date(nowMs).toISOString(), 200);
    const byId = new Map(attempts.map((a) => [a.attemptId, a]));
    for (const row of rows) {
      const a = byId.get(String(row.attempt_id));
      if (!a || a.status === "unknown") continue; // still ringing / not in analytics yet
      const transcript = a.interactionId ? await fetchTranscript(purpose, a.interactionId) : [];
      const r = await finaliseVoiceCall(row.id, {
        status: a.status, durationS: a.durationSeconds != null ? Math.round(a.durationSeconds) : null,
        outcome: clampOutcome(a.agentVariables?.call_disposition), interactionId: a.interactionId,
        failureReason: a.failureReason, transcript: transcript.length ? transcript : null, agentVars: a.agentVariables,
      });
      if (r === "finalised") finalised++;
    }
  }
  return { stuck: stuck.length, finalised };
}

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
