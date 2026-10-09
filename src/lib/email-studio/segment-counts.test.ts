import { describe, expect, it } from "vitest";
import { PRESETS, countMatching, type AudienceContact } from "./segments";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const c = (p: Partial<AudienceContact>): AudienceContact => ({
  id: Math.random().toString(36).slice(2), email: "a@b.in", first_name: null, last_name: null, status: "active",
  accepts_marketing: true, email_consent: null, total_orders: 0, total_spent: 0, first_purchase_date: null,
  last_purchase_date: null, city: null, state: null, tags: null, ...p,
});

describe("countMatching", () => {
  it("counts each quick segment in one pass, with consent and suppression", () => {
    const contacts = [
      c({ total_orders: 4, first_purchase_date: daysAgo(400), last_purchase_date: daysAgo(10) }), // customer, VIP
      c({ total_orders: 1, first_purchase_date: daysAgo(5), last_purchase_date: daysAgo(5) }), // customer, new
      c({ total_orders: 2, first_purchase_date: daysAgo(300), last_purchase_date: daysAgo(200) }), // customer, lapsed
      c({ total_orders: 0 }), // prospect
      c({ total_orders: 5, accepts_marketing: false }), // no consent: never counted
      c({ total_orders: 5, email: "gone@b.in" }), // suppressed
      c({ total_orders: 5, email: null }), // phone-only
    ];
    const keys = ["all", "customers", "vip", "new", "lapsed", "prospects"];
    const counts = countMatching(contacts, keys.map((k) => PRESETS[k].rules), { now: NOW, suppressed: new Set(["gone@b.in"]) });
    expect(Object.fromEntries(keys.map((k, i) => [k, counts[i]]))).toEqual({
      all: 4, customers: 3, vip: 1, new: 1, lapsed: 1, prospects: 1,
    });
  });

  it("returns zeros for no contacts", () => {
    expect(countMatching([], [PRESETS.all.rules], { now: NOW, suppressed: new Set() })).toEqual([0]);
  });
});
