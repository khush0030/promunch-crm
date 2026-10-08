import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: {} }));

import { attributeOrders, touchesFrom } from "./campaign-attribution";

const DAY = 86400000;
const T0 = Date.UTC(2026, 9, 1);

describe("attributeOrders", () => {
  it("credits an order inside 7 days of the recipient's own touch", () => {
    const r = attributeOrders([{ campaignId: "a", phone: "91", at: T0 }], [{ phone: "91", at: T0 + 3 * DAY, total: 500 }]);
    expect(r.get("a")).toEqual({ orders: 1, revenue: 500 });
  });

  it("ignores orders after the window or before the touch", () => {
    const r = attributeOrders(
      [{ campaignId: "a", phone: "91", at: T0 }],
      [
        { phone: "91", at: T0 + 8 * DAY, total: 500 },
        { phone: "91", at: T0 - DAY, total: 500 },
      ],
    );
    expect(r.get("a")).toBeUndefined();
  });

  it("gives the order to the most recent touch only", () => {
    const r = attributeOrders(
      [
        { campaignId: "old", phone: "91", at: T0 },
        { campaignId: "new", phone: "91", at: T0 + DAY },
      ],
      [{ phone: "91", at: T0 + 2 * DAY, total: 300 }],
    );
    expect(r.get("new")?.orders).toBe(1);
    expect(r.get("old")).toBeUndefined();
  });
});

describe("touchesFrom", () => {
  it("keeps only delivered/read sends with a known phone", () => {
    const phones = new Map([["c1", "91"], ["c2", null]]);
    const t = touchesFrom(
      [
        { campaign_id: "a", contact_id: "c1", status: "read", created_at: new Date(T0).toISOString() },
        { campaign_id: "a", contact_id: "c1", status: "sent", created_at: new Date(T0).toISOString() },
        { campaign_id: "a", contact_id: "c2", status: "delivered", created_at: new Date(T0).toISOString() },
        { campaign_id: "a", contact_id: null, status: "delivered", created_at: new Date(T0).toISOString() },
      ],
      (id) => phones.get(id),
    );
    expect(t).toEqual([{ campaignId: "a", phone: "91", at: T0 }]);
  });
});
