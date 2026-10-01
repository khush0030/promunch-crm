// HTTPS tool target for the Sarvam COD agent ("cod_confirm").
// Body: { call_id, action: "confirm" | "cancel_request" }.
// The agent NEVER cancels an order: cancel_request parks it for ops.
// One action per call (voice_calls.tool_action set once by CAS). Replies are
// spoken by the agent, so: short, plain, no em dashes.
import { db } from "../_shared/supabase.ts";
import { checkVoiceToolAuth } from "../_shared/voice-tool-auth.ts";
import { confirmGate, requestCancelFromVoice } from "../_shared/cod-gate.ts";

// Gate statuses are internal ("needs_call"); the customer hears plain words.
function spoken(status: unknown): string {
  if (status === "confirmed") return "confirmed";
  if (status === "cancelled") return "cancelled";
  if (status === "needs_call") return "with our team";
  return "being processed";
}

Deno.serve(async (req) => {
  const denied = await checkVoiceToolAuth(req, "voice-tool-cod");
  if (denied) return denied;
  if (req.method !== "POST") return j({ ok: false, message: "POST only" }, 405);
  const body = await req.json().catch(() => null) as { call_id?: string; action?: string } | null;
  const action = body?.action === "confirm" || body?.action === "cancel_request" ? body.action : null;
  if (!body?.call_id || !action) return j({ ok: false, message: "Sorry, I could not update the order." }, 400);
  const sb = db();
  const { data: call } = await sb.from("voice_calls")
    .select("id, status, purpose, shopify_id, tool_action").eq("id", body.call_id).maybeSingle();
  if (!call || call.status !== "dialing" || call.purpose !== "cod_confirm" || !call.shopify_id) {
    return j({ ok: false, message: "Sorry, I could not update the order." }, 400);
  }
  const { data: won } = await sb.from("voice_calls").update({ tool_action: action, updated_at: new Date().toISOString() })
    .eq("id", call.id).is("tool_action", null).select("id");
  if (!won?.length) return j({ ok: true, message: "That is already noted for this order." });

  if (action === "confirm") {
    const r = await confirmGate(call.shopify_id, "voice");
    return j({ ok: true, message: r.outcome === "confirmed"
      ? "Done, your order is confirmed and will be packed soon."
      : `Your order is already ${spoken(r.already)}.` });
  }
  const r = await requestCancelFromVoice(call.shopify_id);
  return j({ ok: r.ok, message: r.outcome === "already"
    ? `Your order is already ${spoken(r.already)}.`
    : "Noted. Our team will cancel it and confirm with you on WhatsApp shortly." });
});

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
