// Outbound Instagram send. Single chokepoint for all outbound IG DMs — records
// every send in ig_messages and Slack-alerts failures. Mirrors wa-send.
//
// POST body:
//   { thread_id?: string, to?: string (IGSID),
//     kind: 'text' | 'private_reply',
//     text: string,
//     comment_id?: string,        // required for kind='private_reply'
//     sent_by?: string, ai_generated?: boolean, ai_meta?: unknown }
//
// Auth: requires service-role bearer (verify_jwt = false; called function-to-function).

import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { sendDM, privateReply } from "../_shared/instagram.ts";
import { logConnector } from "../_shared/connector-log.ts";
import { windowState } from "../_shared/ig-window.ts";

// Senders that are machines. Outside the 24h window they are always refused —
// only a human send (inbox reply box, Tasks-tab approval) may use the
// HUMAN_AGENT 7-day lane. 'dashboard'/'human' sends sit behind requireSession
// routes, so a human clicked them.
const AUTOMATED_SENDERS = new Set(["bot", "ai", "followup_bot"]);

interface SendBody {
  thread_id?: string;
  to?: string;
  kind: "text" | "private_reply";
  text: string;
  comment_id?: string;
  sent_by?: string;
  ai_generated?: boolean;
  ai_meta?: unknown;
}

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  if (req.method !== "POST") return new Response("method", { status: 405 });

  let body: SendBody;
  try { body = await req.json(); } catch { return j({ error: "bad json" }, 400); }
  if (!body.text) return j({ error: "text required" }, 400);

  const sb = db();

  // resolve thread + IGSID
  let threadId = body.thread_id ?? null;
  let igUserId: string | null = null;
  let lastInboundAt: string | null = null;

  if (threadId) {
    const { data: t } = await sb.from("ig_threads").select("id, ig_user_id, last_inbound_at").eq("id", threadId).single();
    if (!t) return j({ error: "thread not found" }, 404);
    igUserId = t.ig_user_id;
    lastInboundAt = t.last_inbound_at;
  } else if (body.to) {
    igUserId = body.to;
    const { data: th } = await sb
      .from("ig_threads")
      .upsert({ ig_user_id: igUserId }, { onConflict: "ig_user_id" })
      .select("id, last_inbound_at").single();
    if (!th) return j({ error: "thread upsert failed" }, 500);
    threadId = th.id;
    lastInboundAt = th.last_inbound_at;
  } else {
    return j({ error: "thread_id or to required" }, 400);
  }

  // ---- messaging-window guard (free-form DMs only; private replies follow
  // Meta's own 7-days-from-comment rule). Meta would reject these sends anyway;
  // failing here is deliberate policy, with a clean error instead of a Graph
  // error, and it hard-stops any automated sender outside the 24h window.
  let humanAgentTag = false;
  if (body.kind !== "private_reply") {
    const { data: settings } = await sb
      .from("ig_settings").select("human_agent_enabled").eq("id", 1).maybeSingle();
    const state = windowState(lastInboundAt, !!settings?.human_agent_enabled);
    if (state === "closed") {
      return j({ ok: false, error: "window_closed", window_state: state }, 403);
    }
    if (state === "human_agent_7d") {
      if (AUTOMATED_SENDERS.has(body.sent_by ?? "dashboard")) {
        return j({ ok: false, error: "human_agent_required", window_state: state }, 403);
      }
      humanAgentTag = true;
    }
  }

  // dispatch to Meta
  let result;
  let kind = "dm";
  try {
    if (body.kind === "private_reply") {
      if (!body.comment_id) return j({ error: "comment_id required for private_reply" }, 400);
      result = await privateReply(body.comment_id, body.text);
      kind = "private_reply";
    } else {
      result = await sendDM(igUserId!, body.text, humanAgentTag ? { tag: "HUMAN_AGENT" } : undefined);
      kind = "dm";
    }
  } catch (e) {
    return j({ error: String(e) }, 500);
  }

  await sb.from("ig_messages").insert({
    thread_id: threadId,
    ig_user_id: igUserId,
    direction: "outbound",
    kind,
    text: body.text,
    comment_id: body.kind === "private_reply" ? body.comment_id : null,
    ig_message_id: result.message_id,
    status: result.ok ? "sent" : "failed",
    sent_by: body.sent_by ?? "dashboard",
    ai_generated: !!body.ai_generated,
    ai_meta: body.ai_meta ?? null,
    error: result.ok ? null : result.error,
  });

  if (result.ok) {
    await sb.from("ig_threads").update({
      last_outbound_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      last_message_snippet: body.text.slice(0, 240),
    }).eq("id", threadId);
  } else {
    // No silent failures — every failed send is logged + Slack-alerted.
    await logConnector({
      connector: "instagram",
      level: "error",
      event: `send_failed:${result.error_code ?? "na"}`,
      message: `Instagram send failed (${kind}) → ${igUserId}: ${result.error ?? "unknown"}`,
      detail: { code: result.error_code ?? null, detail: result.error_detail ?? null, sent_by: body.sent_by ?? null },
      ref: igUserId,
      throttleMinutes: 5,
    }).catch(() => {});
  }

  return j({ ok: result.ok, message_id: result.message_id, error: result.error ?? null });
});

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
