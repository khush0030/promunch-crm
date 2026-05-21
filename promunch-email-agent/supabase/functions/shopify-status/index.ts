// Shopify webhook for order lifecycle events.
// Handles orders/fulfilled, orders/cancelled, refunds/create.
// Updates DB and posts a threaded reply on the original order's Slack message.

import { db } from "../_shared/supabase.ts";
import { fmtMoney, postSlack, verifyShopifyHmac } from "../_shared/shopify.ts";
import { logConnector } from "../_shared/connector-log.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });

  const raw = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  const topic = req.headers.get("x-shopify-topic") || "";
  const secret = Deno.env.get("SHOPIFY_WEBHOOK_SECRET");
  if (!secret) return new Response("server-misconfig", { status: 500 });
  if (!(await verifyShopifyHmac(raw, hmac, secret))) return new Response("bad-hmac", { status: 401 });

  let payload: any;
  try { payload = JSON.parse(raw); } catch { return new Response("bad-json", { status: 400 }); }

  // refunds/create payload has order_id; orders events have id directly.
  const orderId = payload.order_id ?? payload.id;
  if (!orderId) return new Response("no-order-id", { status: 200 });

  const { data: row } = await db().from("shopify_orders")
    .select("id, order_number, total_price, currency, slack_thread_ts, refunded_amount")
    .eq("shopify_id", orderId).maybeSingle();

  if (!row) {
    // order not yet in DB — store minimal stub later via orders/create; ack and move on
    return new Response(JSON.stringify({ ok: true, skipped: "order-not-found" }), { status: 200 });
  }

  let threadText = "";
  const update: Record<string, unknown> = {};

  if (topic === "orders/fulfilled") {
    update.fulfillment_status = "fulfilled";
    threadText = `📦 Fulfilled · ${row.order_number}`;
  } else if (topic === "orders/cancelled") {
    update.cancelled_at = payload.cancelled_at || new Date().toISOString();
    const reason = payload.cancel_reason ? ` (reason: ${payload.cancel_reason})` : "";
    threadText = `❌ Cancelled${reason} · ${row.order_number}`;
  } else if (topic === "refunds/create") {
    const refundAmt = (payload.transactions ?? []).reduce((a: number, t: any) => a + Number(t.amount ?? 0), 0);
    const newTotal = Number(row.refunded_amount) + refundAmt;
    update.refunded_amount = newTotal;
    threadText = `💸 Refunded ${fmtMoney(refundAmt, row.currency)} · ${row.order_number}`;
  } else {
    return new Response(JSON.stringify({ ok: true, ignored: topic }), { status: 200 });
  }

  await db().from("shopify_orders").update(update).eq("id", row.id);

  const channel = Deno.env.get("SHOPIFY_SLACK_CHANNEL_ID");
  if (channel && row.slack_thread_ts) {
    try {
      await postSlack(channel, [{ type: "section", text: { type: "mrkdwn", text: threadText } }], threadText, row.slack_thread_ts);
      await logConnector({
        connector: "shopify_slack",
        level: "info",
        event: "post_ok",
        message: `Posted "${topic}" update to Slack — ${row.order_number}.`,
        ref: row.order_number,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("slack thread post failed", e);
      await logConnector({
        connector: "shopify_slack",
        level: "error",
        event: "post_failed",
        message: `Failed to post "${topic}" update for ${row.order_number} to Slack: ${msg.slice(0, 300)}`,
        ref: row.order_number,
      });
    }
  }

  return new Response(JSON.stringify({ ok: true, topic }), { headers: { "content-type": "application/json" } });
});
