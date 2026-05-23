// Shopify order webhook receiver.
//
// Handles every `orders/*` topic on one endpoint:
//   - orders/create  → persist the order, post a Slack card.
//   - orders/updated, orders/fulfilled, orders/paid, orders/cancelled, …
//                    → refresh the shopify_orders row only (no Slack card).
//
// Why the refresh path matters: the WhatsApp AI agent answers "where's my
// order?" from shopify_orders (via _shared/orders.ts). If the table only ever
// saw orders/create, fulfillment + tracking + payment status would go stale
// and the bot would quote wrong info. orders/updated fires on every order
// change, so mirroring it keeps the bot's answers current.
//
// Subscribe these topics in Shopify admin → Settings → Notifications →
// Webhooks (or via the Admin API) all pointed at this same URL.

import { db } from "../_shared/supabase.ts";
import { buildOrderBlocks, fmtMoney, postSlack, verifyShopifyHmac } from "../_shared/shopify.ts";
import { logConnector } from "../_shared/connector-log.ts";
import { toWaId } from "../_shared/journeys.ts";
import { handleOrderCreated } from "../_shared/order-confirmation.ts";

const ok = (extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ ok: true, ...extra }), { headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });

  const raw = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  const secret = Deno.env.get("SHOPIFY_WEBHOOK_SECRET");
  if (!secret) return new Response("server-misconfig", { status: 500 });

  if (!(await verifyShopifyHmac(raw, hmac, secret))) {
    return new Response("bad-hmac", { status: 401 });
  }

  // Shopify always sends the topic; default to orders/create for back-compat.
  const topic = (req.headers.get("x-shopify-topic") || "orders/create").toLowerCase();
  // Only order-shaped payloads belong in shopify_orders. fulfillments/* etc.
  // carry a different shape — ignore them (orders/updated covers those changes).
  if (!topic.startsWith("orders/")) return ok({ ignored: topic });

  let order: any;
  try { order = JSON.parse(raw); } catch { return new Response("bad-json", { status: 400 }); }

  const orderNumber = order.name || `#${order.order_number}`;
  const totalPrice = Number(order.total_price ?? order.current_total_price ?? 0);
  const subtotal = Number(order.subtotal_price ?? 0);
  const currency = order.currency || "INR";
  const customerEmail = order.email || order.customer?.email || null;
  const customerName = [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(" ") || null;
  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
  const shopifyCreatedAt = order.created_at || new Date().toISOString();
  // normalised wa_id so the WhatsApp agent can match this order to a chat
  const customerPhone = toWaId(
    order.customer?.phone ?? order.phone ??
    order.shipping_address?.phone ?? order.billing_address?.phone,
  );

  const { data: upserted, error } = await db().from("shopify_orders").upsert({
    shopify_id: order.id,
    order_number: orderNumber,
    total_price: totalPrice,
    subtotal_price: subtotal,
    currency,
    financial_status: order.financial_status ?? null,
    customer_email: customerEmail,
    customer_name: customerName,
    customer_phone: customerPhone,
    line_items: lineItems,
    shopify_created_at: shopifyCreatedAt,
    raw: order,
  }, { onConflict: "shopify_id" }).select("id").maybeSingle();

  if (error) {
    console.error("db upsert failed", error);
    return new Response("db-error", { status: 500 });
  }

  // Status-change events: the row is now refreshed (fulfillment, tracking,
  // payment status) so the WhatsApp bot quotes current info. No Slack card —
  // a card is for new orders only, not every edit.
  if (topic !== "orders/create") {
    await logConnector({
      connector: "shopify_slack",
      level: "info",
      event: "order_refreshed",
      message: `Refreshed ${orderNumber} from ${topic} ` +
        `(payment: ${order.financial_status ?? "—"}, fulfillment: ${order.fulfillment_status ?? "unfulfilled"}).`,
      ref: orderNumber,
    });
    return ok({ refreshed: true, topic });
  }

  // ===== WhatsApp order confirmation =====
  // shopify-webhook is the single proven-reliable Shopify entry point, so we
  // fire the WhatsApp flow from here too — independent of shopify-wa's own
  // (less reliable) Shopify subscription. The shared handler is idempotent:
  // it dedups against wa_messages, so calling it from multiple trigger paths
  // never produces a duplicate message. If this errors, the wa-confirmation-
  // sweep cron will pick the order up within ~1 minute.
  try {
    await handleOrderCreated(order);
  } catch (e) {
    console.error("[shopify-webhook] handleOrderCreated failed", e);
    await logConnector({
      connector: "shopify_wa", level: "error", event: "handler_failed",
      message: `Order ${orderNumber}: confirmation handler errored — ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`,
      ref: orderNumber,
    }).catch(() => {});
  }

  // Prior order count for this customer (excluding the one we just inserted).
  let priorOrders = 0;
  if (customerEmail) {
    const { count } = await db().from("shopify_orders")
      .select("id", { count: "exact", head: true })
      .eq("customer_email", customerEmail)
      .neq("shopify_id", order.id);
    priorOrders = count ?? 0;
  }

  const threshold = Number(Deno.env.get("SHOPIFY_BIG_ORDER_THRESHOLD") ?? "5000");
  const isBig = totalPrice >= threshold;

  const channel = Deno.env.get("SHOPIFY_SLACK_CHANNEL_ID");
  const bigChannel = Deno.env.get("SHOPIFY_SLACK_BIG_ORDER_CHANNEL_ID");

  const blocks = buildOrderBlocks({
    order_number: orderNumber,
    total_price: totalPrice,
    currency,
    customer_name: customerName,
    customer_email: customerEmail,
    line_items: lineItems,
    financial_status: order.financial_status,
    prior_orders: priorOrders,
    big_order: isBig,
  });

  if (channel) {
    try {
      const ts = await postSlack(channel, blocks, `New order ${orderNumber}`);
      if (upserted?.id) await db().from("shopify_orders").update({ slack_thread_ts: ts }).eq("id", upserted.id);
      await logConnector({
        connector: "shopify_slack",
        level: "info",
        event: "post_ok",
        message: `Posted order ${orderNumber} to Slack (${fmtMoney(totalPrice, currency)}).`,
        ref: orderNumber,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("slack post failed", e);
      await logConnector({
        connector: "shopify_slack",
        level: "error",
        event: "post_failed",
        message: `Failed to post order ${orderNumber} to Slack: ${msg.slice(0, 300)}`,
        detail: { order_number: orderNumber },
        ref: orderNumber,
      });
    }
  } else {
    await logConnector({
      connector: "shopify_slack",
      level: "error",
      event: "not_configured",
      message: "Order received but SHOPIFY_SLACK_CHANNEL_ID is not set — nothing posted to Slack.",
      ref: orderNumber,
    });
  }
  if (isBig && bigChannel && bigChannel !== channel) {
    try { await postSlack(bigChannel, blocks, `Big order ${orderNumber} ${fmtMoney(totalPrice, currency)}`); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("slack big-order post failed", e);
      await logConnector({
        connector: "shopify_slack",
        level: "error",
        event: "post_failed",
        message: `Failed to post big order ${orderNumber} to the big-order channel: ${msg.slice(0, 300)}`,
        ref: orderNumber,
      });
    }
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
});
