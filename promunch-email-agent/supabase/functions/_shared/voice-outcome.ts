// What a finished voice call MEANS for the rest of the system. One place,
// used by both voice-webhook (Sarvam push) and voice-tick's reconcile pass
// (Sarvam analytics poll), so the two can never disagree.
// Design: docs/plans/2026-10-01-voice-agent-cart-cod-design.md §3.7

import { db } from "./supabase.ts";
import { addToDndList, type VoicePurpose } from "./sarvam.ts";
import { escalateNeedsCall } from "./cod-gate.ts";
import { getFlowSettings } from "./flow-settings.ts";
import { logConnector } from "./connector-log.ts";

export const REACHED_MIN_SECONDS = 20;

export const VOICE_OUTCOMES = [
  // cart agent
  "will_buy", "asked_link", "not_interested", "callback_later",
  // cod agent
  "confirmed", "cancel_requested", "unclear",
  // both
  "do_not_call", "unknown",
] as const;
const OUTCOME_SET = new Set<string>(VOICE_OUTCOMES);

export function clampOutcome(v: unknown): string {
  const s = String(v ?? "unknown").toLowerCase().trim();
  return OUTCOME_SET.has(s) ? s : "unknown";
}

export type CallStatus = "connected" | "no_answer" | "busy" | "failed";

export interface OutcomeInput {
  purpose: VoicePurpose;
  status: CallStatus;
  durationS: number | null;
  outcome: string;
  linkSent: boolean;
  toolAction: string | null;
  attemptNo: number;
  maxAttempts: number;
}

export interface OutcomeEffects {
  reached: boolean;
  setDnd: boolean;
  cancelCartRuns: boolean;
  /** Non-null = park the COD order for ops with this reason. */
  codEscalate: string | null;
}

export function decideOutcomeEffects(i: OutcomeInput): OutcomeEffects {
  const reached = i.status === "connected" && (i.linkSent || (i.durationS ?? 0) >= REACHED_MIN_SECONDS);
  const setDnd = i.outcome === "do_not_call";
  if (i.purpose === "cart") return { reached, setDnd, cancelCartRuns: reached, codEscalate: null };
  let codEscalate: string | null = null;
  if (!i.toolAction) {
    if (reached) codEscalate = `Spoke to the customer on the COD call, no decision (${i.outcome}). Call to confirm.`;
    else if (i.attemptNo >= i.maxAttempts) {
      codEscalate = `COD voice call not answered after ${i.attemptNo} attempt(s) (${i.status}). Call to confirm.`;
    }
  }
  return { reached, setDnd, cancelCartRuns: false, codEscalate };
}

export interface CallResult {
  status: CallStatus;
  durationS: number | null;
  outcome: string;
  interactionId: string | null;
  failureReason: string | null;
  transcript: unknown;
  agentVars: Record<string, unknown> | null;
}

type Row = {
  id: string; run_id: string | null; wa_id: string; order_ref: string | null; status: string;
  purpose: VoicePurpose; attempt_no: number; tool_action: string | null; link_sent_at: string | null;
  shopify_id: number | null;
};

export async function finaliseVoiceCall(callId: string, r: CallResult): Promise<"finalised" | "dup" | "retry"> {
  const sb = db();
  const { data } = await sb.from("voice_calls")
    .select("id, run_id, wa_id, order_ref, status, purpose, attempt_no, tool_action, link_sent_at, shopify_id")
    .eq("id", callId).maybeSingle();
  const call = data as Row | null;
  if (!call || (call.status !== "dialing" && call.status !== "unknown")) return "dup";
  const now = new Date().toISOString();

  // do_not_call FIRST: if this write fails the row must stay retryable, or the
  // customer's request is lost for good (see api/whatsapp/voice-calls/sync).
  if (r.outcome === "do_not_call") {
    const { error } = await sb.from("wa_contacts").update({ voice_dnd: true, updated_at: now }).eq("wa_id", call.wa_id);
    if (error) {
      await logConnector({ connector: "shopify_wa", level: "error", event: "voice_dnd_write_failed", message: `${call.wa_id}: ${error.message}. Call ${call.id} left open for retry.`, ref: call.id }).catch(() => {});
      return "retry";
    }
  }

  const { data: won } = await sb.from("voice_calls").update({
    status: r.status, outcome: r.outcome, duration_s: r.durationS, failure_reason: r.failureReason,
    interaction_id: r.interactionId, transcript: r.transcript ?? null, agent_vars: r.agentVars, updated_at: now,
  }).eq("id", call.id).in("status", ["dialing", "unknown"]).select("id");
  if (!won?.length) return "dup";

  const flows = await getFlowSettings();
  const eff = decideOutcomeEffects({
    purpose: call.purpose, status: r.status, durationS: r.durationS, outcome: r.outcome,
    linkSent: !!call.link_sent_at, toolAction: call.tool_action, attemptNo: call.attempt_no,
    maxAttempts: flows.cod_voice_max_attempts,
  });

  if (eff.setDnd && !(await addToDndList(`+${call.wa_id}`).catch(() => false))) {
    await logConnector({ connector: "shopify_wa", level: "warn", event: "voice_dnd_push_failed", message: `${call.wa_id}: voice_dnd set locally but Sarvam DND push failed. Add it in indus.sarvam.ai.`, ref: call.id }).catch(() => {});
  }

  if (call.purpose === "cart" && call.run_id) {
    if (eff.reached) {
      await sb.from("wa_journey_runs").update({ delivered_at: now, last_error: "voice: reached on call" })
        .eq("id", call.run_id).is("delivered_at", null).then(() => {}, () => {});
    } else {
      await sb.from("wa_journey_runs").update({ status: "expired", last_error: `voice: ${r.status}` })
        .eq("id", call.run_id).eq("status", "completed").then(() => {}, () => {});
    }
    if (eff.cancelCartRuns) {
      // The customer heard us (and usually has the link). The WhatsApp nudges
      // would now be a second and third message about the same cart.
      await sb.from("wa_journey_runs").update({ status: "cancelled", last_error: "voice: customer reached on call" })
        .eq("wa_id", call.wa_id).eq("journey_key", "abandoned_checkout").eq("status", "active")
        .then(() => {}, () => {});
    }
  }
  if (call.purpose === "cod_confirm" && eff.codEscalate && call.shopify_id) {
    await escalateNeedsCall(call.shopify_id, `Order ${call.order_ref}: ${eff.codEscalate}`);
  }

  await logConnector({
    connector: "shopify_wa", level: "info", event: "voice_call_result",
    message: `${call.purpose} ${call.order_ref}: ${r.status}${r.durationS ? ` ${r.durationS}s` : ""}, outcome ${r.outcome}${eff.reached ? ", reached" : ""}.`,
    ref: call.order_ref ?? call.id,
  }).catch(() => {});
  return "finalised";
}
