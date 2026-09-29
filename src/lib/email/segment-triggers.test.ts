import { describe, expect, it, vi } from "vitest";
import {
  DAY_MS,
  anniversaryYear,
  buildOrderStats,
  eligibleContacts,
  isRealOrder,
  pickForRun,
  planForFlow,
  runSegmentTriggers,
  selectAnniversary,
  selectSunset,
  selectVip,
  selectWinback,
  shouldSuppressAfterSunset,
  type OrderRow,
  type SegmentContact,
} from "./segment-triggers";

const NOW = Date.parse("2026-09-30T04:30:00Z"); // 10:00 IST

function contact(id: string, over: Partial<SegmentContact> = {}): SegmentContact {
  return { id, email: `${id}@x.in`, first_name: id.toUpperCase(), phone: null, status: "active", accepts_marketing: true, email_consent: null, ...over };
}
let oid = 0;
function order(over: Partial<OrderRow> & { daysAgo?: number }): OrderRow {
  const { daysAgo = 10, ...rest } = over;
  oid++;
  return {
    shopify_id: 1000 + oid,
    order_number: `#${1000 + oid}`,
    customer_email: null,
    customer_phone: null,
    total_price: 500,
    financial_status: "paid",
    cancelled_at: null,
    is_creator: false,
    shopify_created_at: new Date(NOW - daysAgo * DAY_MS).toISOString(),
    ...rest,
  };
}

describe("planForFlow", () => {
  it("reads segment configs with defaults", () => {
    expect(planForFlow({ id: "f", trigger_type: "segment_entry", trigger_config: { segment: "winback" } })).toEqual({ kind: "winback", days: 60, windowDays: 30, maxPerRun: 300 });
    expect(planForFlow({ id: "f", trigger_type: "segment_entry", trigger_config: { segment: "vip", min_spend: "5000", max_per_run: 50 } })).toEqual({ kind: "vip", minSpend: 5000, minOrders: 3, maxPerRun: 50 });
    expect(planForFlow({ id: "f", trigger_type: "segment_entry", trigger_config: { segment: "sunset" } }).kind).toBe("sunset");
    expect(planForFlow({ id: "f", trigger_type: "date_based", trigger_config: { kind: "first_order_anniversary" } }).kind).toBe("first_order_anniversary");
  });
  it("skips unknown, missing, external and birthday", () => {
    expect(planForFlow({ id: "f", trigger_type: "segment_entry", trigger_config: {} }).kind).toBe("unsupported");
    expect(planForFlow({ id: "f", trigger_type: "segment_entry", trigger_config: { segment: "referral" } }).kind).toBe("unsupported");
    expect(planForFlow({ id: "f", trigger_type: "segment_entry", trigger_config: { segment: "browse_abandon" } }).kind).toBe("external");
    expect(planForFlow({ id: "f", trigger_type: "date_based", trigger_config: {} }).kind).toBe("unsupported");
  });
  it("rejects nonsense numbers", () => {
    const p = planForFlow({ id: "f", trigger_type: "segment_entry", trigger_config: { segment: "winback", days_since_last_order: -4, max_per_run: "abc" } });
    expect(p).toMatchObject({ days: 60, maxPerRun: 300 });
  });
});

describe("orders", () => {
  it("excludes cancelled, voided, refunded, creator seeds and ₹0.01", () => {
    expect(isRealOrder(order({}))).toBe(true);
    expect(isRealOrder(order({ cancelled_at: "2026-01-01" }))).toBe(false);
    expect(isRealOrder(order({ financial_status: "refunded" }))).toBe(false);
    expect(isRealOrder(order({ financial_status: "voided" }))).toBe(false);
    expect(isRealOrder(order({ is_creator: true }))).toBe(false);
    expect(isRealOrder(order({ total_price: "0.01" }))).toBe(false);
  });
  it("joins on email case-insensitively, else phone last-10", () => {
    const cs = [contact("a", { email: "A@X.in" }), contact("b", { phone: "+91 98765 43210" })];
    const stats = buildOrderStats(
      [
        order({ customer_email: "a@x.IN", daysAgo: 100, total_price: 700 }),
        order({ customer_email: "a@x.in", daysAgo: 70, total_price: 300 }),
        order({ customer_phone: "919876543210", daysAgo: 5 }),
        order({ customer_email: "nobody@x.in" }),
        order({ customer_email: "a@x.in", daysAgo: 1, total_price: 0.01 }),
      ],
      cs,
    );
    const a = stats.get("a")!;
    expect(a.orders).toBe(2);
    expect(a.spend).toBe(1000);
    expect(Math.round((NOW - a.lastOrderAt) / DAY_MS)).toBe(70);
    expect(Math.round((NOW - a.firstOrderAt) / DAY_MS)).toBe(100);
    expect(stats.get("b")?.orders).toBe(1);
    expect(stats.size).toBe(2);
  });
});

describe("eligibleContacts", () => {
  it("requires email, active, consent, not suppressed", () => {
    const list = eligibleContacts(
      [
        contact("ok"),
        contact("sub", { accepts_marketing: null, email_consent: "SUBSCRIBED" }),
        contact("noemail", { email: null }),
        contact("inactive", { status: "unsubscribed" }),
        contact("noconsent", { accepts_marketing: false }),
        contact("supp"),
      ],
      new Set(["supp@x.in"]),
    );
    expect(list.map((c) => c.id)).toEqual(["ok", "sub"]);
  });
});

describe("selectors", () => {
  const cs = [contact("a"), contact("b"), contact("c"), contact("d")];
  const stats = buildOrderStats(
    [
      order({ customer_email: "a@x.in", daysAgo: 65 }), // in window
      order({ customer_email: "b@x.in", daysAgo: 95 }), // past window (60+30)
      order({ customer_email: "c@x.in", daysAgo: 30 }), // too recent
      order({ customer_email: "d@x.in", daysAgo: 200, total_price: 2500 }),
      order({ customer_email: "d@x.in", daysAgo: 85 }),
    ],
    cs,
  );

  it("win-back: last order in [60, 90] days, keyed by last order id", () => {
    const got = selectWinback(cs, stats, { days: 60, windowDays: 30 }, NOW);
    expect(got.map((c) => c.contactId).sort()).toEqual(["a", "d"]);
    const d = got.find((c) => c.contactId === "d")!;
    expect(d.dedupPrefix).toBe("winback");
    expect(d.entityRef).toBe(stats.get("d")!.lastOrderId);
  });

  it("vip: spend OR order threshold, keyed per contact", () => {
    const got = selectVip(cs, stats, { minSpend: 2000, minOrders: 3 });
    expect(got.map((c) => c.contactId)).toEqual(["d"]);
    expect(got[0].entityRef).toBe("d");
    expect(selectVip(cs, stats, { minSpend: 1e9, minOrders: 2 }).map((c) => c.contactId)).toEqual(["d"]);
  });

  it("sunset: enough sends, no engagement, monthly key", () => {
    const sends = new Map([["a", 6], ["b", 9], ["c", 2]]);
    const got = selectSunset(cs, sends, new Set(["b"]), { minSends: 5 }, NOW);
    expect(got.map((c) => c.contactId)).toEqual(["a"]);
    expect(got[0].entityRef).toBe("2026-09:a");
  });

  it("anniversary: same IST calendar day in a later year", () => {
    const first = Date.parse("2025-09-30T02:00:00+05:30");
    expect(anniversaryYear(first, NOW, 0)).toBe(2026);
    expect(anniversaryYear(Date.parse("2025-09-28T12:00:00+05:30"), NOW, 0)).toBeNull();
    expect(anniversaryYear(Date.parse("2025-09-28T12:00:00+05:30"), NOW, 3)).toBe(2026);
    expect(anniversaryYear(Date.parse("2026-09-30T01:00:00+05:30"), NOW, 3)).toBeNull(); // same year
    // Feb 29 celebrates Feb 28 in a non-leap year.
    expect(anniversaryYear(Date.parse("2024-02-29T12:00:00+05:30"), Date.parse("2027-02-28T10:00:00+05:30"), 0)).toBe(2027);
    const s = buildOrderStats([order({ customer_email: "a@x.in", shopify_created_at: new Date(first).toISOString() })], cs);
    const got = selectAnniversary(cs, s, { catchupDays: 3 }, NOW);
    expect(got.map((c) => c.entityRef)).toEqual(["2026:a"]);
  });
});

describe("pickForRun", () => {
  const mk = (id: string, priority: number) => ({ contactId: id, email: `${id}@x.in`, firstName: null, dedupPrefix: "vip", entityRef: id, context: {}, priority });
  it("drops existing keys and active contacts, caps by priority", () => {
    const r = pickForRun([mk("a", 3), mk("b", 1), mk("c", 2), mk("d", 0)], { keys: new Set(["vip:d"]), activeContacts: new Set(["c"]) }, 1);
    expect(r.alreadyEnrolled).toBe(2);
    expect(r.fresh.map((c) => c.contactId)).toEqual(["a", "b"]);
    expect(r.picked.map((c) => c.contactId)).toEqual(["b"]);
  });
});

describe("shouldSuppressAfterSunset", () => {
  it("only after a completed sequence with no engagement since entry", () => {
    expect(shouldSuppressAfterSunset({ enrolmentStatus: "completed", enteredAt: "2026-09-01", lastEngagedAt: null })).toBe(true);
    expect(shouldSuppressAfterSunset({ enrolmentStatus: "completed", enteredAt: "2026-09-01", lastEngagedAt: "2026-08-01" })).toBe(true);
    expect(shouldSuppressAfterSunset({ enrolmentStatus: "completed", enteredAt: "2026-09-01", lastEngagedAt: "2026-09-05" })).toBe(false);
    expect(shouldSuppressAfterSunset({ enrolmentStatus: "active", enteredAt: "2026-09-01", lastEngagedAt: null })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Orchestration against a tiny in-memory fake of the query builder.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>) {
  return {
    from(name: string) {
      let rows = [...(tables[name] ?? [])];
      const q = {
        select: () => q,
        not: (col: string) => ((rows = rows.filter((r) => r[col] != null)), q),
        is: (col: string) => ((rows = rows.filter((r) => r[col] == null)), q),
        eq: (col: string, v: unknown) => ((rows = rows.filter((r) => r[col] === v)), q),
        in: (col: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[col]))), q),
        gte: () => q,
        or: () => q,
        order: () => q,
        range: (a: number, b: number) => Promise.resolve({ data: rows.slice(a, b + 1), error: null }),
        then: (res: (v: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(res),
      };
      return q;
    },
  };
}

describe("runSegmentTriggers", () => {
  const tables = () => ({
    flows: [
      { id: "fw", name: "Win-back", trigger_type: "segment_entry", status: "active", trigger_config: { segment: "winback", max_per_run: 1 } },
      { id: "fx", name: "Referral", trigger_type: "segment_entry", status: "active", trigger_config: {} },
    ],
    contacts: [contact("a"), contact("b"), contact("c", { accepts_marketing: false })],
    shopify_orders: [
      order({ customer_email: "a@x.in", daysAgo: 70 }),
      order({ customer_email: "b@x.in", daysAgo: 80 }),
      order({ customer_email: "c@x.in", daysAgo: 75 }),
    ],
    flow_enrollments: [] as Row[],
  });

  it("dry run counts without enrolling", async () => {
    const enroll = vi.fn();
    const r = await runSegmentTriggers({ db: fakeDb(tables()) as never, enroll, fetchSuppressed: async () => new Set(), now: NOW }, { dry: true });
    expect(enroll).not.toHaveBeenCalled();
    const w = r.flows.find((f) => f.flow_id === "fw")!;
    expect(w).toMatchObject({ candidates: 2, already_enrolled: 0, would_enrol: 1, capped: 1 });
    expect(r.flows.find((f) => f.flow_id === "fx")?.skipped).toMatch(/no trigger_config.segment/);
  });

  it("enrols the capped pick with flowId + dedup, skipping existing keys", async () => {
    const t = tables();
    const bOrder = t.shopify_orders[1];
    t.flow_enrollments.push({ flow_id: "fw", dedup_key: `winback:${bOrder.shopify_id}`, contact_id: "b", status: "completed" });
    const enroll = vi.fn().mockResolvedValue(1);
    const r = await runSegmentTriggers({ db: fakeDb(t) as never, enroll, fetchSuppressed: async () => new Set(), now: NOW }, { dry: false });
    expect(enroll).toHaveBeenCalledTimes(1);
    expect(enroll).toHaveBeenCalledWith("segment_entry", expect.objectContaining({ email: "a@x.in", flowId: "fw", dedupPrefix: "winback" }));
    expect(r.enrolled).toBe(1);
    expect(r.flows.find((f) => f.flow_id === "fw")).toMatchObject({ already_enrolled: 1, enrolled: 1, failed: 0 });
  });
});
