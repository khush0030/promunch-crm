import { describe, expect, it } from "vitest";
import {
  cleanSearch,
  combineOrGroups,
  needsReply,
  nextBefore,
  orGroups,
  parseMentionFilters,
  sentimentBucket,
} from "./filters";

const p = (qs: string) => parseMentionFilters(new URLSearchParams(qs));

describe("parseMentionFilters", () => {
  it("defaults: everything relevant, 50 per page", () => {
    expect(p("")).toEqual({
      view: null,
      statuses: null,
      source: null,
      sentiment: null,
      urgency: null,
      q: null,
      owned: null,
      before: null,
      limit: 50,
      includeIrrelevant: false,
    });
  });
  it("status views and raw status lists", () => {
    expect(p("status=new")).toMatchObject({ view: null, statuses: ["new"] });
    expect(p("status=needs_reply").view).toBe("needs_reply");
    expect(p("status=handled").view).toBe("handled");
    expect(p("status=cases")).toMatchObject({ view: "cases", statuses: null });
    expect(p("status=all")).toMatchObject({ view: null, statuses: null });
    expect(p("status=seen,escalated,bogus").statuses).toEqual(["seen", "escalated"]);
    expect(p("status=bogus").statuses).toBeNull();
  });
  it("source, sentiment, urgency, owned, irrelevant", () => {
    const f = p("source=amazon&sentiment=neg&urgency=critical,high,nope&owned=1&include_irrelevant=1");
    expect(f).toMatchObject({ source: "amazon", sentiment: "neg", urgency: ["critical", "high"], owned: true, includeIrrelevant: true });
    expect(p("source=twitter&sentiment=meh&owned=0")).toMatchObject({ source: null, sentiment: null, owned: false });
  });
  it("limit is clamped to 1..100 and cursor must be a date", () => {
    expect(p("limit=500").limit).toBe(100);
    expect(p("limit=0").limit).toBe(50);
    expect(p("limit=abc").limit).toBe(50);
    expect(p("limit=20").limit).toBe(20);
    expect(p("before=2026-10-01T10:00:00Z").before).toBe("2026-10-01T10:00:00.000Z");
    expect(p("before=yesterday").before).toBeNull();
  });
});

describe("cleanSearch", () => {
  it("strips PostgREST-breaking characters and short queries", () => {
    expect(cleanSearch("  stale, (pack) *100%  ")).toBe("stale pack 100");
    expect(cleanSearch("a")).toBeNull();
    expect(cleanSearch(null)).toBeNull();
    expect(cleanSearch("x".repeat(200))?.length).toBe(80);
  });
});

describe("or groups", () => {
  it("needs_reply and search combine as AND of ORs", () => {
    const f = p("status=needs_reply&q=stale");
    const g = orGroups(f);
    expect(g).toHaveLength(2);
    expect(g[0]).toBe("sentiment.lt.0,intent.in.(complaint,question)");
    expect(g[1]).toContain("body.ilike.*stale*");
    expect(combineOrGroups(g)).toBe(`and(or(${g[0]}),or(${g[1]}))`);
    expect(combineOrGroups([g[0]])).toBe(g[0]);
    expect(combineOrGroups([])).toBeNull();
  });
});

describe("row helpers", () => {
  it("nextBefore only when the page is full", () => {
    const rows = [{ posted_at: "2026-10-02" }, { posted_at: "2026-10-01" }];
    expect(nextBefore(rows, 2)).toBe("2026-10-01");
    expect(nextBefore(rows, 3)).toBeNull();
  });
  it("sentiment buckets", () => {
    expect([-2, -1, 0, 1, 2, null].map(sentimentBucket)).toEqual(["neg", "neg", "neu", "pos", "pos", null]);
  });
  it("needsReply: open + complaint/question/negative", () => {
    expect(needsReply({ status: "new", sentiment: -1, intent: "other" })).toBe(true);
    expect(needsReply({ status: "seen", sentiment: 1, intent: "question" })).toBe(true);
    expect(needsReply({ status: "new", sentiment: 2, intent: "praise" })).toBe(false);
    expect(needsReply({ status: "replied", sentiment: -2, intent: "complaint" })).toBe(false);
  });
});
