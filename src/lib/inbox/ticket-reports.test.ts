import { describe, it, expect } from "vitest";
import {
  buildTicketReport,
  parseReportPeriod,
  reportFetchSince,
  spanText,
  topicWord,
  type ReportTicketRow,
} from "./ticket-reports";

// 9 Oct 2026, 12:00 IST.
const NOW = new Date("2026-10-09T06:30:00Z");
const H = 3_600_000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * H).toISOString();

function row(p: Partial<ReportTicketRow>): ReportTicketRow {
  return { status: "open", category: null, assignee: null, openedAt: null, resolvedAt: null, firstReplyAt: null, ...p };
}

describe("parseReportPeriod", () => {
  it("defaults to 7 days and accepts 30/90", () => {
    expect(parseReportPeriod(null)).toBe("7d");
    expect(parseReportPeriod("bogus")).toBe("7d");
    expect(parseReportPeriod("30d")).toBe("30d");
    expect(parseReportPeriod("90d")).toBe("90d");
  });
});

describe("topicWord", () => {
  it("names the categories the bot writes, and folds unknowns into Other", () => {
    expect(topicWord("order_issue")).toBe("Order problem");
    expect(topicWord("product_query")).toBe("Product question");
    expect(topicWord("Wholesale")).toBe("Wholesale");
    expect(topicWord(null)).toBe("Other");
    expect(topicWord("general")).toBe("Other");
    expect(topicWord("something_new")).toBe("Other");
  });
});

describe("buildTicketReport", () => {
  it("counts opened, first reply, on-time and solved in the window vs the one before", () => {
    const rows = [
      // replied in 1h, solved after 5h (on time)
      row({ status: "resolved", category: "order_issue", assignee: "n@promunch.in", openedAt: ago(30), firstReplyAt: ago(29), resolvedAt: ago(25) }),
      // replied after 6h (late), still open
      row({ status: "open", category: "order_issue", assignee: "k@promunch.in", openedAt: ago(50), firstReplyAt: ago(44) }),
      // no reply, opened 2h ago: clock still running, not judged
      row({ status: "open", category: "refund", openedAt: ago(2) }),
      // no reply, opened 10h ago: late
      row({ status: "pending", category: "refund", openedAt: ago(10) }),
      // previous window (8 to 14 days ago)
      row({ status: "resolved", category: "refund", assignee: "n@promunch.in", openedAt: ago(24 * 10), firstReplyAt: ago(24 * 10 - 3), resolvedAt: ago(24 * 9) }),
    ];
    const r = buildTicketReport(rows, "7d", NOW);
    expect(r.opened).toBe(4);
    expect(r.prevOpened).toBe(1);
    expect(r.firstReplyMin).toBe((60 + 360) / 2);
    expect(r.prevFirstReplyMin).toBe(180);
    expect(r.onTimeBase).toBe(3);
    expect(r.onTimePct).toBe(33);
    expect(r.prevOnTimePct).toBe(100);
    expect(r.solved).toBe(1);
    expect(r.prevSolved).toBe(1);
    expect(r.solveHours).toBe(5);
    expect(r.openNow).toBe(3);
    expect(r.unassignedOpen).toBe(2);
    expect(r.topics.map((t) => [t.word, t.count, t.prevCount])).toEqual([
      ["Order problem", 2, 0],
      ["Refund", 2, 1],
    ]);
  });

  it("builds a per-person table and a day-by-day series of the right length", () => {
    const rows = [
      row({ status: "resolved", assignee: "n@promunch.in", openedAt: ago(30), firstReplyAt: ago(29.5), resolvedAt: ago(20) }),
      row({ status: "resolved", assignee: "n@promunch.in", openedAt: ago(5), firstReplyAt: ago(4), resolvedAt: ago(1) }),
      row({ status: "open", assignee: "k@promunch.in", openedAt: ago(3) }),
    ];
    const r = buildTicketReport(rows, "7d", NOW);
    expect(r.people).toEqual([
      { assignee: "n@promunch.in", solved: 2, open: 0, firstReplyMin: 45 },
      { assignee: "k@promunch.in", solved: 0, open: 1, firstReplyMin: null },
    ]);
    expect(r.daily).toHaveLength(7);
    expect(r.daily[6].date).toBe("2026-10-09");
    expect(r.daily.reduce((n, d) => n + d.opened, 0)).toBe(3);
    expect(r.daily.reduce((n, d) => n + d.solved, 0)).toBe(2);
  });

  it("returns empty numbers, not zeros pretending to be times, when there is nothing", () => {
    const r = buildTicketReport([], "30d", NOW);
    expect(r.opened).toBe(0);
    expect(r.firstReplyMin).toBeNull();
    expect(r.onTimePct).toBeNull();
    expect(r.solveHours).toBeNull();
    expect(r.topics).toEqual([]);
    expect(r.daily).toHaveLength(30);
  });

  it("fetches from the start of the previous window", () => {
    // 7d window starts 3 Oct IST; previous starts 26 Sep IST (00:00 IST = 18:30 UTC the day before).
    expect(reportFetchSince("7d", NOW).toISOString()).toBe("2026-09-25T18:30:00.000Z");
  });
});

describe("spanText", () => {
  it("reads like a person", () => {
    expect(spanText(null)).toBe("None yet");
    expect(spanText(35)).toBe("35 min");
    expect(spanText(100)).toBe("1h 40m");
    expect(spanText(120)).toBe("2h");
    expect(spanText(27 * 60)).toBe("1 day 3h");
    expect(spanText(4 * 24 * 60 + 30)).toBe("4 days");
  });
});
