import { describe, it, expect } from "vitest";
import { buildAttention, shortProductName, type AttentionInput } from "./attention";

const now = new Date("2026-09-15T12:00:00.000Z");

function baseInput(overrides: Partial<AttentionInput> = {}): AttentionInput {
  return {
    now,
    amazonInventory: [],
    amazonFinanceItems: [],
    codOrders: [],
    tickets: [],
    emailDrafts: [],
    pausedCampaigns: [],
    ...overrides,
  };
}

describe("buildAttention", () => {
  it("returns an empty feed when nothing needs attention", () => {
    const out = buildAttention(baseInput());
    expect(out.items).toEqual([]);
    expect(out.counts).toEqual({
      open: 0,
      byHub: { Today: 0, Sales: 0, Inbox: 0, Marketing: 0, Partners: 0, System: 0 },
      orders: 0,
      inbox: 0,
    });
  });

  it("flags an out-of-stock Amazon SKU with lost profit per day, ignoring non-Shipment/stale events", () => {
    const out = buildAttention(
      baseInput({
        amazonInventory: [
          { seller_sku: "PP-100", product_name: "Peri Peri Chips 100g", fulfillable_quantity: 0, inbound_shipped: 0 },
        ],
        amazonFinanceItems: [
          // 10 units sold @ net 40 each inside the 30d window -> counted
          { seller_sku: "PP-100", event_type: "Shipment", posted_date: "2026-09-10T00:00:00.000Z", quantity: 10, net: 400 },
          // Refund event -> excluded from the unit-economics average
          { seller_sku: "PP-100", event_type: "Refund", posted_date: "2026-09-10T00:00:00.000Z", quantity: 1, net: -40 },
          // Older than 30d -> excluded
          { seller_sku: "PP-100", event_type: "Shipment", posted_date: "2026-07-01T00:00:00.000Z", quantity: 50, net: 2000 },
        ],
      }),
    );

    expect(out.items).toHaveLength(1);
    const item = out.items[0];
    expect(item.id).toBe("amazon-stockout-PP-100");
    expect(item.group).toBe("money");
    expect(item.severity).toBe("crit");
    expect(item.href).toBe("/dashboard/sales/amazon?tab=stock");
    expect(item.cta).toBe("Restock");
    // velocity = 10/30 units/day, avg net/unit = 400/10 = 40 -> lost/day = 10/30*40 = 13.33
    expect(item.amount).toBeCloseTo(13.33, 2);
    expect(item.amountLabel).toBe("per day");
  });

  it("does not flag a SKU with zero fulfillable stock but no recent sales", () => {
    const out = buildAttention(
      baseInput({
        amazonInventory: [{ seller_sku: "DEAD-1", product_name: "Discontinued", fulfillable_quantity: 0, inbound_shipped: 0 }],
        amazonFinanceItems: [],
      }),
    );
    expect(out.items).toEqual([]);
  });

  it("combines SKUs with 1-9 days of stock left into one warn item", () => {
    const out = buildAttention(
      baseInput({
        amazonInventory: [
          // velocity 1/day, fulfillable 5 -> 5 days cover
          { seller_sku: "A", product_name: "A", fulfillable_quantity: 5, inbound_shipped: 0 },
          // velocity 1/day, fulfillable 3 -> 3 days cover (soonest)
          { seller_sku: "B", product_name: "B", fulfillable_quantity: 3, inbound_shipped: 0 },
          // velocity 1/day, fulfillable 20 -> 20 days cover, not low
          { seller_sku: "C", product_name: "C", fulfillable_quantity: 20, inbound_shipped: 0 },
        ],
        amazonFinanceItems: ["A", "B", "C"].map((sku) => ({
          seller_sku: sku,
          event_type: "Shipment",
          posted_date: "2026-09-10T00:00:00.000Z",
          quantity: 30,
          net: 300,
        })),
      }),
    );
    expect(out.items).toHaveLength(1);
    expect(out.items[0].id).toBe("amazon-low-stock");
    expect(out.items[0].severity).toBe("warn");
    expect(out.items[0].count).toBe(2);
    expect(out.items[0].context).toContain("3 day");
  });

  it("summarizes COD needs-call orders with sum, count and oldest age", () => {
    const out = buildAttention(
      baseInput({
        codOrders: [
          { shopify_id: 1, total_price: "500", shopify_created_at: "2026-09-14T12:00:00.000Z" }, // 1 day old
          { shopify_id: 2, total_price: "300.50", shopify_created_at: "2026-09-13T06:00:00.000Z" }, // oldest
        ],
      }),
    );
    expect(out.items).toHaveLength(1);
    const item = out.items[0];
    expect(item.id).toBe("cod-needs-call");
    expect(item.group).toBe("money");
    expect(item.severity).toBe("crit");
    expect(item.amount).toBeCloseTo(800.5, 2);
    expect(item.amountLabel).toBe("on hold");
    expect(item.count).toBe(2);
    expect(item.context).toBe("oldest 2d");
    expect(item.href).toBe("/dashboard/sales/orders");
    expect(item.cta).toBe("Call list");
    expect(out.counts.orders).toBe(2);
  });

  it("summarizes open WhatsApp tickets and pending email drafts", () => {
    const out = buildAttention(
      baseInput({
        tickets: [
          { id: "t1", ticket_opened_at: "2026-09-15T06:00:00.000Z" }, // 6h old
          { id: "t2", ticket_opened_at: "2026-09-15T00:00:00.000Z" }, // 12h old, oldest
        ],
        emailDrafts: [{ id: "d1" }],
      }),
    );
    const ticket = out.items.find((i) => i.id === "wa-tickets-open")!;
    expect(ticket.group).toBe("customers");
    expect(ticket.severity).toBe("warn");
    expect(ticket.count).toBe(2);
    expect(ticket.context).toBe("oldest 12h");
    expect(ticket.href).toBe("/dashboard/whatsapp?tab=tickets");

    const draft = out.items.find((i) => i.id === "email-drafts-pending")!;
    expect(draft.group).toBe("customers");
    expect(draft.severity).toBe("info");
    expect(draft.count).toBe(1);
    expect(draft.href).toBe("/dashboard/support-emails");

    expect(out.counts.inbox).toBe(3); // 2 tickets + 1 draft
    expect(out.counts.byHub.Inbox).toBe(2); // 2 items (ticket item + draft item)
  });

  it("lists a campaign deferred by Meta's marketing cap, but not one already due to resume", () => {
    const out = buildAttention(
      baseInput({
        pausedCampaigns: [
          { id: "c1", name: "Edamame launch", resume_at: "2026-09-16T00:00:00.000Z" }, // future -> flagged
          { id: "c2", name: "Old batch", resume_at: "2026-09-15T00:00:00.000Z" }, // already past -> not flagged
          { id: "c3", name: "No resume set", resume_at: null }, // not a cap defer -> not flagged
        ],
      }),
    );
    expect(out.items).toHaveLength(1);
    const item = out.items[0];
    expect(item.id).toBe("campaign-paused-c1");
    expect(item.group).toBe("marketing");
    expect(item.severity).toBe("info");
    expect(item.title).toBe("Edamame launch");
    expect(item.context).toBe("Paused by Meta's daily marketing limit");
    expect(item.href).toBe("/dashboard/whatsapp?tab=campaigns");
  });

  it("sorts by amount desc, then items without an amount, then severity", () => {
    const out = buildAttention(
      baseInput({
        codOrders: [{ shopify_id: 1, total_price: "100", shopify_created_at: "2026-09-14T00:00:00.000Z" }],
        amazonInventory: [{ seller_sku: "X", product_name: "X", fulfillable_quantity: 0, inbound_shipped: 0 }],
        amazonFinanceItems: [
          { seller_sku: "X", event_type: "Shipment", posted_date: "2026-09-10T00:00:00.000Z", quantity: 30, net: 30000 },
        ],
        tickets: [{ id: "t1", ticket_opened_at: "2026-09-15T00:00:00.000Z" }],
        pausedCampaigns: [{ id: "c1", name: "Camp", resume_at: "2026-09-16T00:00:00.000Z" }],
      }),
    );
    // amazon stockout has the largest amount (30/30*1000=1000/day), then COD (100), then
    // no-amount items ordered by severity (tickets=warn before campaign=info).
    expect(out.items.map((i) => i.id)).toEqual([
      "amazon-stockout-X",
      "cod-needs-call",
      "wa-tickets-open",
      "campaign-paused-c1",
    ]);
  });

  it("groups several stock-outs into one row, oldest since, summed loss", () => {
    const out = buildAttention(
      baseInput({
        amazonInventory: [
          { seller_sku: "NEWER", product_name: "Newer stockout", fulfillable_quantity: 0, inbound_shipped: 0 },
          { seller_sku: "OLDER", product_name: "Older stockout", fulfillable_quantity: 0, inbound_shipped: 0 },
        ],
        amazonFinanceItems: [
          { seller_sku: "NEWER", event_type: "Shipment", posted_date: "2026-09-01T00:00:00.000Z", quantity: 10, net: 400 },
          { seller_sku: "OLDER", event_type: "Shipment", posted_date: "2026-08-20T00:00:00.000Z", quantity: 10, net: 400 },
        ],
      }),
    );
    expect(out.items).toHaveLength(1);
    const it0 = out.items[0];
    expect(it0.id).toBe("amazon-stockouts");
    expect(it0.title).toBe("2 products out of stock on Amazon");
    expect(it0.context).toBe("Newer stockout, Older stockout");
    expect(it0.count).toBe(2);
    expect(it0.amount).toBeCloseTo(26.67, 2);
    expect(it0.since).toBe("2026-08-20T00:00:00.000Z");
  });

  it("breaks a tie on equal amount and severity by age, oldest first", () => {
    const out = buildAttention(
      baseInput({
        codOrders: [{ shopify_id: 1, total_price: "400", shopify_created_at: "2026-09-01T00:00:00.000Z" }],
        amazonInventory: [{ seller_sku: "X", product_name: "X", fulfillable_quantity: 0, inbound_shipped: 0 }],
        amazonFinanceItems: [
          // 30 units × ₹400 net / 30 days = ₹400 per day, same as the COD hold.
          { seller_sku: "X", event_type: "Shipment", posted_date: "2026-08-20T00:00:00.000Z", quantity: 30, net: 12000 },
        ],
      }),
    );
    expect(out.items).toHaveLength(2);
    expect(out.items[0].amount).toBe(out.items[1].amount);
    expect(out.items[0].severity).toBe(out.items[1].severity);
    expect(out.items.map((i) => i.id)).toEqual(["amazon-stockout-X", expect.stringContaining("cod")]);
  });

  it("computes byHub counts across sources", () => {
    const out = buildAttention(
      baseInput({
        codOrders: [{ shopify_id: 1, total_price: "100", shopify_created_at: "2026-09-14T00:00:00.000Z" }],
        amazonInventory: [{ seller_sku: "X", product_name: "X", fulfillable_quantity: 0, inbound_shipped: 0 }],
        amazonFinanceItems: [
          { seller_sku: "X", event_type: "Shipment", posted_date: "2026-09-10T00:00:00.000Z", quantity: 5, net: 500 },
        ],
        tickets: [{ id: "t1", ticket_opened_at: "2026-09-15T00:00:00.000Z" }],
        emailDrafts: [{ id: "d1" }],
        pausedCampaigns: [{ id: "c1", name: "Camp", resume_at: "2026-09-16T00:00:00.000Z" }],
      }),
    );
    expect(out.counts.byHub).toEqual({
      Today: 5,
      Sales: 2, // amazon stockout + cod
      Inbox: 2, // ticket + draft
      Marketing: 1,
      Partners: 0,
      System: 0,
    });
    expect(out.counts.open).toBe(5);
  });
});

describe("shortProductName", () => {
  it("keeps the part before the first comma, pipe or bracket", () => {
    expect(shortProductName("PROMUNCH Rakhi Gift Hamper for Brother Sister, Healthy Raksha Bandhan Gift Box")).toBe("PROMUNCH Rakhi Gift Hamper for Brother Sister");
    expect(shortProductName("Vama SOYA Flour Enriched with 50% Protein | Low Carb")).toBe("Vama SOYA Flour Enriched with 50% Protein");
    expect(shortProductName("PROMUNCH High-Protein Roasted Soya Snack, 200g")).toBe("PROMUNCH High-Protein Roasted Soya Snack");
  });
  it("caps very long names and handles empty", () => {
    expect(shortProductName("A".repeat(80)).length).toBe(46);
    expect(shortProductName(null)).toBe("");
  });
});
