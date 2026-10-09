import { describe, expect, it } from "vitest";
import {
  buildSummary,
  driverRows,
  fetchSince,
  istDay,
  istWeeks,
  istWeekStart,
  latestSnapshots,
  parseDays,
  productRows,
  responseStats,
  windowStart,
  type SummaryRow,
  type SummarySource,
} from "./summary";

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

describe("IST weeks", () => {
  it("weeks start on Monday in India time", () => {
    // Fri 9 Oct 2026 -> Mon 5 Oct
    expect(istWeekStart(NOW)).toBe("2026-10-05");
    // Sun 4 Oct 23:00 IST is still the week of 28 Sep
    expect(istWeekStart(Date.parse("2026-10-04T17:30:00Z"))).toBe("2026-09-28");
    // Sun 4 Oct 19:00 UTC is Mon 5 Oct 00:30 IST
    expect(istWeekStart(Date.parse("2026-10-04T19:00:00Z"))).toBe("2026-10-05");
  });
  it("12 weeks, oldest first, ending this week", () => {
    const w = istWeeks(NOW);
    expect(w).toHaveLength(12);
    expect(w[11]).toBe("2026-10-05");
    expect(w[0]).toBe("2026-07-20");
  });
  it("fetchSince covers the previous period and the 12 weeks", () => {
    // 7 days: weeks reach further back (20 Jul IST midnight)
    expect(fetchSince(7, NOW).toISOString()).toBe("2026-07-19T18:30:00.000Z");
    // 90 days: previous period reaches further (start 11 Jul minus 90 days)
    expect(fetchSince(90, NOW).toISOString()).toBe("2026-04-12T18:30:00.000Z");
  });
});

describe("v2 summary pieces", () => {
  const cur: SummaryRow[] = [
    row({ product: "Noodle Masala Crunchies", rating: 2, sentiment: -1, topics: ["taste", "crunch"] }),
    row({ product: "Noodle Masala Crunchies", rating: 4, sentiment: 1, topics: ["crunch"] }),
    row({ product: "Noodle Masala Crunchies", rating: 3, sentiment: -1, topics: ["taste"] }),
    row({ product: "Edamame Himalayan Rock Salt", rating: 5, sentiment: 2, topics: ["taste", "protein"] }),
    row({ product: "Soya Sticks", rating: 1, sentiment: -2, topics: ["delivery"] }),
    row({ product: null, rating: null, sentiment: 0, topics: ["price"] }),
  ];
  const prev: SummaryRow[] = [
    row({ product: "Noodle Masala Crunchies", rating: 4, sentiment: 1 }),
    row({ product: "Edamame Himalayan Rock Salt", rating: 4, sentiment: 1 }),
  ];

  it("products: worst first, trend vs previous period, unknown grouped", () => {
    const p = productRows(cur, prev);
    expect(p.map((x) => x.product)).toEqual([
      "Soya Sticks",
      "Noodle Masala Crunchies",
      "Edamame Himalayan Rock Salt",
      "Not sure which product",
    ]);
    expect(p[1]).toEqual({
      product: "Noodle Masala Crunchies",
      mentions: 3,
      avg_rating: 3,
      rated: 3,
      pct_negative: 67,
      top_complaint_topic: "taste",
      trend: "down",
    });
    expect(p[2].trend).toBe("up");
    expect(p[0].trend).toBe("flat"); // no previous rating
    expect(p[3]).toMatchObject({ pct_negative: 0, avg_rating: null, rated: 0 });
  });

  it("drivers: praise vs complaints per topic, busiest first", () => {
    expect(driverRows(cur)).toEqual([
      { topic: "taste", praise: 1, complaints: 2, neutral: 0 },
      { topic: "crunch", praise: 1, complaints: 1, neutral: 0 },
      { topic: "delivery", praise: 0, complaints: 1, neutral: 0 },
      { topic: "protein", praise: 1, complaints: 0, neutral: 0 },
    ]);
  });

  it("response: open negatives, median reply time, oldest unanswered, cases", () => {
    const rows: SummaryRow[] = [
      row({ sentiment: -2, urgency: "critical", status: "new", posted_at: "2026-10-05T06:30:00Z" }),
      row({ sentiment: -1, status: "new", case_status: "resolved", case_outcome: "recovered" }),
      row({ sentiment: -1, status: "replied", replied_at: "2026-10-08T07:00:00Z", case_status: "resolved", case_outcome: "refund" }),
      row({ sentiment: 1, status: "replied", replied_at: "2026-10-08T09:00:00Z" }),
      row({ sentiment: -1, status: "seen", case_status: "in_progress" }),
      row({ sentiment: -1, status: "new", case_status: "open" }),
    ];
    expect(responseStats(rows, 50, NOW)).toEqual({
      open_negatives: 3,
      open_critical: 1,
      median_reply_hours: 3, // 2h and 4h after posting
      oldest_unanswered_days: 4,
      reply_rate: 50,
      cases: { open: 1, in_progress: 1, resolved: 2, recovered: 1, recovery_rate: 50 },
    });
  });

  it("competitors: latest snapshot per ASIN, ours first", () => {
    const snap = (asin: string, taken_on: string, rating: number, is_ours = false) => ({
      asin, brand: is_ours ? "PROMUNCH" : "Other", label: null, is_ours, rating, review_count: 10, price_inr: 99, taken_on,
    });
    expect(
      latestSnapshots([
        snap("B0COMP0001", "2026-09-01", 4.0),
        snap("B0COMP0001", "2026-10-01", 4.2),
        snap("B0COMP0002", "2026-10-01", 4.4),
        snap("B0OURS0001", "2026-10-01", 4.1, true),
      ]).map((s) => [s.asin, s.rating]),
    ).toEqual([
      ["B0OURS0001", 4.1],
      ["B0COMP0002", 4.4],
      ["B0COMP0001", 4.2],
    ]);
  });

  it("buildSummary adds score, previous score, weekly scores and channels", () => {
    const rows: SummaryRow[] = [
      row({ source: "judgeme", rating: 5, sentiment: 2, status: "replied", posted_at: "2026-10-08T05:00:00Z" }),
      row({ source: "amazon", rating: 1, sentiment: -2, status: "new", posted_at: "2026-10-07T05:00:00Z" }),
      // previous 7-day period
      row({ source: "judgeme", rating: 5, sentiment: 2, status: "new", posted_at: "2026-09-29T05:00:00Z" }),
      // 5 weeks ago: only in weekly series
      row({ source: "judgeme", rating: 4, sentiment: 1, status: "new", posted_at: "2026-09-02T05:00:00Z" }),
    ];
    const s = buildSummary(rows, SOURCES, 7, NOW);
    expect(s.total).toBe(2);
    expect(s.score.score).toBe(45); // rating 50*.4 + net 50*.3 + reply 0*.2 + critical 100*.1
    expect(s.score_prev.score).toBe(100);
    expect(s.score_weekly).toHaveLength(12);
    expect(s.score_weekly[11]).toEqual({ week_start: "2026-10-05", score: 45, mentions: 2 });
    expect(s.score_weekly[10]).toEqual({ week_start: "2026-09-28", score: 100, mentions: 1 });
    expect(s.score_weekly[0].score).toBeNull();
    expect(s.channels.map((c) => c.key)).toEqual(["amazon", "judgeme"]);
    const jm = s.channels[1];
    expect(jm).toMatchObject({ avg_rating: 5, reviews: 1, star_mix: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 1 } });
    expect(jm.weekly.filter((w) => w.count).map((w) => [w.week_start, w.avg_rating])).toEqual([
      ["2026-08-31", 4],
      ["2026-09-28", 5],
      ["2026-10-05", 5],
    ]);
    expect(jm.velocity_per_week).toBe(0.5);
    expect(s.response.reply_rate).toBe(0);
    expect(s.competitors).toEqual([]);
  });
});
