// Pure aggregator for Inbox → Reports (helpdesk numbers). Turns wa_threads
// ticket rows (+ each ticket's first human reply, see firstHumanReplyAt in
// ./tickets) into the period's volume, first-reply time, on-time share,
// solve time, a topic breakdown and a per-person table. No React, no
// Supabase, no fetch: GET /api/inbox/tickets/reports fetches the rows and
// calls buildTicketReport. Read-only by construction.

import { categoryWord } from "../../components/inbox/labels";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const IST_OFFSET_MS = 5.5 * HOUR_MS;

// Same 4-hour first-human-reply target the Tickets queue uses (isPastTarget).
export const FIRST_REPLY_TARGET_MS = 4 * HOUR_MS;

export type ReportPeriod = "7d" | "30d" | "90d";
export const REPORT_PERIODS: readonly ReportPeriod[] = ["7d", "30d", "90d"];
const PERIOD_DAYS: Record<ReportPeriod, number> = { "7d": 7, "30d": 30, "90d": 90 };

export function parseReportPeriod(raw: string | null | undefined): ReportPeriod {
  return raw === "30d" || raw === "90d" ? raw : "7d";
}

export function periodDays(p: ReportPeriod): number {
  return PERIOD_DAYS[p];
}

export type ReportTicketRow = {
  status: string | null;
  category: string | null;
  assignee: string | null;
  openedAt: string | null;
  resolvedAt: string | null;
  firstReplyAt: string | null;
};

// Topic words for every category the bot and the edge functions write
// (wa-ai-reply prompt: order_issue|refund|product_query|partnership|
// complaint|wholesale|general; cod-gate: order_issue; IG: support). Falls
// back to the shared Inbox category words, then "Other".
const TOPIC_WORDS: Record<string, string> = {
  order_issue: "Order problem",
  order_tracking: "Where's my order",
  refund: "Refund",
  product_query: "Product question",
  partnership: "Partnership",
  partnership_inquiry: "Partnership",
  wholesale: "Wholesale",
  complaint: "Complaint",
  support: "Support",
  customer_support: "Support",
};

export function topicKey(category: string | null): string {
  const c = (category ?? "").trim().toLowerCase();
  return c || "general";
}

export function topicWord(category: string | null): string {
  const key = topicKey(category);
  if (TOPIC_WORDS[key]) return TOPIC_WORDS[key];
  const shared = categoryWord(key);
  return shared === "General" ? "Other" : shared;
}

export type TicketReport = {
  period: ReportPeriod;
  days: number;
  opened: number;
  prevOpened: number;
  // Median minutes from ticket opened to the first human reply, over tickets
  // opened in the window that got one. null when none did.
  firstReplyMin: number | null;
  prevFirstReplyMin: number | null;
  // Share (0..100) of tickets opened in the window whose 4h clock has run out
  // or that already got a reply, answered by a human within 4 hours.
  onTimePct: number | null;
  prevOnTimePct: number | null;
  onTimeBase: number;
  solved: number;
  prevSolved: number;
  // Median hours from opened to solved, over tickets solved in the window.
  solveHours: number | null;
  prevSolveHours: number | null;
  openNow: number;
  topics: { key: string; word: string; count: number; prevCount: number }[];
  people: { assignee: string; solved: number; open: number; firstReplyMin: number | null }[];
  unassignedOpen: number;
  // Tickets opened per IST day in the window, oldest first.
  daily: { date: string; opened: number; solved: number }[];
};

function ms(iso: string | null): number {
  if (!iso) return NaN;
  return new Date(iso).getTime();
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function istMidnightMs(t: number): number {
  return Math.floor((t + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
}

function istDate(t: number): string {
  return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
}

const isSolved = (s: string | null) => s === "resolved" || s === "closed";
const isLive = (s: string | null) => s === "open" || s === "pending";

type Win = { from: number; to: number };
const inWin = (t: number, w: Win) => Number.isFinite(t) && t >= w.from && t < w.to;

function replyStats(rows: ReportTicketRow[], w: Win, now: number) {
  const replyMins: number[] = [];
  let base = 0;
  let onTime = 0;
  for (const r of rows) {
    const opened = ms(r.openedAt);
    if (!inWin(opened, w)) continue;
    const reply = ms(r.firstReplyAt);
    const replied = Number.isFinite(reply) && reply > opened;
    if (replied) replyMins.push((reply - opened) / MINUTE_MS);
    // Only judge tickets whose 4h window has closed, or that already got a
    // reply: a ticket opened 10 minutes ago is neither late nor on time.
    const clockDone = now - opened >= FIRST_REPLY_TARGET_MS;
    if (!replied && !clockDone) continue;
    base++;
    if (replied && reply - opened <= FIRST_REPLY_TARGET_MS) onTime++;
  }
  return {
    median: median(replyMins),
    onTimePct: base > 0 ? Math.round((onTime / base) * 100) : null,
    base,
  };
}

function solveStats(rows: ReportTicketRow[], w: Win) {
  const hours: number[] = [];
  let count = 0;
  for (const r of rows) {
    if (!isSolved(r.status)) continue;
    const resolved = ms(r.resolvedAt);
    if (!inWin(resolved, w)) continue;
    count++;
    const opened = ms(r.openedAt);
    if (Number.isFinite(opened) && resolved >= opened) hours.push((resolved - opened) / HOUR_MS);
  }
  return { count, median: median(hours) };
}

export function buildTicketReport(rows: ReportTicketRow[], period: ReportPeriod, now: Date): TicketReport {
  const days = PERIOD_DAYS[period];
  const nowMs = now.getTime();
  // The window is the last `days` IST calendar days including today, so the
  // daily chart lines up with whole days; the previous window is the same
  // length immediately before it.
  const todayStart = istMidnightMs(nowMs);
  const cur: Win = { from: todayStart - (days - 1) * DAY_MS, to: todayStart + DAY_MS };
  const prev: Win = { from: cur.from - days * DAY_MS, to: cur.from };

  const curReply = replyStats(rows, cur, nowMs);
  const prevReply = replyStats(rows, prev, nowMs);
  const curSolve = solveStats(rows, cur);
  const prevSolve = solveStats(rows, prev);

  let opened = 0;
  let prevOpened = 0;
  const topicCur = new Map<string, number>();
  const topicPrev = new Map<string, number>();
  const daily = new Map<string, { opened: number; solved: number }>();
  for (let d = 0; d < days; d++) daily.set(istDate(cur.from + d * DAY_MS), { opened: 0, solved: 0 });

  for (const r of rows) {
    const o = ms(r.openedAt);
    const key = topicKey(r.category);
    if (inWin(o, cur)) {
      opened++;
      topicCur.set(key, (topicCur.get(key) ?? 0) + 1);
      const day = daily.get(istDate(o));
      if (day) day.opened++;
    } else if (inWin(o, prev)) {
      prevOpened++;
      topicPrev.set(key, (topicPrev.get(key) ?? 0) + 1);
    }
    const s = ms(r.resolvedAt);
    if (isSolved(r.status) && inWin(s, cur)) {
      const day = daily.get(istDate(s));
      if (day) day.solved++;
    }
  }

  // Topics merge by their display word (support + customer_support are both
  // "Support"), largest first, ties by name.
  const byWord = new Map<string, { key: string; word: string; count: number; prevCount: number }>();
  for (const key of new Set([...topicCur.keys(), ...topicPrev.keys()])) {
    const word = topicWord(key);
    const t = byWord.get(word) ?? { key, word, count: 0, prevCount: 0 };
    t.count += topicCur.get(key) ?? 0;
    t.prevCount += topicPrev.get(key) ?? 0;
    byWord.set(word, t);
  }
  const topics = [...byWord.values()]
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));

  // Per person: solved in the window, open now, and the median first reply
  // on the tickets they hold that were opened in the window.
  const people = new Map<string, { solved: number; open: number; replies: number[] }>();
  const person = (email: string) => {
    let p = people.get(email);
    if (!p) people.set(email, (p = { solved: 0, open: 0, replies: [] }));
    return p;
  };
  let openNow = 0;
  let unassignedOpen = 0;
  for (const r of rows) {
    if (isLive(r.status)) {
      openNow++;
      if (r.assignee) person(r.assignee).open++;
      else unassignedOpen++;
    }
    if (!r.assignee) continue;
    if (isSolved(r.status) && inWin(ms(r.resolvedAt), cur)) person(r.assignee).solved++;
    const o = ms(r.openedAt);
    const rep = ms(r.firstReplyAt);
    if (inWin(o, cur) && Number.isFinite(rep) && rep > o) person(r.assignee).replies.push((rep - o) / MINUTE_MS);
  }

  return {
    period,
    days,
    opened,
    prevOpened,
    firstReplyMin: curReply.median,
    prevFirstReplyMin: prevReply.median,
    onTimePct: curReply.onTimePct,
    prevOnTimePct: prevReply.onTimePct,
    onTimeBase: curReply.base,
    solved: curSolve.count,
    prevSolved: prevSolve.count,
    solveHours: curSolve.median,
    prevSolveHours: prevSolve.median,
    openNow,
    topics,
    people: [...people.entries()]
      .map(([assignee, p]) => ({ assignee, solved: p.solved, open: p.open, firstReplyMin: median(p.replies) }))
      .filter((p) => p.solved > 0 || p.open > 0 || p.firstReplyMin != null)
      .sort((a, b) => b.solved - a.solved || b.open - a.open || a.assignee.localeCompare(b.assignee)),
    unassignedOpen,
    daily: [...daily.entries()].map(([date, v]) => ({ date, ...v })),
  };
}

// The earliest timestamp the route must fetch for a period: the start of the
// previous window (tickets opened or solved since then).
export function reportFetchSince(period: ReportPeriod, now: Date): Date {
  const days = PERIOD_DAYS[period];
  const todayStart = istMidnightMs(now.getTime());
  return new Date(todayStart - (2 * days - 1) * DAY_MS);
}

// "35 min" / "1h 40m" / "2h" / "1 day 3h" / "4 days" for a span in minutes.
export function spanText(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) return "None yet";
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const hr = h % 24;
  if (d >= 3 || hr === 0) return `${d} day${d === 1 ? "" : "s"}`;
  return `${d} day${d === 1 ? "" : "s"} ${hr}h`;
}
