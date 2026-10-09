// Reputation Score (0-100). Pure, unit-tested. The SAME formula lives in
// promunch-email-agent/supabase/functions/_shared/orm-score.ts (weekly
// WhatsApp digest) and both suites assert the same test vectors
// (score-vectors.json, a copy of docs/plans/orm-score-vectors.json from the
// edge side; change both copies and the vectors together). Contract: docs/plans/2026-10-09-orm-v2-spec.md §1.
//
//   Rating         0.40  (avg(rating) - 1) / 4 * 100       missing: no rated mentions
//   Net sentiment  0.30  (pct_pos - pct_neg + 100) / 2      missing: no scored mentions
//   Reply rate     0.20  negatives handled / negatives      no negatives -> 100
//   Critical       0.10  max(0, 100 - 50 * open_critical)   never missing
//
// Missing parts drop out and the remaining weights are re-normalised.
// Score = round(weighted mean). No relevant enriched mentions -> null.

export type ScoreRow = {
  rating?: number | string | null;
  sentiment?: number | null;
  status?: string | null;
  case_status?: string | null;
  urgency?: string | null;
  /** false = not about us (excluded). Missing/undefined counts as relevant. */
  relevant?: boolean | null;
  /** null = not enriched yet (excluded). Undefined = caller already filtered. */
  enriched_at?: string | null;
};

export type ScoreParts = {
  rating: number | null;
  net_sentiment: number | null;
  /** null only when there are no mentions at all */
  reply_rate: number | null;
  critical: number | null;
};

export type ScoreCounts = {
  mentions: number;
  rated: number;
  scored: number;
  positive: number;
  negative: number;
  negatives_handled: number;
  open_critical: number;
};

export type ReputationScore = {
  score: number | null;
  parts: ScoreParts;
  /** pct_pos - pct_neg, -100..100 (null when nothing is scored). */
  net_sentiment_raw: number | null;
  avg_rating: number | null;
  counts: ScoreCounts;
};

export const SCORE_WEIGHTS = { rating: 0.4, net_sentiment: 0.3, reply_rate: 0.2, critical: 0.1 } as const;

const HANDLED = new Set(["replied", "ignored"]);

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** A mention counts as dealt with: answered, closed, or its case resolved. */
export function isHandled(m: Pick<ScoreRow, "status" | "case_status">): boolean {
  return HANDLED.has(String(m.status ?? "")) || m.case_status === "resolved";
}

export function inScope(m: ScoreRow): boolean {
  if (m.relevant === false) return false;
  if (m.enriched_at === null) return false;
  return true;
}

export function computeScore(input: ScoreRow[]): ReputationScore {
  const rows = input.filter(inScope);
  const counts: ScoreCounts = {
    mentions: rows.length,
    rated: 0,
    scored: 0,
    positive: 0,
    negative: 0,
    negatives_handled: 0,
    open_critical: 0,
  };
  let ratingSum = 0;
  for (const m of rows) {
    const rating = m.rating == null || m.rating === "" ? NaN : Number(m.rating);
    // ratings outside 1..5 are ignored (same as the edge copy)
    if (Number.isFinite(rating) && rating >= 1 && rating <= 5) {
      ratingSum += rating;
      counts.rated++;
    }
    if (m.sentiment != null && Number.isFinite(Number(m.sentiment))) {
      const s = Number(m.sentiment);
      counts.scored++;
      if (s > 0) counts.positive++;
      if (s < 0) {
        counts.negative++;
        if (isHandled(m)) counts.negatives_handled++;
      }
    }
    if (m.urgency === "critical" && !isHandled(m)) counts.open_critical++;
  }

  if (!rows.length)
    return {
      score: null,
      parts: { rating: null, net_sentiment: null, reply_rate: null, critical: null },
      net_sentiment_raw: null,
      avg_rating: null,
      counts,
    };

  const avg = counts.rated ? ratingSum / counts.rated : null;
  const ratingPart = avg == null ? null : ((avg - 1) / 4) * 100;
  const pctPos = counts.scored ? (counts.positive / counts.scored) * 100 : 0;
  const pctNeg = counts.scored ? (counts.negative / counts.scored) * 100 : 0;
  const netRaw = counts.scored ? pctPos - pctNeg : null;
  const netPart = netRaw == null ? null : (netRaw + 100) / 2;
  const replyPart = counts.negative ? (counts.negatives_handled / counts.negative) * 100 : 100;
  const critPart = Math.max(0, 100 - 50 * counts.open_critical);

  const pieces: [number | null, number][] = [
    [ratingPart, SCORE_WEIGHTS.rating],
    [netPart, SCORE_WEIGHTS.net_sentiment],
    [replyPart, SCORE_WEIGHTS.reply_rate],
    [critPart, SCORE_WEIGHTS.critical],
  ];
  let wSum = 0;
  let vSum = 0;
  for (const [v, w] of pieces) {
    if (v == null) continue;
    wSum += w;
    vSum += v * w;
  }
  return {
    score: Math.round(vSum / wSum),
    parts: {
      rating: ratingPart == null ? null : r1(ratingPart),
      net_sentiment: netPart == null ? null : r1(netPart),
      reply_rate: r1(replyPart),
      critical: critPart,
    },
    net_sentiment_raw: netRaw == null ? null : r1(netRaw),
    avg_rating: avg == null ? null : r2(avg),
    counts,
  };
}

export type ScoreBand = "Excellent" | "Good" | "Needs work" | "At risk";

export function scoreBand(score: number | null | undefined): ScoreBand | null {
  if (score == null) return null;
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "Needs work";
  return "At risk";
}
