import { describe, expect, it } from "vitest";
import { dueEvents, buildEvent, planEvents, type EventOrder } from "./brevo-events-plan";
import type { SyncContact } from "./brevo-audience";

const now = new Date("2026-09-17T06:00:00Z");

const order = (p: Partial<EventOrder> = {}): EventOrder => ({
  id: "o1",
  shopify_id: 555,
  order_number: 2101,
  total_price: "649.00",
  currency: "INR",
  customer_email: null,
  customer_phone: "+919876543210",
  customer_name: "Asha Rao",
  line_items: [{ title: "Crunchies", quantity: 2, price: "299.00", sku: "CR-1" }],
  shopify_created_at: "2026-09-16T10:00:00Z",
  fulfillment_status: null,
  financial_status: "paid",
  cancelled_at: null,
  source_name: "web",
  is_creator: false,
  customer_order_index: 1,
  ...p,
});

const contact: SyncContact = {
  id: "c1",
  email: "asha@gmail.com",
  first_name: "Asha",
  last_name: "Rao",
  city: null,
  state: null,
  phone: "9876543210",
  status: "active",
  accepts_marketing: true,
  email_consent: "SUBSCRIBED",
  anonymized_at: null,
};

const baseInput = {
  claimed: new Set<string>(),
  contactsByEmail: new Map([["asha@gmail.com", contact]]),
  emailByWaId: new Map([["919876543210", "asha@gmail.com"]]),
  suppressed: new Set<string>(),
  target: "live" as const,
  testEmails: new Set(["kmutha@vippysoya.com"]),
  now,
};

describe("dueEvents", () => {
  it("places, fulfils and cancels; skips creator seeds and zero orders", () => {
    expect(dueEvents(order())).toEqual(["order_placed"]);
    expect(dueEvents(order({ fulfillment_status: "fulfilled" }))).toEqual(["order_placed", "order_fulfilled"]);
    expect(dueEvents(order({ cancelled_at: "2026-09-16T12:00:00Z" }))).toEqual(["order_placed", "order_cancelled"]);
    expect(dueEvents(order({ is_creator: true }))).toEqual([]);
    expect(dueEvents(order({ total_price: "0.01" }))).toEqual([]);
  });
});

describe("buildEvent", () => {
  it("builds Brevo's event shape", () => {
    const e = buildEvent(order({ financial_status: "pending" }), "order_placed", "asha@gmail.com", now);
    expect(e).toMatchObject({
      event_name: "order_placed",
      event_date: "2026-09-16T10:00:00Z",
      identifiers: { email_id: "asha@gmail.com" },
      contact_properties: { FIRSTNAME: "Asha" },
      event_properties: { order_id: "555", order_number: "2101", total: 649, first_order: true, payment: "COD", channel: "D2C site" },
    });
    expect((e.event_properties.items as unknown[])[0]).toMatchObject({ title: "Crunchies", quantity: 2, price: 299 });
  });
});

describe("planEvents", () => {
  it("resolves email by phone and plans only unclaimed events for consented contacts", () => {
    const r = planEvents({ ...baseInput, orders: [order({ fulfillment_status: "fulfilled" })], claimed: new Set(["o1:order_placed"]) });
    expect(r.planned.map((p) => p.event)).toEqual(["order_fulfilled"]);
    expect(r.planned[0].email).toBe("asha@gmail.com");
  });

  it("skips no-email, no-consent and suppressed customers in live mode", () => {
    const r = planEvents({
      ...baseInput,
      orders: [
        order({ id: "a", customer_phone: null }),
        order({ id: "b", customer_email: "stranger@x.com" }),
        order({ id: "c" }),
      ],
      contactsByEmail: new Map([["asha@gmail.com", { ...contact, accepts_marketing: false, email_consent: "NEVER_SUBSCRIBED" }]]),
    });
    expect(r.planned).toEqual([]);
    expect(r.skipped).toEqual({ no_email: 1, no_crm_contact: 1, no_consent: 1 });
  });

  it("only events test addresses in test mode", () => {
    const r = planEvents({ ...baseInput, target: "test", orders: [order({ id: "a" }), order({ id: "b", customer_email: "KMutha@vippysoya.com", customer_phone: null })] });
    expect(r.planned.map((p) => p.orderId)).toEqual(["b"]);
    expect(r.skipped).toEqual({ not_test_address: 1 });
  });
});
