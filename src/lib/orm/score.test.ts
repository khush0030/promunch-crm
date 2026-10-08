import { describe, expect, it } from "vitest";
import { computeScore, isHandled, scoreBand, type ScoreRow } from "./score";
import vectors from "./score-vectors.json";

type Vector = { name: string; mentions: ScoreRow[]; expected: ReturnType<typeof computeScore>; band: string | null };
const V = vectors as unknown as { vectors: Vector[]; bands: { score: number | null; band: string | null }[] };

// Shared with the edge copy (_shared/orm-score.ts): both suites assert this file.
describe("computeScore: shared test vectors", () => {
  for (const v of V.vectors) {
    it(v.name, () => {
      const r = computeScore(v.mentions);
      expect(r).toEqual(v.expected);
      expect(scoreBand(r.score)).toBe(v.band);
    });
  }
  it("bands", () => {
    for (const b of V.bands) expect(scoreBand(b.score)).toBe(b.band);
  });
});

describe("computeScore details", () => {
  it("handled = replied, ignored or a resolved case", () => {
    expect(isHandled({ status: "replied", case_status: null })).toBe(true);
    expect(isHandled({ status: "ignored", case_status: null })).toBe(true);
    expect(isHandled({ status: "new", case_status: "resolved" })).toBe(true);
    expect(isHandled({ status: "escalated", case_status: "in_progress" })).toBe(false);
  });
  it("rated but not scored: sentiment part drops (75*.4 + 100*.2 + 100*.1) / .7", () => {
    expect(computeScore([{ rating: 4, sentiment: null, status: "new" }])).toMatchObject({
      score: 86,
      parts: { rating: 75, net_sentiment: null, reply_rate: 100, critical: 100 },
    });
  });
  it("ratings outside 1..5 are ignored", () => {
    expect(computeScore([{ rating: 0, sentiment: 1 }, { rating: 9, sentiment: 1 }]).counts.rated).toBe(0);
  });
});
