// Shopify orders/create webhook receiver.
// Verifies HMAC, persists order, posts a card to Slack.

import { db } from "../_shared/supabase.ts";
import { buildOrderBlocks, fmtMoney, postSlack, verifyShopifyHmac } from "../_shared/shopify.ts";
import { logConnector } from "../_shared/connector-log.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });

  const raw = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  const secret = Deno.env.get("SHOPIFY_WEBHOOK_SECRET");
  if (!secret) return new Response("server-misconfig", { status: 500 });

  if (!(await verifyShopifyHmac(raw, hmac, secret))) {
    return new Response("bad-hmac", { status: 401 });
  }

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

  const { data: upserted, error } = await db().from("shopify_orders").upsert({
    shopify_id: order.id,
    order_number: orderNumber,
    total_price: totalPrice,
    subtotal_price: subtotal,
    currency,
    financial_status: order.financial_status ?? null,
    customer_email: customerEmail,
    customer_name: customerName,
    line_items: lineItems,
    shopify_created_at: shopifyCreatedAt,
    raw: order,
  }, { onConflict: "shopify_id" }).select("id").maybeSingle();

  if (error) {
    console.error("db upsert failed", error);
    return new Response("db-error", { status: 500 });
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
