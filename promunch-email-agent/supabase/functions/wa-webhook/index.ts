// Meta WhatsApp Cloud API webhook.
// - GET: verify subscription challenge.
// - POST: handle inbound messages + status callbacks, upsert thread/message,
//   trigger AI reply if conversation is in 'bot' status.

import { db } from "../_shared/supabase.ts";
import { verifySignature, downloadMedia, markRead } from "../_shared/whatsapp.ts";
import { logConnector } from "../_shared/connector-log.ts";

const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
const WA_MEDIA_BUCKET = Deno.env.get("WA_MEDIA_BUCKET") ?? "wa-media";

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

  // Durable capture — log every inbound event BEFORE processing, so a lead is
  // never lost even if processing throws. Visible on the CRM Integrations page.
  const v0 = payload?.entry?.[0]?.changes?.[0]?.value;
  const msgCount = (v0?.messages ?? []).length;
  const statusCount = (v0?.statuses ?? []).length;
  logConnector({
    connector: "whatsapp",
    level: "info",
    event: "webhook_received",
    message: `WhatsApp webhook: ${msgCount} message(s), ${statusCount} status update(s).`,
    detail: payload,
  }).catch(() => {});

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

        // non-message subscribed fields (template status, quality, account…)
        if (change?.field && change.field !== "messages") {
          await handleFieldEvent(change.field, value);
        }
      }
    }
  } catch (err) {
    console.error("[wa-webhook] error", err);
    // raw payload is already captured above — safe to 200 and not lose the lead
    logConnector({
      connector: "whatsapp",
      level: "error",
      event: "processing_failed",
      message: `Inbound processing failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 300)}`,
      detail: payload,
    }).catch(() => {});
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
  const sb = db();
  const { data: updated } = await sb.from("wa_messages").update({
    status: next,
    error: status?.errors?.[0]?.title ?? null,
  }).eq("wa_message_id", wamid).select("campaign_id").maybeSingle();

  // roll up delivery stats if this message belongs to a marketing campaign
  if (updated?.campaign_id) {
    await sb.rpc("wa_campaign_recount", { p_campaign: updated.campaign_id })
      .then(() => {}, () => {});
  }
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
    let transcript: string | null = null;
    const mid = msg[msg.type]?.id;
    if (mid) {
      // download the bytes and persist to storage — Meta media URLs expire,
      // so we keep our own permanent, dashboard-viewable copy.
      const dl = await downloadMedia(mid).catch(() => null);
      if (dl) {
        mediaMime = dl.mime;
        const path = `${thread.id}/${crypto.randomUUID()}.${mimeExt(dl.mime)}`;
        const { error: upErr } = await sb.storage
          .from(WA_MEDIA_BUCKET)
          .upload(path, dl.bytes, { contentType: dl.mime, upsert: true });
        if (upErr) {
          console.error("[wa-webhook] media upload failed", upErr);
        } else {
          mediaUrl = sb.storage.from(WA_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
        }
        // voice note → transcribe so the agent and the dashboard can read it
        if (msg.type === "audio") {
          transcript = await transcribeAudio(dl.bytes, dl.mime).catch(() => null);
        }
      }
    }
    body = transcript ?? msg[msg.type]?.caption ?? `[${msg.type}]`;
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

  // honour opt-out keywords — stop marketing to this contact
  if (type === "text" && /^\s*(stop|unsubscribe|stop promotions?|opt[\s-]?out)\s*$/i.test(body)) {
    await sb.from("wa_contacts").update({ opted_in: false }).eq("id", contact.id);
  }

  // trigger AI reply if bot owns the conversation — any message carrying real
  // text (plain, button/list reply, caption, or a transcribed voice note),
  // or an image (Claude reads the image directly)
  const hasRealText = !!body && !/^\[(image|video|document|audio|sticker)\]$/i.test(body);
  const isImage = type === "image" && !!mediaUrl;
  if (thread.status === "bot" && type !== "reaction" && (hasRealText || isImage)) {
    await enqueueAiReply(thread.id, body, isImage ? mediaUrl : null)
      .catch((e) => console.error("[wa-webhook] ai enqueue failed", e));
  }
}

// Durably hand off an inbound message for an AI reply.
//
// 1. Persist a wa_jobs row FIRST — this is the safety net. If anything below
//    fails, wa-jobs-tick will still drain it with retries.
// 2. Fire a best-effort fast-path call to wa-ai-reply so the customer normally
//    gets an instant reply. It carries the job_id so a successful run marks
//    the job done and the cron never has to touch it.
async function enqueueAiReply(threadId: string, lastMessage: string, imageUrl: string | null = null) {
  const sb = db();
  const { data: job } = await sb.from("wa_jobs").insert({
    kind: "ai_reply",
    payload: { thread_id: threadId, last_message: lastMessage, image_url: imageUrl },
    // give the fast path a generous window before the cron may pick it up
    run_after: new Date(Date.now() + 120_000).toISOString(),
  }).select("id").single();

  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-ai-reply`;
  fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ thread_id: threadId, last_message: lastMessage, image_url: imageUrl, job_id: job?.id ?? null }),
  }).catch((e) => console.error("[wa-webhook] fast-path ai invoke failed", e));
}

// Map a WhatsApp media MIME type to a file extension for the storage path.
function mimeExt(mime: string): string {
  const base = (mime ?? "").split(";")[0].trim();
  const map: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
    "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/amr": "amr",
    "video/mp4": "mp4", "video/3gpp": "3gp",
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "text/plain": "txt",
  };
  return map[base] ?? "bin";
}

// Transcribe a voice note via OpenAI Whisper. Returns null if no key or failure
// — the caller then falls back to "[audio]" and a human picks it up.
async function transcribeAudio(bytes: Uint8Array, mime: string): Promise<string | null> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return null;
  try {
    const fd = new FormData();
    fd.append("file", new Blob([bytes], { type: mime }), `voice.${mimeExt(mime)}`);
    fd.append("model", Deno.env.get("WA_TRANSCRIBE_MODEL") ?? "whisper-1");
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: fd,
    });
    if (!r.ok) {
      console.error("[wa-webhook] whisper failed", r.status, (await r.text().catch(() => "")).slice(0, 200));
      return null;
    }
    const out = await r.json();
    const text = String(out?.text ?? "").trim();
    return text || null;
  } catch (e) {
    console.error("[wa-webhook] whisper error", e);
    return null;
  }
}

// Non-message webhook fields → connector_events for dashboard visibility,
// plus the one high-value action: syncing template approval status.
async function handleFieldEvent(field: string, value: any) {
  const sb = db();
  try {
    if (field === "message_template_status_update") {
      const name = value?.message_template_name;
      const lang = value?.message_template_language;
      const ev = String(value?.event ?? "").toUpperCase();
      const statusMap: Record<string, string> = {
        APPROVED: "approved", REJECTED: "rejected", PENDING: "pending",
        PENDING_DELETION: "disabled", PAUSED: "disabled", DISABLED: "disabled", FLAGGED: "disabled",
      };
      const next = statusMap[ev];
      if (name && next) {
        let upd = sb.from("wa_templates").update({
          status: next,
          meta_template_id: value?.message_template_id ?? null,
          rejection_reason: ev === "REJECTED" ? (value?.reason ?? "Rejected by Meta") : null,
        }).eq("name", name);
        if (lang) upd = upd.eq("language", lang);
        await upd;
      }
      await logConnector({
        connector: "whatsapp",
        level: ev === "REJECTED" ? "warn" : "info",
        event: "template_status",
        message: `Template '${name ?? "?"}' → ${ev || "update"}.`,
        detail: value,
      });
    } else if (field === "phone_number_quality_update" || field === "phone_number_name_update") {
      const down = /RED|LOW|FLAGGED|DOWNGRAD|DISABL/i.test(JSON.stringify(value ?? {}));
      await logConnector({
        connector: "whatsapp",
        level: down ? "error" : "warn",
        event: field,
        message: `${field}: ${JSON.stringify(value ?? {}).slice(0, 220)}`,
        detail: value,
      });
    } else if (field === "account_update" || field === "account_alerts" || field === "business_capability_update") {
      const bad = /BAN|RESTRICT|VIOLAT|DISABL|REJECT/i.test(JSON.stringify(value ?? {}));
      await logConnector({
        connector: "whatsapp",
        level: bad ? "error" : "warn",
        event: field,
        message: `Meta ${field}: ${JSON.stringify(value ?? {}).slice(0, 220)}`,
        detail: value,
      });
    } else if (field === "user_preferences") {
      // opt-out via the STOP keyword is handled on inbound messages; log here
      await logConnector({
        connector: "whatsapp",
        level: "info",
        event: "user_preferences",
        message: "Customer marketing-preference update received.",
        detail: value,
      });
    } else {
      await logConnector({
        connector: "whatsapp",
        level: "info",
        event: `field_${field}`,
        message: `WhatsApp webhook field '${field}' received.`,
        detail: value,
      });
    }
  } catch (e) {
    console.error("[wa-webhook] handleFieldEvent", field, e);
  }
}
