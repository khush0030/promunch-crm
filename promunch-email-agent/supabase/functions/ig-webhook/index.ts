// Meta Instagram webhook (Instagram Messaging + comments).
// - GET: verify subscription challenge.
// - POST: handle inbound DMs (entry[].messaging[]) and comments
//   (entry[].changes[] field='comments'), upsert thread/message, enqueue an AI
//   triage+reply if the bot owns the conversation.
//
// Mirrors wa-webhook. NO-SPAM invariant: dedup on Meta mid / comment id, and the
// AI reply takes an atomic per-turn claim before sending (see ig-ai-reply).

import { db } from "../_shared/supabase.ts";
import { verifySignature } from "../_shared/instagram.ts";
import { logConnector } from "../_shared/connector-log.ts";

const VERIFY_TOKEN = Deno.env.get("INSTAGRAM_VERIFY_TOKEN") ?? "";
// Our own IG account id — webhooks echo our own sends back as messaging events
// with sender.id == us; skip those so the bot never replies to itself.
const SELF_ID = Deno.env.get("INSTAGRAM_USER_ID") ?? "";

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // ---- GET verification handshake ----
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const rawBody = await req.text();
  const sigHeader = req.headers.get("x-hub-signature-256");
  const sigOk = await verifySignature(rawBody, sigHeader);
  if (!sigOk) {
    console.warn("[ig-webhook] signature check failed");
    return new Response("bad signature", { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  // Durable capture — log every inbound event BEFORE processing so a lead is
  // never lost even if processing throws.
  logConnector({
    connector: "instagram",
    level: "info",
    event: "webhook_received",
    message: `Instagram webhook received (${(payload?.entry ?? []).length} entry).`,
    detail: payload,
  }).catch(() => {});

  try {
    for (const entry of payload?.entry ?? []) {
      // Direct messages arrive as entry[].messaging[]
      for (const m of entry?.messaging ?? []) {
        await handleInboundDM(m).catch((e) => console.error("[ig-webhook] DM error", e));
      }
      // Comments arrive as entry[].changes[] with field 'comments'
      for (const change of entry?.changes ?? []) {
        if (change?.field === "comments") {
          await handleComment(change.value).catch((e) => console.error("[ig-webhook] comment error", e));
        } else if (change?.field) {
          await logConnector({
            connector: "instagram",
            level: "info",
            event: `field_${change.field}`,
            message: `Instagram webhook field '${change.field}' received.`,
            detail: change.value,
          });
        }
      }
    }
  } catch (err) {
    console.error("[ig-webhook] error", err);
    logConnector({
      connector: "instagram",
      level: "error",
      event: "processing_failed",
      message: `Inbound processing failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 300)}`,
      detail: payload,
    }).catch(() => {});
    // still 200 — Meta retries forever on non-2xx
  }

  return new Response("ok", { status: 200 });
});

// ---- inbound direct message ------------------------------------------------
async function handleInboundDM(m: any) {
  const senderId: string = m?.sender?.id ?? "";
  if (!senderId || senderId === SELF_ID) return; // ignore echoes of our own sends

  // ignore read/delivery/reaction-only events — only act on real message content
  const msg = m?.message;
  if (!msg || msg.is_echo) return;

  const mid: string | null = msg.mid ?? null;
  let text: string = (msg.text ?? "").toString();
  let mediaUrl: string | null = null;
  if (!text && Array.isArray(msg.attachments) && msg.attachments.length) {
    const att = msg.attachments[0];
    mediaUrl = att?.payload?.url ?? null;
    text = `[${att?.type ?? "attachment"}]`;
  }
  if (!text && !mediaUrl) return;

  const sb = db();

  // dedup by Meta message id
  if (mid) {
    const { data: existing } = await sb.from("ig_messages").select("id").eq("ig_message_id", mid).maybeSingle();
    if (existing) return;
  }

  const thread = await upsertThread(senderId);
  if (!thread) return;

  const { data: inserted } = await sb.from("ig_messages").insert({
    thread_id: thread.id,
    ig_user_id: senderId,
    direction: "inbound",
    kind: "dm",
    text,
    media_url: mediaUrl,
    ig_message_id: mid,
    status: "received",
  }).select("id").single();

  await touchThreadInbound(thread, text);

  // hand off to AI triage unless a human has taken over this thread
  if (thread.status === "bot" && inserted) {
    await enqueueAiReply(thread.id, { last_message: text, inbound_id: inserted.id, kind: "dm" })
      .catch((e) => console.error("[ig-webhook] enqueue failed", e));
  }
}

// ---- inbound comment -------------------------------------------------------
async function handleComment(value: any) {
  const commentId: string = value?.id ?? "";
  const fromId: string = value?.from?.id ?? "";
  const handle: string | null = value?.from?.username ?? null;
  const text: string = (value?.text ?? "").toString();
  if (!commentId || !fromId || fromId === SELF_ID) return;

  const sb = db();
  // dedup by comment id
  const { data: existing } = await sb.from("ig_messages").select("id").eq("comment_id", commentId).maybeSingle();
  if (existing) return;

  const thread = await upsertThread(fromId, handle);
  if (!thread) return;

  const { data: inserted } = await sb.from("ig_messages").insert({
    thread_id: thread.id,
    ig_user_id: fromId,
    direction: "inbound",
    kind: "comment",
    text,
    comment_id: commentId,
    status: "received",
  }).select("id").single();

  await touchThreadInbound(thread, text ? `💬 ${text}` : "💬 (comment)");

  if (thread.status === "bot" && inserted) {
    await enqueueAiReply(thread.id, { last_message: text, inbound_id: inserted.id, kind: "comment", comment_id: commentId })
      .catch((e) => console.error("[ig-webhook] comment enqueue failed", e));
  }
}

// ---- thread helpers --------------------------------------------------------
async function upsertThread(igUserId: string, handle?: string | null) {
  const sb = db();
  const patch: Record<string, unknown> = { ig_user_id: igUserId, last_inbound_at: new Date().toISOString() };
  if (handle) patch.handle = handle;
  const { data, error } = await sb
    .from("ig_threads")
    .upsert(patch, { onConflict: "ig_user_id" })
    .select("*")
    .single();
  if (error) { console.error("[ig-webhook] upsert thread failed", error); return null; }
  return data;
}

async function touchThreadInbound(thread: any, snippet: string) {
  await db().from("ig_threads").update({
    last_message_snippet: snippet.slice(0, 240),
    last_activity_at: new Date().toISOString(),
    unread_count: (thread.unread_count ?? 0) + 1,
    archived_at: null,
  }).eq("id", thread.id);
}

// Durably hand off for an AI triage+reply (mirrors wa-webhook.enqueueAiReply):
// persist an ig_jobs row FIRST (safety net for ig-jobs-tick), then fire a
// best-effort fast-path call for an instant reply.
async function enqueueAiReply(
  threadId: string,
  ctx: { last_message: string; inbound_id: string; kind: string; comment_id?: string },
) {
  const sb = db();
  const payload = { thread_id: threadId, ...ctx };
  const { data: job } = await sb.from("ig_jobs").insert({
    kind: "ai_reply",
    payload,
    run_after: new Date(Date.now() + 120_000).toISOString(),
  }).select("id").single();

  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ig-ai-reply`;
  const fastPath = fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...payload, job_id: job?.id ?? null }),
  }).catch((e) => console.error("[ig-webhook] fast-path ai invoke failed", e));

  try {
    (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } })
      .EdgeRuntime?.waitUntil(fastPath);
  } catch { /* not on the edge runtime */ }
}
