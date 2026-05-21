// Shopify -> WhatsApp webhook.
//
// A SEPARATE webhook from shopify-webhook (which posts orders to Slack) — this
// one drives the WhatsApp customer journeys. Subscribe these Shopify topics to
// this function's URL:
//   orders/create     -> send order confirmation + enrol review/replenishment
//   orders/fulfilled  -> send shipping update
//   checkouts/create  -> enrol abandoned-checkout reminder
//
// Order confirmations are treated as utility messages (sent to anyone who gave
// a phone at checkout). Marketing-category journeys carry an opt-out footer.

import { db } from "../_shared/supabase.ts";
import { verifyShopifyHmac } from "../_shared/shopify.ts";
import { logConnector } from "../_shared/connector-log.ts";
import { REVIEW_URL, SITE_URL, TIMED_JOURNEYS, firstName, toWaId } from "../_shared/journeys.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });

  const raw = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  const secret = Deno.env.get("SHOPIFY_WEBHOOK_SECRET");
  if (!secret) return new Response("server-misconfig", { status: 500 });
  if (!(await verifyShopifyHmac(raw, hmac, secret))) {
    return new Response("bad-hmac", { status: 401 });
  }

  const topic = req.headers.get("x-shopify-topic") ?? "";
  let payload: any;
  try { payload = JSON.parse(raw); } catch { return new Response("bad-json", { status: 400 }); }

  try {
    if (topic === "orders/create") await handleOrderCreate(payload);
    else if (topic === "orders/fulfilled") await handleOrderFulfilled(payload);
    else if (topic === "checkouts/create") await handleCheckoutCreate(payload);
    // other topics (orders/updated, checkouts/update, …) are acknowledged, no-op
  } catch (e) {
    console.error("[shopify-wa]", topic, e);
    await logConnector({
      connector: "shopify_wa",
      level: "error",
      event: "handler_failed",
      message: `${topic} handler failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`,
    }).catch(() => {});
    // still 200 — Shopify retries non-2xx aggressively
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
});

// --- orders/create: confirmation + post-purchase enrolment -------------------
async function handleOrderCreate(order: any) {
  const sb = db();
  const orderRef: string = order.name || `#${order.order_number}` || String(order.id);

  // idempotency — if we've already processed this order, stop
  const { data: prior } = await sb.from("wa_journey_runs").select("id").eq("order_ref", orderRef).limit(1);
  if (prior && prior.length) return;

  const waId = toWaId(
    order.customer?.phone ?? order.phone ?? order.shipping_address?.phone ?? order.billing_address?.phone,
  );
  if (!waId) {
    await logConnector({
      connector: "shopify_wa", level: "info", event: "no_phone",
      message: `Order ${orderRef}: no usable phone — WhatsApp messages skipped.`, ref: orderRef,
    });
    return;
  }

  const name = firstName(order.customer?.first_name, order.shipping_address?.first_name, order.billing_address?.first_name);
  const total = String(order.total_price ?? order.current_total_price ?? "");

  // 1. immediate order confirmation (utility)
  const res = await callWaSend({
    to: waId,
    kind: "template",
    template: { name: "order_confirmation", language: "en", vars: { "1": name, "2": orderRef, "3": total } },
    sent_by: "journey:order_confirmation",
  });
  await logConnector({
    connector: "shopify_wa",
    level: res?.ok ? "info" : "error",
    event: res?.ok ? "confirmation_sent" : "confirmation_failed",
    message: res?.ok
      ? `Order ${orderRef}: WhatsApp confirmation sent to ${waId}.`
      : `Order ${orderRef}: confirmation failed — ${res?.error ?? "unknown"}.`,
    ref: orderRef,
  }).catch(() => {});

  // 2. cancel any open abandoned-checkout reminder — they converted
  await sb.from("wa_journey_runs")
    .update({ status: "converted" })
    .eq("wa_id", waId).eq("journey_key", "abandoned_checkout").eq("status", "active");

  // 3. enrol the timed post-purchase journeys
  await enrol("review_request", waId, orderRef, { "1": name, "2": REVIEW_URL });
  await enrol("replenishment_reminder", waId, orderRef, { "1": name, "2": SITE_URL });
}

// --- orders/fulfilled: shipping update --------------------------------------
async function handleOrderFulfilled(order: any) {
  const orderRef: string = order.name || `#${order.order_number}` || String(order.id);
  const waId = toWaId(
    order.customer?.phone ?? order.phone ?? order.shipping_address?.phone ?? order.billing_address?.phone,
  );
  if (!waId) return;

  const name = firstName(order.customer?.first_name, order.shipping_address?.first_name);
  const f = Array.isArray(order.fulfillments) ? order.fulfillments[0] : null;
  const tracking: string =
    f?.tracking_url || f?.tracking_urls?.[0] || order.order_status_url || SITE_URL;

  const res = await callWaSend({
    to: waId,
    kind: "template",
    template: { name: "shipping_update", language: "en", vars: { "1": name, "2": orderRef, "3": tracking } },
    sent_by: "journey:shipping_update",
  });
  await logConnector({
    connector: "shopify_wa",
    level: res?.ok ? "info" : "error",
    event: res?.ok ? "shipping_sent" : "shipping_failed",
    message: res?.ok
      ? `Order ${orderRef}: WhatsApp shipping update sent.`
      : `Order ${orderRef}: shipping update failed — ${res?.error ?? "unknown"}.`,
    ref: orderRef,
  }).catch(() => {});
}

// --- checkouts/create: abandoned-checkout enrolment -------------------------
async function handleCheckoutCreate(checkout: any) {
  const sb = db();
  const token: string = String(checkout.token ?? checkout.id ?? "");
  if (!token) return;

  const waId = toWaId(
    checkout.phone ?? checkout.customer?.phone ?? checkout.shipping_address?.phone ?? checkout.billing_address?.phone,
  );
  if (!waId) return;

  // dedupe on the checkout token
  const { data: prior } = await sb.from("wa_journey_runs").select("id").eq("order_ref", token).limit(1);
  if (prior && prior.length) return;

  const name = firstName(checkout.customer?.first_name, checkout.shipping_address?.first_name);
  const url: string = checkout.abandoned_checkout_url || `${SITE_URL}/cart`;
  await enrol("abandoned_checkout", waId, token, { "1": name, "2": url });
}

// --- helpers ----------------------------------------------------------------

// Queue a timed journey message in wa_journey_runs.
async function enrol(journeyKey: string, waId: string, orderRef: string, vars: Record<string, string>) {
  const cfg = TIMED_JOURNEYS[journeyKey];
  if (!cfg) return;
  const due = new Date(Date.now() + cfg.delayHours * 3600_000).toISOString();
  await db().from("wa_journey_runs").insert({
    journey_key: journeyKey,
    wa_id: waId,
    next_action_at: due,
    context: { vars },
    order_ref: orderRef,
  });
}

// Send via the wa-send edge function (records the message + thread).
async function callWaSend(body: unknown): Promise<{ ok?: boolean; error?: string } | null> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-send`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
