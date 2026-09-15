import { describe, it, expect } from "vitest";
import { aggregateWeb, type WebAggregateInput, type WebOrderRow } from "./web-aggregate";
import { periodWindow, previousWindow } from "./period";

// Fixed clock: current 7d window = Sep 8 12:00Z .. Sep 15 12:00Z,
// previous 7d window = Sep 1 12:00Z .. Sep 8 12:00Z.
const now = new Date("2026-09-15T12:00:00.000Z");
const window = periodWindow("7d", now);
const previous = previousWindow(window);

function row(overrides: Partial<WebOrderRow>): WebOrderRow {
  return {
    total_price: "500",
    shopify_created_at: "2026-09-09T10:00:00.000Z",
    financial_status: "paid",
    source_name: "web",
    first_utm_source: null,
    first_utm_medium: null,
    first_utm_campaign: null,
    first_source: null,
    first_source_type: null,
    first_referrer_url: null,
    is_creator: false,
    customer_order_index: 1,
    ...overrides,
  };
}

const shopify: WebOrderRow[] = [
  // current, new customer, Instagram ads
  row({
    total_price: "500",
    shopify_created_at: "2026-09-09T10:00:00.000Z",
    first_utm_source: "instagram",
    first_utm_campaign: "Edamame launch reel",
    customer_order_index: 1,
  }),
  // current, repeat customer, WhatsApp via medium
  row({
    total_price: "900",
    shopify_created_at: "2026-09-10T10:00:00.000Z",
    first_utm_medium: "whatsapp",
    first_utm_campaign: "Rakhi Hamper reminder",
    customer_order_index: 3,
  }),
  // current, no source at all -> Not tracked
  row({
    total_price: "300",
    shopify_created_at: "2026-09-11T10:00:00.000Z",
    customer_order_index: 1,
  }),
  // current, source_name is the new sales-channel id (still "web")
  row({
    total_price: "200",
    source_name: "368925802497",
    shopify_created_at: "2026-09-12T10:00:00.000Z",
    first_utm_source: "google",
    customer_order_index: 2,
  }),
  // current, HYPD creator seed on web channel: excluded by default
  row({
    total_price: "0.01",
    shopify_created_at: "2026-09-12T11:00:00.000Z",
    is_creator: true,
    first_utm_source: "hypd",
    customer_order_index: 1,
  }),
  // current, refunded: excluded
  row({
    total_price: "9999",
    shopify_created_at: "2026-09-12T12:00:00.000Z",
    financial_status: "refunded",
  }),
  // current, HYPD marketplace order (source_name id): not "web", excluded
  row({
    total_price: "700",
    shopify_created_at: "2026-09-12T13:00:00.000Z",
    source_name: "341128478721",
  }),
  // previous, tracked (email)
  row({
    total_price: "400",
    shopify_created_at: "2026-09-03T10:00:00.000Z",
    first_utm_medium: "email",
    customer_order_index: 2,
  }),
  // previous, not tracked
  row({
    total_price: "100",
    shopify_created_at: "2026-09-04T10:00:00.000Z",
    customer_order_index: 1,
  }),
  // out of range entirely
  row({
    total_price: "5000",
    shopify_created_at: "2026-08-01T10:00:00.000Z",
    first_utm_source: "google",
  }),
];

function makeInput(overrides: Partial<WebAggregateInput> = {}): WebAggregateInput {
  return {
    period: "7d",
    window,
    previous,
    shopify,
    includeCreators: false,
    ...overrides,
  };
}

describe("aggregateWeb", () => {
  const out = aggregateWeb(makeInput());

  it("echoes period and ISO windows", () => {
    expect(out.period).toBe("7d");
    expect(out.window).toEqual({ from: window.from.toISOString(), to: window.to.toISOString() });
    expect(out.previous).toEqual({ from: previous.from.toISOString(), to: previous.to.toISOString() });
  });

  it("totals only web-channel revenue orders, excluding creators/refunded/HYPD marketplace", () => {
    // 500 + 900 + 300 + 200 = 1900; the 0.01 creator, refunded 9999, and HYPD
    // marketplace 700 are all excluded.
    expect(out.total.revenue).toBe(1900);
    expect(out.total.orders).toBe(4);
    expect(out.total.prevRevenue).toBe(500);
    expect(out.total.prevOrders).toBe(2);
  });

  it("computes aov for current and previous windows", () => {
    expect(out.aov.value).toBe(475);
    expect(out.aov.prev).toBe(250);
  });

  it("repeat pct counts customer_order_index > 1", () => {
    // current: 2 repeat orders (idx 3, idx 2) of 4 orders = 50%
    expect(out.repeat.pct).toBe(50);
    // previous: 1 repeat (idx 2) of 2 orders = 50%
    expect(out.repeat.prevPct).toBe(50);
  });

  it("untracked counts orders with no source signal at all", () => {
    // current: 1 of 4 orders untracked = 25%
    expect(out.untracked).toEqual({ pct: 25, prevPct: 50, orders: 1 });
  });

  it("maps sources to business names, sorted by revenue with Not tracked last", () => {
    expect(out.sources.map((s) => s.label)).toEqual(["WhatsApp", "Instagram ads", "Google", "Not tracked"]);
    const wa = out.sources.find((s) => s.label === "WhatsApp")!;
    expect(wa).toMatchObject({ revenue: 900, orders: 1, share: 47.4 });
    const nt = out.sources.find((s) => s.label === "Not tracked")!;
    expect(nt).toMatchObject({ revenue: 300, orders: 1 });
  });

  it("splits new vs returning revenue and aov by customer_order_index", () => {
    // new (idx 1): 500 + 300 = 800; returning (idx > 1): 900 (idx 3) + 200 (idx 2) = 1100.
    expect(out.newVsReturning).toEqual({
      newRevenue: 800,
      returningRevenue: 1100,
      newAov: 400,
      returningAov: 550,
    });
  });

  it("aggregates campaigns by first_utm_campaign, top 5 by revenue", () => {
    expect(out.campaigns).toEqual([
      { name: "Rakhi Hamper reminder", source: "WhatsApp", orders: 1, revenue: 900, newPct: 0 },
      { name: "Edamame launch reel", source: "Instagram ads", orders: 1, revenue: 500, newPct: 100 },
    ]);
  });

  it("reports tracking coverage and the most recent attributed order across the whole fetched range", () => {
    expect(out.tracking.totalOrders).toBe(4);
    expect(out.tracking.attributedOrders).toBe(3);
    // the latest tracked order (any window) is the Google one on Sep 12
    expect(out.tracking.lastAttributedAt).toBe("2026-09-12T10:00:00.000Z");
  });

  it("creators=include lets a creator-flagged web order count", () => {
    const withCreators = aggregateWeb(makeInput({ includeCreators: true }));
    // adds the 0.01 creator order (hypd utm_source, web channel) on top of
    // the 1900 base
    expect(withCreators.total.revenue).toBe(1900.01);
    expect(withCreators.total.orders).toBe(5);
  });

  it("tolerates numeric-string prices and a fully empty order set", () => {
    const empty = aggregateWeb(makeInput({ shopify: [] }));
    expect(empty.total).toEqual({ revenue: 0, orders: 0, prevRevenue: 0, prevOrders: 0 });
    expect(empty.aov).toEqual({ value: 0, prev: 0 });
    expect(empty.sources).toEqual([]);
    expect(empty.campaigns).toEqual([]);
    expect(empty.tracking).toEqual({ attributedOrders: 0, totalOrders: 0, lastAttributedAt: null });
  });
});
