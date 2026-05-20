// Meta WhatsApp Cloud API webhook.
// - GET: verify subscription challenge.
// - POST: handle inbound messages + status callbacks, upsert thread/message,
//   trigger AI reply if conversation is in 'bot' status.

import { db } from "../_shared/supabase.ts";
import { verifySignature, fetchMedia, markRead } from "../_shared/whatsapp.ts";

const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";

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
  if (!sigOk && Deno.env.get("WA_SKIP_SIGNATURE") !== "1") {
    console.warn("[wa-webhook] signature check failed");
    return new Response("bad signature", { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  try {
    for (const entry of payload?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value;
        if (!value) continue;

        // status updates: delivery/read/failed callbacks
        for (const status of value.statuses ?? []) {
          await handleStatus(status);
        }

        // inbound messages
        const contacts = value.contacts ?? [];
        for (const msg of value.messages ?? []) {
          const contact = contacts.find((c: any) => c.wa_id === msg.from) ?? null;
          await handleInboundMessage(msg, contact);
        }
      }
    }
  } catch (err) {
    console.error("[wa-webhook] error", err);
    // still 200 — Meta retries forever on non-2xx
  }

  return new Response("ok", { status: 200 });
});

async function handleStatus(status: any) {
  const wamid = status?.id;
  if (!wamid) return;
  const map: Record<string, string> = { sent: "sent", delivered: "delivered", read: "read", failed: "failed" };
  const next = map[status.status] ?? null;
  if (!next) return;
  await db().from("wa_messages").update({
    status: next,
    error: status?.errors?.[0]?.title ?? null,
  }).eq("wa_message_id", wamid);
}

async function handleInboundMessage(msg: any, profile: any) {
  const sb = db();
  const waId: string = msg.from;
  const phone = "+" + waId;
  const name = profile?.profile?.name ?? null;

  // dedupe by wa_message_id
  const wamid = msg.id;
  if (wamid) {
    const { data: existing } = await sb.from("wa_messages").select("id").eq("wa_message_id", wamid).maybeSingle();
    if (existing) return;
  }

  // upsert contact
  const { data: contact } = await sb
    .from("wa_contacts")
    .upsert({ wa_id: waId, phone, name, last_seen_at: new Date().toISOString() }, { onConflict: "wa_id" })
    .select("id")
    .single();
  if (!contact) throw new Error("upsert contact failed");

  // upsert thread
  const { data: thread } = await sb
    .from("wa_threads")
    .upsert({ contact_id: contact.id, wa_id: waId, last_inbound_at: new Date().toISOString() }, { onConflict: "contact_id" })
    .select("*")
    .single();
  if (!thread) throw new Error("upsert thread failed");

  // extract body
  let body = "";
  let type = msg.type ?? "text";
  let mediaUrl: string | null = null;
  let mediaMime: string | null = null;

  if (msg.type === "text") body = msg.text?.body ?? "";
  else if (msg.type === "button") body = msg.button?.text ?? "";
  else if (msg.type === "interactive") body = msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? "";
  else if (msg.type === "image" || msg.type === "document" || msg.type === "audio" || msg.type === "video") {
    const mid = msg[msg.type]?.id;
    if (mid) {
      const m = await fetchMedia(mid).catch(() => null);
      if (m) { mediaUrl = m.url; mediaMime = m.mime; }
    }
    body = msg[msg.type]?.caption ?? `[${msg.type}]`;
  } else if (msg.type === "reaction") {
    body = msg.reaction?.emoji ?? "";
    type = "reaction";
  } else {
    body = JSON.stringify(msg).slice(0, 500);
  }

  // insert message
  await sb.from("wa_messages").insert({
    thread_id: thread.id,
    contact_id: contact.id,
    direction: "inbound",
    type,
    body,
    media_url: mediaUrl,
    media_mime: mediaMime,
    wa_message_id: wamid,
    status: "received",
  });

  // update thread snippet
  await sb.from("wa_threads").update({
    last_message_snippet: body.slice(0, 240),
    unread_count: (thread.unread_count ?? 0) + 1,
  }).eq("id", thread.id);

  // mark read on Meta side
  if (wamid) markRead(wamid).catch(() => {});

  // trigger AI reply if bot owns the conversation
  if (thread.status === "bot" && type === "text") {
    invokeAiReply(thread.id, body).catch((e) => console.error("[wa-webhook] ai invoke failed", e));
  }
}

async function invokeAiReply(threadId: string, lastMessage: string) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-ai-reply`;
  await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ thread_id: threadId, last_message: lastMessage }),
  });
}
