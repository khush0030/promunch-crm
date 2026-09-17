import { describe, it, expect } from "vitest";
import {
  waToItem,
  igToItem,
  emailToItem,
  matchesFilter,
  mergeItems,
  nextCursor,
  countFilters,
  type WaThreadRow,
  type IgThreadRow,
  type EmailThreadRow,
  type InboxItem,
} from "./conversations";

function waRow(overrides: Partial<WaThreadRow> = {}): WaThreadRow {
  return {
    id: "w1",
    status: "bot",
    assigned_to: null,
    ticket_status: null,
    ticket_number: null,
    ticket_assignee: null,
    unread_count: null,
    last_message_snippet: "Hey, is this in stock?",
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
    last_message_snippet: "Love your chips!",
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

describe("waToItem", () => {
  it("is Bot info when status is bot and there is no active ticket", () => {
    const item = waToItem(waRow({ status: "bot" }));
    expect(item.pill).toEqual({ tone: "info", text: "Bot" });
    expect(item.needsHuman).toBe(false);
    expect(item.bot).toBe(true);
  });

  it("is a warn Needs a human pill when status is human and there is no ticket", () => {
    const item = waToItem(waRow({ status: "human" }));
    expect(item.pill).toEqual({ tone: "warn", text: "Needs a human" });
    expect(item.needsHuman).toBe(true);
    expect(item.bot).toBe(false);
  });

  it("is a good Closed pill when status is closed and there is no ticket", () => {
    const item = waToItem(waRow({ status: "closed" }));
    expect(item.pill).toEqual({ tone: "good", text: "Closed" });
    expect(item.needsHuman).toBe(false);
    expect(item.bot).toBe(false);
  });

  it("an open ticket wins over bot status with a crit Ticket # pill", () => {
    const item = waToItem(waRow({ status: "bot", ticket_status: "open", ticket_number: 42 }));
    expect(item.pill).toEqual({ tone: "crit", text: "Ticket #42" });
    expect(item.needsHuman).toBe(true);
    expect(item.bot).toBe(false);
  });

  it("a pending ticket also wins over human status with a crit Ticket # pill", () => {
    const item = waToItem(waRow({ status: "human", ticket_status: "pending", ticket_number: 7 }));
    expect(item.pill).toEqual({ tone: "crit", text: "Ticket #7" });
    expect(item.needsHuman).toBe(true);
  });

  it("an active ticket with no ticket_number shows plain Ticket, no #", () => {
    const item = waToItem(waRow({ status: "bot", ticket_status: "open", ticket_number: null }));
    expect(item.pill).toEqual({ tone: "crit", text: "Ticket" });
    expect(item.needsHuman).toBe(true);
  });

  it("snoozed status with no ticket is still an info Bot pill, but bot stays false (literal brief rule: bot only when status is exactly \"bot\")", () => {
    const item = waToItem(waRow({ status: "snoozed" }));
    expect(item.pill).toEqual({ tone: "info", text: "Bot" });
    expect(item.needsHuman).toBe(false);
    expect(item.bot).toBe(false);
  });

  it("falls back at → created_at when last_activity_at is null", () => {
    const item = waToItem(waRow({ last_activity_at: null, created_at: "2026-09-10T00:00:00.000Z" }));
    expect(item.at).toBe("2026-09-10T00:00:00.000Z");
  });

  it("name falls back contact.name → phone → wa_id", () => {
    expect(waToItem(waRow({ contact: { name: "  Priya  ", phone: "+91900", wa_id: "919000" } })).name).toBe(
      "Priya",
    );
    expect(waToItem(waRow({ contact: { name: "   ", phone: "+91900", wa_id: "919000" } })).name).toBe("+91900");
    expect(waToItem(waRow({ contact: { name: null, phone: null, wa_id: "919000" } })).name).toBe("919000");
    expect(waToItem(waRow({ contact: null })).name).toBe("");
  });

  it("assignee is assigned_to falling back to ticket_assignee", () => {
    expect(waToItem(waRow({ assigned_to: "khush@trypromunch.in", ticket_assignee: "narendra@trypromunch.in" })).assignee).toBe(
      "khush@trypromunch.in",
    );
    expect(waToItem(waRow({ assigned_to: null, ticket_assignee: "narendra@trypromunch.in" })).assignee).toBe(
      "narendra@trypromunch.in",
    );
  });

  it("unread defaults to 0 when unread_count is null", () => {
    expect(waToItem(waRow({ unread_count: null })).unread).toBe(0);
    expect(waToItem(waRow({ unread_count: 3 })).unread).toBe(3);
  });
});

describe("igToItem", () => {
  it("collab classification shows a neu Creator pill, taking priority over other branches", () => {
    const item = igToItem(igRow({ classification: "collab", ticket_status: "open" }));
    expect(item.pill).toEqual({ tone: "neu", text: "Creator" });
    // still counted as needing a human because the ticket is open
    expect(item.needsHuman).toBe(true);
  });

  it("an open ticket (non-collab) is a crit Needs a human pill", () => {
    const item = igToItem(igRow({ ticket_status: "open" }));
    expect(item.pill).toEqual({ tone: "crit", text: "Needs a human" });
    expect(item.needsHuman).toBe(true);
  });

  it("human status without a ticket is a warn Needs a human pill", () => {
    const item = igToItem(igRow({ status: "human" }));
    expect(item.pill).toEqual({ tone: "warn", text: "Needs a human" });
    expect(item.needsHuman).toBe(true);
  });

  it("bot status without a ticket is an info Bot pill", () => {
    const item = igToItem(igRow({ status: "bot" }));
    expect(item.pill).toEqual({ tone: "info", text: "Bot" });
    expect(item.needsHuman).toBe(false);
    expect(item.bot).toBe(true);
  });

  it("name falls back full_name → @handle → Instagram user", () => {
    expect(igToItem(igRow({ full_name: "Priya Eats" })).name).toBe("Priya Eats");
    expect(igToItem(igRow({ full_name: null, handle: "priya.eats" })).name).toBe("@priya.eats");
    expect(igToItem(igRow({ full_name: null, handle: null })).name).toBe("Instagram user");
  });

  it("falls back at → created_at when last_activity_at is null", () => {
    const item = igToItem(igRow({ last_activity_at: null, created_at: "2026-09-10T00:00:00.000Z" }));
    expect(item.at).toBe("2026-09-10T00:00:00.000Z");
  });

  it("at is an empty string when both last_activity_at and created_at are missing — callers must exclude these from paging rather than emit a cursor from them", () => {
    expect(igToItem(igRow({ last_activity_at: null })).at).toBe("");
    expect(igToItem(igRow({ last_activity_at: null, created_at: null })).at).toBe("");
  });
});

describe("emailToItem", () => {
  it("pending with should_reply true is a warn Draft ready pill", () => {
    const item = emailToItem(emailRow({ status: "pending", should_reply: true }));
    expect(item.pill).toEqual({ tone: "warn", text: "Draft ready" });
    expect(item.needsHuman).toBe(true);
  });

  it("pending with should_reply null is still Draft ready (only false suppresses it)", () => {
    const item = emailToItem(emailRow({ status: "pending", should_reply: null }));
    expect(item.pill).toEqual({ tone: "warn", text: "Draft ready" });
    expect(item.needsHuman).toBe(true);
  });

  it("pending with should_reply false falls back to the category pill", () => {
    const item = emailToItem(emailRow({ status: "pending", should_reply: false, lead_category: "spam" }));
    expect(item.pill).toEqual({ tone: "neu", text: "Spam" });
    expect(item.needsHuman).toBe(false);
  });

  it("sent status is a neu category pill regardless of should_reply", () => {
    const item = emailToItem(emailRow({ status: "sent", should_reply: true, lead_category: "complaint" }));
    expect(item.pill).toEqual({ tone: "neu", text: "Complaint" });
    expect(item.needsHuman).toBe(false);
  });

  it("bot is always false and assignee is always null", () => {
    const item = emailToItem(emailRow());
    expect(item.bot).toBe(false);
    expect(item.assignee).toBeNull();
    expect(item.unread).toBe(0);
  });

  it("name falls back from_name → from_email; preview falls back to (no subject)", () => {
    expect(emailToItem(emailRow({ from_name: null, from_email: "a@b.com" })).name).toBe("a@b.com");
    expect(emailToItem(emailRow({ subject: null })).preview).toBe("(no subject)");
    expect(emailToItem(emailRow({ subject: "" })).preview).toBe("(no subject)");
  });
});

describe("preview", () => {
  it("collapses whitespace/newlines to single spaces and caps at 90 chars", () => {
    const long = "Hi there,\n\nI wanted   to ask about " + "bulk orders ".repeat(10);
    const item = waToItem(waRow({ last_message_snippet: long }));
    expect(item.preview.length).toBeLessThanOrEqual(90);
    expect(item.preview).not.toMatch(/\s{2,}/);
    expect(item.preview).not.toMatch(/\n/);
  });

  it("email preview uses the subject, not the body", () => {
    const item = emailToItem(emailRow({ subject: "Bulk order inquiry" }));
    expect(item.preview).toBe("Bulk order inquiry");
  });
});

describe("matchesFilter", () => {
  const human: InboxItem = { ...waToItem(waRow({ status: "human" })) };
  const botItem: InboxItem = { ...waToItem(waRow({ status: "bot" })) };
  const mine: InboxItem = { ...waToItem(waRow({ assigned_to: "Khush@TryPromunch.in" })) };

  it("human filters on needsHuman", () => {
    expect(matchesFilter(human, "human", "khush@trypromunch.in")).toBe(true);
    expect(matchesFilter(botItem, "human", "khush@trypromunch.in")).toBe(false);
  });

  it("mine matches assignee case-insensitively", () => {
    expect(matchesFilter(mine, "mine", "khush@trypromunch.in")).toBe(true);
    expect(matchesFilter(mine, "mine", "narendra@trypromunch.in")).toBe(false);
    expect(matchesFilter(botItem, "mine", "khush@trypromunch.in")).toBe(false);
  });

  it("mine matches wa ticket_assignee too, via the item's resolved assignee", () => {
    const item = waToItem(waRow({ assigned_to: null, ticket_assignee: "narendra@trypromunch.in" }));
    expect(matchesFilter(item, "mine", "narendra@trypromunch.in")).toBe(true);
  });

  it("bot filters on bot", () => {
    expect(matchesFilter(botItem, "bot", "khush@trypromunch.in")).toBe(true);
    expect(matchesFilter(human, "bot", "khush@trypromunch.in")).toBe(false);
  });

  it("all always matches", () => {
    expect(matchesFilter(human, "all", "khush@trypromunch.in")).toBe(true);
    expect(matchesFilter(botItem, "all", "khush@trypromunch.in")).toBe(true);
  });
});

describe("mergeItems", () => {
  it("interleaves wa/ig/email lists by at desc, capped at limit", () => {
    const wa = [waToItem(waRow({ id: "w1", last_activity_at: "2026-09-15T09:00:00.000Z" }))];
    const ig = [igToItem(igRow({ id: "i1", last_activity_at: "2026-09-15T11:00:00.000Z" }))];
    const em = [emailToItem(emailRow({ id: "e1", created_at: "2026-09-15T10:00:00.000Z" }))];

    const merged = mergeItems([wa, ig, em], 10);
    expect(merged.map((i) => i.key)).toEqual(["ig-i1", "em-e1", "wa-w1"]);
  });

  it("caps at limit", () => {
    const wa = [
      waToItem(waRow({ id: "w1", last_activity_at: "2026-09-15T09:00:00.000Z" })),
      waToItem(waRow({ id: "w2", last_activity_at: "2026-09-15T08:00:00.000Z" })),
    ];
    const ig = [igToItem(igRow({ id: "i1", last_activity_at: "2026-09-15T11:00:00.000Z" }))];
    const merged = mergeItems([wa, ig], 2);
    expect(merged).toHaveLength(2);
    expect(merged.map((i) => i.key)).toEqual(["ig-i1", "wa-w1"]);
  });

  it("breaks ties on equal at by key ascending", () => {
    const wa = [
      waToItem(waRow({ id: "b", last_activity_at: "2026-09-15T09:00:00.000Z" })),
      waToItem(waRow({ id: "a", last_activity_at: "2026-09-15T09:00:00.000Z" })),
    ];
    const merged = mergeItems([wa], 10);
    expect(merged.map((i) => i.key)).toEqual(["wa-a", "wa-b"]);
  });
});

describe("nextCursor", () => {
  it("is null when fewer items than the limit come back", () => {
    const items = [waToItem(waRow({ id: "w1" }))];
    expect(nextCursor(items, 5)).toBeNull();
  });

  it("is `${at}|${key}` of the last item when the page is full", () => {
    const items = [
      waToItem(waRow({ id: "w1", last_activity_at: "2026-09-15T09:00:00.000Z" })),
      waToItem(waRow({ id: "w2", last_activity_at: "2026-09-15T08:00:00.000Z" })),
    ];
    expect(nextCursor(items, 2)).toBe("2026-09-15T08:00:00.000Z|wa-w2");
  });
});

describe("countFilters", () => {
  it("counts each filter bucket independently", () => {
    const items = [
      waToItem(waRow({ id: "w1", status: "human" })),
      waToItem(waRow({ id: "w2", status: "bot" })),
      waToItem(waRow({ id: "w3", status: "bot", assigned_to: "khush@trypromunch.in" })),
      emailToItem(emailRow({ id: "e1", status: "pending", should_reply: true })),
    ];
    expect(countFilters(items, "khush@trypromunch.in")).toEqual({
      human: 2, // w1 (human status) + e1 (pending draft)
      mine: 1, // w3
      bot: 2, // w2, w3
      all: 4,
    });
  });
});
