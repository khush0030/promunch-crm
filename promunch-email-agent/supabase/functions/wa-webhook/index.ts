// Meta WhatsApp Cloud API webhook.
// - GET: verify subscription challenge.
// - POST: handle inbound messages + status callbacks, upsert thread/message,
//   trigger AI reply if conversation is in 'bot' status.

import { db } from "../_shared/supabase.ts";
import { verifySignature, downloadMedia, markRead, buildCtaUrl } from "../_shared/whatsapp.ts";
import { logConnector, alertWaSendFailure, postSlack, slackChannelFor } from "../_shared/connector-log.ts";
import { buildCartPermalink, cartFromOrderItems } from "../_shared/shopify-cart.ts";
import { getFlowSettings } from "../_shared/flow-settings.ts";
import { handleGateButton, parseGatePayload } from "../_shared/cod-gate.ts";
import { safeMessageType } from "../_shared/wa-message-types.ts";

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
  if (!sigOk) {
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
  const errTitle = status?.errors?.[0]?.title ?? null;
  const { data: updated } = await sb.from("wa_messages").update({
    status: next,
    error: errTitle,
  }).eq("wa_message_id", wamid).select("campaign_id, template_name, type, sent_by, journey_run_id").maybeSingle();

  // roll up delivery stats if this message belongs to a marketing campaign
  if (updated?.campaign_id) {
    await sb.rpc("wa_campaign_recount", { p_campaign: updated.campaign_id })
      .then(() => {}, () => {});
  }

  // CART DELIVERY GUARANTEE — confirm or reopen the journey run that sent this.
  // A send returning ok only means Meta ACCEPTED it; the real verdict arrives
  // here. Only abandoned_checkout runs carry the at-least-once guarantee.
  if (updated?.journey_run_id && updated.sent_by === "journey:abandoned_checkout") {
    if (next === "delivered" || next === "read") {
      // SUCCESS — one message landed. Set the terminal delivered flag so no tick
      // and no later reopen ever sends this cart again (CLAUDE.md §0: never twice).
      await sb.from("wa_journey_runs")
        .update({ delivered_at: new Date().toISOString(), status: "completed", last_error: null })
        .eq("id", updated.journey_run_id).is("delivered_at", null)
        .then(() => {}, () => {});
    } else if (next === "failed") {
      // ASYNC FAILURE (usually #131049 cap) — the send did NOT land. Reopen the
      // run for another attempt UNLESS it already delivered or passed its
      // deadline. Reopening only from a confirmed non-delivery keeps at-least-once
      // from ever becoming twice. Guarded on the current status so a duplicate
      // 'failed' callback can't double-reopen.
      const { data: run } = await sb.from("wa_journey_runs")
        .select("deadline_at, delivered_at, attempts")
        .eq("id", updated.journey_run_id).maybeSingle();
      const nowIso = new Date().toISOString();
      if (run && !run.delivered_at) {
        if (run.deadline_at && run.deadline_at < nowIso) {
          await sb.from("wa_journey_runs")
            .update({ status: "expired", last_error: "recovery deadline passed (async cap)" })
            .eq("id", updated.journey_run_id).neq("status", "expired")
            .then(() => {}, () => {});
        } else {
          const backoffH = (await getFlowSettings()).cart_backoff_hours;
          const nextAt = new Date(Date.now() + backoffH * 3600_000).toISOString();
          await sb.from("wa_journey_runs").update({
            status: "active",
            next_action_at: nextAt,
            attempts: (run.attempts ?? 0) + 1,
            last_error: `async cap (#${status?.errors?.[0]?.code ?? "?"}) — reopened, retry in ${backoffH}h`,
          }).eq("id", updated.journey_run_id).eq("status", "completed")
            .then(() => {}, () => {});
        }
      }
    }
  }

  // ASYNC delivery failure — Meta reports "undeliverable" / frequency-cap /
  // re-engagement here, AFTER the send call already returned ok. This is where
  // most real failures surface, so it must alert too (with the Meta reason).
  // Routine deliverability rejections no longer Slack-post (connector-log), so
  // this is recorded-not-shouted for cart caps — exactly the intended quiet.
  if (next === "failed" && updated) {
    const err = status?.errors?.[0] ?? {};
    await alertWaSendFailure({
      to: status?.recipient_id ?? "?",
      kind: updated.type ?? "message",
      templateName: updated.template_name ?? null,
      error: err.title ?? errTitle ?? "delivery failed",
      errorCode: typeof err.code === "number" ? err.code : undefined,
      errorDetail: err.error_data?.details ?? err.message ?? undefined,
      sentBy: updated.sent_by ?? undefined,
    }).catch(() => {});
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
  // when the customer sends a cart from the WhatsApp catalog (type 'order'),
  // we capture the line items so we can hand them a Shopify checkout link.
  let checkoutUrl: string | null = null;
  let cartTotal: { total: number; currency: string; count: number } | null = null;

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
  } else if (msg.type === "order") {
    // Cart submitted from the WhatsApp catalog. Each product_retailer_id is the
    // Shopify variant id (catalog convention), so we can build a checkout link
    // with no Shopify product API calls.
    type = "order";
    const items = msg.order?.product_items ?? [];
    const cart = cartFromOrderItems(items);
    checkoutUrl = buildCartPermalink(cart.lines);
    cartTotal = { total: cart.total, currency: cart.currency, count: cart.count };
    const note = (msg.order?.text ?? "").toString().trim();
    body = `🛒 Cart from WhatsApp: ${cart.count} item(s)` +
      (cart.total ? ` · ${cart.currency} ${cart.total.toFixed(0)}` : "") +
      (note ? `\nNote: ${note}` : "");
  } else {
    body = JSON.stringify(msg).slice(0, 500);
  }

  // insert message. This is the ATOMIC dedup gate for concurrent duplicate
  // deliveries of the same wamid: the select-based dedupe above only catches
  // sequential retries, but Meta can deliver the same message twice at once.
  // The unique index on wa_message_id makes exactly one insert win; the loser
  // returns before ANY side effect (STOP/START confirms, COD gate, checkout
  // links, AI enqueue) so nothing sends twice (§0).
  type = safeMessageType(type);
  const { error: insErr } = await sb.from("wa_messages").insert({
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
  if (insErr) {
    if (insErr.code === "23505") return; // concurrent duplicate delivery — the other one owns the side effects
    // Last-ditch retry with a minimal, always-valid row. Losing the insert
    // means losing the WHOLE turn — no AI reply, no opt-out, no COD gate tap —
    // so we would rather store a stripped-down record and carry on than drop a
    // customer's message. (A narrow type constraint silently ate 92 COD button
    // taps this way; the clamp above closes that specific hole, this closes the
    // class.) The wa_message_id unique index still guarantees exactly-once.
    const { error: retryErr } = await sb.from("wa_messages").insert({
      thread_id: thread.id,
      contact_id: contact.id,
      direction: "inbound",
      type: "unsupported",
      body: (body ?? "").slice(0, 4000),
      wa_message_id: wamid,
      status: "received",
    });
    if (retryErr) {
      if (retryErr.code === "23505") return;
      throw new Error(`inbound wa_messages insert failed: ${insErr.message}`);
    }
    await logConnector({
      connector: "whatsapp", level: "warn", event: "inbound_degraded_insert",
      message: `Inbound message stored in degraded form after insert error: ${insErr.message}`,
      detail: { type, wamid },
    }).catch(() => {});
  }

  // update thread snippet — a new inbound also un-archives the chat so it
  // resurfaces in the inbox (archiving only hides quiet conversations).
  await sb.from("wa_threads").update({
    last_message_snippet: body.slice(0, 240),
    unread_count: (thread.unread_count ?? 0) + 1,
    archived_at: null,
  }).eq("id", thread.id);

  // mark read on Meta side
  if (wamid) markRead(wamid).catch(() => {});

  // COD confirmation gate — button taps carry machine payloads. Handle them
  // deterministically and never let them reach the AI. Non-gate buttons
  // (any payload not matching the gate pattern) fall through unchanged.
  const gateRaw = msg.type === "button"
    ? msg.button?.payload
    : msg.type === "interactive"
    ? msg.interactive?.button_reply?.id
    : null;
  const gate = parseGatePayload(gateRaw);
  if (gate) {
    await handleGateButton(gate.action, gate.shopifyId, waId, thread.id)
      .catch((e) => console.error("[wa-webhook] gate button failed", e));
    return;
  }

  // honour opt-out keywords — stop marketing to this contact. A bare "STOP" is an
  // UNSUBSCRIBE, never a message: confirm it, then RETURN so the AI never sees it
  // and never mistakes it for "cancel my order". A cancellation is only ever an
  // explicit "cancel my order" request, handled by the AI's request_order_change.
  if (type === "text" && /^\s*(stop|unsubscribe|stop promotions?|opt[\s-]?out)\s*$/i.test(body)) {
    await sb.from("wa_contacts").update({ opted_in: false }).eq("id", contact.id);
    await callSend({
      thread_id: thread.id,
      kind: "text",
      sent_by: "optout",
      text: "You're unsubscribed from PROMUNCH updates 💚 Reply START anytime to opt back in. Need help with an order? Just tell us.",
    }).catch((e) => console.error("[wa-webhook] optout confirm failed", e));
    return;
  }

  // honour opt-IN — let an unsubscribed contact come back
  if (type === "text" && /^\s*(start|unstop|subscribe|opt[\s-]?in)\s*$/i.test(body)) {
    await sb.from("wa_contacts").update({ opted_in: true }).eq("id", contact.id);
    await callSend({
      thread_id: thread.id,
      kind: "text",
      sent_by: "optin",
      text: "You're back in 💚 You'll get PROMUNCH updates again. Reply STOP anytime to unsubscribe.",
    }).catch((e) => console.error("[wa-webhook] optin confirm failed", e));
    return;
  }

  // OPS RESOLVE — one of the escalation numbers (ops guard, Narendra, or the
  // owner) replying "done 42" / "resolved 42" / "close 42" closes ticket #42 and
  // hands that customer's chat back to the bot. Fully phone-driven, no dashboard.
  // Only these known internal numbers can close a ticket this way; a customer
  // typing "done" hits the AI path as normal.
  if (type === "text") {
    const opsNums = new Set(
      ["OPS_WA_ID", "OPS_WA_ID_2", "ESCALATION_WA_ID"]
        .map((k) => (Deno.env.get(k) ?? "").replace(/^\+/, "").replace(/\D/g, ""))
        .filter(Boolean),
    );
    const m = body.match(/^\s*(?:done|resolved?|closed?)\s*#?\s*(\d{1,10})\b/i);
    if (opsNums.has(waId) && m) {
      const ticketNo = Number(m[1]);
      const { data: closed } = await sb
        .from("wa_threads")
        .update({
          ticket_status: "closed",
          ticket_resolved_at: new Date().toISOString(),
          status: "bot",
          ticket_last_alert_at: null,
          ticket_alert_count: 0,
        })
        .eq("ticket_number", ticketNo)
        .in("ticket_status", ["open", "pending"])
        .select("id")
        .maybeSingle();
      await callSend({
        thread_id: thread.id,
        kind: "text",
        sent_by: "ops_resolve",
        text: closed
          ? `✅ Ticket #${ticketNo} closed. The bot is handling that chat again.`
          : `⚠️ No open ticket #${ticketNo} found — it may already be closed.`,
      }).catch((e) => console.error("[wa-webhook] ops resolve confirm failed", e));
      return;
    }
  }

  // CART CHECKOUT — a 'order' message is a cart the customer built from the
  // WhatsApp catalog. Respond deterministically with a Shopify checkout link
  // (no AI). The inbound wamid dedup at the top of this function guarantees we
  // only do this once per cart, even if Meta retries the webhook.
  if (type === "order") {
    await sendCheckout(thread.id, checkoutUrl, cartTotal)
      .catch((e) => console.error("[wa-webhook] checkout send failed", e));
    return;
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

// Fire a send through wa-send so it's recorded in wa_messages and any failure is
// Slack-alerted like every other send.
async function callSend(payload: Record<string, unknown>): Promise<void> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-send`;
  const auth = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;
  await fetch(url, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// Reply to a WhatsApp catalog cart with a Shopify checkout link (or a graceful
// fallback if the cart couldn't be read). Routes through wa-send so the send is
// recorded in wa_messages and any failure is Slack-alerted like every other send.
async function sendCheckout(
  threadId: string,
  checkoutUrl: string | null,
  cart: { total: number; currency: string; count: number } | null,
) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-send`;
  const auth = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;
  const post = (payload: Record<string, unknown>) =>
    fetch(url, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(payload) });

  if (!checkoutUrl) {
    await post({
      thread_id: threadId,
      kind: "text",
      sent_by: "checkout",
      text: "Oops, I couldn't read the items in your cart. Could you add them again from the menu, or tell me what you'd like and I'll help? 🛒",
    });
    return;
  }

  const totalLine = cart?.total ? ` Your total is ${cart.currency} ${cart.total.toFixed(0)}.` : "";
  const bodyText = `Yay, your cart's ready! 🛒${totalLine}\nTap below to checkout securely. Pay by UPI, card or COD. Free shipping on orders ₹599+ 💚`;
  const ctaFlows = await getFlowSettings();
  const ctaFooter = ctaFlows.tagline_checkout_footer ? ((ctaFlows.tagline_text || "").trim() || undefined) : undefined;
  await post({
    thread_id: threadId,
    kind: "interactive",
    sent_by: "checkout",
    interactive: buildCtaUrl(bodyText, "Checkout now", checkoutUrl, ctaFooter),
  });
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
  const { data: job, error: jobErr } = await sb.from("wa_jobs").insert({
    kind: "ai_reply",
    payload: { thread_id: threadId, last_message: lastMessage, image_url: imageUrl },
    // give the fast path a generous window before the cron may pick it up
    run_after: new Date(Date.now() + 120_000).toISOString(),
  }).select("id").single();
  if (jobErr || !job) {
    // The durable safety net failed — if the fast path below also fails, this
    // inbound would be silently dropped. Alert loudly so a human notices.
    logConnector({
      connector: "whatsapp",
      event: "ai_reply_enqueue_failed",
      level: "error",
      detail: { thread_id: threadId, error: jobErr?.message ?? "no job row" },
    }).catch(() => {});
  }

  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-ai-reply`;
  const fastPath = fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ thread_id: threadId, last_message: lastMessage, image_url: imageUrl, job_id: job?.id ?? null }),
  }).catch((e) => console.error("[wa-webhook] fast-path ai invoke failed", e));

  // Keep the fast-path request alive after the webhook returns its 200 —
  // without waitUntil the edge runtime can tear the instance down before the
  // call lands, leaving the customer to wait for the wa-jobs-tick cron.
  try {
    (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } })
      .EdgeRuntime?.waitUntil(fastPath);
  } catch { /* not on the edge runtime — fall through */ }
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
    // Type-only cast: Uint8Array<ArrayBufferLike> vs BlobPart lib mismatch.
    fd.append("file", new Blob([bytes as unknown as BlobPart], { type: mime }), `voice.${mimeExt(mime)}`);
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
    } else if (field === "calls") {
      // WhatsApp Business Calling. This number is on the Cloud API, so there is
      // no WhatsApp app ringing anywhere — an unanswered call just terminates.
      // We don't answer calls (no WebRTC/SIP backend); we surface them so a
      // human can call/message the customer back. One Slack ping per call event.
      const calls: any[] = Array.isArray(value?.calls) ? value.calls : [];
      const channel = slackChannelFor("whatsapp");
      for (const c of calls) {
        const from = c?.from ?? "?";
        const ev = String(c?.event ?? "").toLowerCase();        // connect | terminate
        const dir = String(c?.direction ?? "").toUpperCase();   // USER_INITIATED | BUSINESS_INITIATED
        const inbound = dir !== "BUSINESS_INITIATED";
        const dur = typeof c?.duration === "number" ? c.duration : null;
        const stat = c?.status ?? null;

        await logConnector({
          connector: "whatsapp",
          level: inbound && ev === "connect" ? "warn" : "info",
          event: `call_${ev || "event"}`,
          message: `WhatsApp call ${ev || "event"} ${inbound ? "from" : "to"} ${from}` +
            (dur != null ? ` (${dur}s)` : "") + (stat ? ` · ${stat}` : ""),
          detail: c,
        });

        // Only ping Slack for an inbound ring — outbound + terminate are noise.
        if (inbound && ev === "connect" && channel) {
          await postSlack(
            channel,
            `:telephone_receiver: *Incoming WhatsApp call* from \`${from}\`\n` +
            `No app is connected to answer it (number is on the Cloud API), so the call won't ring anywhere — ` +
            `*call or message them back* from the dashboard. ` +
            `<https://wa.me/${String(from).replace(/[^0-9]/g, "")}|Open chat>`,
          ).catch(() => {});
        }
      }
      if (calls.length === 0) {
        // permission grants / unknown call sub-shapes — log raw so nothing is lost
        await logConnector({
          connector: "whatsapp",
          level: "info",
          event: "call_field",
          message: `WhatsApp 'calls' webhook (no calls[] array): ${JSON.stringify(value ?? {}).slice(0, 220)}`,
          detail: value,
        });
      }
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
