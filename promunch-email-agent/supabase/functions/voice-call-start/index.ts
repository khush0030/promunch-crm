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

  const agentVariables: Record<string, string> = {
    customer_name: vars["1"] || "there",
    cart_items: items.length ? items.map((i) => `${i.qty}x ${i.title}`).join(", ") : "your PROMUNCH snacks",
    cart_total: ctx.total ? `Rs ${Number(ctx.total).toFixed(0)}` : "",
    coupon_code: String(ctx.coupon ?? ""),
    checkout_url: vars["2"] ?? "",
    call_id: call.id,
    phone: `+${call.wa_id}`,
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
