// Amazon SP-API poller — the data pipeline that mirrors the Shopify sync.
//
// Cron-invoked (every 15 min). Each run:
//   1. ORDERS:    pull orders updated since the watermark -> upsert amazon_orders
//                 (+ order items for genuinely new orders) -> Slack new-order alerts.
//   2. INVENTORY: refresh FBA summaries -> upsert amazon_inventory -> low-stock alerts.
//   3. FINANCES:  pull posted financial events since watermark -> upsert (deduped).
//
// Each section advances its own watermark in amazon_sync_state ONLY on success,
// so a failure in one section never loses ground or skips data.
//
// Internal Slack alerts use a durable ledger (alerted_at / low_stock_alerted_at)
// so a re-poll never double-pings — same no-duplicate discipline as the WA code.
//
// Gating: not Amazon-signed, so it relies on verify_jwt + cron. No customer
// messages are sent here, only internal Slack, so token gating isn't critical,
// but config.toml sets verify_jwt=false for the cron caller.

import { db } from "../_shared/supabase.ts";
import {
  getOrders, getOrderItems, getInventorySummaries, listFinancialEvents,
  shipmentEconomics, getReports, fetchReportText, parseTSV, SETTLEMENT_REPORT_TYPE,
  num, MARKETPLACE_ID, type AmazonOrder,
} from "../_shared/amazon.ts";
import { fmtMoney, postSlack } from "../_shared/shopify.ts";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

// Channel routing. Order/inventory alerts (high-volume, operational) and finance
// alerts (low-volume, high-importance) can go to separate channels. Each falls
// back to a single AMAZON_SLACK_CHANNEL_ID, then to the Shopify orders channel.
const ordersChannel = () =>
  Deno.env.get("AMAZON_ORDERS_SLACK_CHANNEL_ID") ?? Deno.env.get("AMAZON_SLACK_CHANNEL_ID") ?? Deno.env.get("SHOPIFY_SLACK_CHANNEL_ID");
const financeChannel = () =>
  Deno.env.get("AMAZON_FINANCE_SLACK_CHANNEL_ID") ?? Deno.env.get("AMAZON_SLACK_CHANNEL_ID") ?? Deno.env.get("SHOPIFY_SLACK_CHANNEL_ID");
const LOW_STOCK_THRESHOLD = Number(Deno.env.get("AMAZON_LOW_STOCK_THRESHOLD") ?? "10");
// Only Slack-alert orders placed within this window — stops first-backfill spam.
const ALERT_MAX_AGE_HOURS = Number(Deno.env.get("AMAZON_ALERT_MAX_AGE_HOURS") ?? "12");

// Settlement reports use "DD.MM.YYYY HH:MM:SS UTC" — which new Date() can't parse.
// Parse it explicitly; fall back to native parsing for anything already ISO.
function parseSettlementDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
  if (m) {
    const [, dd, mo, yyyy, hh = "00", mi = "00", ss = "00"] = m;
    return new Date(Date.UTC(+yyyy, +mo - 1, +dd, +hh, +mi, +ss)).toISOString();
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const DAYS = 24 * 60 * 60_000;

async function getWatermark(key: string, fallbackDaysAgo: number): Promise<string> {
  const { data } = await db().from("amazon_sync_state").select("watermark").eq("key", key).maybeSingle();
  if (data?.watermark) return new Date(data.watermark).toISOString();
  return new Date(Date.now() - fallbackDaysAgo * DAYS).toISOString();
}

async function setWatermark(key: string, iso: string, meta?: unknown) {
  await db().from("amazon_sync_state").upsert(
    { key, watermark: iso, meta: meta ?? null, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
}

// ---- Orders ----------------------------------------------------------------
// IMPORTANT: line-items are NOT fetched here. Doing both in one invocation blows
// WORKER_RESOURCE_LIMIT on the first (wide) run. Orders upsert cheaply and the
// watermark advances immediately; items sync in a separate bounded pass below.
const ITEM_BATCH = Number(Deno.env.get("AMAZON_ITEM_BATCH") ?? "8"); // new orders to fetch items for per run

async function syncOrders(firstRunDays: number): Promise<{ upserts: number; alerts: number; items: number; error?: string }> {
  const runStart = new Date().toISOString();
  let orders: AmazonOrder[];
  try {
    const since = await getWatermark("orders", firstRunDays);
    orders = await getOrders({ since, mode: "updated" });
  } catch (e) {
    return { upserts: 0, alerts: 0, items: 0, error: `orders fetch: ${(e as Error).message}` };
  }

  let upserts = 0;
  if (orders.length) {
    const rows = orders.map((o) => ({
      amazon_order_id: o.AmazonOrderId,
      order_status: o.OrderStatus ?? null,
      purchase_date: o.PurchaseDate ?? null,
      last_update_date: o.LastUpdateDate ?? null,
      order_total: num(o.OrderTotal?.Amount),
      currency: o.OrderTotal?.CurrencyCode ?? "INR",
      fulfillment_channel: o.FulfillmentChannel ?? null,
      sales_channel: o.SalesChannel ?? null,
      number_of_items_shipped: num(o.NumberOfItemsShipped),
      number_of_items_unshipped: num(o.NumberOfItemsUnshipped),
      is_prime: !!o.IsPrime,
      ship_service_level: o.ShipmentServiceLevelCategory ?? null,
      raw: o as unknown,
      // alerted_at / items_synced omitted -> default for new rows, preserved for existing.
    }));
    const { error } = await db().from("amazon_orders").upsert(rows, { onConflict: "amazon_order_id" });
    if (error) return { upserts: 0, alerts: 0, items: 0, error: `orders upsert: ${error.message}` };
    upserts = rows.length;
  }
  // Advance the watermark NOW — orders are saved; items + alerts are best-effort.
  await setWatermark("orders", runStart, { last_count: orders.length });

  // ---- bounded line-item backfill (items_synced=false) ----
  let items = 0;
  const { data: needItems } = await db().from("amazon_orders")
    .select("amazon_order_id")
    .eq("items_synced", false)
    .order("purchase_date", { ascending: false })
    .limit(ITEM_BATCH);
  for (const o of needItems ?? []) {
    try {
      const its = await getOrderItems(o.amazon_order_id);
      if (its.length) {
        await db().from("amazon_order_items").upsert(
          its.map((it) => ({
            order_item_id: it.OrderItemId,
            amazon_order_id: o.amazon_order_id,
            seller_sku: it.SellerSKU ?? null,
            asin: it.ASIN ?? null,
            title: it.Title ?? null,
            quantity_ordered: num(it.QuantityOrdered),
            item_price: num(it.ItemPrice?.Amount),
            currency: it.ItemPrice?.CurrencyCode ?? "INR",
            raw: it as unknown,
          })),
          { onConflict: "order_item_id" },
        );
      }
      await db().from("amazon_orders").update({ items_synced: true }).eq("amazon_order_id", o.amazon_order_id);
      items++;
    } catch (_e) { /* leave items_synced=false -> retried next run */ }
  }

  // ---- new-order Slack alerts (durable dedup via alerted_at) ----
  // Freshness guard: only alert RECENT orders. Without this, the first backfill
  // would Slack-spam every historical order. Orders older than the window stay
  // alerted_at=null but are never selected, so they're silently absorbed.
  let alerts = 0;
  const ch = ordersChannel();
  const freshSince = new Date(Date.now() - ALERT_MAX_AGE_HOURS * 60 * 60_000).toISOString();
  if (ch) {
    const { data: pending } = await db().from("amazon_orders")
      .select("amazon_order_id, order_total, currency, fulfillment_channel, purchase_date")
      .is("alerted_at", null)
      .gte("purchase_date", freshSince)
      .neq("order_status", "Pending")   // wait until the order is real, not a pending auth
      .not("amazon_order_id", "ilike", "S02-%") // skip Multi-Channel Fulfillment (FBA stock shipping non-Amazon sales): ₹0 total, blank titles, not a marketplace sale
      .order("purchase_date", { ascending: true })
      .limit(25);
    for (const o of pending ?? []) {
      let its = (await db().from("amazon_order_items")
        .select("title, quantity_ordered").eq("amazon_order_id", o.amazon_order_id)).data ?? [];
      // Just-in-time: fetch/refresh items so the alert card is never "syncing…" or
      // showing stale "0 ×". Items first synced while the order was incomplete come
      // back qty 0; if the order has a real total but every cached line is 0, the
      // earlier sync was premature — refetch. Volume is low (freshness-gated), cheap.
      const cachedQtyAllZero = its.length > 0 &&
        num(o.order_total) > 0 &&
        its.every((i: any) => num(i.quantity_ordered) === 0);
      if (!its.length || cachedQtyAllZero) {
        try {
          const fresh = await getOrderItems(o.amazon_order_id);
          if (fresh.length) {
            await db().from("amazon_order_items").upsert(
              fresh.map((it) => ({
                order_item_id: it.OrderItemId,
                amazon_order_id: o.amazon_order_id,
                seller_sku: it.SellerSKU ?? null,
                asin: it.ASIN ?? null,
                title: it.Title ?? null,
                quantity_ordered: num(it.QuantityOrdered),
                item_price: num(it.ItemPrice?.Amount),
                currency: it.ItemPrice?.CurrencyCode ?? "INR",
                raw: it as unknown,
              })),
              { onConflict: "order_item_id" },
            );
            await db().from("amazon_orders").update({ items_synced: true }).eq("amazon_order_id", o.amazon_order_id);
            its = fresh.map((it) => ({ title: it.Title, quantity_ordered: num(it.QuantityOrdered) }));
          }
        } catch (_e) { /* fall back to syncing label */ }
      }
      const itemLines = (its ?? []).map((i: any) => `• ${i.quantity_ordered} × ${i.title ?? "item"}`).join("\n") || "_items syncing…_";
      const chan = o.fulfillment_channel === "AFN" ? "FBA" : "Merchant";
      const blocks = [
        { type: "header", text: { type: "plain_text", text: `📦 New Amazon order ${o.amazon_order_id}` } },
        { type: "context", elements: [{ type: "mrkdwn", text: `Amazon · ${chan}` }] },
        { type: "section", fields: [
          { type: "mrkdwn", text: `*Total*\n${fmtMoney(num(o.order_total), o.currency)}` },
          { type: "mrkdwn", text: `*Placed*\n${o.purchase_date ? new Date(o.purchase_date).toLocaleString("en-IN") : "—"}` },
        ] },
        { type: "section", text: { type: "mrkdwn", text: `*Items*\n${itemLines}` } },
      ];
      try {
        await postSlack(ch, blocks, `New Amazon order ${o.amazon_order_id}: ${fmtMoney(num(o.order_total), o.currency)}`);
        await db().from("amazon_orders").update({ alerted_at: new Date().toISOString() }).eq("amazon_order_id", o.amazon_order_id);
        alerts++;
      } catch (_e) { /* leave alerted_at null -> retried next run, never double-sent */ }
    }
  }

  return { upserts, alerts, items };
}

// ---- Inventory -------------------------------------------------------------
async function syncInventory(): Promise<{ upserts: number; alerts: number; error?: string }> {
  let summaries;
  try {
    summaries = await getInventorySummaries();
  } catch (e) {
    return { upserts: 0, alerts: 0, error: `inventory fetch: ${(e as Error).message}` };
  }

  const rows = summaries
    .filter((s) => s.sellerSku)
    .map((s) => {
      const d = s.inventoryDetails ?? {};
      return {
        seller_sku: s.sellerSku!,
        asin: s.asin ?? null,
        fnsku: s.fnSku ?? null,
        product_name: s.productName ?? null,
        total_quantity: num(s.totalQuantity),
        fulfillable_quantity: num(d.fulfillableQuantity),
        reserved_quantity: num(d.reservedQuantity?.totalReservedQuantity),
        inbound_working: num(d.inboundWorkingQuantity),
        inbound_shipped: num(d.inboundShippedQuantity),
        inbound_receiving: num(d.inboundReceivingQuantity),
        raw: s as unknown,
      };
    });

  if (rows.length) {
    const { error } = await db().from("amazon_inventory").upsert(rows, { onConflict: "seller_sku" });
    if (error) return { upserts: 0, alerts: 0, error: `inventory upsert: ${error.message}` };
  }

  // ---- low-stock alerts (dedup: alert once until it recovers above threshold) ----
  let alerts = 0;
  const ch = ordersChannel();
  if (ch) {
    // Clear the flag for anything that recovered, so it can alert again if it drops.
    await db().from("amazon_inventory")
      .update({ low_stock_alerted_at: null })
      .gt("fulfillable_quantity", LOW_STOCK_THRESHOLD)
      .not("low_stock_alerted_at", "is", null);

    const { data: low } = await db().from("amazon_inventory")
      .select("seller_sku, product_name, fulfillable_quantity")
      .lte("fulfillable_quantity", LOW_STOCK_THRESHOLD)
      .is("low_stock_alerted_at", null)
      .order("fulfillable_quantity", { ascending: true })
      .limit(50);
    if (low && low.length) {
      const lines = low.map((r: any) => `• *${r.product_name ?? r.seller_sku}* (${r.seller_sku}) — ${r.fulfillable_quantity} left`).join("\n");
      const blocks = [
        { type: "header", text: { type: "plain_text", text: `⚠️ Amazon FBA low stock (≤ ${LOW_STOCK_THRESHOLD})` } },
        { type: "section", text: { type: "mrkdwn", text: lines } },
      ];
      try {
        await postSlack(ch, blocks, `${low.length} Amazon SKU(s) low on FBA stock`);
        const now = new Date().toISOString();
        await db().from("amazon_inventory").update({ low_stock_alerted_at: now })
          .in("seller_sku", low.map((r: any) => r.seller_sku));
        alerts = low.length;
      } catch (_e) { /* retried next run */ }
    }
  }

  await setWatermark("inventory", new Date().toISOString(), { skus: rows.length });
  return { upserts: rows.length, alerts };
}

// ---- Finances --------------------------------------------------------------
// Flattens ShipmentEventList + RefundEventList into one ledger with a full fee
// breakdown (gross / promo / referral / FBA / other / net). dedup_key keeps
// re-polls idempotent. This powers the live "revenue after Amazon's margin" view.
async function syncFinances(): Promise<{ upserts: number; error?: string }> {
  const runStart = new Date().toISOString();
  let events;
  try {
    const since = await getWatermark("finances", 30);
    events = await listFinancialEvents({ since });
  } catch (e) {
    return { upserts: 0, error: `finances fetch: ${(e as Error).message}` };
  }

  const rows: any[] = [];
  const push = (list: any[] = [], type: string) => {
    for (const ev of list) {
      const orderId = ev.AmazonOrderId ?? null;
      const posted = ev.PostedDate ?? null;
      const e = shipmentEconomics(ev);
      rows.push({
        amazon_order_id: orderId,
        event_type: type,
        posted_date: posted,
        gross: e.gross,
        promo: e.promo,
        referral_fee: e.referralFee,
        fba_fee: e.fbaFee,
        other_fees: e.otherFees,
        net: e.net,
        currency: "INR",
        raw: ev,
        dedup_key: `${type}:${orderId ?? "na"}:${posted ?? "na"}`,
      });
    }
  };
  push(events.ShipmentEventList, "Shipment");
  push(events.RefundEventList, "Refund");

  let upserts = 0;
  if (rows.length) {
    const { error } = await db().from("amazon_finance_events").upsert(rows, { onConflict: "dedup_key", ignoreDuplicates: true });
    if (error) return { upserts: 0, error: `finances upsert: ${error.message}` };
    upserts = rows.length;
  }
  await setWatermark("finances", runStart, { events: rows.length });
  return { upserts };
}

// ---- Settlements + reconciliation ------------------------------------------
// Pulls the auto-generated V2 Settlement Report (bank-truth deposits), stores
// the summary + every line, then reconciles: does our computed net for the
// period equal what Amazon actually deposited? Variance => Slack alert.
//
// Bounded: ingests at most ONE new settlement report per run (they're large and
// arrive ~fortnightly) to stay under WORKER_RESOURCE_LIMIT.
async function syncSettlements(debug = false, reprocess = false): Promise<{ ingested: number; reconciled?: any; error?: string; debug?: any }> {
  let reports: any[];
  try {
    reports = await getReports(SETTLEMENT_REPORT_TYPE, { pageSize: 25 });
  } catch (e) {
    return { ingested: 0, error: `settlement list: ${(e as Error).message}` };
  }
  const done = reports.filter((r) => r.processingStatus === "DONE" && r.reportDocumentId);

  // Skip already-ingested documents (debug bypasses the guard to inspect the newest).
  const ids = done.map((r) => r.reportDocumentId);
  const { data: seen } = await db().from("amazon_report_state").select("report_document_id").in("report_document_id", ids);
  const seenSet = new Set((seen ?? []).map((r: any) => r.report_document_id));
  const next = (debug || reprocess) ? done[0] : done.find((r) => !seenSet.has(r.reportDocumentId));
  if (!next) return { ingested: 0 };

  let rowsText: string;
  try {
    rowsText = await fetchReportText(next.reportDocumentId);
  } catch (e) {
    return { ingested: 0, error: `settlement download: ${(e as Error).message}` };
  }
  const rows = parseTSV(rowsText);
  if (debug) {
    return { ingested: 0, debug: { headers: Object.keys(rows[0] ?? {}), rowCount: rows.length, sample: rows.slice(0, 4) } };
  }
  if (!rows.length) {
    await db().from("amazon_report_state").upsert({ report_document_id: next.reportDocumentId, report_type: SETTLEMENT_REPORT_TYPE });
    return { ingested: 0 };
  }

  // The summary row carries settlement-id + total-amount + dates; detail rows carry amounts.
  const summary = rows.find((r) => r["total-amount"] && r["settlement-id"]) ?? rows[0];
  const settlementId = summary["settlement-id"];
  const totalDeposit = num(summary["total-amount"]);
  const currency = summary["currency"] || "INR";
  const periodStart = parseSettlementDate(summary["settlement-start-date"]);
  const periodEnd = parseSettlementDate(summary["settlement-end-date"]);
  const depositDate = parseSettlementDate(summary["deposit-date"]);

  // Detail lines: every row carrying an amount. We DON'T require amount-type to be
  // set — reserve/balance adjustment rows (which move the deposit) can have an
  // empty amount-type, and excluding them is what leaves a reconciliation gap.
  // The summary row has amount="" so it's naturally excluded.
  const lineRows = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r["amount"] !== "")
    .map(({ r, i }) => ({
      settlement_id: settlementId,
      line_index: i,
      amazon_order_id: r["order-id"] || null,
      transaction_type: r["transaction-type"] || null,
      amount_type: r["amount-type"] || null,
      amount_description: r["amount-description"] || null,
      amount: num(r["amount"]),
      posted_date: parseSettlementDate(r["posted-date-time"] || r["posted-date"]),
    }));

  // Everything below is derived from the report's OWN lines — one source of truth.
  const lineSum = round2(lineRows.reduce((a, l) => a + l.amount, 0));
  const grossSales = round2(lineRows.filter((l) => l.amount_description === "Principal").reduce((a, l) => a + l.amount, 0));
  const feesTotal = round2(lineRows.filter((l) => l.amount_type === "ItemFees" || l.amount_type === "Commission").reduce((a, l) => a + l.amount, 0));
  const refundsTotal = round2(lineRows.filter((l) => l.transaction_type === "Refund").reduce((a, l) => a + l.amount, 0));
  // Per-description breakdown for the dashboard (Principal, Commission, FBA fees, Tax, …).
  const breakdown: Record<string, number> = {};
  for (const l of lineRows) {
    const k = l.amount_description || l.amount_type || "Other";
    breakdown[k] = round2((breakdown[k] ?? 0) + l.amount);
  }

  // Reconciliation: do the line items sum to what Amazon actually deposited?
  // (computed_net = sum of all settlement lines; deposit = bank-truth summary row.)
  const computedNet = lineSum;
  const variance = round2(computedNet - totalDeposit);
  const reconciled = Math.abs(variance) < 1; // within ₹1 = rounding noise

  await db().from("amazon_settlements").upsert({
    settlement_id: settlementId,
    currency,
    total_deposit: totalDeposit,
    period_start: periodStart,
    period_end: periodEnd,
    deposit_date: depositDate,
    line_sum: lineSum,
    computed_net: computedNet,
    gross_sales: grossSales,
    fees_total: feesTotal,
    refunds_total: refundsTotal,
    breakdown,
    variance,
    reconciled,
    recon_note: reconciled ? "matched" : `lines ${computedNet.toFixed(2)} vs deposit ${totalDeposit.toFixed(2)}`,
    raw_summary: summary,
  }, { onConflict: "settlement_id" });

  if (lineRows.length) {
    await db().from("amazon_settlement_lines").upsert(lineRows, { onConflict: "settlement_id,line_index", ignoreDuplicates: true });
  }
  await db().from("amazon_report_state").upsert({ report_document_id: next.reportDocumentId, report_type: SETTLEMENT_REPORT_TYPE });

  // Variance alert (deduped) -> finance channel.
  const ch = financeChannel();
  if (ch && !reconciled) {
    const { data: s } = await db().from("amazon_settlements").select("alerted_at").eq("settlement_id", settlementId).maybeSingle();
    if (!s?.alerted_at) {
      const blocks = [
        { type: "header", text: { type: "plain_text", text: `🧮 Amazon settlement variance` } },
        { type: "section", fields: [
          { type: "mrkdwn", text: `*Settlement*\n${settlementId}` },
          { type: "mrkdwn", text: `*Deposit (bank)*\n${fmtMoney(totalDeposit, currency)}` },
          { type: "mrkdwn", text: `*Computed net*\n${fmtMoney(computedNet, currency)}` },
          { type: "mrkdwn", text: `*Variance*\n${fmtMoney(variance, currency)}` },
        ] },
        { type: "context", elements: [{ type: "mrkdwn", text: `Period ${periodStart ?? "?"} → ${periodEnd ?? "?"}. Investigate fees/refunds not captured.` }] },
      ];
      try {
        await postSlack(ch, blocks, `Amazon settlement ${settlementId} variance ${fmtMoney(variance, currency)}`);
        await db().from("amazon_settlements").update({ alerted_at: new Date().toISOString() }).eq("settlement_id", settlementId);
      } catch (_e) { /* retried next run */ }
    }
  }

  return { ingested: 1, reconciled: { settlementId, period: [periodStart, periodEnd], totalDeposit, lineSum, grossSales, feesTotal, refundsTotal, variance, reconciled, lines: lineRows.length } };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const only = url.searchParams.get("only"); // ?only=orders|inventory|finances for manual runs
  // First-run lookback window (only used if no watermark yet). Keep small to stay
  // under the worker limit; widen via ?days=30 for a deliberate backfill.
  const days = Number(url.searchParams.get("days") ?? "7");

  const result: Record<string, unknown> = { ok: true, marketplace: MARKETPLACE_ID() };
  const errors: string[] = [];

  // Run a section, turning any thrown error into a JSON error (never a blank 500).
  const run = async (name: string, fn: () => Promise<any>) => {
    try {
      const r = await fn();
      result[name] = r;
      if (r?.error) errors.push(r.error);
    } catch (e) {
      const msg = `${name}: ${(e as Error)?.message ?? String(e)}`;
      result[name] = { error: msg };
      errors.push(msg);
    }
  };

  if (!only || only === "orders") await run("orders", () => syncOrders(days));
  if (!only || only === "inventory") await run("inventory", syncInventory);
  if (!only || only === "finances") await run("finances", syncFinances);
  // Settlements run ONLY when explicitly requested (their own daily cron) —
  // downloading + parsing a fortnightly report is too heavy for the 15-min pass.
  if (only === "settlements") await run("settlements", () => syncSettlements(url.searchParams.get("debug") === "1", url.searchParams.get("reprocess") === "1"));

  result.ok = errors.length === 0;
  if (errors.length) result.errors = errors;
  return json(result, errors.length ? 207 : 200);
});
