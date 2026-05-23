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
import { SITE_URL, firstName, toWaId } from "../_shared/journeys.ts";
import { handleOrderCreated } from "../_shared/order-confirmation.ts";

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
    if (topic === "orders/create") await handleOrderCreated(payload);
    else if (topic === "orders/fulfilled") await handleOrderFulfilled(payload);
    else if (topic === "orders/cancelled") await handleOrderCancelled(payload);
    else if (topic === "checkouts/create" || topic === "checkouts/update") await handleCheckout(payload);
    // other topics (orders/updated, …) are acknowledged, no-op
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

// orders/create is delegated to the shared handleOrderCreated — see
// _shared/order-confirmation.ts. shopify-webhook (the proven-reliable
// Shopify entry point) also calls it, so the confirmation goes out no
// matter which Shopify subscription delivers first.

// --- orders/fulfilled: shipping update --------------------------------------
async function handleOrderFulfilled(order: any) {
  const orderRef: string = order.name || `#${order.order_number}` || String(order.id);
  // Don't send a shipping update for an order that was cancelled.
  if (!orderIsActive(order)) return;
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

// --- orders/cancelled: stop pending post-purchase journeys ------------------
async function handleOrderCancelled(order: any) {
  const sb = db();
  const orderRef: string = order.name || `#${order.order_number}` || String(order.id);

  // Cancel any review-request / replenishment runs still queued for this
  // order so we never message "hope you're loving your snacks" about an
  // order that no longer exists.
  const { data: stopped } = await sb.from("wa_journey_runs")
    .update({ status: "cancelled", last_error: "order cancelled" })
    .eq("order_ref", orderRef).eq("status", "active")
    .select("id");

  await logConnector({
    connector: "shopify_wa", level: "info", event: "order_cancelled",
    message: `Order ${orderRef} cancelled — stopped ${stopped?.length ?? 0} pending journey message(s).`,
    ref: orderRef,
  }).catch(() => {});
}

// --- checkouts/create + checkouts/update: abandoned-checkout enrolment ------
// Routed for both topics. The per-token dedup means a cart enrols exactly
// once — the first time a usable phone number appears on it (often only on
// a later checkouts/update, not at creation).
async function handleCheckout(checkout: any) {
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
  const recoverUrl: string = checkout.abandoned_checkout_url || `${SITE_URL}/cart`;
  const cartValue = Number(checkout.total_price ?? checkout.total_line_items_price ?? 0);
  // coupon routing by cart value (per the knowledge base) — real Shopify codes
  const code = cartValue >= 499 ? "PROTEIN15" : "PROMUNCH10";

  // The template's "Checkout Now" button is a dynamic URL: base
  // https://promunch.in/{{1}}. We fill {{1}} with a Shopify discount link —
  // /discount/<code>?redirect=<recovery checkout> — so tapping it applies the
  // coupon AND drops the customer on their own cart, discount already on.
  const recoverPath = recoverUrl.replace(/^https?:\/\/[^/]+/, "") || "/cart";
  const buttonSuffix = `discount/${code}?redirect=${encodeURIComponent(recoverPath)}`;

  // body has one variable (name); the link lives entirely in the URL button.
  const components = [
    { type: "body", parameters: [{ type: "text", text: name }] },
    { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: buttonSuffix }] },
  ];

  // a 3-message recovery sequence — all within the first 24h (1h / 6h / 24h)
  // so an unconverted cart is nudged 3 times in a day. Each reminder stops
  // early once the customer orders: orders/create flips active runs to
  // 'converted', so they never get a nudge after buying.
  const rows = [1, 6, 24].map((h) => ({
    journey_key: "abandoned_checkout",
    wa_id: waId,
    next_action_at: new Date(Date.now() + h * 3600_000).toISOString(),
    context: { components },
    order_ref: token,
  }));
  await sb.from("wa_journey_runs").insert(rows);
}

// --- helpers ----------------------------------------------------------------

// An order is "active" (worth messaging the customer about) when it is not
// cancelled and not voided/refunded.
function orderIsActive(order: any): boolean {
  if (order?.cancelled_at) return false;
  const fin = String(order?.financial_status ?? "").toLowerCase();
  return fin !== "voided" && fin !== "refunded";
}
function orderState(order: any): string {
  if (order?.cancelled_at) return "cancelled";
  const fin = String(order?.financial_status ?? "").toLowerCase();
  return fin === "voided" || fin === "refunded" ? fin : "active";
}

// Send via the wa-send edge function, retrying transient failures.
//
// This webhook always returns 200 (Shopify retries non-2xx aggressively), so
// Shopify never re-delivers on our behalf — a failed send here is final.
// A missed order confirmation is worse than a rare duplicate attempt, so we
// retry 3x with short backoff. ok:false means Meta did NOT accept the message,
// so a retry sends nothing twice; the wa-confirmation-sweep cron is the final
// backstop for anything that still fails all 3 tries.
async function callWaSend(body: unknown): Promise<{ ok?: boolean; error?: string } | null> {
  let last: { ok?: boolean; error?: string } | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    last = await callWaSendOnce(body);
    if (last?.ok) return last;
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 750));
  }
  return last;
}

async function callWaSendOnce(body: unknown): Promise<{ ok?: boolean; error?: string } | null> {
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
