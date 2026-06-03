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
  const tracking: string = resolveTrackingUrl(f, order);

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

  // Both templates carry a dynamic URL button: base https://promunch.in/{{1}}.
  // We fill {{1}} with a path suffix that gets appended to that base.
  const recoverPath = recoverUrl.replace(/^https?:\/\/[^/]+/, "") || "/cart";

  // Step 1 (reminder, NO coupon): {{1}} is the bare recovery-checkout path, so
  // tapping "Complete Order" drops the customer straight back on their cart —
  // full price, no discount given away yet. Strip the leading slash to avoid a
  // double slash against the template's base URL.
  const reminderSuffix = recoverPath.replace(/^\//, "");
  const reminderComponents = [
    { type: "body", parameters: [{ type: "text", text: name }] },
    { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: reminderSuffix }] },
  ];

  // Steps 2 & 3 (recovery, WITH coupon): {{1}} is a Shopify discount link —
  // /discount/<code>?redirect=<recovery checkout> — so tapping it applies the
  // coupon AND drops the customer on their own cart, discount already on.
  const discountSuffix = `discount/${code}?redirect=${encodeURIComponent(recoverPath)}`;
  const discountComponents = [
    { type: "body", parameters: [{ type: "text", text: name }] },
    { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: discountSuffix }] },
  ];

  // 3-message sequence within the first 24h:
  //   +1h  reminder, no coupon (just the checkout link)
  //   +6h  10%/15% coupon — only if they haven't ordered by then
  //   +24h coupon again — final nudge
  // Each step carries its own template name in context (wa-journey-tick reads
  // context.template, falling back to the journey default). The whole sequence
  // stops early once the customer orders: orders/create flips active runs to
  // 'converted', so they never get a nudge after buying.
  const steps = [
    { h: 1,  template: "abandoned_cart_reminder", components: reminderComponents },
    { h: 6,  template: "abandoned_cart_recovery", components: discountComponents },
    { h: 24, template: "abandoned_cart_recovery", components: discountComponents },
  ];
  const rows = steps.map((s) => ({
    journey_key: "abandoned_checkout",
    wa_id: waId,
    next_action_at: new Date(Date.now() + s.h * 3600_000).toISOString(),
    context: { template: s.template, language: "en", components: s.components },
    order_ref: token,
  }));
  await sb.from("wa_journey_runs").insert(rows);
}

// --- tracking link resolution ----------------------------------------------
//
// Shopify's fulfillment.tracking_url is unreliable: for some carriers
// (Xpressbees, Shadowfax, Shree Maruti) it's just the carrier HOMEPAGE with no
// AWB — e.g. "https://www.xpressbees.com/track" — so the customer can't
// actually track anything. We saw exactly that go out for orders #2053/#2054.
//
// Strategy, best → safe fallback:
//   1. Trust Shopify's URL only if it actually contains the AWB (a real deep link).
//   2. Else build a deep link ourselves from AWB + carrier, for carriers whose
//      URL format is stable and known.
//   3. Else use Shopify's order-status page — always valid, always shows the
//      live carrier + tracking number. NEVER send a bare carrier homepage.
//   4. Last resort: the site. (order_status_url is almost always present.)
function resolveTrackingUrl(f: any, order: any): string {
  const awb = String(f?.tracking_number ?? f?.tracking_numbers?.[0] ?? "").trim();
  const company = String(f?.tracking_company ?? "");
  const rawUrl = String(f?.tracking_url ?? f?.tracking_urls?.[0] ?? "").trim();

  // 1. Shopify's URL already carries the AWB → it's a genuine deep link.
  if (awb && rawUrl && rawUrl.includes(awb)) return rawUrl;
  // 2. Build a known-carrier deep link from the AWB.
  if (awb) {
    const built = carrierTrackingUrl(company, awb);
    if (built) return built;
  }
  // 3. Bare homepage / no AWB → Shopify's order status page (always valid).
  const statusUrl = String(order?.order_status_url ?? "").trim();
  if (statusUrl) return statusUrl;
  // 4. Last resort.
  return rawUrl || SITE_URL;
}

// Deep-link templates for carriers whose format is stable. Conservative on
// purpose: an unknown carrier returns "" so the caller falls back to the
// Shopify order-status page rather than to a guessed (possibly broken) URL.
function carrierTrackingUrl(company: string, awb: string): string {
  const c = company.toLowerCase();
  const id = encodeURIComponent(awb);
  if (c.includes("delhivery")) return `https://www.delhivery.com/track/package/${id}`;
  if (c.includes("xpressbee")) return `https://www.xpressbees.com/shipment/tracking?awbNo=${id}`;
  if (c.includes("bluedart") || c.includes("blue dart")) return `https://www.bluedart.com/web/guest/trackdartresult?trackFor=0&trackNo=${id}`;
  if (c.includes("amazon")) return `https://track.amazon.com/tracking/${id}`;
  if (c.includes("ekart")) return `https://ekartlogistics.com/shipmenttrack/${id}`;
  return "";
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
