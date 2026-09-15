// Pure period-window math shared by dashboard metric API routes and pages.
// "Period" here always means a rolling window ending at `now` (or `w.from`
// for the comparison window), never a calendar month/quarter.

export type PeriodKey = "7d" | "30d" | "90d" | "12m";

const KEYS: PeriodKey[] = ["7d", "30d", "90d", "12m"];

export function parsePeriod(raw: string | null | undefined): PeriodKey {
  return KEYS.includes(raw as PeriodKey) ? (raw as PeriodKey) : "30d";
}

const DAY_MS = 24 * 60 * 60 * 1000;

const DAYS: Record<PeriodKey, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  // "12m" is a rolling 365-day window, not a calendar-month walk-back.
  "12m": 365,
};

export function periodWindow(key: PeriodKey, now: Date = new Date()): { from: Date; to: Date } {
  const to = now;
  const from = new Date(to.getTime() - DAYS[key] * DAY_MS);
  return { from, to };
}

// Same-length window immediately preceding `w`, for period-over-period
// comparisons. Ends exactly at w.from so the two windows are contiguous
// (no gap, no overlap).
export function previousWindow(w: { from: Date; to: Date }): { from: Date; to: Date } {
  const length = w.to.getTime() - w.from.getTime();
  const to = w.from;
  const from = new Date(to.getTime() - length);
  return { from, to };
}

// Percent change from `previous` to `current`, rounded to the nearest
// integer. null (not Infinity/NaN) when `previous` is 0 — there is no
// meaningful percent change off a zero base.
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
