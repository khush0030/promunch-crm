// HTTPS tool target for the Sarvam agent ("send_whatsapp_link"). Configured in
// indus.sarvam.ai with bearer auth = INTERNAL_FN_SECRET, so requireInternal
// gates it exactly like wa-send. One link per call, ever (claimSend), and the
// call must still be live so a stale/replayed tool call cannot message anyone.

import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { claimSend, markSendSent, releaseSend } from "../_shared/confirmations.ts";
import { sessionOpen } from "../_shared/window-asks.ts";

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  if (req.method !== "POST") return j({ ok: false, message: "POST only" }, 405);
  const body = await req.json().catch(() => null) as { call_id?: string; phone?: string } | null;
  if (!body?.call_id) return j({ ok: false, message: "Could not send the link." }, 400);
  const sb = db();

  const { data: call } = await sb.from("voice_calls")
    .select("id, run_id, wa_id, status, link_sent_at, created_at").eq("id", body.call_id).maybeSingle();
  if (!call || call.status !== "dialing") return j({ ok: false, message: "Could not send the link." }, 400);
  const phoneDigits = String(body.phone ?? "").replace(/\D/g, "");
  if (phoneDigits && phoneDigits !== call.wa_id) return j({ ok: false, message: "Could not send the link." }, 400);
  if (call.link_sent_at) return j({ ok: true, message: "The link is already on your WhatsApp." });

  const { data: run } = await sb.from("wa_journey_runs").select("context").eq("id", call.run_id).maybeSingle();
  const vars = ((run?.context as Record<string, unknown> | null)?.vars ?? {}) as Record<string, string>;
  const url = vars["2"];
  const name = vars["1"] || "there";
  if (!url) return j({ ok: false, message: "Could not find the cart link." }, 400);

  const key = `voice_link:${call.id}`;
  if (!(await claimSend(key))) return j({ ok: true, message: "The link is on its way to your WhatsApp." });

  const { data: th } = await sb.from("wa_threads").select("last_inbound_at").eq("wa_id", call.wa_id).maybeSingle();
  const free = sessionOpen(th?.last_inbound_at, Date.now());
  const payload = free
    ? { to: call.wa_id, kind: "text", text: `Hi ${name}, here is your PROMUNCH checkout link from our call:\n${url}\n\nYour cart is saved, just tap to finish. Your Munchy Pal`, sent_by: "voice:cart_link", journey_run_id: call.run_id }
    : { to: call.wa_id, kind: "template", template: { name: "cart_link_requested", language: "en", vars: { "1": name, "2": url } }, sent_by: "voice:cart_link", journey_run_id: call.run_id };

  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const res = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` })) as { ok?: boolean; error?: string };
  if (!res.ok) {
    await releaseSend(key);
    return j({ ok: false, message: "Could not send the link right now. You can also find it in your WhatsApp chat with PROMUNCH." }, 502);
  }
  await markSendSent(key);
  await sb.from("voice_calls").update({ link_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", call.id);
  return j({ ok: true, message: "Done, the checkout link is on your WhatsApp now." });
});

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
