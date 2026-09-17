import { describe, expect, it } from "vitest";
import {
  waFilterPlan,
  waMatchesSql,
  igFilterPlan,
  igMatchesSql,
  emFilterPlan,
  emMatchesSql,
} from "./filters";
import {
  waToItem,
  igToItem,
  emailToItem,
  matchesFilter,
  type WaThreadRow,
  type IgThreadRow,
  type EmailThreadRow,
  type InboxFilter,
} from "./conversations";

const ME = "kmutha@vippysoya.com";
const FILTERS: InboxFilter[] = ["human", "mine", "bot", "all"];

// ---- exact clause-string assertions, one per channel × filter ----

describe("waFilterPlan — exact clause strings", () => {
  it("human", () => {
    expect(waFilterPlan("human", ME)).toEqual({
      type: "or",
      clause: "status.eq.human,ticket_status.in.(open,pending)",
    });
  });

  it("bot", () => {
    expect(waFilterPlan("bot", ME)).toEqual({
      type: "eqOr",
      column: "status",
      value: "bot",
      clause: "ticket_status.is.null,ticket_status.not.in.(open,pending)",
    });
  });

  it("mine", () => {
    expect(waFilterPlan("mine", ME)).toEqual({
      type: "or",
      clause: 'assigned_to.ilike."kmutha@vippysoya.com",and(assigned_to.is.null,ticket_assignee.ilike."kmutha@vippysoya.com")',
    });
  });

  it("all", () => {
    expect(waFilterPlan("all", ME)).toEqual({ type: "none" });
  });
});

describe("igFilterPlan — exact clause strings", () => {
  it("human", () => {
    expect(igFilterPlan("human", ME)).toEqual({
      type: "or",
      clause: "status.eq.human,ticket_status.eq.open",
    });
  });

  it("bot", () => {
    expect(igFilterPlan("bot", ME)).toEqual({
      type: "eqOr",
      column: "status",
      value: "bot",
      clause: "ticket_status.is.null,ticket_status.neq.open",
    });
  });

  it("mine", () => {
    expect(igFilterPlan("mine", ME)).toEqual({
      type: "or",
      clause: 'assigned_to.ilike."kmutha@vippysoya.com"',
    });
  });

  it("all", () => {
    expect(igFilterPlan("all", ME)).toEqual({ type: "none" });
  });
});

describe("emFilterPlan — exact clause strings", () => {
  it("human", () => {
    expect(emFilterPlan("human")).toEqual({
      type: "eqOr",
      column: "status",
      value: "pending",
      clause: "should_reply.is.null,should_reply.eq.true",
    });
  });

  it("bot and mine are both skipped — email has no bot/assignee model", () => {
    expect(emFilterPlan("bot")).toEqual({ type: "skip" });
    expect(emFilterPlan("mine")).toEqual({ type: "skip" });
  });

  it("all", () => {
    expect(emFilterPlan("all")).toEqual({ type: "none" });
  });
});

// ---- table test: the SQL-mirroring predicate must agree with matchesFilter
// over the mapped item, for every fixture row and every filter ----

function waRow(overrides: Partial<WaThreadRow> = {}): WaThreadRow {
  return {
    id: "w1",
    status: "bot",
    assigned_to: null,
    ticket_status: null,
    ticket_number: null,
    ticket_assignee: null,
    unread_count: null,
    last_message_snippet: null,
    last_activity_at: "2026-09-15T10:00:00.000Z",
    created_at: "2026-09-15T09:00:00.000Z",
    archived_at: null,
    contact: { name: "Priya Sharma", phone: "+919000000001", wa_id: "919000000001" },
    ...overrides,
  };
}

function igRow(overrides: Partial<IgThreadRow> = {}): IgThreadRow {
  return {
    id: "i1",
    status: "bot",
    classification: null,
    handle: "priya.eats",
    full_name: "Priya Eats",
    ticket_status: null,
    assigned_to: null,
    unread_count: null,
    last_message_snippet: null,
    last_activity_at: "2026-09-15T11:00:00.000Z",
    archived_at: null,
    ...overrides,
  };
}

function emailRow(overrides: Partial<EmailThreadRow> = {}): EmailThreadRow {
  return {
    id: "e1",
    status: "pending",
    should_reply: true,
    from_name: "Rohan Mehta",
    from_email: "rohan@example.com",
    subject: "Bulk order inquiry",
    lead_category: "wholesale",
    urgency: null,
    created_at: "2026-09-15T08:00:00.000Z",
    ...overrides,
  };
}

describe("waMatchesSql agrees with matchesFilter(waToItem(row)) for every fixture × filter", () => {
  const fixtures: [string, Partial<WaThreadRow>][] = [
    ["bot, no ticket", { status: "bot", ticket_status: null }],
    ["bot, but an open ticket makes it active (not bot)", { status: "bot", ticket_status: "open" }],
    ["human status", { status: "human" }],
    ["snoozed with a pending ticket", { status: "snoozed", ticket_status: "pending" }],
    ["closed, no ticket", { status: "closed", ticket_status: "resolved" }],
    ["assigned_to matches me", { assigned_to: ME }],
    ["assigned_to matches me, different case", { assigned_to: "KMutha@VippySoya.com" }],
    ["assigned_to is someone else", { assigned_to: "narendra@vippysoya.com" }],
    ["assigned_to null, ticket_assignee matches me", { assigned_to: null, ticket_assignee: ME }],
    [
      "assigned_to is someone else AND ticket_assignee is me — assigned_to wins (not mine)",
      { assigned_to: "narendra@vippysoya.com", ticket_assignee: ME },
    ],
    ["assigned_to empty string (not null) — no fallback to ticket_assignee", { assigned_to: "", ticket_assignee: ME }],
    ["neither assignee set", { assigned_to: null, ticket_assignee: null }],
  ];

  for (const [label, overrides] of fixtures) {
    for (const filter of FILTERS) {
      it(`${label} — filter=${filter}`, () => {
        const row = waRow(overrides);
        expect(waMatchesSql(row, filter, ME)).toBe(matchesFilter(waToItem(row), filter, ME));
      });
    }
  }
});

describe("igMatchesSql agrees with matchesFilter(igToItem(row)) for every fixture × filter", () => {
  const fixtures: [string, Partial<IgThreadRow>][] = [
    ["bot, no ticket", { status: "bot", ticket_status: null }],
    ["bot, but an open ticket makes it active (not bot)", { status: "bot", ticket_status: "open" }],
    ["human status", { status: "human" }],
    ["assigned_to matches me", { assigned_to: ME }],
    ["assigned_to matches me, different case", { assigned_to: "KMutha@VippySoya.com" }],
    ["assigned_to is someone else", { assigned_to: "narendra@vippysoya.com" }],
    ["assigned_to null", { assigned_to: null }],
  ];

  for (const [label, overrides] of fixtures) {
    for (const filter of FILTERS) {
      it(`${label} — filter=${filter}`, () => {
        const row = igRow(overrides);
        expect(igMatchesSql(row, filter, ME)).toBe(matchesFilter(igToItem(row), filter, ME));
      });
    }
  }
});

describe("emMatchesSql agrees with matchesFilter(emailToItem(row)) for every fixture × filter", () => {
  const fixtures: [string, Partial<EmailThreadRow>][] = [
    ["pending, should_reply true", { status: "pending", should_reply: true }],
    ["pending, should_reply null", { status: "pending", should_reply: null }],
    ["pending, should_reply explicitly false", { status: "pending", should_reply: false }],
    ["sent", { status: "sent" }],
    ["skipped", { status: "skipped" }],
    ["failed", { status: "failed" }],
  ];

  for (const [label, overrides] of fixtures) {
    for (const filter of FILTERS) {
      it(`${label} — filter=${filter}`, () => {
        const row = emailRow(overrides);
        expect(emMatchesSql(row, filter)).toBe(matchesFilter(emailToItem(row), filter, ME));
      });
    }
  }
});
