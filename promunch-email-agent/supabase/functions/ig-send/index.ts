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
import { sendDM, privateReply } from "../_shared/instagram.ts";
import { logConnector } from "../_shared/connector-log.ts";

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
  if (req.method !== "POST") return new Response("method", { status: 405 });

  let body: SendBody;
  try { body = await req.json(); } catch { return j({ error: "bad json" }, 400); }
  if (!body.text) return j({ error: "text required" }, 400);

  const sb = db();

  // resolve thread + IGSID
  let threadId = body.thread_id ?? null;
  let igUserId: string | null = null;

  if (threadId) {
    const { data: t } = await sb.from("ig_threads").select("id, ig_user_id").eq("id", threadId).single();
    if (!t) return j({ error: "thread not found" }, 404);
    igUserId = t.ig_user_id;
  } else if (body.to) {
    igUserId = body.to;
    const { data: th } = await sb
      .from("ig_threads")
      .upsert({ ig_user_id: igUserId }, { onConflict: "ig_user_id" })
      .select("id").single();
    if (!th) return j({ error: "thread upsert failed" }, 500);
    threadId = th.id;
  } else {
    return j({ error: "thread_id or to required" }, 400);
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
      result = await sendDM(igUserId!, body.text);
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
