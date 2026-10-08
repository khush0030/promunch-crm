import { describe, expect, it } from "vitest";
import { buildContext, orderState, payWord, tagWord, topicWord, type CtxInput, type CtxOrderRow } from "./context";

function order(p: Partial<CtxOrderRow>): CtxOrderRow {
  return {
    shopify_id: 1,
    order_number: "2811",
    total_price: "599.00",
    currency: "INR",
    financial_status: "paid",
    fulfillment_status: null,
    cancelled_at: null,
    confirmation_status: null,
    line_items: [{ title: "Masala Mania 100g", quantity: 2 }],
    shopify_created_at: "2026-10-03T10:00:00Z",
    ...p,
  };
}

const base: CtxInput = {
  open: { channel: "wa", id: "t1" },
  fallbackName: "+91 98765",
  email: null,
  waContact: { wa_id: "919876543210", phone: "+919876543210", name: "Sneha Kulkarni", email: null, tags: ["rfm:at_risk"], opted_in: true, created_at: "2026-08-01T00:00:00Z" },
  waThread: {
    id: "t1",
    status: "human",
    ticket_status: "open",
    ticket_number: 1186,
    ticket_category: "delivery",
    ticket_subject: null,
    escalation_reason: null,
    ticket_opened_at: "2026-10-09T04:13:00Z",
    ticket_resolved_at: null,
    last_message_snippet: "Yes please",
    last_activity_at: "2026-10-09T04:13:00Z",
    created_at: "2026-08-01T00:00:00Z",
  },
  waMessages: [],
  crm: null,
  orders: [],
  emails: [],
};

describe("buildContext", () => {
  it("counts orders and spend, skipping HYPD seeds and cancelled orders", () => {
    const ctx = buildContext({
      ...base,
      orders: [
        order({ order_number: "3", total_price: "0.01" }),
        order({ order_number: "2", total_price: "549", cancelled_at: "2026-09-01T00:00:00Z" }),
        order({ order_number: "1", total_price: "599" }),
      ],
    });
    expect(ctx.stats.orders).toBe(1);
    expect(ctx.stats.spent).toBe(599);
    expect(ctx.orders.map((o) => o.number)).toEqual(["#2", "#1"]);
    expect(ctx.orders[1].items).toBe("Masala Mania 100g × 2");
  });

  it("reports the newest COD gate status", () => {
    const ctx = buildContext({
      ...base,
      orders: [order({ order_number: "9", confirmation_status: "needs_call", financial_status: "pending" }), order({ confirmation_status: "confirmed" })],
    });
    expect(ctx.cod).toMatchObject({ orderNumber: "#9", tone: "crit" });
    expect(ctx.orders[0].pay).toBe("COD");
    expect(ctx.orders[0].state.text).toBe("COD not confirmed");
  });

  it("lists the thread ticket and tags, never repeating the open chat as history", () => {
    const ctx = buildContext(base);
    expect(ctx.tickets).toHaveLength(1);
    expect(ctx.tickets[0]).toMatchObject({ number: 1186, open: true, topic: "Delivery" });
    expect(ctx.whatsapp?.isOpen).toBe(true);
    expect(ctx.tags.map((t) => t.text)).toEqual(["WhatsApp opted in", "No email", "At risk"]);
    expect(ctx.person.name).toBe("Sneha Kulkarni");
    expect(ctx.person.since).toBe("Aug 2026");
  });

  it("marks the open email and keeps a WhatsApp excerpt for email views", () => {
    const ctx = buildContext({
      ...base,
      open: { channel: "em", id: "e1" },
      email: "sneha@example.com",
      waMessages: [{ direction: "inbound", body: "Hi  there", type: "text", created_at: "2026-10-09T04:00:00Z" }],
      emails: [{ id: "e1", subject: "Order", status: "pending", lead_category: null, created_at: "2026-10-09T05:00:00Z" }],
    });
    expect(ctx.emails[0]).toMatchObject({ isOpen: true, status: { text: "Draft ready" } });
    expect(ctx.whatsapp?.isOpen).toBe(false);
    expect(ctx.whatsapp?.messages).toEqual([{ mine: false, text: "Hi there", at: "2026-10-09T04:00:00Z" }]);
    expect(ctx.tags.some((t) => t.text === "No email")).toBe(false);
  });
});

describe("words", () => {
  it("maps payment, state, tags and topics", () => {
    expect(payWord({ financial_status: "paid", confirmation_status: null })).toBe("Prepaid");
    expect(payWord({ financial_status: "refunded", confirmation_status: "confirmed" })).toBe("Refunded");
    expect(orderState({ fulfillment_status: "fulfilled", cancelled_at: null, confirmation_status: null, financial_status: "paid" }).text).toBe("Shipped");
    expect(tagWord("rfm:champions")).toBe("Champions");
    expect(tagWord("buyer")).toBe("buyer");
    expect(tagWord("tier:engaged")).toBe("Engaged");
    expect(topicWord(null)).toBe("General");
    expect(topicWord("wrong_item")).toBe("Wrong item");
  });
});
