// Pure aggregation for GET /api/orm/summary (unit-tested).
import { HANDLED_STATUSES, sentimentBucket } from "./filters";
import type { OrmSource, OrmSourceKey, OrmStatus, OrmSummary } from "./types";

export type SummaryRow = {
  source: OrmSourceKey;
  rating: number | string | null;
  sentiment: number | null;
  topics: string[] | null;
  status: OrmStatus;
  posted_at: string | null;
  collected_at: string;
};

export type SummarySource = Pick<
  OrmSource,
  "key" | "label" | "enabled" | "last_run_at" | "last_status" | "last_error" | "last_count" | "next_run_at"
>;

export const SUMMARY_DAYS = [7, 30, 90] as const;

export function parseDays(v: string | null): number {
  const n = Number(v);
  return (SUMMARY_DAYS as readonly number[]).includes(n) ? n : 30;
}

const IST_MS = 330 * 60_000;

/** 'YYYY-MM-DD' of an instant in India time. */
export function istDay(ms: number): string {
  return new Date(ms + IST_MS).toISOString().slice(0, 10);
}

/** First instant of the window: start of the IST day `days - 1` days before now. */
export function windowStart(days: number, now: number): Date {
  const today = istDay(now);
  const startIst = Date.parse(`${today}T00:00:00.000Z`) - (days - 1) * 86_400_000;
  return new Date(startIst - IST_MS);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function buildSummary(rows: SummaryRow[], sources: SummarySource[], days: number, now: number): OrmSummary {
  const start = windowStart(days, now).getTime();
  const inWindow = rows.filter((r) => {
    const t = Date.parse(r.posted_at ?? r.collected_at);
    return Number.isFinite(t) && t >= start && t <= now + 60_000;
  });

  const sentiment = { neg: 0, neu: 0, pos: 0 };
  const topicCount = new Map<string, number>();
  const bySource = new Map<OrmSourceKey, { count: number; ratingSum: number; ratingN: number }>();
  const trendMap = new Map<string, { neg: number; neu: number; pos: number }>();
  for (let i = 0; i < days; i++) trendMap.set(istDay(start + i * 86_400_000), { neg: 0, neu: 0, pos: 0 });

  let newCount = 0;
  let unansweredNeg = 0;
  for (const r of inWindow) {
    const b = sentimentBucket(r.sentiment);
    if (b) sentiment[b]++;
    if (r.status === "new") newCount++;
    if (b === "neg" && !HANDLED_STATUSES.includes(r.status)) unansweredNeg++;
    for (const t of r.topics ?? []) topicCount.set(t, (topicCount.get(t) ?? 0) + 1);

    const s = bySource.get(r.source) ?? { count: 0, ratingSum: 0, ratingN: 0 };
    s.count++;
    const rating = r.rating == null ? NaN : Number(r.rating);
    if (Number.isFinite(rating)) {
      s.ratingSum += rating;
      s.ratingN++;
    }
    bySource.set(r.source, s);

    if (b) {
      const day = istDay(Date.parse(r.posted_at ?? r.collected_at));
      const bucket = trendMap.get(day);
      if (bucket) bucket[b]++;
    }
  }

  const labelOf = (k: OrmSourceKey) => sources.find((s) => s.key === k)?.label ?? k;
  const by_source = [...bySource.entries()]
    .map(([key, v]) => ({
      key,
      label: labelOf(key),
      count: v.count,
      avg_rating: v.ratingN ? round1(v.ratingSum / v.ratingN) : null,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const top_topics = [...topicCount.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
    .slice(0, 8);

  return {
    days,
    total: inWindow.length,
    new_count: newCount,
    unanswered_negative: unansweredNeg,
    by_source,
    sentiment,
    top_topics,
    trend: [...trendMap.entries()].map(([day, v]) => ({ day, ...v })),
    sources: sources.map((s) => ({
      key: s.key,
      label: s.label,
      enabled: s.enabled,
      last_run_at: s.last_run_at,
      last_status: s.last_status,
      last_error: s.last_error,
      last_count: s.last_count,
      next_run_at: s.next_run_at,
    })),
  };
}
