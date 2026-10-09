import { describe, it, expect } from "vitest";
import { aggregateChannels, type ChannelsAggregateInput } from "./channels-aggregate";
import { periodWindow, previousWindow } from "./period";

const now = new Date("2026-09-15T12:00:00.000Z");
const window = periodWindow("7d", now);
const previous = previousWindow(window);

const order = (o: Partial<ChannelsAggregateInput["shopify"][number]>): ChannelsAggregateInput["shopify"][number] => ({
  total_price: "0",
  shopify_created_at: "2026-09-10T10:00:00.000Z",
  financial_status: "paid",
  source_name: "web",
  first_utm_source: null,
  first_source: null,
  is_creator: false,
  customer_order_index: 1,
  line_items: [],
  ...o,
});

const input: ChannelsAggregateInput = {
  period: "7d",
  window,
  previous,
  shopify: [
    order({ total_price: "500", line_items: [{ title: "Cheese Jar", sku: "CO300G", quantity: 2, price: "250" }] }),
    order({
      total_price: "900",
      source_name: "341128478721",
      shopify_created_at: "2026-09-12T10:00:00.000Z",
      line_items: [
        { title: "Edamame Combo", sku: "PM-EDM-P3", quantity: 3, price: "300" },
        { title: "No sku thing", quantity: 1, price: "10" },
      ],
    }),
    // excluded: refunded, creator seed, previous window line items
    order({ total_price: "700", financial_status: "refunded", line_items: [{ title: "Cheese Jar", sku: "CO300G", quantity: 9, price: "250" }] }),
    order({ total_price: "0.01", is_creator: true, source_name: "341128478721", line_items: [{ title: "Seed", sku: "S", quantity: 1, price: "0.01" }] }),
    order({ total_price: "400", shopify_created_at: "2026-09-03T10:00:00.000Z", line_items: [{ title: "Cheese Jar", sku: "CO300G", quantity: 1, price: "400" }] }),
  ],
  amazonFinance: [
    { posted_date: "2026-09-11T10:00:00.000Z", gross: "1000", net: "700", event_type: "Shipment" },
    { posted_date: "2026-09-13T10:00:00.000Z", gross: "-200", net: "-180", event_type: "Refund" },
  ],
  amazonOrders: [{ purchase_date: "2026-09-11T09:00:00.000Z", order_status: "Shipped" }],
  amazonItems: [
    // co300g on Amazon = same SKU code as Shopify (case-insensitive) → joined
    { seller_sku: "co300g", event_type: "Shipment", posted_date: "2026-09-11T10:00:00.000Z", quantity: 3, gross: "600" },
    // two SKUs, same ASIN → one listing
    { seller_sku: "VAMASF001", event_type: "Shipment", posted_date: "2026-09-11T10:00:00.000Z", quantity: 2, gross: "400" },
    { seller_sku: "M_VAMASF001", event_type: "Refund", posted_date: "2026-09-13T10:00:00.000Z", quantity: 1, gross: "-200" },
    // outside the window: ignored
    { seller_sku: "VAMASF001", event_type: "Shipment", posted_date: "2026-09-02T10:00:00.000Z", quantity: 5, gross: "999" },
  ],
  amazonListings: [
    { seller_sku: "VAMASF001", asin: "B0ASIN1", title: "PROMUNCH Soya Mince, 250g, Gluten free" },
    { seller_sku: "M_VAMASF001", asin: "B0ASIN1", title: "PROMUNCH Soya Mince MFN" },
  ],
};

describe("aggregateChannels", () => {
  const m = aggregateChannels(input);

  it("channel totals are exactly the Sales tab numbers", () => {
    const web = m.sales.channels.find((c) => c.key === "web")!;
    const hypd = m.sales.channels.find((c) => c.key === "hypd")!;
    const amz = m.sales.channels.find((c) => c.key === "amazon")!;
    expect(web.revenue).toBe(500);
    expect(hypd.revenue).toBe(900);
    expect(amz.revenue).toBe(800);
    expect(m.sales.total.revenue).toBe(2200);
  });

  it("per-day channel split adds up to the all-channel daily series", () => {
    m.dailyByChannel.forEach((d, i) => {
      expect(d.web + d.hypd + d.amazon + d.other).toBeCloseTo(m.sales.daily[i].revenue, 2);
    });
    expect(m.dailyByChannel.reduce((s, d) => s + d.amazon, 0)).toBe(800);
  });

  it("joins Shopify and Amazon only on identical SKU codes, groups Amazon SKUs by ASIN", () => {
    const cheese = m.skus.find((r) => r.codes.includes("CO300G"))!;
    expect(cheese.name).toBe("Cheese Jar");
    expect(cheese.byChannel.web).toEqual({ revenue: 500, units: 2 });
    expect(cheese.byChannel.amazon).toEqual({ revenue: 600, units: 3 });
    expect(cheese.revenue).toBe(1100);
    expect(cheese.best).toBe("amazon");
    expect(cheese.onAmazon && cheese.onShopify).toBe(true);

    const mince = m.skus.find((r) => r.codes.includes("VAMASF001"))!;
    expect(mince.codes).toEqual(["M_VAMASF001", "VAMASF001"]);
    expect(mince.byChannel.amazon).toEqual({ revenue: 200, units: 1 });
    expect(mince.name).toBe("PROMUNCH Soya Mince");
    expect(mince.onShopify).toBe(false);

    expect(m.matchedSkus).toBe(1);
  });

  it("excludes refunded and creator orders, ranks by revenue, shares sum to 100", () => {
    expect(m.skus.map((r) => r.name)).toEqual(["Cheese Jar", "Edamame Combo", "PROMUNCH Soya Mince", "No sku thing"]);
    expect(m.skus.find((r) => r.name === "Seed")).toBeUndefined();
    expect(m.skus.reduce((s, r) => s + r.share, 0)).toBeCloseTo(100, 0);
    expect(m.skuTotals.hypd).toEqual({ revenue: 910, units: 4 });
  });
});
