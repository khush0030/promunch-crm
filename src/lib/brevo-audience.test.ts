import { describe, expect, it } from "vitest";
import { marketingEligibility, aggregateOrders, rfmSegment, waIdOf, buildImportRow, type SyncContact, type SyncOrder } from "./brevo-audience";

const base: SyncContact = {
  id: "c1",
  email: "Buyer@Gmail.com",
  first_name: "Asha",
  last_name: " Rao ",
  city: "Indore",
  state: null,
  phone: "+91 98765 43210",
  status: "active",
  accepts_marketing: true,
  email_consent: "SUBSCRIBED",
  anonymized_at: null,
};

describe("marketingEligibility", () => {
  const none = new Set<string>();
  it("accepts opted-in active contacts", () => {
    expect(marketingEligibility(base, none)).toEqual({ ok: true });
    expect(marketingEligibility({ ...base, accepts_marketing: null, email_consent: "subscribed" }, none)).toEqual({ ok: true });
    expect(marketingEligibility({ ...base, email_consent: null }, none)).toEqual({ ok: true });
  });

  it("rejects without a positive opt-in", () => {
    expect(marketingEligibility({ ...base, accepts_marketing: false, email_consent: "NEVER_SUBSCRIBED" }, none)).toEqual({ ok: false, reason: "no_consent" });
    expect(marketingEligibility({ ...base, accepts_marketing: null, email_consent: null }, none)).toEqual({ ok: false, reason: "no_consent" });
  });

  it("unsubscribe beats accepts_marketing", () => {
    expect(marketingEligibility({ ...base, email_consent: "UNSUBSCRIBED" }, none)).toEqual({ ok: false, reason: "unsubscribed" });
    expect(marketingEligibility({ ...base, status: "unsubscribed" }, none)).toEqual({ ok: false, reason: "unsubscribed" });
  });

  it("rejects suppressed, bounced, anonymized and email-less contacts", () => {
    expect(marketingEligibility(base, new Set(["buyer@gmail.com"]))).toEqual({ ok: false, reason: "suppressed" });
    expect(marketingEligibility({ ...base, status: "bounced" }, none)).toEqual({ ok: false, reason: "not_active" });
    expect(marketingEligibility({ ...base, anonymized_at: "2026-01-01" }, none)).toEqual({ ok: false, reason: "anonymized" });
    expect(marketingEligibility({ ...base, email: null }, none)).toEqual({ ok: false, reason: "no_email" });
  });
});

describe("aggregateOrders", () => {
  const o = (p: Partial<SyncOrder>): SyncOrder => ({
    customer_email: "buyer@gmail.com",
    total_price: "499.00",
    shopify_created_at: "2026-07-01T10:00:00Z",
    source_name: "web",
    is_creator: false,
    cancelled_at: null,
    financial_status: "paid",
    ...p,
  });

  it("sums real orders and skips seeds, cancels, refunds and zero orders", () => {
    const m = aggregateOrders([
      o({}),
      o({ total_price: 650, shopify_created_at: "2026-08-10T10:00:00Z", source_name: "341128478721" }),
      o({ total_price: "0.01", is_creator: true }),
      o({ cancelled_at: "2026-07-02T00:00:00Z" }),
      o({ financial_status: "refunded" }),
      o({ customer_email: null }),
      o({ customer_email: "BUYER@gmail.com ", total_price: 0 }),
    ]);
    expect(m.get("buyer@gmail.com")).toEqual({ count: 2, spent: 1149, first: "2026-07-01T10:00:00Z", last: "2026-08-10T10:00:00Z", channel: "HYPD" });
    expect(m.size).toBe(1);
  });
});

describe("rfmSegment / waIdOf", () => {
  it("labels the rfm tag", () => {
    expect(rfmSegment(["tier:engaged", "rfm:at_risk"])).toBe("At risk");
    expect(rfmSegment(["rfm:vip"])).toBe("VIP");
    expect(rfmSegment(["rfm:some_new_bucket"])).toBe("some new bucket");
    expect(rfmSegment(null)).toBeNull();
  });
  it("normalises Indian numbers", () => {
    expect(waIdOf("+91 98765 43210")).toBe("919876543210");
    expect(waIdOf("9876543210")).toBe("919876543210");
    expect(waIdOf("12345")).toBeNull();
  });
});

describe("buildImportRow", () => {
  it("lowercases email, trims, omits nulls and rounds spend", () => {
    const row = buildImportRow(base, { count: 2, spent: 1149.005, first: "2026-07-01T10:00:00Z", last: "2026-08-10T10:00:00Z", channel: "HYPD" }, "At risk");
    expect(row).toEqual({
      email: "buyer@gmail.com",
      attributes: {
        FIRSTNAME: "Asha",
        LASTNAME: "Rao",
        CITY: "Indore",
        ORDER_COUNT: 2,
        TOTAL_SPENT: 1149.01,
        FIRST_ORDER_DATE: "2026-07-01",
        LAST_ORDER_DATE: "2026-08-10",
        RFM_SEGMENT: "At risk",
        CHANNEL: "HYPD",
        CRM_ID: "c1",
      },
    });
  });
  it("falls back to the contact's stored totals when no order row matches", () => {
    const row = buildImportRow({ ...base, total_orders: 3, total_spent: "1797.5", last_purchase_date: "2026-06-02T08:00:00Z" }, undefined, null);
    expect(row.attributes).toMatchObject({ ORDER_COUNT: 3, TOTAL_SPENT: 1797.5, LAST_ORDER_DATE: "2026-06-02" });
    expect(buildImportRow({ ...base, total_orders: 3 }, { count: 1, spent: 10, first: null, last: null, channel: null }, null).attributes.ORDER_COUNT).toBe(1);
  });

  it("writes zero orders for contacts without purchases", () => {
    expect(buildImportRow(base, undefined, null).attributes).toMatchObject({ ORDER_COUNT: 0, TOTAL_SPENT: 0 });
  });
});
