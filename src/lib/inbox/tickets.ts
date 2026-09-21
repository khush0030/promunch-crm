// Pure aggregator for the Tickets board (Task 2.6). Turns wa_threads /
// ig_threads ticket rows into a kanban board by ticket status, plus the
// headline KPIs (open count, 4-hour target misses, median resolve time,
// top complaint category). No React, no Supabase, no fetch — the API route
// (src/app/api/inbox/tickets/route.ts) fetches the real rows and calls
// buildBoard with them.

import { categoryWord } from "../../components/inbox/labels";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
// IST is UTC+5:30 with no DST. Used to compute calendar-day/week boundaries
// without depending on the process's TZ (see istMidnightMs below).
const IST_OFFSET_MS = 5.5 * HOUR_MS;

export type TicketRow = {
  id: string;
  channel: "wa" | "ig";
  ticket_number: number | null;
  ticket_status: "open" | "pending" | "resolved" | "closed";
  ticket_subject: string | null;
  ticket_category: string | null;
  escalation_reason: string | null;
  ticket_assignee: string | null;
  ticket_opened_at: string | null;
  ticket_resolved_at: string | null;
  customer: string;
  firstHumanReplyAt: string | null;
};

export type TicketCard = {
  key: string;
  number: number | null;
  title: string;
  customer: string;
  orderRef: string | null;
  orderValue: number | null;
  ageText: string;
  tone: "crit" | "warn" | "neu";
  pastTarget: boolean;
  assignee: string | null;
  href: string;
};

export type TicketsBoard = {
  columns: { key: string; title: string; cards: TicketCard[] }[];
  kpis: {
    open: number;
    pastTarget: number;
    medianResolveHours: number | null;
    prevMedianResolveHours: number | null;
    topCategory: { word: string; count: number; prevCount: number } | null;
  };
  counts: { open: number; waiting: number; resolvedWeek: number };
};

// "D Mon" for a date outside "today"/"yesterday" — en-IN's "short" month
// renders "Sept", not "Sep", so build it by hand off IST day/month parts.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const istDateParts = new Intl.DateTimeFormat("en-CA", { day: "numeric", month: "numeric", timeZone: "Asia/Kolkata" });

// First /#?(\d{4,6})/ match in the text, normalised to "#2231". Order refs
// show up in ticket_subject/escalation_reason free text, with or without a
// leading '#' (bot-written vs. agent-written).
export function extractOrderRef(text: string | null): string | null {
  if (!text) return null;
  const m = text.match(/#?(\d{4,6})/);
  return m ? `#${m[1]}` : null;
}

// Classifies a wa_messages.sent_by value as a real human reply vs. noise:
// the bot itself, a marketing campaign send, or the automatic "done #N"
// close confirmation (sent_by = 'ops_resolve') — none of those count as the
// human picking up the ticket.
export function isHumanReplySender(sentBy: string | null): boolean {
  if (!sentBy) return false;
  // Allowlist, not denylist: automated senders keep growing (journey:x,
  // cod_gate, checkout, optin, voice:cart_link, growth:x, followup_bot,
  // ticket_watchdog_fallback, ...). Only a signed-in agent's email or the
  // literal "human" (Instagram replies) is a person answering.
  return sentBy.includes("@") || sentBy === "human";
}

// Reduces a raw wa_messages slice to the first genuine human reply per
// thread, strictly after that thread's own ticket_opened_at.
export function firstHumanReplyAt(
  messages: { thread_id: string; direction: string; sent_by: string | null; created_at: string }[],
  openedAt: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const m of messages) {
    if (m.direction !== "outbound") continue;
    if (!isHumanReplySender(m.sent_by)) continue;
    const opened = openedAt[m.thread_id];
    if (!opened) continue;
    const openedMs = new Date(opened).getTime();
    const createdMs = new Date(m.created_at).getTime();
    if (!Number.isFinite(openedMs) || !Number.isFinite(createdMs)) continue;
    if (createdMs <= openedMs) continue;
    const existing = result[m.thread_id];
    if (!existing || createdMs < new Date(existing).getTime()) {
      result[m.thread_id] = m.created_at;
    }
  }
  return result;
}

// Past the 4-hour first-human-reply target: still open/pending, opened more
// than 4h ago, and no human reply landed within 4h of opening.
export function isPastTarget(t: TicketRow, now: Date): boolean {
  if (t.ticket_status !== "open" && t.ticket_status !== "pending") return false;
  if (!t.ticket_opened_at) return false;
  const openedMs = new Date(t.ticket_opened_at).getTime();
  const nowMs = now.getTime();
  if (!Number.isFinite(openedMs)) return false;
  if (nowMs - openedMs <= 4 * HOUR_MS) return false;
  if (t.firstHumanReplyAt) {
    const replyMs = new Date(t.firstHumanReplyAt).getTime();
    if (Number.isFinite(replyMs) && replyMs - openedMs <= 4 * HOUR_MS) return false;
  }
  return true;
}

// "40m" / "2h 10m" / "2h" (no remainder) / "1 day" / "3 days".
export function ageText(from: string, now: Date): string {
  const then = new Date(from).getTime();
  const diff = Math.max(0, now.getTime() - then);
  const totalMin = Math.floor(diff / MINUTE_MS);
  if (totalMin < 60) return `${totalMin}m`;
  const totalHours = Math.floor(diff / HOUR_MS);
  if (totalHours < 24) {
    const mins = Math.floor((diff % HOUR_MS) / MINUTE_MS);
    return mins > 0 ? `${totalHours}h ${mins}m` : `${totalHours}h`;
  }
  const days = Math.floor(diff / DAY_MS);
  return `${days} day${days === 1 ? "" : "s"}`;
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max).trim()}…` : t;
}

// Card titles come from bot- or agent-written subjects that sometimes use
// an em dash as a clause separator ("Wrong flavour — sent Peri Peri
// instead"). PROMUNCH copy bans em dashes on screen, so the card title
// swaps it for ": " — this only affects display, never the stored
// ticket_subject/escalation_reason text.
export function humanizeTitleSeparator(text: string): string {
  return text.replace(/ — /g, ": ");
}

// The real UTC ms timestamp of IST midnight for the calendar day containing
// `d`. Shifting by the fixed IST offset before flooring to a day boundary
// gives the right answer regardless of the host process's TZ.
function istMidnightMs(d: Date): number {
  const shifted = d.getTime() + IST_OFFSET_MS;
  const dayFloor = Math.floor(shifted / DAY_MS) * DAY_MS;
  return dayFloor - IST_OFFSET_MS;
}

// "today" / "yesterday" / "12 Sep" (IST calendar day) for a resolved card's
// meta line, so an older card in the 7-day Resolved column still reads
// right instead of implying it just happened.
function istDayLabel(d: Date, now: Date): string {
  const dayStart = istMidnightMs(d);
  const todayStart = istMidnightMs(now);
  if (dayStart === todayStart) return "today";
  if (dayStart === todayStart - DAY_MS) return "yesterday";
  const parts = istDateParts.formatToParts(d);
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const month = Number(parts.find((p) => p.type === "month")?.value ?? "1");
  return `${day} ${MONTHS[month - 1]}`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function firstNameOf(name: string): string {
  const t = name.trim();
  return t.split(/\s+/)[0] || t;
}

function byOpenedAtAsc(a: TicketRow, b: TicketRow): number {
  const am = a.ticket_opened_at ? new Date(a.ticket_opened_at).getTime() : Number.POSITIVE_INFINITY;
  const bm = b.ticket_opened_at ? new Date(b.ticket_opened_at).getTime() : Number.POSITIVE_INFINITY;
  return am - bm;
}

export function buildBoard(
  rows: TicketRow[],
  orders: Record<string, number>,
  now: Date,
  teamName: (email: string) => string,
): TicketsBoard {
  const todayStart = istMidnightMs(now);
  const todayEnd = todayStart + DAY_MS;
  // "Last 7 IST days" includes today, so it starts 6 days before today's
  // midnight; the previous 7-day window is the 7 days immediately before that.
  const last7Start = todayStart - 6 * DAY_MS;
  const prev7Start = todayStart - 13 * DAY_MS;
  const prev7End = last7Start;

  const newRows: TicketRow[] = [];
  const waitingRows: TicketRow[] = [];
  const resolvedWeekRows: TicketRow[] = [];
  const withRowsByAssignee = new Map<string, TicketRow[]>();

  let pastTargetCount = 0;
  const resolveDurationsWeek: number[] = [];
  const resolveDurationsPrevWeek: number[] = [];
  const categoryCountsWeek = new Map<string, number>();
  const categoryCountsPrevWeek = new Map<string, number>();

  for (const r of rows) {
    const isOpenLike = r.ticket_status === "open" || r.ticket_status === "pending";
    const isResolvedLike = r.ticket_status === "resolved" || r.ticket_status === "closed";

    if (isOpenLike) {
      if (isPastTarget(r, now)) pastTargetCount++;
      if (r.ticket_assignee) {
        const bucket = withRowsByAssignee.get(r.ticket_assignee) ?? [];
        bucket.push(r);
        withRowsByAssignee.set(r.ticket_assignee, bucket);
      } else if (r.ticket_status === "open") {
        newRows.push(r);
      } else {
        waitingRows.push(r);
      }
    }

    if (isResolvedLike && r.ticket_resolved_at) {
      const resolvedMs = new Date(r.ticket_resolved_at).getTime();
      if (Number.isFinite(resolvedMs)) {
        // "Resolved this week" = the last 7 IST days including today (not
        // only today) — the column and the counts.resolvedWeek badge both
        // read off the same resolvedWeekRows list, so they can never drift.
        const openedMs = r.ticket_opened_at ? new Date(r.ticket_opened_at).getTime() : NaN;
        const durationHours = Number.isFinite(openedMs) ? (resolvedMs - openedMs) / HOUR_MS : null;
        if (resolvedMs >= last7Start && resolvedMs < todayEnd) {
          resolvedWeekRows.push(r);
          if (durationHours != null) resolveDurationsWeek.push(durationHours);
        } else if (resolvedMs >= prev7Start && resolvedMs < prev7End) {
          if (durationHours != null) resolveDurationsPrevWeek.push(durationHours);
        }
      }
    }

    // Category volume is counted by when the ticket was OPENED, not resolved.
    if (r.ticket_opened_at) {
      const openedMs = new Date(r.ticket_opened_at).getTime();
      if (Number.isFinite(openedMs)) {
        const word = categoryWord(r.ticket_category);
        if (openedMs >= last7Start && openedMs < todayEnd) {
          categoryCountsWeek.set(word, (categoryCountsWeek.get(word) ?? 0) + 1);
        } else if (openedMs >= prev7Start && openedMs < prev7End) {
          categoryCountsPrevWeek.set(word, (categoryCountsPrevWeek.get(word) ?? 0) + 1);
        }
      }
    }
  }

  function toCard(r: TicketRow, kind: "open" | "resolved"): TicketCard {
    const orderRef = extractOrderRef(r.ticket_subject) ?? extractOrderRef(r.escalation_reason);
    const orderValue = orderRef && orders[orderRef] != null ? orders[orderRef] : null;
    const title = truncate(humanizeTitleSeparator(r.ticket_subject || r.escalation_reason || "Ticket"), 60);
    const href = `/dashboard/inbox/${r.channel}-${r.id}`;
    const base = {
      key: `${r.channel}-${r.id}`,
      number: r.ticket_number,
      title,
      customer: r.customer,
      orderRef,
      orderValue,
      assignee: r.ticket_assignee,
      href,
    };

    if (kind === "resolved") {
      let text = "—";
      if (r.ticket_opened_at && r.ticket_resolved_at) {
        const resolvedAt = new Date(r.ticket_resolved_at);
        const age = ageText(r.ticket_opened_at, resolvedAt);
        text = `resolved in ${age} · ${istDayLabel(resolvedAt, now)}`;
      }
      return { ...base, ageText: text, tone: "neu", pastTarget: false };
    }

    const past = isPastTarget(r, now);
    const age = r.ticket_opened_at ? ageText(r.ticket_opened_at, now) : "";
    const ageMs = r.ticket_opened_at ? now.getTime() - new Date(r.ticket_opened_at).getTime() : 0;
    const tone: TicketCard["tone"] = past ? "crit" : ageMs > 2 * HOUR_MS ? "warn" : "neu";
    return { ...base, ageText: past ? `${age} · past target` : age, tone, pastTarget: past };
  }

  const columns: TicketsBoard["columns"] = [
    { key: "new", title: "New", cards: [...newRows].sort(byOpenedAtAsc).map((r) => toCard(r, "open")) },
  ];

  const withKeys = [...withRowsByAssignee.keys()].sort((a, b) =>
    firstNameOf(teamName(a)).localeCompare(firstNameOf(teamName(b))),
  );
  for (const assignee of withKeys) {
    const bucket = withRowsByAssignee.get(assignee)!;
    columns.push({
      key: `with:${assignee}`,
      title: `With ${firstNameOf(teamName(assignee))}`,
      cards: [...bucket].sort(byOpenedAtAsc).map((r) => toCard(r, "open")),
    });
  }

  columns.push({
    key: "waiting",
    title: "Waiting on customer",
    cards: [...waitingRows].sort(byOpenedAtAsc).map((r) => toCard(r, "open")),
  });
  columns.push({
    key: "resolved",
    title: "Resolved this week",
    cards: [...resolvedWeekRows].sort(byOpenedAtAsc).map((r) => toCard(r, "resolved")),
  });

  let topCategory: TicketsBoard["kpis"]["topCategory"] = null;
  if (categoryCountsWeek.size > 0) {
    let bestWord = "";
    let bestCount = -1;
    for (const [word, count] of categoryCountsWeek) {
      if (count > bestCount || (count === bestCount && word < bestWord)) {
        bestWord = word;
        bestCount = count;
      }
    }
    topCategory = { word: bestWord, count: bestCount, prevCount: categoryCountsPrevWeek.get(bestWord) ?? 0 };
  }

  // Chip badges must equal the cards each chip's columns actually show, so
  // both `counts` and kpis.open are read straight off the columns just
  // built rather than kept as separate running totals that could drift.
  const openCardCount = columns
    .filter((c) => c.key === "new" || c.key.startsWith("with:"))
    .reduce((sum, c) => sum + c.cards.length, 0);
  const waitingCardCount = columns.find((c) => c.key === "waiting")?.cards.length ?? 0;
  const resolvedCardCount = columns.find((c) => c.key === "resolved")?.cards.length ?? 0;

  return {
    columns,
    kpis: {
      open: openCardCount,
      pastTarget: pastTargetCount,
      medianResolveHours: median(resolveDurationsWeek),
      prevMedianResolveHours: median(resolveDurationsPrevWeek),
      topCategory,
    },
    counts: { open: openCardCount, waiting: waitingCardCount, resolvedWeek: resolvedCardCount },
  };
}
