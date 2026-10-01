// Ledger-first dial: insert the voice_calls row (status 'dialing'), then ask
// voice-call-start to place it. The CALLER must already hold the claim
// (journey run active->completed, or shopify_orders.voice_attempts CAS).
//
// stage "unknown" = the start request threw, timed out, or came back non-JSON.
// Sarvam may already have dialled, so the row is left untouched (voice-tick's
// reconcile pass marks rows with no attempt_id 'unknown' after 30 min, never
// start_failed, since Sarvam may have dialled; it settles rows that have one). Callers must treat "unknown" as a CONSUMED
// attempt and never redial. stage "start" = a JSON refusal; nothing was dialled.
import { db } from "./supabase.ts";
import type { VoicePurpose } from "./sarvam.ts";

export function voiceAllowList(): string[] {
  return (Deno.env.get("VOICE_TEST_WA_IDS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function voiceAllowlisted(waId: string): boolean {
  const allow = voiceAllowList();
  return allow.length === 0 || allow.includes(waId);
}

export async function placeVoiceCall(row: {
  purpose: VoicePurpose;
  wa_id: string;
  order_ref: string | null;
  run_id?: string | null;
  shopify_id?: number | null;
  attempt_no?: number;
}): Promise<{ ok: true; callId: string } | { ok: false; stage: "insert" | "start" | "unknown"; error: string; callId?: string }> {
  const token = crypto.randomUUID().replace(/-/g, "");
  const { data: call, error } = await db()
    .from("voice_calls")
    .insert({
      purpose: row.purpose,
      wa_id: row.wa_id,
      order_ref: row.order_ref,
      run_id: row.run_id ?? null,
      shopify_id: row.shopify_id ?? null,
      attempt_no: row.attempt_no ?? 1,
      webhook_token: token,
      status: "dialing",
    })
    .select("id")
    .single();
  if (error || !call) return { ok: false, stage: "insert", error: error?.message ?? "insert failed" };

  let res: { ok?: boolean; error?: string };
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/voice-call-start`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ call_id: call.id }),
      signal: AbortSignal.timeout(25_000),
    });
    res = await r.json();
  } catch (e) {
    return { ok: false, stage: "unknown", error: e instanceof Error ? e.message : String(e), callId: call.id };
  }
  if (res.ok) return { ok: true, callId: call.id };

  // A JSON refusal: voice-call-start marks the row start_failed itself when
  // Sarvam refuses; if it refused earlier it may still be 'dialing', so close it.
  await db()
    .from("voice_calls")
    .update({
      status: "start_failed",
      failure_reason: res.error ?? "start failed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", call.id)
    .eq("status", "dialing")
    .is("attempt_id", null)
    .then(() => {}, () => {});

  return { ok: false, stage: "start", error: res.error ?? "start failed", callId: call.id };
}
