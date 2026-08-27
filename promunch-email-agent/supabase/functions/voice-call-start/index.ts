// Internal: place ONE Sarvam outbound call for an already-claimed voice_calls
// row. The tick owns the claim (journey run active->completed + voice_calls
// insert); this function only talks to Sarvam and records the attempt id.
// Never called for a row that is not 'dialing' with attempt_id null.

import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { startOutboundCall } from "../_shared/sarvam.ts";
import { logConnector } from "../_shared/connector-log.ts";
import { getFlowSettings } from "../_shared/flow-settings.ts";

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  if (req.method !== "POST") return j({ error: "POST only" }, 405);
  const body = await req.json().catch(() => null) as { call_id?: string } | null;
  if (!body?.call_id) return j({ error: "call_id required" }, 400);
  const sb = db();

  const { data: call } = await sb.from("voice_calls")
    .select("id, run_id, wa_id, order_ref, status, attempt_id, webhook_token, agent_vars")
    .eq("id", body.call_id).maybeSingle();
  if (!call) return j({ ok: false, error: "call not found" }, 404);
  if (call.status !== "dialing" || call.attempt_id) return j({ ok: false, error: "call already started" }, 409);

  const { data: run } = await sb.from("wa_journey_runs").select("context").eq("id", call.run_id).maybeSingle();
  const ctx = (run?.context ?? {}) as Record<string, unknown>;
  const vars = (ctx.vars ?? {}) as Record<string, string>;
  const items = Array.isArray(ctx.items) ? ctx.items as Array<{ title: string; qty: number }> : [];
  const language = (await getFlowSettings()).voice_language || "Hindi";

  // Names MUST match the variables declared on the Sarvam agent (Build -> Variables).
  // Sending a variable the agent does not declare is a HARD FAILURE, not a silent
  // drop: Sarvam answers 422 "Agent variables {...} not found in agent variables
  // of app <id>" and never dials (verified against the live agent, Aug 27 2026).
  // So adding a key here without adding it in the dashboard takes the whole voice
  // leg down, and the reverse (agent declares more than we send) is harmless.
  // Current agent contract (Aug 27, 2026):
  //   inputs  customer_name, cart_items, cart_value, discount_code, gender, call_id
  //   outputs call_disposition (our outcome enum), call_summary
  //
  // call_id is the ONE variable the agent must declare beyond its own content
  // set: the mid-call send_whatsapp_link tool passes it back to
  // voice-tool-wa-link, which is how that endpoint identifies the live call and
  // enforces one-link-per-call.
  //
  // We deliberately do NOT send checkout_url or phone. voice-tool-wa-link reads
  // both off the voice_calls row it just looked up (the link from the journey
  // context, the number from wa_id), so passing them through the agent would add
  // two required dashboard variables, two more things to keep in sync, and a
  // second copy of the customer's number in a third-party transcript. The agent
  // never needs to say the URL out loud either: a link read over the phone is
  // useless, which is what the WhatsApp tool exists for.
  const agentVariables: Record<string, string> = {
    customer_name: vars["1"] || "there",
    cart_items: items.length ? items.map((i) => `${i.qty}x ${i.title}`).join(", ") : "your PROMUNCH snacks",
    // Zero is a real total, so test for a finite number rather than truthiness.
    cart_value: Number.isFinite(Number(ctx.total)) ? `Rs ${Number(ctx.total).toFixed(0)}` : "",
    discount_code: String(ctx.coupon ?? ""),
    call_id: call.id,
    // Declared by the agent; we hold no gender data and never guess one.
    gender: "",
  };

  const res = await startOutboundCall({
    phoneE164: `+${call.wa_id}`,
    agentVariables,
    language,
    webhookUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/voice-webhook`,
    metadata: { call_id: call.id, run_id: String(call.run_id ?? ""), wa_id: call.wa_id, token: call.webhook_token },
  });

  if (!res.ok) {
    await sb.from("voice_calls").update({ status: "start_failed", failure_reason: res.error, agent_vars: agentVariables, updated_at: new Date().toISOString() })
      .eq("id", call.id);
    await logConnector({ connector: "shopify_wa", level: "error", event: "voice_start_failed", message: `Cart ${call.order_ref}: ${res.error}`, ref: call.order_ref ?? call.id }).catch(() => {});
    return j({ ok: false, error: res.error }, 502);
  }
  await sb.from("voice_calls").update({ attempt_id: res.attemptId, agent_vars: agentVariables, updated_at: new Date().toISOString() }).eq("id", call.id);
  await logConnector({ connector: "shopify_wa", level: "info", event: "voice_call_placed", message: `Cart ${call.order_ref}: Sarvam attempt ${res.attemptId} to ${call.wa_id}.`, ref: call.order_ref ?? call.id }).catch(() => {});
  return j({ ok: true, attempt_id: res.attemptId });
});

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
