// Public receiver for Sarvam's post-call webhook (verify_jwt=false). Auth is
// verifyVoiceWebhook (per-call token + attempt id). Payload shape:
//   https://docs.sarvam.ai/api-reference/instant-outbound/webhook-payload
// Always returns 200 once verified so Sarvam does not retry a processed call.

import { db } from "../_shared/supabase.ts";
import { errStr, logConnector } from "../_shared/connector-log.ts";
import { verifyVoiceWebhook } from "../_shared/voice-webhook-verify.ts";
import { addToDndList } from "../_shared/sarvam.ts";

interface SarvamWebhook {
  attempt_id?: string;
  status?: "connected" | "no_answer" | "busy" | "failed";
  duration?: number | null;
  interaction_id?: string;
  failure_reason?: string | null;
  final_agent_variables?: Record<string, unknown>;
  interaction_transcript?: Array<{ role: string; en_text: string }>;
  webhook_config?: { url?: string; metadata?: Record<string, string> };
}

const OUTCOMES = new Set(["will_buy", "asked_link", "not_interested", "do_not_call", "callback_later", "unknown"]);

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });
  const p = await req.json().catch(() => null) as SarvamWebhook | null;
  if (!p) return j({ error: "bad json" }, 400);
  try {
  const meta = p.webhook_config?.metadata ?? {};
  const sb = db();

  const { data: row } = await sb.from("voice_calls")
    .select("id, run_id, wa_id, order_ref, status, attempt_id, webhook_token")
    .eq("id", meta.call_id ?? "00000000-0000-0000-0000-000000000000").maybeSingle();
  const v = verifyVoiceWebhook({ attempt_id: p.attempt_id, token: meta.token }, row);
  if (!v.ok) {
    await logConnector({ connector: "shopify_wa", level: "warn", event: "voice_webhook_rejected", message: `voice-webhook rejected: ${v.reason}`, ref: meta.call_id ?? null, throttleMinutes: 10 }).catch(() => {});
    // already_finished is a benign duplicate delivery: acknowledge it.
    return v.reason === "already_finished" ? j({ ok: true, dup: true }) : j({ error: v.reason }, 401);
  }
  const call = row!;
  // Sarvam's status is unauthenticated JSON; voice_calls.status has a CHECK
  // constraint, so an unmapped spelling must never reach the UPDATE (it would
  // throw, strand the row on 'dialing' forever, and 500 on every redelivery).
  const STATUSES = new Set(["connected", "no_answer", "busy", "failed"]);
  const rawStatus = p.status !== undefined ? String(p.status) : null;
  const status = rawStatus && STATUSES.has(rawStatus) ? (rawStatus as "connected" | "no_answer" | "busy" | "failed") : "failed";
  const unmappedStatus = rawStatus && !STATUSES.has(rawStatus) ? rawStatus : null;
  const rawOutcome = String(p.final_agent_variables?.outcome ?? "unknown").toLowerCase();
  const outcome = OUTCOMES.has(rawOutcome) ? rawOutcome : "unknown";
  const now = new Date().toISOString();
  const failureReason = unmappedStatus
    ? `unmapped status '${unmappedStatus}'; ${p.failure_reason ?? ""}`
    : (p.failure_reason ?? null);

  // Idempotent finalise: only the dialing row transitions.
  const { data: finalised } = await sb.from("voice_calls").update({
    status, outcome, duration_s: p.duration ?? null, failure_reason: failureReason,
    interaction_id: p.interaction_id ?? null, transcript: p.interaction_transcript ?? null,
    agent_vars: p.final_agent_variables ?? null, updated_at: now,
  }).eq("id", call.id).eq("status", "dialing").select("id");
  if (!finalised?.length) return j({ ok: true, dup: true });

  if (status === "connected" && call.run_id) {
    // Honest attribution: the customer heard us. If an order follows, the cart
    // counts as recovered (cart-recovery route requires converted && delivered).
    await sb.from("wa_journey_runs").update({ delivered_at: now, last_error: null })
      .eq("id", call.run_id).is("delivered_at", null).then(() => {}, () => {});
  }
  if (outcome === "do_not_call") {
    await sb.from("wa_contacts").update({ voice_dnd: true, updated_at: now }).eq("wa_id", call.wa_id).then(() => {}, () => {});
    // Local voice_dnd is the real dialing gate; the Sarvam-side push is
    // best-effort only, but must never silently vanish on a throw.
    const pushed = await addToDndList(`+${call.wa_id}`).catch(() => false);
    if (!pushed) {
      await logConnector({ connector: "shopify_wa", level: "warn", event: "voice_dnd_push_failed", message: `${call.wa_id}: voice_dnd set locally but Sarvam DND list push failed - add manually in indus.sarvam.ai.`, ref: call.order_ref ?? call.id }).catch(() => {});
    }
  }
  if ((status === "no_answer" || status === "busy") && call.run_id) {
    // ONE retry, 2h later, inside the window (the tick re-checks the window).
    const { data: run } = await sb.from("wa_journey_runs").select("context, deadline_at").eq("id", call.run_id).maybeSingle();
    const ctx = (run?.context ?? {}) as Record<string, unknown>;
    const attempts = Number(ctx.voice_attempts ?? 0);
    if (attempts < 1 && (!run?.deadline_at || run.deadline_at > now)) {
      await sb.from("wa_journey_runs").update({
        status: "active",
        next_action_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
        last_error: `voice ${status}, one retry scheduled`,
        context: { ...ctx, voice_attempts: attempts + 1 },
      }).eq("id", call.run_id).eq("status", "completed").then(() => {}, () => {});
    } else {
      await sb.from("wa_journey_runs").update({ status: "expired", last_error: `voice ${status} twice` })
        .eq("id", call.run_id).eq("status", "completed").then(() => {}, () => {});
    }
  }
  if (status === "failed" && call.run_id) {
    await sb.from("wa_journey_runs").update({ status: "failed", last_error: `voice failed: ${p.failure_reason ?? "unknown"}` })
      .eq("id", call.run_id).eq("status", "completed").then(() => {}, () => {});
    await logConnector({ connector: "shopify_wa", level: "warn", event: "voice_call_failed", message: `Cart ${call.order_ref}: ${p.failure_reason ?? "unknown"}`, ref: call.order_ref ?? call.id }).catch(() => {});
  }
  await logConnector({ connector: "shopify_wa", level: "info", event: "voice_call_result", message: `Cart ${call.order_ref}: ${status}${p.duration ? ` ${p.duration}s` : ""}, outcome ${outcome}.`, ref: call.order_ref ?? call.id }).catch(() => {});
  return j({ ok: true });
  } catch (e) {
    // No future throw in the body above may strand a call silently; always
    // trace it and give Sarvam a definite (retryable) response.
    await logConnector({ connector: "shopify_wa", level: "warn", event: "voice_webhook_error", message: `voice-webhook threw: ${errStr(e)}`, ref: null }).catch(() => {});
    return j({ error: "internal" }, 500);
  }
});

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
