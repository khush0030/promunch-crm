import { describe, it, expect } from "vitest";
import {
  extractOrderRef,
  isPastTarget,
  isHumanReplySender,
  firstHumanReplyAt,
  ageText,
  humanizeTitleSeparator,
  buildBoard,
  type TicketRow,
} from "./tickets";

const NOW = new Date("2026-09-18T10:00:00.000Z"); // 15:30 IST — safely mid-day
const hoursAgo = (h: number, from: Date = NOW) => new Date(from.getTime() - h * 60 * 60 * 1000).toISOString();
const minsAgo = (m: number, from: Date = NOW) => new Date(from.getTime() - m * 60 * 1000).toISOString();

function ticketRow(overrides: Partial<TicketRow> = {}): TicketRow {
  return {
    id: "t1",
    channel: "wa",
    ticket_number: 100,
    ticket_status: "open",
    ticket_subject: "Wrong flavour received",
    ticket_category: "complaint",
    escalation_reason: null,
    ticket_assignee: null,
    ticket_opened_at: hoursAgo(1),
    ticket_resolved_at: null,
    customer: "Kiran Rao",
    firstHumanReplyAt: null,
    ...overrides,
  };
}

describe("extractOrderRef", () => {
  it("extracts the first 4-6 digit number, hashed", () => {
    expect(extractOrderRef("pack crushed order 2231")).toBe("#2231");
  });
  it("works when the text already has a #", () => {
    expect(extractOrderRef("issue with #2231 again")).toBe("#2231");
  });
  it("returns null when there is no order-shaped number", () => {
    expect(extractOrderRef("no numbers here")).toBeNull();
    expect(extractOrderRef("call me at 5")).toBeNull();
    expect(extractOrderRef(null)).toBeNull();
  });
});

describe("isHumanReplySender", () => {
  it("rejects the bot, ops_resolve, campaign sends and null", () => {
    expect(isHumanReplySender("bot")).toBe(false);
    expect(isHumanReplySender("ops_resolve")).toBe(false);
    expect(isHumanReplySender("campaign_edamame")).toBe(false);
    expect(isHumanReplySender(null)).toBe(false);
  });
  it("accepts a real agent email or 'dashboard'", () => {
    expect(isHumanReplySender("khush@trypromunch.in")).toBe(true);
    expect(isHumanReplySender("dashboard")).toBe(true);
  });
});

describe("firstHumanReplyAt", () => {
  const opened = { t1: hoursAgo(5) };

  it("picks the first outbound human message strictly after ticket_opened_at", () => {
    const messages = [
      { thread_id: "t1", direction: "outbound", sent_by: "bot", created_at: hoursAgo(4.5) },
      { thread_id: "t1", direction: "outbound", sent_by: "khush@trypromunch.in", created_at: hoursAgo(3) },
      { thread_id: "t1", direction: "outbound", sent_by: "narendra@trypromunch.in", created_at: hoursAgo(2) },
    ];
    expect(firstHumanReplyAt(messages, opened)).toEqual({ t1: hoursAgo(3) });
  });

  it("ignores inbound messages, bot/campaign/ops_resolve senders, and replies before the ticket opened", () => {
    const messages = [
      { thread_id: "t1", direction: "inbound", sent_by: "customer", created_at: hoursAgo(1) },
      { thread_id: "t1", direction: "outbound", sent_by: "campaign_edamame", created_at: hoursAgo(1) },
      { thread_id: "t1", direction: "outbound", sent_by: "ops_resolve", created_at: hoursAgo(1) },
      { thread_id: "t1", direction: "outbound", sent_by: "khush@trypromunch.in", created_at: hoursAgo(6) }, // before opened
    ];
    expect(firstHumanReplyAt(messages, opened)).toEqual({});
  });
});

describe("isPastTarget", () => {
  it("is true at 5h with no reply", () => {
    const row = ticketRow({ ticket_opened_at: hoursAgo(5), firstHumanReplyAt: null });
    expect(isPastTarget(row, NOW)).toBe(true);
  });

  it("is false at 5h when a human replied within 4h of opening", () => {
    const opened = hoursAgo(5);
    // Reply 1h after opening == 4h before now — inside the 4h target window.
    const replyAt = new Date(new Date(opened).getTime() + 60 * 60 * 1000).toISOString();
    const row = ticketRow({ ticket_opened_at: opened, firstHumanReplyAt: replyAt });
    expect(isPastTarget(row, NOW)).toBe(false);
  });

  it("is false at 3h regardless of reply", () => {
    const row = ticketRow({ ticket_opened_at: hoursAgo(3), firstHumanReplyAt: null });
    expect(isPastTarget(row, NOW)).toBe(false);
  });

  it("is false when the ticket is already resolved", () => {
    const row = ticketRow({ ticket_status: "resolved", ticket_opened_at: hoursAgo(10) });
    expect(isPastTarget(row, NOW)).toBe(false);
  });
});

describe("ageText", () => {
  it("renders minutes under an hour", () => {
    expect(ageText(minsAgo(40), NOW)).toBe("40m");
  });
  it("renders hours and minutes", () => {
    expect(ageText(minsAgo(130), NOW)).toBe("2h 10m");
  });
  it("drops the minutes when they are zero", () => {
    expect(ageText(minsAgo(120), NOW)).toBe("2h");
  });
  it("renders a single day", () => {
    expect(ageText(hoursAgo(24), NOW)).toBe("1 day");
  });
  it("renders multiple days", () => {
    expect(ageText(hoursAgo(72), NOW)).toBe("3 days");
  });
});

describe("humanizeTitleSeparator", () => {
  it("replaces ' — ' with ': ' for display", () => {
    expect(humanizeTitleSeparator("Wrong flavour — sent Peri Peri instead")).toBe("Wrong flavour: sent Peri Peri instead");
  });
  it("leaves text with no em dash untouched", () => {
    expect(humanizeTitleSeparator("Refund for cancelled COD")).toBe("Refund for cancelled COD");
  });
});

const teamName = (email: string) => (email === "khush@trypromunch.in" ? "Khush Mutha" : email === "narendra@trypromunch.in" ? "Narendra Singh" : email);

describe("buildBoard", () => {
  it("puts an unassigned open ticket in New", () => {
    const board = buildBoard([ticketRow({ id: "a", ticket_status: "open", ticket_assignee: null })], {}, NOW, teamName);
    const newCol = board.columns.find((c) => c.key === "new")!;
    expect(newCol.cards.map((c) => c.key)).toEqual(["wa-a"]);
  });

  it("gives each assignee their own column", () => {
    const rows = [
      ticketRow({ id: "a", ticket_status: "open", ticket_assignee: "khush@trypromunch.in" }),
      ticketRow({ id: "b", ticket_status: "pending", ticket_assignee: "narendra@trypromunch.in" }),
    ];
    const board = buildBoard(rows, {}, NOW, teamName);
    const withCols = board.columns.filter((c) => c.key.startsWith("with:"));
    expect(withCols).toHaveLength(2);
    expect(withCols.map((c) => c.title).sort()).toEqual(["With Khush", "With Narendra"]);
  });

  it("puts an unassigned pending ticket in Waiting on customer", () => {
    const board = buildBoard([ticketRow({ id: "a", ticket_status: "pending", ticket_assignee: null })], {}, NOW, teamName);
    const waiting = board.columns.find((c) => c.key === "waiting")!;
    expect(waiting.cards.map((c) => c.key)).toEqual(["wa-a"]);
    expect(board.counts.waiting).toBe(1);
  });

  it("includes a ticket resolved yesterday in the Resolved this week column", () => {
    const resolvedYesterday = ticketRow({
      id: "y",
      ticket_status: "resolved",
      ticket_opened_at: hoursAgo(30),
      ticket_resolved_at: hoursAgo(26),
    });
    const board = buildBoard([resolvedYesterday], {}, NOW, teamName);
    const resolved = board.columns.find((c) => c.key === "resolved")!;
    expect(resolved.title).toBe("Resolved this week");
    expect(resolved.cards.map((c) => c.key)).toEqual(["wa-y"]);
    expect(resolved.cards[0].ageText).toBe("resolved in 4h · yesterday");
  });

  it("excludes a ticket resolved 8 days ago from the Resolved this week column", () => {
    const resolvedLongAgo = ticketRow({
      id: "old",
      ticket_status: "resolved",
      ticket_opened_at: hoursAgo(8 * 24 + 2),
      ticket_resolved_at: hoursAgo(8 * 24),
    });
    const board = buildBoard([resolvedLongAgo], {}, NOW, teamName);
    const resolved = board.columns.find((c) => c.key === "resolved")!;
    expect(resolved.cards).toHaveLength(0);
    expect(board.counts.resolvedWeek).toBe(0);
  });

  it("includes a ticket resolved earlier today in the Resolved this week column, dated 'today'", () => {
    const resolvedToday = ticketRow({
      id: "r",
      ticket_status: "resolved",
      ticket_opened_at: hoursAgo(3),
      ticket_resolved_at: hoursAgo(1),
    });
    const board = buildBoard([resolvedToday], {}, NOW, teamName);
    const resolved = board.columns.find((c) => c.key === "resolved")!;
    expect(resolved.cards.map((c) => c.key)).toEqual(["wa-r"]);
    expect(resolved.cards[0].ageText).toBe("resolved in 2h · today");
    expect(board.counts.resolvedWeek).toBe(1);
  });

  it("computes the median resolve time over the last 7 days", () => {
    // Build explicit opened/resolved pairs so each resolve duration is exactly h hours.
    const rows: TicketRow[] = [1, 3, 5].map((h, i) => {
      const resolvedAt = hoursAgo(0.5, NOW); // resolved 30 min ago (today)
      const openedAt = new Date(new Date(resolvedAt).getTime() - h * 60 * 60 * 1000).toISOString();
      return ticketRow({ id: `m${i}`, ticket_status: "resolved", ticket_opened_at: openedAt, ticket_resolved_at: resolvedAt });
    });
    const board = buildBoard(rows, {}, NOW, teamName);
    expect(board.kpis.medianResolveHours).toBe(3);
  });

  it("counts categories opened in the last 7 days for topCategory", () => {
    const rows = [
      ticketRow({ id: "c1", ticket_category: "complaint", ticket_opened_at: hoursAgo(2) }),
      ticketRow({ id: "c2", ticket_category: "complaint", ticket_opened_at: hoursAgo(5) }),
      ticketRow({ id: "c3", ticket_category: "order_tracking", ticket_opened_at: hoursAgo(1) }),
    ];
    const board = buildBoard(rows, {}, NOW, teamName);
    expect(board.kpis.topCategory).toEqual({ word: "Complaint", count: 2, prevCount: 0 });
  });

  it("reads the order value from the extracted order ref", () => {
    const row = ticketRow({ id: "o", ticket_subject: "pack crushed, order #2231 damaged" });
    const board = buildBoard([row], { "#2231": 799 }, NOW, teamName);
    const card = board.columns.find((c) => c.key === "new")!.cards[0];
    expect(card.orderRef).toBe("#2231");
    expect(card.orderValue).toBe(799);
  });

  it("derives chip counts from the columns actually shown (Open excludes Waiting)", () => {
    const rows = [
      ticketRow({ id: "n1", ticket_status: "open", ticket_assignee: null }), // New
      ticketRow({ id: "n2", ticket_status: "open", ticket_assignee: null }), // New
      ticketRow({ id: "w1", ticket_status: "open", ticket_assignee: "khush@trypromunch.in" }), // With Khush
      ticketRow({ id: "wait1", ticket_status: "pending", ticket_assignee: null }), // Waiting
      ticketRow({
        id: "res1",
        ticket_status: "resolved",
        ticket_opened_at: hoursAgo(3),
        ticket_resolved_at: hoursAgo(1),
      }), // Resolved this week
    ];
    const board = buildBoard(rows, {}, NOW, teamName);

    const newCount = board.columns.find((c) => c.key === "new")!.cards.length;
    const withCount = board.columns.filter((c) => c.key.startsWith("with:")).reduce((s, c) => s + c.cards.length, 0);
    const waitingCount = board.columns.find((c) => c.key === "waiting")!.cards.length;
    const resolvedCount = board.columns.find((c) => c.key === "resolved")!.cards.length;

    expect(board.counts.open).toBe(newCount + withCount);
    expect(board.counts.open).toBe(3); // 2 New + 1 With — Waiting is NOT counted in Open
    expect(board.counts.waiting).toBe(waitingCount);
    expect(board.counts.waiting).toBe(1);
    expect(board.counts.resolvedWeek).toBe(resolvedCount);
    expect(board.counts.resolvedWeek).toBe(1);
    expect(board.kpis.open).toBe(board.counts.open);
  });

  it("marks past-target cards crit and includes them in kpis.pastTarget", () => {
    const row = ticketRow({ id: "p", ticket_opened_at: hoursAgo(6) });
    const board = buildBoard([row], {}, NOW, teamName);
    const card = board.columns.find((c) => c.key === "new")!.cards[0];
    expect(card.tone).toBe("crit");
    expect(card.pastTarget).toBe(true);
    expect(card.ageText).toContain("past target");
    expect(board.kpis.pastTarget).toBe(1);
  });
});
