import { describe, it, expect } from "vitest";
import { aggregateSales, type SalesAggregateInput } from "./sales-aggregate";
import { periodWindow, previousWindow } from "./period";

// Fixed clock: current 7d window = Sep 8 12:00Z .. Sep 15 12:00Z,
// previous 7d window = Sep 1 12:00Z .. Sep 8 12:00Z.
const now = new Date("2026-09-15T12:00:00.000Z");
const window = periodWindow("7d", now);
const previous = previousWindow(window);

const shopify: SalesAggregateInput["shopify"] = [
  // current window, day 0 (Sep 8 12:00 .. Sep 9 12:00), web, new customer
  {
    total_price: "500",
    shopify_created_at: "2026-09-08T15:00:00.000Z",
    financial_status: "paid",
    source_name: "web",
    first_utm_source: null,
    first_source: null,
    is_creator: false,
    customer_order_index: 1,
    line_items: [
      { title: "Peri Peri Chips", quantity: 2, price: "150", sku: "PP-1" },
      { title: "Masala Sticks", quantity: 1, price: "200" },
    ],
  },
  // current window, day 2, hypd, repeat customer
  {
    total_price: "800",
    shopify_created_at: "2026-09-10T18:00:00.000Z",
    financial_status: "paid",
    source_name: "341128478721",
    first_utm_source: null,
    first_source: null,
    is_creator: false,
    customer_order_index: 3,
    line_items: [{ title: "Masala Sticks", quantity: 4, price: "200" }],
  },
  // current window, day 2, other marketplace, unknown customer index
  {
    total_price: "300",
    shopify_created_at: "2026-09-11T06:00:00.000Z",
    financial_status: "pending",
    source_name: "99999",
    first_utm_source: null,
    first_source: null,
    is_creator: false,
    customer_order_index: null,
    line_items: [{ title: "Crunchies", quantity: 3, price: "100" }],
  },
  // current window, refunded: excluded everywhere
  {
    total_price: "9999",
    shopify_created_at: "2026-09-12T10:00:00.000Z",
    financial_status: "refunded",
    source_name: "web",
    first_utm_source: null,
    first_source: null,
    is_creator: false,
    customer_order_index: 1,
    line_items: [{ title: "Refunded Thing", quantity: 1, price: "9999" }],
  },
  // current window, creator seed: excluded everywhere
  {
    total_price: "0.01",
    shopify_created_at: "2026-09-12T11:00:00.000Z",
    financial_status: "paid",
    source_name: "341128478721",
    first_utm_source: null,
    first_source: null,
    is_creator: true,
    customer_order_index: 1,
    line_items: [{ title: "Creator Seed", quantity: 1, price: "0.01" }],
  },
  // previous window, day 0 (Sep 1 12:00 .. Sep 2 12:00), web, repeat
  {
    total_price: "400",
    shopify_created_at: "2026-09-01T20:00:00.000Z",
    financial_status: "paid",
    source_name: "web",
    first_utm_source: null,
    first_source: null,
    is_creator: false,
    customer_order_index: 2,
    line_items: [{ title: "Peri Peri Chips", quantity: 1, price: "400" }],
  },
  // previous window, day 3, hypd, new
  {
    total_price: "600",
    shopify_created_at: "2026-09-04T13:00:00.000Z",
    financial_status: "paid",
    source_name: "341128478721",
    first_utm_source: null,
    first_source: null,
    is_creator: false,
    customer_order_index: 1,
    line_items: [{ title: "Masala Sticks", quantity: 3, price: "200" }],
  },
  // before both windows: ignored
  {
    total_price: "12345",
    shopify_created_at: "2026-08-20T13:00:00.000Z",
    financial_status: "paid",
    source_name: "web",
    first_utm_source: null,
    first_source: null,
    is_creator: false,
    customer_order_index: 1,
    line_items: [],
  },
];

const amazonFinance: SalesAggregateInput["amazonFinance"] = [
  // current, day 0
  { posted_date: "2026-09-09T02:00:00.000Z", gross: 1000, net: 700, event_type: "Order" },
  // current, day 2, refund (negative, stays in totals)
  { posted_date: "2026-09-10T20:00:00.000Z", gross: -200, net: -150, event_type: "Refund" },
  // previous, day 3
  { posted_date: "2026-09-04T13:00:00.000Z", gross: 500, net: 350, event_type: "Order" },
  // out of range
  { posted_date: "2026-08-01T00:00:00.000Z", gross: 77777, net: 55555, event_type: "Order" },
];

const amazonOrders: SalesAggregateInput["amazonOrders"] = [
  { purchase_date: "2026-09-09T02:00:00.000Z", order_status: "Shipped" },
  { purchase_date: "2026-09-10T02:00:00.000Z", order_status: "Unshipped" },
  { purchase_date: "2026-09-10T03:00:00.000Z", order_status: "Canceled" },
  { purchase_date: "2026-09-04T13:00:00.000Z", order_status: "Shipped" },
];

const input: SalesAggregateInput = {
  period: "7d",
  window,
  previous,
  shopify,
  amazonFinance,
  amazonOrders,
};

describe("aggregateSales", () => {
  const out = aggregateSales(input);

  it("echoes period and ISO windows", () => {
    expect(out.period).toBe("7d");
    expect(out.window).toEqual({ from: window.from.toISOString(), to: window.to.toISOString() });
    expect(out.previous).toEqual({ from: previous.from.toISOString(), to: previous.to.toISOString() });
  });

  it("totals = Shopify revenue orders + Amazon gross, excluding refunded and creator rows", () => {
    // current: 500 + 800 + 300 shopify + (1000 - 200) amazon = 2400
    expect(out.total.revenue).toBe(2400);
    // 3 shopify orders + 2 non-cancelled amazon orders
    expect(out.total.orders).toBe(5);
    // previous: 400 + 600 shopify + 500 amazon = 1500
    expect(out.total.prevRevenue).toBe(1500);
    expect(out.total.prevOrders).toBe(3);
  });

  it("splits channels web/hypd/amazon/other in that order with labels and aov", () => {
    expect(out.channels.map((c) => c.key)).toEqual(["web", "hypd", "amazon", "other"]);
    expect(out.channels.map((c) => c.label)).toEqual(["Web store", "HYPD", "Amazon", "Other marketplaces"]);
    const by = Object.fromEntries(out.channels.map((c) => [c.key, c]));
    expect(by.web).toMatchObject({ revenue: 500, orders: 1, prevRevenue: 400, aov: 500 });
    expect(by.hypd).toMatchObject({ revenue: 800, orders: 1, prevRevenue: 600, aov: 800 });
    expect(by.amazon).toMatchObject({ revenue: 800, orders: 2, prevRevenue: 500, aov: 400 });
    expect(by.other).toMatchObject({ revenue: 300, orders: 1, prevRevenue: 0, aov: 300 });
  });

  it("aov is 0 when a channel has no orders", () => {
    const empty = aggregateSales({ ...input, shopify: [], amazonFinance: [], amazonOrders: [] });
    expect(empty.channels.every((c) => c.aov === 0)).toBe(true);
    expect(empty.total.revenue).toBe(0);
    expect(empty.amazon).toEqual({ gross: 0, net: 0, prevGross: 0, prevNet: 0, orders: 0 });
  });

  it("amazon block sums gross/net incl. refunds and counts non-cancelled orders", () => {
    expect(out.amazon).toEqual({ gross: 800, net: 550, prevGross: 500, prevNet: 350, orders: 2 });
  });

  it("daily has one row per day, UTC dates, aligned to previous window by index", () => {
    expect(out.daily).toHaveLength(7);
    expect(out.daily.map((d) => d.date)).toEqual([
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
      "2026-09-14",
    ]);
    // day 0: web 500 + amazon 1000; prev day 0: web 400
    expect(out.daily[0]).toEqual({ date: "2026-09-08", revenue: 1500, prevRevenue: 400 });
    // day 2: hypd 800 + other 300 + amazon -200; prev day 2: nothing
    expect(out.daily[2]).toEqual({ date: "2026-09-10", revenue: 900, prevRevenue: 0 });
    // day 3: refunded + creator rows contribute nothing; prev day 3: hypd 600 + amazon 500
    expect(out.daily[3]).toEqual({ date: "2026-09-11", revenue: 0, prevRevenue: 1100 });
    expect(out.daily[6]).toEqual({ date: "2026-09-14", revenue: 0, prevRevenue: 0 });
  });

  it("repeat and new customers use customer_order_index; null counts as neither", () => {
    // current shopify revenue orders: idx 1 (new), idx 3 (repeat), null -> 1 repeat of 3
    expect(out.repeat).toEqual({ orders: 1, pct: 33.3, prevPct: 50 });
    expect(out.newCustomers).toEqual({ count: 1, prevCount: 1 });
  });

  it("topProducts aggregates line_items by title over current-window Shopify revenue orders", () => {
    // Masala Sticks: 1*200 + 4*200 = 1000 units 5; Peri Peri: 2*150 = 300; Crunchies: 3*100 = 300
    // shopify total = 1600
    expect(out.topProducts).toEqual([
      { title: "Masala Sticks", units: 5, revenue: 1000, share: 62.5 },
      { title: "Crunchies", units: 3, revenue: 300, share: 18.8 },
      { title: "Peri Peri Chips", units: 2, revenue: 300, share: 18.8 },
    ]);
  });

  it("caps topProducts at 5", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      total_price: "10",
      shopify_created_at: "2026-09-09T00:00:00.000Z",
      financial_status: "paid",
      source_name: "web",
      first_utm_source: null,
      first_source: null,
      is_creator: false,
      customer_order_index: 1,
      line_items: [{ title: `P${i}`, quantity: 1, price: String(10 + i) }],
    }));
    const r = aggregateSales({ ...input, shopify: many });
    expect(r.topProducts).toHaveLength(5);
    expect(r.topProducts[0].title).toBe("P7");
  });

  it("tolerates malformed line_items and numeric strings", () => {
    const r = aggregateSales({
      ...input,
      shopify: [
        {
          ...shopify[0],
          line_items: null,
        },
        {
          ...shopify[0],
          line_items: [{ title: "", quantity: "2", price: "abc" }, { quantity: 1, price: 5 }],
        },
      ],
    });
    expect(r.total.revenue).toBe(1000 + 800);
    expect(r.topProducts).toEqual([]);
  });
});
