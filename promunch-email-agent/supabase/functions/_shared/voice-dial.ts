// Ledger-first dial: insert the voice_calls row (status 'dialing'), then ask
// voice-call-start to place it. The CALLER must already hold the claim
// (journey run active->completed, or shopify_orders.voice_attempts CAS).
import { db } from "./supabase.ts";
import type { VoicePurpose } from "./sarvam.ts";

export function voiceAllowlisted(waId: string): boolean {
  const allow = (Deno.env.get("VOICE_TEST_WA_IDS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return allow.length === 0 || allow.includes(waId);
}

export async function placeVoiceCall(row: {
  purpose: VoicePurpose;
  wa_id: string;
  order_ref: string | null;
  run_id?: string | null;
  shopify_id?: number | null;
  attempt_no?: number;
}): Promise<{ ok: true; callId: string } | { ok: false; stage: "insert" | "start"; error: string; callId?: string }> {
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

  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/voice-call-start`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ call_id: call.id }),
  }).catch(() => null);

  const res = (r ? (await r.json().catch(() => ({ ok: false }))) : { ok: false, error: "fetch failed" }) as {
    ok?: boolean;
    error?: string;
  };
  if (res.ok) return { ok: true, callId: call.id };

  // voice-call-start marks the row start_failed itself when Sarvam refuses;
  // a fetch failure leaves it 'dialing' with no attempt_id, so close it here.
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
