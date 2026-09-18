// Pure relative-time helper for the Inbox conversation list (Task 2.4). No
// React, no fetch. Renders "2m" / "3h" / "2d" for anything within the last
// week, then falls back to a short IST date ("12 Sep") so old threads don't
// show an ever-growing day count. `now` is injectable for deterministic
// tests; defaults to the real clock at call time.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

// en-IN's "short" month renders "Sept", not "Sep" — build the "D Mon" string
// by hand off IST day-of-month/month parts instead of trusting the locale.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const istParts = new Intl.DateTimeFormat("en-CA", {
  day: "numeric",
  month: "numeric",
  timeZone: "Asia/Kolkata",
});

export function formatWhen(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Math.max(0, now.getTime() - then);

  if (diff < HOUR_MS) return `${Math.max(1, Math.floor(diff / MINUTE_MS))}m`;
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)}h`;
  if (diff < WEEK_MS) return `${Math.floor(diff / DAY_MS)}d`;
  const parts = istParts.formatToParts(new Date(then));
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const month = Number(parts.find((p) => p.type === "month")?.value ?? "1");
  return `${day} ${MONTHS[month - 1]}`;
}
