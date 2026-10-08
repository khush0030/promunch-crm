// Pure aggregation for GET /api/orm/summary (unit-tested).
import { HANDLED_STATUSES, sentimentBucket } from "./filters";
import { computeScore, isHandled } from "./score";
import type {
  ChannelStats,
  CompetitorSnapshot,
  OrmSource,
  OrmSourceKey,
  OrmStatus,
  OrmSummary,
  ProductRow,
  ResponseStats,
} from "./types";

export type SummaryRow = {
  source: OrmSourceKey;
  rating: number | string | null;
  sentiment: number | null;
  topics: string[] | null;
  status: OrmStatus;
  posted_at: string | null;
  collected_at: string;
  // v2 (optional so older fixtures still type-check)
  product?: string | null;
  urgency?: string | null;
  case_status?: string | null;
  case_outcome?: string | null;
  replied_at?: string | null;
  enriched_at?: string | null;
};

/** Columns GET /api/orm/summary selects (the route filters relevant != false). */
export const SUMMARY_COLUMNS =
  "source, rating, sentiment, topics, status, posted_at, collected_at, product, urgency, case_status, case_outcome, replied_at, enriched_at";

export type SnapshotRow = CompetitorSnapshot & { created_at?: string };

export const UNKNOWN_PRODUCT = "Not sure which product";
export const WEEKS = 12;

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

/** IST Monday 'YYYY-MM-DD' of the week an instant falls in. */
export function istWeekStart(ms: number): string {
  const day = istDay(ms);
  const d = new Date(`${day}T00:00:00.000Z`);
  const back = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(d.getTime() - back * 86_400_000).toISOString().slice(0, 10);
}

/** The last `n` IST week starts (Mondays), oldest first, ending with the current week. */
export function istWeeks(now: number, n = WEEKS): string[] {
  const cur = Date.parse(`${istWeekStart(now)}T00:00:00.000Z`);
  return Array.from({ length: n }, (_, i) => new Date(cur - (n - 1 - i) * 7 * 86_400_000).toISOString().slice(0, 10));
}

/** First instant (UTC) of an IST day 'YYYY-MM-DD'. */
const istDayStartMs = (day: string) => Date.parse(`${day}T00:00:00.000Z`) - IST_MS;

/** How far back GET /api/orm/summary must read: previous period and 12 weeks. */
export function fetchSince(days: number, now: number): Date {
  const prev = windowStart(days, now).getTime() - days * 86_400_000;
  const weeks = istDayStartMs(istWeeks(now)[0]);
  return new Date(Math.min(prev, weeks));
}

const rowTime = (r: SummaryRow) => Date.parse(r.posted_at ?? r.collected_at);

function avgRating(rows: SummaryRow[]): { avg: number | null; n: number } {
  let sum = 0;
  let n = 0;
  for (const r of rows) {
    const v = r.rating == null || r.rating === "" ? NaN : Number(r.rating);
    if (Number.isFinite(v)) {
      sum += v;
      n++;
    }
  }
  return { avg: n ? sum / n : null, n };
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function topOf(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let n = 0;
  for (const [k, v] of counts) if (v > n || (v === n && best != null && k < best)) [best, n] = [k, v];
  return best;
}

export function productRows(cur: SummaryRow[], prev: SummaryRow[]): ProductRow[] {
  const group = (rows: SummaryRow[]) => {
    const m = new Map<string, SummaryRow[]>();
    for (const r of rows) {
      const k = r.product?.trim() || UNKNOWN_PRODUCT;
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return m;
  };
  const prevBy = group(prev);
  const out: ProductRow[] = [];
  for (const [product, rs] of group(cur)) {
    const { avg, n } = avgRating(rs);
    const scored = rs.filter((r) => r.sentiment != null);
    const neg = scored.filter((r) => (r.sentiment as number) < 0);
    const complaintTopics = new Map<string, number>();
    for (const r of neg) for (const t of r.topics ?? []) complaintTopics.set(t, (complaintTopics.get(t) ?? 0) + 1);
    const before = avgRating(prevBy.get(product) ?? []).avg;
    const diff = avg != null && before != null ? avg - before : 0;
    out.push({
      product,
      mentions: rs.length,
      avg_rating: avg == null ? null : round1(avg),
      rated: n,
      pct_negative: scored.length ? Math.round((neg.length / scored.length) * 100) : null,
      top_complaint_topic: topOf(complaintTopics),
      trend: diff >= 0.1 ? "up" : diff <= -0.1 ? "down" : "flat",
    });
  }
  const nl = (v: number | null, dflt: number) => (v == null ? dflt : v);
  return out.sort(
    (a, b) =>
      nl(b.pct_negative, -1) - nl(a.pct_negative, -1) ||
      nl(a.avg_rating, 99) - nl(b.avg_rating, 99) ||
      b.mentions - a.mentions ||
      a.product.localeCompare(b.product),
  );
}

export function driverRows(rows: SummaryRow[]): OrmSummary["drivers"] {
  const m = new Map<string, { praise: number; complaints: number; neutral: number }>();
  for (const r of rows) {
    if (r.sentiment == null) continue;
    for (const t of r.topics ?? []) {
      const d = m.get(t) ?? { praise: 0, complaints: 0, neutral: 0 };
      if (r.sentiment > 0) d.praise++;
      else if (r.sentiment < 0) d.complaints++;
      else d.neutral++;
      m.set(t, d);
    }
  }
  return [...m.entries()]
    .map(([topic, d]) => ({ topic, ...d }))
    .filter((d) => d.praise + d.complaints > 0)
    .sort((a, b) => b.praise + b.complaints - (a.praise + a.complaints) || a.topic.localeCompare(b.topic))
    .slice(0, 10);
}

export function responseStats(rows: SummaryRow[], replyRate: number | null, now: number): ResponseStats {
  const openNeg = rows.filter((r) => (r.sentiment ?? 0) < 0 && !isHandled(r));
  const replyHours: number[] = [];
  for (const r of rows) {
    if (!r.replied_at) continue;
    const h = (Date.parse(r.replied_at) - rowTime(r)) / 3_600_000;
    if (Number.isFinite(h)) replyHours.push(Math.max(0, h));
  }
  const oldest = openNeg.reduce((m, r) => Math.min(m, rowTime(r)), Infinity);
  const cases = { open: 0, in_progress: 0, resolved: 0, recovered: 0, recovery_rate: null as number | null };
  for (const r of rows) {
    if (r.case_status === "open") cases.open++;
    else if (r.case_status === "in_progress") cases.in_progress++;
    else if (r.case_status === "resolved") {
      cases.resolved++;
      if (r.case_outcome === "recovered") cases.recovered++;
    }
  }
  cases.recovery_rate = cases.resolved ? Math.round((cases.recovered / cases.resolved) * 100) : null;
  const med = median(replyHours);
  return {
    open_negatives: openNeg.length,
    open_critical: rows.filter((r) => r.urgency === "critical" && !isHandled(r)).length,
    median_reply_hours: med == null ? null : round1(med),
    oldest_unanswered_days: Number.isFinite(oldest) ? Math.max(0, Math.floor((now - oldest) / 86_400_000)) : null,
    reply_rate: replyRate,
    cases,
  };
}

export function channelStats(
  rows: SummaryRow[],
  inWindow: SummaryRow[],
  sources: SummarySource[],
  weeks: string[],
): ChannelStats[] {
  const firstWeek = istDayStartMs(weeks[0]);
  const keys = new Set(rows.filter((r) => rowTime(r) >= firstWeek).map((r) => r.source));
  const order = sources.map((s) => s.key as string);
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : 99);
  return [...keys]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((key) => {
      const win = inWindow.filter((r) => r.source === key);
      const { avg, n } = avgRating(win);
      const star_mix = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 } as ChannelStats["star_mix"];
      for (const r of win) {
        const v = r.rating == null || r.rating === "" ? NaN : Number(r.rating);
        if (!Number.isFinite(v)) continue;
        const k = String(Math.min(5, Math.max(1, Math.round(v)))) as keyof typeof star_mix;
        star_mix[k]++;
      }
      const byWeek = new Map<string, SummaryRow[]>(weeks.map((w) => [w, []]));
      for (const r of rows) {
        if (r.source !== key) continue;
        const t = rowTime(r);
        if (!Number.isFinite(t)) continue;
        byWeek.get(istWeekStart(t))?.push(r);
      }
      const weekly = weeks.map((w) => {
        const rs = byWeek.get(w) ?? [];
        const a = avgRating(rs).avg;
        return { week_start: w, avg_rating: a == null ? null : round1(a), count: rs.length };
      });
      const last4 = weekly.slice(-4).reduce((x, w) => x + w.count, 0);
      return {
        key,
        label: sources.find((s) => s.key === key)?.label ?? key,
        avg_rating: avg == null ? null : round1(avg),
        reviews: n,
        star_mix,
        weekly,
        velocity_per_week: round1(last4 / 4),
      };
    });
}

/** Latest snapshot per ASIN; ours first, then by rating (best first). */
export function latestSnapshots(rows: SnapshotRow[]): CompetitorSnapshot[] {
  const m = new Map<string, SnapshotRow>();
  for (const r of rows) {
    const cur = m.get(r.asin);
    if (!cur || r.taken_on > cur.taken_on) m.set(r.asin, r);
  }
  return [...m.values()]
    .map((r) => ({
      asin: r.asin,
      brand: r.brand ?? null,
      label: r.label ?? null,
      is_ours: !!r.is_ours,
      rating: r.rating == null ? null : Number(r.rating),
      review_count: r.review_count == null ? null : Number(r.review_count),
      price_inr: r.price_inr == null ? null : Number(r.price_inr),
      taken_on: r.taken_on,
    }))
    .sort((a, b) => Number(b.is_ours) - Number(a.is_ours) || (b.rating ?? -1) - (a.rating ?? -1) || a.asin.localeCompare(b.asin));
}

export function buildSummary(
  rows: SummaryRow[],
  sources: SummarySource[],
  days: number,
  now: number,
  snapshots: SnapshotRow[] = [],
): OrmSummary {
  const start = windowStart(days, now).getTime();
  const prevStart = start - days * 86_400_000;
  const inWindow = rows.filter((r) => {
    const t = rowTime(r);
    return Number.isFinite(t) && t >= start && t <= now + 60_000;
  });
  const inPrev = rows.filter((r) => {
    const t = rowTime(r);
    return Number.isFinite(t) && t >= prevStart && t < start;
  });
  const weeks = istWeeks(now);

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
    if (b === "neg" && !HANDLED_STATUSES.includes(r.status) && r.case_status !== "resolved") unansweredNeg++;
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

  const score = computeScore(inWindow);
  const byWeek = new Map<string, SummaryRow[]>(weeks.map((w) => [w, []]));
  for (const r of rows) {
    const t = rowTime(r);
    if (Number.isFinite(t) && t <= now + 60_000) byWeek.get(istWeekStart(t))?.push(r);
  }

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
    score,
    score_prev: computeScore(inPrev),
    score_weekly: weeks.map((w) => {
      const rs = byWeek.get(w) ?? [];
      return { week_start: w, score: computeScore(rs).score, mentions: rs.length };
    }),
    products: productRows(inWindow, inPrev),
    drivers: driverRows(inWindow),
    response: responseStats(inWindow, score.score == null ? null : (score.parts?.reply_rate ?? null), now),
    channels: channelStats(rows, inWindow, sources, weeks),
    competitors: latestSnapshots(snapshots),
  };
}
