import { CART_REQUEST_PREFIX, cartRequestCode, validRequestedCartLink } from "../_shared/cart-request.ts";
import { callSend, j } from "./send.ts";
import { markJobDone } from "./turn-claim.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// Deterministic service reply to an actual, signed-webhook inbound. No model
// interpretation of a supplied URL, no marketing opt-in, no promotional ask.
export async function handleCartRequest(
  sb: SupabaseClient, threadId: string,
  inbound: { id: string; body?: string; created_at: string } | undefined,
  draft: boolean | undefined, jobId?: string | null,
  send: typeof callSend = callSend,
): Promise<Response | null> {
  if (!inbound?.body?.trim().startsWith(CART_REQUEST_PREFIX)) return null;
  const age = Date.now() - Date.parse(inbound.created_at);
  if (!Number.isFinite(age) || age < 0 || age >= 24 * 3600_000) {
    await markJobDone(jobId);
    return j({ ok: true, skipped: "cart request outside service window" });
  }
  const code = cartRequestCode(inbound.body);
  const { data: link, error } = code
    ? await sb.from("wa_short_links").select("target_url,sent_by,created_at").eq("code", code).maybeSingle()
    : { data: null, error: null };
  if (error) return j({ ok: false, error: "cart request lookup unavailable" }, 503);
  const url = validRequestedCartLink(link);
  const reply = url
    ? `Here is the PROMUNCH cart you requested:\n${url}\n\nPrices and availability are checked when you open it. Need help checking out? Your Munchy Pal`
    : "This PROMUNCH cart request has expired or is invalid. Please return to your cart and select Send my cart to WhatsApp again, or tell us what you need help with.";
  if (draft) return j({ ok: true, draft: reply, action: "reply" });
  const sender = `cart_request:${inbound.id}`;
  const { data: existing, error: ledgerError } = await sb.from("wa_messages")
    .select("id").eq("thread_id", threadId).eq("sent_by", sender).limit(1);
  if (ledgerError) return j({ ok: false, error: "cart request ledger unavailable" }, 503);
  if (existing?.length) { await markJobDone(jobId); return j({ ok: true, skipped: "already attempted" }); }
  // Never use claimReplyTurn's legacy read-only fallback for this new path.
  const { data: won, error: claimError } = await sb.rpc("claim_ai_reply", {
    p_thread: threadId, p_inbound: inbound.id,
  });
  if (claimError) return j({ ok: false, error: "cart request claim unavailable" }, 503);
  if (won !== true) { await markJobDone(jobId); return j({ ok: true, skipped: "claimed elsewhere" }); }
  // Seal before the external side effect. If the network outcome is unknown,
  // a retry must not send again. The customer can explicitly request anew.
  const { error: sealError } = await sb.rpc("mark_ai_reply_sent", { p_thread: threadId, p_inbound: inbound.id });
  if (sealError) return j({ ok: false, error: "cart request claim seal failed" }, 503);
  const result = await send({ thread_id: threadId, kind: "text", text: reply, sent_by: sender });
  await markJobDone(jobId);
  return j(result, result.ok ? 200 : 502);
}
