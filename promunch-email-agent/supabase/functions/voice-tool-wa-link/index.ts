// HTTPS tool target for the Sarvam agent ("send_whatsapp_link").
//
// AUTH: a DEDICATED secret, VOICE_TOOL_SECRET, not requireInternal. Two reasons.
// (1) The caller is a third party (Sarvam's tool runner), not one of our own
// functions, so it must never hold a credential that opens the rest of the
// internal surface. (2) requireInternal's shared secret is the platform-injected
// SUPABASE_SERVICE_ROLE_KEY, whose value has drifted from every key the dashboard
// or CLI reports here — so it cannot be pasted into Sarvam's tool config at all,
// and setting INTERNAL_FN_SECRET to work around that would 401 every legitimate
// function-to-function call (wa-journey-tick -> wa-send and friends) at once.
//
// Fails closed: no secret configured means reject everything. The rest of the
// guarantees are unchanged - one link per call ever (claimSend), and the call
// must still be live so a stale or replayed tool call cannot message anyone.

import { db } from "../_shared/supabase.ts";
import { claimSend, markSendSent, releaseSend } from "../_shared/confirmations.ts";
import { sessionOpen } from "../_shared/window-asks.ts";
import { logConnector } from "../_shared/connector-log.ts";

// Constant-time compare so the secret cannot be recovered one byte at a time.
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a), bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("VOICE_TOOL_SECRET") ?? "";
  const got = req.headers.get("Authorization") ?? "";
  if (!secret || !timingSafeEqual(got, `Bearer ${secret}`)) {
    // Log the REJECTION (never the credential). Without this, "Sarvam never
    // called the tool" and "Sarvam called it with the wrong bearer" look
    // identical from our side - which cost a live test call to work out once.
    // Shape only: whether a header arrived and what scheme it used.
    const scheme = got ? got.split(" ")[0] : "none";
    await logConnector({
      connector: "shopify_wa",
      level: "warn",
      event: "voice_tool_unauthorized",
      message: `voice-tool-wa-link rejected a call: ${!secret ? "VOICE_TOOL_SECRET is not set" : `bad bearer (auth scheme: ${scheme})`}.`,
      throttleMinutes: 5,
    }).catch(() => {});
    return new Response(JSON.stringify({ ok: false, message: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  if (req.method !== "POST") return j({ ok: false, message: "POST only" }, 405);
  const body = await req.json().catch(() => null) as { call_id?: string; phone?: string } | null;
  if (!body?.call_id) return j({ ok: false, message: "Could not send the link." }, 400);
  const sb = db();

  const { data: call } = await sb.from("voice_calls")
    .select("id, run_id, wa_id, order_ref, status, link_sent_at, created_at").eq("id", body.call_id).maybeSingle();
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

  const res = await callWaSendOnce(payload);
  if (!res.ok) {
    await releaseSend(key);
    logConnector({
      connector: "shopify_wa",
      level: "warn",
      event: "voice_link_failed",
      message: `${call.wa_id}: cart link send failed during voice call (${res.error ?? "unknown error"}).`,
      ref: call.order_ref ?? call.id,
    }).catch(() => {});
    return j({ ok: false, message: "Could not send the link right now. You can also find it in your WhatsApp chat with PROMUNCH." }, 502);
  }
  await markSendSent(key);
  await sb.from("voice_calls").update({ link_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", call.id);
  logConnector({
    connector: "shopify_wa",
    level: "info",
    event: "voice_link_sent",
    message: `${call.wa_id}: cart link sent on WhatsApp during voice call (${free ? "free text" : "template"}).`,
    ref: call.order_ref ?? call.id,
  }).catch(() => {});
  return j({ ok: true, message: "Done, the checkout link is on your WhatsApp now." });
});

// Network-level throws (DNS/connection failures) must resolve to the same
// {ok:false, error} shape as an HTTP error response, never propagate — a
// thrown fetch here would skip releaseSend(key), stranding the claim for the
// full stale window (the agent could not retry within the live call) and
// breaking the {ok, message} contract the voice agent speaks from.
async function callWaSendOnce(payload: unknown): Promise<{ ok?: boolean; error?: string }> {
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
