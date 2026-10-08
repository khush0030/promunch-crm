import { describe, expect, it } from "vitest";
import { buildSummary, istDay, parseDays, windowStart, type SummaryRow, type SummarySource } from "./summary";

// 2026-10-09 12:00 IST
const NOW = Date.parse("2026-10-09T06:30:00Z");

const src = (key: SummarySource["key"], label: string): SummarySource => ({
  key,
  label,
  enabled: true,
  last_run_at: null,
  last_status: "ok",
  last_error: null,
  last_count: 3,
  next_run_at: "2026-10-09T07:00:00Z",
});
const SOURCES = [src("amazon", "Amazon reviews"), src("judgeme", "Website reviews (Judge.me)"), src("reddit", "Reddit")];

const row = (o: Partial<SummaryRow>): SummaryRow => ({
  source: "amazon",
  rating: null,
  sentiment: null,
  topics: [],
  status: "new",
  posted_at: "2026-10-08T05:00:00Z",
  collected_at: "2026-10-08T05:05:00Z",
  ...o,
});

describe("window", () => {
  it("parseDays allows 7/30/90 only", () => {
    expect([parseDays("7"), parseDays("90"), parseDays("14"), parseDays(null)]).toEqual([7, 90, 30, 30]);
  });
  it("starts at IST midnight", () => {
    expect(windowStart(7, NOW).toISOString()).toBe("2026-10-02T18:30:00.000Z");
    expect(istDay(Date.parse("2026-10-08T19:00:00Z"))).toBe("2026-10-09");
  });
});

describe("buildSummary", () => {
  const rows: SummaryRow[] = [
    row({ source: "amazon", rating: 1, sentiment: -2, topics: ["freshness", "quality"], status: "new" }),
    row({ source: "amazon", rating: "3.0", sentiment: 0, topics: ["price"], status: "seen" }),
    row({ source: "judgeme", rating: 5, sentiment: 2, topics: ["taste"], status: "replied", posted_at: "2026-10-09T03:00:00Z" }),
    row({ source: "reddit", sentiment: -1, topics: ["price"], status: "replied" }),
    row({ source: "reddit", sentiment: null, status: "new", posted_at: null, collected_at: "2026-10-07T10:00:00Z" }),
    // outside a 7-day window
    row({ source: "amazon", rating: 1, sentiment: -2, posted_at: "2026-09-20T05:00:00Z" }),
  ];
  const s = buildSummary(rows, SOURCES, 7, NOW);

  it("counts within the window", () => {
    expect(s.total).toBe(5);
    expect(s.new_count).toBe(2);
    expect(s.unanswered_negative).toBe(1);
    expect(s.sentiment).toEqual({ neg: 2, neu: 1, pos: 1 });
  });
  it("by source with average rating (null where no stars)", () => {
    expect(s.by_source).toEqual([
      { key: "amazon", label: "Amazon reviews", count: 2, avg_rating: 2 },
      { key: "reddit", label: "Reddit", count: 2, avg_rating: null },
      { key: "judgeme", label: "Website reviews (Judge.me)", count: 1, avg_rating: 5 },
    ]);
  });
  it("top topics sorted by count then name", () => {
    expect(s.top_topics).toEqual([
      { topic: "price", count: 2 },
      { topic: "freshness", count: 1 },
      { topic: "quality", count: 1 },
      { topic: "taste", count: 1 },
    ]);
  });
  it("trend has one bucket per IST day, oldest first", () => {
    expect(s.trend).toHaveLength(7);
    expect(s.trend[0].day).toBe("2026-10-03");
    expect(s.trend[6]).toEqual({ day: "2026-10-09", neg: 0, neu: 0, pos: 1 });
    expect(s.trend[5]).toEqual({ day: "2026-10-08", neg: 2, neu: 1, pos: 0 });
  });
  it("source status rows pass through", () => {
    expect(s.sources.map((x) => x.key)).toEqual(["amazon", "judgeme", "reddit"]);
  });
  it("empty is all zeros", () => {
    const e = buildSummary([], [], 30, NOW);
    expect(e).toMatchObject({ total: 0, new_count: 0, unanswered_negative: 0, by_source: [], top_topics: [] });
    expect(e.trend).toHaveLength(30);
  });
});
