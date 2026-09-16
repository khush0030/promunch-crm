import { describe, it, expect } from "vitest";
import { buildAmazonMetrics, sortForStock, sortForProfit, type AmazonMetricsInput } from "./economics";

// Fixed clock: 7d window = Sep 8 12:00Z .. Sep 15 12:00Z, previous = Sep 1 .. Sep 8.
// The 30-day velocity basis reaches back to Aug 16 12:00Z regardless of period.
const now = new Date("2026-09-15T12:00:00.000Z");

const input: AmazonMetricsInput = {
  now,
  period: "7d",
  // Header-level finance events (the money flow). Refund rows stay in, negative.
  financeEvents: [
    { posted_date: "2026-09-10T10:00:00Z", event_type: "Shipment", gross: 400, promo: -20, referral_fee: -30, fba_fee: -50, other_fees: -10, net: 290 },
    { posted_date: "2026-09-09T10:00:00Z", event_type: "Shipment", gross: 800, promo: 0, referral_fee: -80, fba_fee: 0, other_fees: -20, net: 700 },
    { posted_date: "2026-09-11T10:00:00Z", event_type: "Refund", gross: -200, promo: 10, referral_fee: 0, fba_fee: 0, other_fees: 5, net: -185 },
    // previous window
    { posted_date: "2026-09-03T10:00:00Z", event_type: "Shipment", gross: 600, promo: 0, referral_fee: -45, fba_fee: -75, other_fees: -15, net: 465 },
    // outside both windows (only matters for the 30d velocity basis on item rows)
    { posted_date: "2026-08-20T10:00:00Z", event_type: "Shipment", gross: 200, promo: 0, referral_fee: -15, fba_fee: -25, other_fees: -5, net: 155 },
  ],
  itemEvents: [
    // SKU-A: FBA, out of stock, sells. Period: 2 units. Prev: 3. 30d total: 6.
    { seller_sku: "SKU-A", event_type: "Shipment", posted_date: "2026-09-10T10:00:00Z", quantity: 2, gross: 400, promo: -20, referral_fee: -30, fba_fee: -50, closing_fee: -10, other_fees: 0, net: 290 },
    { seller_sku: "SKU-A", event_type: "Shipment", posted_date: "2026-09-03T10:00:00Z", quantity: 3, gross: 600, promo: 0, referral_fee: -45, fba_fee: -75, closing_fee: -15, other_fees: 0, net: 465 },
    { seller_sku: "SKU-A", event_type: "Shipment", posted_date: "2026-08-20T10:00:00Z", quantity: 1, gross: 200, promo: 0, referral_fee: -15, fba_fee: -25, closing_fee: -5, other_fees: 0, net: 155 },
    { seller_sku: "SKU-A", event_type: "Refund", posted_date: "2026-09-11T10:00:00Z", quantity: 1, gross: -200, promo: 10, referral_fee: 0, fba_fee: 0, closing_fee: 5, other_fees: 0, net: -185 },
    // SKU-C: ships from you (not in inventory), no cost price. 4 units in period.
    { seller_sku: "SKU-C", event_type: "Shipment", posted_date: "2026-09-09T10:00:00Z", quantity: 4, gross: 800, promo: 0, referral_fee: -80, fba_fee: 0, closing_fee: -20, other_fees: 0, net: 700 },
    { seller_sku: null, event_type: "Shipment", posted_date: "2026-09-09T10:00:00Z", quantity: 1, gross: 1, promo: 0, referral_fee: 0, fba_fee: 0, closing_fee: 0, other_fees: 0, net: 1 },
  ],
  inventory: [
    { seller_sku: "SKU-A", asin: "B0A", product_name: "PROMUNCH Masala Mania, Pack of 2, 100g", fulfillable_quantity: 0, inbound_working: 20, inbound_shipped: 100, inbound_receiving: 0 },
    { seller_sku: "SKU-B", asin: "B0B", product_name: "PROMUNCH Gift Hamper (Diwali)", fulfillable_quantity: 40, inbound_working: 0, inbound_shipped: 0, inbound_receiving: 0 },
    // dead listing: no stock, nothing inbound, no sales -> dropped
    { seller_sku: "SKU-D", asin: "B0D", product_name: "Old listing", fulfillable_quantity: 0, inbound_working: 0, inbound_shipped: 0, inbound_receiving: 0 },
  ],
  costs: [{ seller_sku: "SKU-A", cost_per_unit: 60 }],
  titles: [{ seller_sku: "SKU-C", asin: "B0C", title: "PROMUNCH Chilli Lime Sticks | 80g" }],
  settlements: [
    { settlement_id: "S1", total_deposit: 1000, period_start: "2026-08-29T00:00:00Z", period_end: "2026-09-11T00:00:00Z", deposit_date: "2026-09-12T00:00:00Z", gross_sales: 1500, fees_total: -400, refunds_total: -100, line_sum: 1000, variance: 0, recon_note: "matched" },
    { settlement_id: "S2", total_deposit: 900, period_start: "2026-08-15T00:00:00Z", period_end: "2026-08-28T00:00:00Z", deposit_date: "2026-09-09T00:00:00Z", gross_sales: 1400, fees_total: -250, refunds_total: -50, line_sum: 1100, variance: -200, recon_note: "reserve held" },
    // scheduled, not yet deposited
    { settlement_id: "S3", total_deposit: 500, period_start: "2026-09-11T00:00:00Z", period_end: "2026-09-18T00:00:00Z", deposit_date: "2026-09-20T00:00:00Z", gross_sales: 700, fees_total: -200, refunds_total: 0, line_sum: 500, variance: 0, recon_note: null },
  ],
  recentOrders: [
    { amazon_order_id: "403-1", order_status: "Shipped", purchase_date: "2026-09-14T10:00:00Z", order_total: "225.40", number_of_items_shipped: 1, number_of_items_unshipped: 0, fulfillment_channel: "AFN" },
    { amazon_order_id: "403-2", order_status: "Pending", purchase_date: "2026-09-15T10:00:00Z", order_total: null, number_of_items_shipped: 0, number_of_items_unshipped: 2, fulfillment_channel: "MFN" },
  ],
  orderCount: { period: 10, prev: 8 },
  sync: [
    { key: "orders", updated_at: "2026-09-15T11:50:00Z" },
    { key: "finances", updated_at: "2026-09-15T11:55:00Z" },
  ],
};

const m = buildAmazonMetrics(input);
const bySku = Object.fromEntries(m.skus.map((s) => [s.sku, s]));

describe("buildAmazonMetrics: money flow", () => {
  it("splits what customers paid into what Amazon kept and what was paid to you", () => {
    expect(m.money.customersPaid).toBe(1000);
    expect(m.money.amazonKept).toBe(195);
    expect(m.money.amazonKeptBreakdown).toEqual({ referral: 110, fba: 50, closingOther: 25, promo: 10 });
    expect(m.money.paidToYou).toBe(805);
  });
  it("subtracts product cost only where a cost price exists and reports coverage", () => {
    expect(m.money.productCost).toBe(120); // SKU-A 60 x 2 units
    expect(m.money.profit).toBe(685);
    expect(m.money.marginPct).toBeCloseTo(68.5, 1);
    expect(m.money.costCoverage).toBeCloseTo(100 / 3, 1); // 2 of 6 units carry a cost price
  });
  it("carries previous-period values for the overview KPIs", () => {
    expect(m.money.customersPaidPrev).toBe(600);
    expect(m.money.paidToYouPrev).toBe(465);
    expect(m.money.productCostPrev).toBe(180); // 60 x 3 units
    expect(m.money.profitPrev).toBe(285);
    expect(m.money.marginPctPrev).toBeCloseTo(47.5, 1);
  });
  it("counts refunds against orders in the period", () => {
    expect(m.refunds).toEqual({ count: 1, amount: 185, pct: 10, prevPct: 0, orders: 10 });
  });
  it("builds a daily series covering exactly the window", () => {
    expect(m.daily).toHaveLength(7);
    expect(m.daily[0].date).toBe("2026-09-08");
    expect(m.daily.reduce((a, d) => a + d.net, 0)).toBe(805);
  });
});

describe("buildAmazonMetrics: per SKU", () => {
  it("prices an out-of-stock FBA SKU with a cost price", () => {
    const a = bySku["SKU-A"];
    expect(a.fulfillmentChannel).toBe("FBA");
    expect(a.shortTitle).toBe("PROMUNCH Masala Mania");
    expect(a.asin).toBe("B0A");
    expect(a.units).toBe(2);
    expect(a.unitsPrev).toBe(3);
    expect(a.refundUnits).toBe(1);
    expect(a.avgPrice).toBe(200);
    expect(a.amazonKeepsPerUnit).toBe(55);
    expect(a.costPerUnit).toBe(60);
    expect(a.keepPerUnit).toBe(85);
    expect(a.profit).toBe(170);
    expect(a.velocityPerDay).toBeCloseTo(6 / 30, 3);
    expect(a.fulfillable).toBe(0);
    expect(a.inbound).toBe(120);
    expect(a.daysLeft).toBe(0);
    expect(a.outOfStock).toBe(true);
    expect(a.lostProfitPerDay).toBeCloseTo(17, 2);
    expect(a.lostNetPerDay).toBeCloseTo(29, 2);
  });
  it("leaves estimates empty for a stocked SKU with no sales", () => {
    const b = bySku["SKU-B"];
    expect(b.units).toBe(0);
    expect(b.daysLeft).toBeNull();
    expect(b.velocityPerDay).toBe(0);
    expect(b.keepPerUnit).toBeNull();
    expect(b.profit).toBeNull();
    expect(b.outOfStock).toBe(false);
    expect(b.lostProfitPerDay).toBeNull();
  });
  it("marks a ships-from-you SKU untracked and null profit without a cost price", () => {
    const c = bySku["SKU-C"];
    expect(c.fulfillmentChannel).toBe("MFN");
    expect(c.title).toBe("PROMUNCH Chilli Lime Sticks | 80g");
    expect(c.shortTitle).toBe("PROMUNCH Chilli Lime Sticks");
    expect(c.fulfillable).toBeNull();
    expect(c.daysLeft).toBe("untracked");
    expect(c.avgPrice).toBe(200);
    expect(c.amazonKeepsPerUnit).toBe(25);
    expect(c.costPerUnit).toBeNull();
    expect(c.keepPerUnit).toBeNull();
    expect(c.profit).toBeNull();
  });
  it("drops dead listings and rows without a SKU", () => {
    expect(m.skus.map((s) => s.sku).sort()).toEqual(["SKU-A", "SKU-B", "SKU-C"]);
  });
  it("rolls up the stock KPIs", () => {
    expect(m.stock).toEqual({ total: 3, outOfStock: 1, under14Days: 0, atRisk: 1, lostProfitPerDay: 17 });
  });
  it("sorts worst first for stock and best first for profit", () => {
    const stock = sortForStock([
      { ...bySku["SKU-C"] },
      { ...bySku["SKU-B"] },
      { ...bySku["SKU-A"], daysLeft: 12, outOfStock: false },
      { ...bySku["SKU-A"], sku: "SKU-A2", daysLeft: 3, outOfStock: false },
      { ...bySku["SKU-A"], sku: "SKU-A3" },
    ]).map((s) => s.sku);
    expect(stock).toEqual(["SKU-A3", "SKU-A2", "SKU-A", "SKU-B", "SKU-C"]);
    const profit = sortForProfit([bySku["SKU-C"], bySku["SKU-B"], bySku["SKU-A"]]).map((s) => s.sku);
    expect(profit).toEqual(["SKU-A", "SKU-C", "SKU-B"]);
  });
});

describe("buildAmazonMetrics: payouts, orders, sync", () => {
  it("reconciles each settlement within 50 rupees", () => {
    const s1 = m.settlements.find((s) => s.id === "S1")!;
    const s2 = m.settlements.find((s) => s.id === "S2")!;
    expect(s1.matched).toBe(true);
    expect(s2.matched).toBe(false);
    expect(s2.variance).toBe(-200);
    expect(s2.lineSum).toBe(1100);
    expect(s2.note).toBe("reserve held");
    expect(m.settlements.map((s) => s.id)).toEqual(["S3", "S1", "S2"]); // newest deposit first
  });
  it("sums deposits already made, and points at the last and next payout", () => {
    expect(m.payouts.paidOut).toBe(1900);
    expect(m.payouts.count).toBe(2);
    expect(m.payouts.matched).toBe(2);
    expect(m.payouts.needsLook).toBe(200);
    expect(m.payouts.last?.id).toBe("S1");
    expect(m.payouts.next?.id).toBe("S3");
  });
  it("shapes recent orders and the sync time", () => {
    expect(m.orders.count).toBe(10);
    expect(m.orders.prevCount).toBe(8);
    expect(m.orders.recent[1]).toEqual({ id: "403-2", status: "Pending", date: "2026-09-15T10:00:00Z", items: 2, total: 0, channel: "MFN" });
    expect(m.orders.recent[0].total).toBeCloseTo(225.4, 2);
    expect(m.sync.lastSyncedAt).toBe("2026-09-15T11:55:00Z");
  });
});
