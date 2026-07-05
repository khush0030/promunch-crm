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
import { getFlowSettings } from "../_shared/flow-settings.ts";
import { handleOrderCreated } from "../_shared/order-confirmation.ts";
import { claimSend, markSendSent, releaseSend } from "../_shared/confirmations.ts";
import { enrolCustomFlows } from "../_shared/custom-flows.ts";

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

  // User-created flows on this trigger (own atomic claim per flow+order;
  // independent of the built-in shipping-update toggle).
  await enrolCustomFlows("order_fulfilled", { waId, name, entityRef: orderRef })
    .catch((e) => console.warn("[shopify-wa] custom enrol (fulfilled):", e));

  // Dashboard kill-switch (Flows tab).
  if (!(await getFlowSettings()).shipping_update_enabled) return;

  const f = Array.isArray(order.fulfillments) ? order.fulfillments[0] : null;
  const tracking: string = resolveTrackingUrl(f, order);

  // NO-SPAM: exactly one shipping update per fulfillment. Shopify re-delivers
  // orders/fulfilled on retries / order edits, and we always return 200, so
  // without this guard the customer gets "your order shipped!" several times.
  // Key on the fulfillment id (falls back to tracking number) so a genuine
  // SECOND shipment — a different fulfillment — still gets its own update.
  const fid = String(f?.id ?? f?.tracking_number ?? f?.tracking_numbers?.[0] ?? "x");
  const claimKey = `shipping_update:${orderRef}:${fid}`;
  if (!(await claimSend(claimKey))) {
    await logConnector({
      connector: "shopify_wa", level: "info", event: "shipping_skipped_dup",
      message: `Order ${orderRef}: shipping update for fulfillment ${fid} already sent — not re-sending.`,
      ref: orderRef,
    }).catch(() => {});
    return;
  }

  const res = await callWaSend({
    to: waId,
    kind: "template",
    template: { name: "shipping_update", language: "en", vars: { "1": name, "2": orderRef, "3": tracking } },
    sent_by: "journey:shipping_update",
  });
  // Lock the claim on success; release on failure so a webhook re-delivery can retry.
  if (res?.ok) await markSendSent(claimKey); else await releaseSend(claimKey);
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

// Pull the checkout partner's recovery URL out of the order note. The partner
// writes it into `note` (free text); we also scan `note_attributes` values as a
// safety net in case it ever moves there. Returns the first http(s) URL found,
// or null if the note has none.
function noteCheckoutUrl(checkout: any): string | null {
  const URL_RE = /https?:\/\/\S+/;
  const note = String(checkout?.note ?? "");
  const m = note.match(URL_RE);
  if (m) return m[0];
  const attrs = Array.isArray(checkout?.note_attributes) ? checkout.note_attributes : [];
  for (const a of attrs) {
    const mm = String(a?.value ?? "").match(URL_RE);
    if (mm) return mm[0];
  }
  return null;
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

  // Dashboard settings (Flows tab): kill-switch + step delays + deadline + coupon.
  const flows = await getFlowSettings();

  const name = firstName(checkout.customer?.first_name, checkout.shipping_address?.first_name);
  // The third-party checkout partner (sales channel SMB-1CCO) skips the native
  // Shopify checkout, so `abandoned_checkout_url` points at a cart the customer
  // can't actually complete. The partner instead drops its OWN recovery URL into
  // the order note — a /cart/?atomsSt=<token>&bzCartRec=true link. Always prefer
  // that note URL; the token rehydrates the partner cart on tap. Only fall back
  // to Shopify's native URL (then /cart) when the note carries no link.
  const noteUrl = noteCheckoutUrl(checkout);
  const recoverUrl: string = noteUrl || checkout.abandoned_checkout_url || `${SITE_URL}/cart`;

  // User-created flows on this trigger (own atomic claim per flow+checkout;
  // independent of the built-in cart flow's toggle and enrol gate).
  await enrolCustomFlows("checkout_abandoned", { waId, name, entityRef: token, checkoutUrl: recoverUrl })
    .catch((e) => console.warn("[shopify-wa] custom enrol (checkout):", e));

  if (!flows.abandoned_cart_enabled) return;

  // ATOMIC gate — two checkouts/create+update webhooks for the same token could
  // both pass the select-based dedup below and enrol the 3-step sequence twice
  // (6 abandoned-cart messages). claimSend makes enrolment happen exactly once.
  const enrolKey = `abandoned_enrol:${token}`;
  if (!(await claimSend(enrolKey))) return;
  // secondary guard — already enrolled before this gate existed? lock and stop.
  const { data: prior } = await sb.from("wa_journey_runs").select("id").eq("order_ref", token).limit(1);
  if (prior && prior.length) { await markSendSent(enrolKey); return; }

  await logConnector({
    connector: "shopify_wa", level: "info", event: "abandoned_recover_url",
    message: `Cart ${token}: recovery link from ${noteUrl ? "note" : (checkout.abandoned_checkout_url ? "shopify_url" : "fallback")}.`,
    ref: token,
  }).catch(() => {});
  // Coupon comes from the dashboard (Flows tab); defaults to PROMUNCH10 (10%
  // off on orders ₹399+, the only live code — PROTEIN15 discontinued 2026-06).
  const code = (flows.cart_coupon_code || "PROMUNCH10").trim();

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

  // Step 2 (recovery, WITH coupon): {{1}} is a Shopify discount link —
  // /discount/<code>?redirect=<recovery checkout> — so tapping it applies the
  // coupon AND drops the customer on their own cart, discount already on.
  const discountSuffix = `discount/${code}?redirect=${encodeURIComponent(recoverPath)}`;
  const discountComponents = [
    { type: "body", parameters: [{ type: "text", text: name }] },
    { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: discountSuffix }] },
  ];

  // 2-message sequence within the first 6h — NO duplicate sends:
  //   +1h  reminder, no coupon (just the checkout link)
  //   +6h  PROMUNCH10 coupon — only if they haven't ordered by then
  // We used to fire a THIRD touch at +24h that re-sent the SAME recovery
  // template verbatim. Two identical "special discount" messages read as spam
  // and break the no-double-message invariant, so that step was removed.
  // Each step carries its own template name in context (wa-journey-tick reads
  // context.template, falling back to the journey default). The whole sequence
  // stops early once the customer orders: orders/create flips active runs to
  // 'converted', so they never get a nudge after buying.
  // Full tappable URLs for the cap-immune FREE-TEXT recovery path (wa-journey-tick
  // delivers these when the customer's 24h window is open, dodging #131049). The
  // template path uses the path-suffix components above; the free-text path needs
  // the whole https URL. vars["1"]=name, vars["2"]=link, matching callProactiveAsk.
  const reminderUrl = recoverUrl;
  const discountUrl = `${SITE_URL}/${discountSuffix}`;

  // All cart runs share one retry deadline: keep trying (free text in-window, or
  // spaced template) until ONE message is delivered or this passes (see migration
  // 20260627160000). Measured from enrolment so both steps expire together.
  const deadlineAt = new Date(Date.now() + flows.cart_deadline_hours * 3600_000).toISOString();

  // Delays measured from abandonment (dashboard-configurable; defaults +1h / +6h).
  const steps = [
    { h: flows.cart_step1_delay_hours, template: "abandoned_cart_reminder", components: reminderComponents, url: reminderUrl },
    { h: flows.cart_step2_delay_hours, template: "abandoned_cart_recovery", components: discountComponents, url: discountUrl },
  ];
  const rows = steps.map((s) => ({
    journey_key: "abandoned_checkout",
    wa_id: waId,
    next_action_at: new Date(Date.now() + s.h * 3600_000).toISOString(),
    deadline_at: deadlineAt,
    context: { template: s.template, language: "en", components: s.components, vars: { "1": name, "2": s.url } },
    order_ref: token,
  }));
  await sb.from("wa_journey_runs").insert(rows);
  await markSendSent(enrolKey); // lock — never re-enrol this cart
}

// --- tracking link resolution ----------------------------------------------
//
// We have NO trusted carrier tracking feed yet (Shree Maruti API integration is
// still pending). Shopify's fulfillment.tracking_url and guessed carrier deep
// links both proved unreliable: for some carriers the URL is just the carrier
// HOMEPAGE with no AWB, and a constructed Amazon link
// (track.amazon.com/tracking/<awb>) went out for order #2056 and did not
// resolve to a real shipment.
//
// Policy until a carrier API is wired up: ALWAYS send the Shopify order-status
// page. It is always valid and automatically surfaces the live carrier + AWB
// once the courier scans the parcel — so the customer can always track, and we
// never ship a broken or guessed link again.
function resolveTrackingUrl(_f: any, order: any): string {
  const statusUrl = String(order?.order_status_url ?? "").trim();
  return statusUrl || SITE_URL;
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
