import { describe, it, expect } from "vitest";
import { aggregateProducts, aggregateRepeat, buyerKey, MIXED_LABEL, type BuyerOrderRow } from "./buyers-aggregate";

const NOW = new Date("2026-10-09T06:30:00Z");
const D = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * D).toISOString();

let seq = 0;
function o(p: Partial<BuyerOrderRow> & { phone?: string; ago: number; items?: [string, number, number][] }): BuyerOrderRow {
  return {
    shopify_id: ++seq,
    total_price: p.total_price ?? 500,
    shopify_created_at: daysAgo(p.ago),
    financial_status: "paid",
    source_name: p.source_name ?? "web",
    first_utm_source: null,
    first_source: null,
    is_creator: p.is_creator ?? false,
    customer_order_index: p.customer_order_index ?? null,
    customer_phone: p.phone ?? null,
    customer_email: p.customer_email ?? null,
    line_items: p.items ? p.items.map(([title, quantity, price]) => ({ title, quantity, price: String(price) })) : undefined,
  };
}

describe("buyerKey", () => {
  it("prefers the phone, falls back to email", () => {
    expect(buyerKey({ customer_phone: "+91 98765 43210", customer_email: "a@b.in" })).toBe("p:919876543210");
    expect(buyerKey({ customer_phone: null, customer_email: " A@B.in " })).toBe("e:a@b.in");
    expect(buyerKey({ customer_phone: "123", customer_email: null })).toBeNull();
  });
});

describe("aggregateRepeat", () => {
  const rows = [
    // A: first 100 days ago, back after 25 days
    o({ phone: "9000000001", ago: 100 }),
    o({ phone: "9000000001", ago: 75 }),
    // B: first 60 days ago, once
    o({ phone: "9000000002", ago: 60 }),
    // C: first 10 days ago (too new to judge), once
    o({ phone: "9000000003", ago: 10 }),
    // D: bought before our data (index 3): not a new buyer
    o({ phone: "9000000004", ago: 50, customer_order_index: 3 }),
    o({ phone: "9000000004", ago: 20 }),
    // HYPD and creator seeds never count
    o({ phone: "9000000005", ago: 40, source_name: "341128478721" }),
    o({ phone: "9000000006", ago: 40, is_creator: true }),
  ];
  const r = aggregateRepeat(rows, NOW, new Date(NOW.getTime() - 400 * D));

  it("measures repeat rate on new buyers old enough to have come back", () => {
    expect(r.buyers).toBe(3);
    expect(r.repeatBase).toBe(2);
    expect(r.repeatPct).toBe(50);
    expect(r.medianDaysToSecond).toBe(25);
    expect(r.spendPerBuyer).toBe(Math.round(2000 / 3));
  });

  it("buckets the gap to the second order by week", () => {
    expect(r.secondOrderWeeks.find((w) => w.label === "4w")?.buyers).toBe(1);
    expect(r.secondOrderWeeks.reduce((n, w) => n + w.buyers, 0)).toBe(1);
  });

  it("builds six month rows with unfinished cells left empty", () => {
    expect(r.cohorts).toHaveLength(6);
    expect(r.cohorts[5].month).toBe("2026-10");
    expect(r.cohorts[5].cells.every((c) => c === null)).toBe(true);
    const jun = r.cohorts.find((c) => c.month === "2026-07");
    expect(jun?.buyers).toBe(1);
    expect(jun?.cells[0]).toBe(100);
  });
});

describe("aggregateProducts", () => {
  const rows = [
    o({ phone: "9100000001", ago: 5, total_price: 650, items: [["Rock Salt", 2, 200], ["Masala Mania", 1, 250]] }),
    o({ phone: "9100000002", ago: 6, total_price: 350, items: [["Rock Salt", 1, 350]] }),
    o({ phone: "9100000003", ago: 7, total_price: 1200, items: [["Rock Salt", 1, 400], ["Masala Mania", 1, 400], ["Crunchies", 1, 400]] }),
    o({ phone: "9100000004", ago: 40, total_price: 500, items: [["Crunchies", 1, 500]] }), // outside a 30d window
  ];
  const r = aggregateProducts(rows, { from: new Date(NOW.getTime() - 30 * D), to: NOW }, NOW, 1);

  it("ranks products by sales in the window", () => {
    expect(r.orders).toBe(3);
    expect(r.products[0]).toEqual({ title: "Rock Salt", units: 4, revenue: 1150 });
  });

  it("finds products bought together in multi-item orders", () => {
    expect(r.multiItemOrders).toBe(2);
    expect(r.pairs[0]).toEqual({ a: "Masala Mania", b: "Rock Salt", orders: 2, pct: 100 });
  });

  it("buckets order sizes and counts orders just above free shipping", () => {
    expect(r.sizes.find((s) => s.label === "Under ₹400")?.orders).toBe(1);
    expect(r.sizes.find((s) => s.label === "₹600 to 799")?.orders).toBe(1);
    expect(r.justAboveFreeShipping).toBe(1);
  });

  it("groups first orders 30+ days old by what they held", () => {
    expect(r.firstProduct).toEqual([{ label: "Crunchies", buyers: 1, cameBack: 0, pct: 0 }]);
    const mixed = aggregateProducts(
      [
        o({ phone: "9200000001", ago: 60, items: [["A", 1, 1], ["B", 1, 1], ["C", 1, 1]] }),
        o({ phone: "9200000001", ago: 20 }),
      ],
      { from: new Date(NOW.getTime() - 30 * D), to: NOW },
      NOW,
      1,
    );
    expect(mixed.firstProduct).toEqual([{ label: MIXED_LABEL, buyers: 1, cameBack: 1, pct: 100 }]);
  });
});
