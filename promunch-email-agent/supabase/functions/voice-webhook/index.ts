// Public receiver for Sarvam's post-call webhook (verify_jwt=false). Auth is
// verifyVoiceWebhook (per-call token + attempt id). Payload shape:
//   https://docs.sarvam.ai/api-reference/instant-outbound/webhook-payload
// Always returns 200 once verified so Sarvam does not retry a processed call.

import { db } from "../_shared/supabase.ts";
import { errStr, logConnector } from "../_shared/connector-log.ts";
import { verifyVoiceWebhook } from "../_shared/voice-webhook-verify.ts";
import { clampOutcome, finaliseVoiceCall } from "../_shared/voice-outcome.ts";

interface SarvamWebhook {
  attempt_id?: string;
  status?: "connected" | "no_answer" | "busy" | "failed";
  duration?: number | null;
  interaction_id?: string;
  failure_reason?: string | null;
  final_agent_variables?: Record<string, unknown>;
  interaction_transcript?: Array<{ role: string; en_text: string }>;
  webhook_config?: { url?: string; metadata?: Record<string, string> };
  metadata?: Record<string, string>;
}

interface VoiceCallRow {
  id: string;
  run_id: string | null;
  wa_id: string;
  order_ref: string | null;
  status: string;
  attempt_id: string | null;
  webhook_token: string;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });
  const p = await req.json().catch(() => null) as SarvamWebhook | null;
  if (!p) return j({ error: "bad json" }, 400);
  try {
  // WHERE THE METADATA ACTUALLY IS. The docs show our metadata echoed at
  // webhook_config.metadata, but a live delivery (Aug 27 2026) did not match on
  // that path, so read every place it could plausibly sit rather than trusting
  // one. Providers move this around and a miss here strands the call row on
  // 'dialing' with no outcome, no transcript, and no do_not_call flag.
  const meta = (p.webhook_config?.metadata ?? p.metadata ?? {}) as Record<string, string>;
  const sb = db();

  // attempt_id is our second, independent handle on the row: voice-call-start
  // stores it the moment Sarvam accepts the call, and it is an unguessable
  // server-issued UUID. Matching on it means a delivery that drops our metadata
  // entirely still finalises the right call instead of being rejected.
  const SELECT = "id, run_id, wa_id, order_ref, status, attempt_id, webhook_token";
  let row: VoiceCallRow | null = null;
  if (meta.call_id) {
    const { data } = await sb.from("voice_calls").select(SELECT).eq("id", meta.call_id).maybeSingle();
    row = (data as VoiceCallRow | null) ?? null;
  }
  if (!row && p.attempt_id) {
    const { data } = await sb.from("voice_calls").select(SELECT).eq("attempt_id", p.attempt_id).maybeSingle();
    row = (data as VoiceCallRow | null) ?? null;
  }
  const v = verifyVoiceWebhook({ attempt_id: p.attempt_id, token: meta.token }, row);
  if (!v.ok) {
    // Log the payload's SHAPE (keys only, never values) so a provider that moves
    // or drops our metadata is diagnosable from the dashboard instead of needing
    // another live call to reproduce.
    const shape = `keys=[${Object.keys(p ?? {}).join(",")}] meta=[${Object.keys(meta).join(",")}] attempt=${p.attempt_id ? "yes" : "no"}`;
    await logConnector({ connector: "shopify_wa", level: "warn", event: "voice_webhook_rejected", message: `voice-webhook rejected: ${v.reason} (${shape})`, ref: meta.call_id ?? p.attempt_id ?? null, throttleMinutes: 10 }).catch(() => {});
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
  // The agent's outcome variable is named call_disposition (Sarvam Build ->
  // Variables); `outcome` is accepted as a fallback so renaming the variable on
  // either side degrades to "unknown" rather than throwing. clampOutcome drops
  // values outside the allowed set, and do_not_call flips voice_dnd downstream,
  // so if the clamp starts firing fix the agent's extraction prompt, not this line.
  const outcome = clampOutcome(p.final_agent_variables?.call_disposition ?? p.final_agent_variables?.outcome);
  const failureReason = unmappedStatus
    ? `unmapped status '${unmappedStatus}'; ${p.failure_reason ?? ""}`
    : (p.failure_reason ?? null);

  const res = await finaliseVoiceCall(call.id, {
    status, durationS: p.duration ?? null, outcome, interactionId: p.interaction_id ?? null,
    failureReason, transcript: p.interaction_transcript ?? null, agentVars: p.final_agent_variables ?? null,
  });
  if (res === "retry") return j({ error: "retry" }, 500);
  return j({ ok: true, dup: res === "dup" });
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
