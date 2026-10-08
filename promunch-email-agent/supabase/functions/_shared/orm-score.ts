// ORM Reputation Score. Contract: docs/plans/2026-10-09-orm-v2-spec.md §1.
//
// Pure. The SAME formula lives in src/lib/orm/score.ts (Next.js); both suites
// assert the shared vectors in docs/plans/orm-score-vectors.json, so change
// both copies and the vectors together or not at all.
//
// Input mentions: the caller passes the period's mentions; this function also
// drops relevant === false and enriched_at === null (explicit null only; a
// missing enriched_at key counts as enriched).
//
//   rating        0.40  (avg(rating) - 1) / 4 * 100        missing: no rated mentions
//   net_sentiment 0.30  (pct_pos - pct_neg + 100) / 2       missing: no scored mentions
//   reply_rate    0.20  handled negatives / negatives * 100 no negatives → 100
//   critical      0.10  max(0, 100 - 50 * open_critical)    never missing
//
// Missing parts are dropped and the remaining weights re-normalised.
// score = Math.round(weighted mean of the UNROUNDED parts). Returned parts and
// net_sentiment_raw are rounded to 1 decimal, avg_rating to 2 decimals, all
// with Math.round semantics. No mentions at all → score null.

export interface ScoreMention {
  rating?: number | string | null;
  sentiment?: number | null; // -2..2
  status?: string | null; // new | seen | replied | ignored | escalated
  case_status?: string | null; // open | in_progress | resolved | null
  urgency?: string | null; // critical | high | normal | low
  relevant?: boolean | null;
  enriched_at?: string | null;
}

export interface ScoreParts {
  rating: number | null;
  net_sentiment: number | null;
  reply_rate: number | null;
  critical: number | null;
}

export interface ScoreCounts {
  mentions: number;
  rated: number;
  scored: number;
  positive: number;
  negative: number;
  negatives_handled: number;
  open_critical: number;
}

export interface ScoreResult {
  score: number | null;
  parts: ScoreParts;
  net_sentiment_raw: number | null; // -100..100
  avg_rating: number | null;
  counts: ScoreCounts;
}

export const SCORE_WEIGHTS = { rating: 0.4, net_sentiment: 0.3, reply_rate: 0.2, critical: 0.1 } as const;

const HANDLED_STATUSES = new Set(["replied", "ignored"]);

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Handled = status replied/ignored OR case resolved. */
export function isHandled(m: ScoreMention): boolean {
  return HANDLED_STATUSES.has(String(m.status ?? "")) || m.case_status === "resolved";
}

/** Open critical = urgency critical AND not handled. */
export function isOpenCritical(m: ScoreMention): boolean {
  return m.urgency === "critical" && !isHandled(m);
}

export function computeScore(input: ScoreMention[]): ScoreResult {
  const ms = (input ?? []).filter((m) => m && m.relevant !== false && m.enriched_at !== null);

  const ratings = ms.map((m) => num(m.rating)).filter((r): r is number => r != null && r >= 1 && r <= 5);
  const scored = ms.map((m) => num(m.sentiment)).filter((s): s is number => s != null);
  const positive = scored.filter((s) => s > 0).length;
  const negativeRows = ms.filter((m) => {
    const s = num(m.sentiment);
    return s != null && s < 0;
  });
  const handled = negativeRows.filter(isHandled).length;
  const openCritical = ms.filter(isOpenCritical).length;

  const counts: ScoreCounts = {
    mentions: ms.length,
    rated: ratings.length,
    scored: scored.length,
    positive,
    negative: negativeRows.length,
    negatives_handled: handled,
    open_critical: openCritical,
  };

  if (!ms.length) {
    return {
      score: null,
      parts: { rating: null, net_sentiment: null, reply_rate: null, critical: null },
      net_sentiment_raw: null,
      avg_rating: null,
      counts,
    };
  }

  const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
  const rating = avg == null ? null : ((avg - 1) / 4) * 100;
  let netRaw: number | null = null;
  let net: number | null = null;
  if (scored.length) {
    const pctPos = (positive / scored.length) * 100;
    const pctNeg = (negativeRows.length / scored.length) * 100;
    netRaw = pctPos - pctNeg;
    net = (netRaw + 100) / 2;
  }
  const reply = negativeRows.length ? (handled / negativeRows.length) * 100 : 100;
  const critical = Math.max(0, 100 - 50 * openCritical);

  const raw: ScoreParts = { rating, net_sentiment: net, reply_rate: reply, critical };
  let wsum = 0, acc = 0;
  for (const k of Object.keys(SCORE_WEIGHTS) as Array<keyof ScoreParts>) {
    const v = raw[k];
    if (v == null) continue;
    wsum += SCORE_WEIGHTS[k];
    acc += SCORE_WEIGHTS[k] * v;
  }
  const score = wsum > 0 ? Math.round(acc / wsum) : null;

  return {
    score,
    parts: {
      rating: rating == null ? null : r1(rating),
      net_sentiment: net == null ? null : r1(net),
      reply_rate: r1(reply),
      critical: r1(critical),
    },
    net_sentiment_raw: netRaw == null ? null : r1(netRaw),
    avg_rating: avg == null ? null : r2(avg),
    counts,
  };
}

export type ScoreBand = "Excellent" | "Good" | "Needs work" | "At risk";

/** 85+ Excellent, 70-84 Good, 50-69 Needs work, <50 At risk; null → null. */
export function scoreBand(score: number | null | undefined): ScoreBand | null {
  if (score == null || !Number.isFinite(score)) return null;
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "Needs work";
  return "At risk";
}
