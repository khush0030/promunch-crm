// Server-only helper for the brief send route: interpret the answer from the
// shared invokeInfluencerSend() (db.ts) as sent / engine_off / failed.

import { invokeInfluencerSend } from "./db";

export type InfluencerSendResult =
  | { whatsapp: "sent"; data: Record<string, unknown> }
  | { whatsapp: "already_sent"; data: Record<string, unknown> }
  | { whatsapp: "engine_off"; data: Record<string, unknown> }
  | { whatsapp: "failed"; error: string; data: Record<string, unknown> };

/** True when influencer-send reports the engine switch is off (accepts a few shapes). */
export function isEngineOff(data: Record<string, unknown>): boolean {
  if (data.engine_off === true) return true;
  return ["status", "reason", "skipped", "error", "result"].some((k) => data[k] === "engine_off");
}

/** influencer-send owns the claim + idempotency; this never calls Meta. */
export async function sendBriefReady(dealId: string): Promise<InfluencerSendResult> {
  const r = await invokeInfluencerSend({ deal_id: dealId, kind: "brief_ready" });
  if (isEngineOff(r.data)) return { whatsapp: "engine_off", data: r.data };
  if (!r.ok) return { whatsapp: "failed", error: String(r.data.error ?? `influencer-send answered ${r.status}`), data: r.data };
  return { whatsapp: "sent", data: r.data };
}

/**
 * "Send WhatsApp again" after a failed brief ping. retry:true lets
 * influencer-send re-arm a failed row; its claim + wa_messages ledger check
 * still run first, so a brief that already landed answers already_sent and is
 * never delivered twice.
 */
export async function resendBriefReady(dealId: string): Promise<InfluencerSendResult> {
  const r = await invokeInfluencerSend({ deal_id: dealId, kind: "brief_ready", retry: true });
  if (isEngineOff(r.data)) return { whatsapp: "engine_off", data: r.data };
  if (!r.ok) return { whatsapp: "failed", error: String(r.data.error ?? r.data.reason ?? `influencer-send answered ${r.status}`), data: r.data };
  if (r.data.already_sent === true) return { whatsapp: "already_sent", data: r.data };
  return { whatsapp: "sent", data: r.data };
}
