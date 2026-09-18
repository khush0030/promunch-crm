// Pure helpers for the Inbox conversation view (Task 2.5). No React, no
// fetch, no Supabase: everything here maps API rows into the `BubbleItem`
// shape `src/components/inbox/Bubbles.tsx` renders, plus the small words the
// header/facts strip needs (status words, masked phone, IST day labels, COD
// order match, Instagram window errors). The components stay thin and these
// stay testable.

import type { BubbleItem } from "@/components/inbox/Bubbles";
import { explainWaError } from "@/components/whatsapp/waErrors";

const IST = "Asia/Kolkata";

// ---- rows as the routes return them (only the fields we read) -----------

export type WaMessageRow = {
  id: string;
  direction: "inbound" | "outbound";
  type: string;
  body: string | null;
  media_url: string | null;
  status: string;
  template_name: string | null;
  sent_by: string | null;
  ai_meta: unknown;
  error?: string | null;
  created_at: string;
};

export type WaThreadRow = {
  ticket_status: string | null;
  ticket_opened_at?: string | null;
  escalation_reason: string | null;
};

export type IgMessageRow = {
  id: string;
  direction: "inbound" | "outbound";
  text: string | null;
  media_url: string | null;
  status: string;
  sent_by: string | null;
  ai_generated: boolean | null;
  error?: string | null;
  created_at: string;
};

export type CodGateOrder = {
  shopify_id: string | number;
  order_number: string | number | null;
  customer_phone: string | null;
  confirmation_status: string | null;
  shopify_created_at?: string | null;
};

// ---- words ---------------------------------------------------------------

/** Delivery status of an outbound message, as a plain word for the bubble meta. */
export function statusWord(status: string | null | undefined): string {
  switch (status) {
    case "queued":
    case "received":
      return "sending";
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "read":
      return "read";
    case "failed":
      return "failed";
    default:
      return status || "";
  }
}

/** "khush@trypromunch.in" -> "Khush"; "bot" / null / "" -> "Team". */
export function firstNameOf(sentBy: string | null | undefined): string {
  if (!sentBy) return "Team";
  const local = sentBy.includes("@") ? sentBy.split("@")[0] : sentBy;
  const piece = local.split(/[._\-+ ]+/).filter(Boolean)[0];
  if (!piece || !sentBy.includes("@")) return "Team";
  return piece.charAt(0).toUpperCase() + piece.slice(1).toLowerCase();
}

/** Digits only. */
export function digitsOf(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

/**
 * Phone for the crumb with the last three digits hidden:
 * "919823041234" -> "+91 98230 41xxx". Non-Indian numbers keep their
 * digits with a single space after the country code guess. Empty -> "".
 */
export function maskPhone(phone: string | null | undefined): string {
  const d = digitsOf(phone);
  if (!d) return "";
  if (d.length === 12 && d.startsWith("91")) {
    return `+91 ${d.slice(2, 7)} ${d.slice(7, 9)}xxx`;
  }
  if (d.length === 10) {
    return `+91 ${d.slice(0, 5)} ${d.slice(5, 7)}xxx`;
  }
  const keep = Math.max(0, d.length - 3);
  return `+${d.slice(0, keep)}xxx`;
}

// ---- time in IST ---------------------------------------------------------

function istParts(iso: string): { y: number; m: number; d: number; hh: string; mm: string } | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(t));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), hh: get("hour"), mm: get("minute") };
}

/** "14:03" in IST. */
export function timeIST(iso: string): string {
  const p = istParts(iso);
  if (!p) return "";
  // Intl can emit "24" for midnight in some engines with hour12:false.
  const hh = p.hh === "24" ? "00" : p.hh;
  return `${hh}:${p.mm}`;
}

/** IST calendar day key "YYYY-MM-DD". */
export function dayKeyIST(iso: string): string {
  const p = istParts(iso);
  if (!p) return "";
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Today" / "Yesterday" / "Mon 14 Sep" / "Mon 14 Sep 2025" (other year), IST. */
export function dayLabelIST(iso: string, now: number = Date.now()): string {
  const p = istParts(iso);
  if (!p) return "";
  const key = dayKeyIST(iso);
  const todayKey = dayKeyIST(new Date(now).toISOString());
  const yesterdayKey = dayKeyIST(new Date(now - 86_400_000).toISOString());
  if (key === todayKey) return "Today";
  if (key === yesterdayKey) return "Yesterday";
  // weekday of that IST date: build a UTC date for the IST calendar day
  const wd = WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
  const nowYear = Number(todayKey.slice(0, 4));
  return `${wd} ${p.d} ${MONTHS[p.m - 1]}${p.y !== nowYear ? ` ${p.y}` : ""}`;
}

// ---- bubbles -------------------------------------------------------------

/** True when the bot's ai_meta records Master KB chunks actually used. */
export function usedMasterKb(aiMeta: unknown): boolean {
  if (!aiMeta || typeof aiMeta !== "object") return false;
  const m = aiMeta as Record<string, unknown>;
  for (const k of ["kb_chunks", "chunks", "kb_chunk_ids", "sources", "kb"]) {
    const v = m[k];
    if (Array.isArray(v) && v.length > 0) return true;
    if (typeof v === "number" && v > 0) return true;
  }
  return false;
}

/** Plain-English failure reason for a failed outbound message. */
export function failedReason(m: { error?: string | null; ai_meta?: unknown }): string {
  const meta = m.ai_meta && typeof m.ai_meta === "object" ? (m.ai_meta as Record<string, unknown>) : null;
  const raw =
    m.error ||
    (meta && typeof meta.error === "string" ? (meta.error as string) : null) ||
    (meta && typeof meta.reason === "string" ? (meta.reason as string) : null) ||
    null;
  return explainWaError(raw) || raw || "Not delivered";
}

function mediaText(body: string | null, type: string, mediaUrl: string | null): string {
  if (body && body.trim()) return body;
  if (mediaUrl || (type && type !== "text")) {
    if (type === "image") return "Photo";
    if (type === "audio") return "Voice note";
    if (type === "video") return "Video";
    if (type === "document") return "Document";
    if (type === "interactive") return "Button tap";
    if (type === "reaction") return "Reaction";
  }
  return body ?? "";
}

type Timed = { at: number; item: BubbleItem };

function withDays(entries: Timed[], now: number): BubbleItem[] {
  const sorted = [...entries].sort((a, b) => a.at - b.at);
  const out: BubbleItem[] = [];
  let lastDay = "";
  for (const e of sorted) {
    const iso = new Date(e.at).toISOString();
    const key = dayKeyIST(iso);
    if (key !== lastDay) {
      out.push({ kind: "day", label: dayLabelIST(iso, now) });
      lastDay = key;
    }
    out.push(e.item);
  }
  return out;
}

/**
 * wa_messages -> bubbles with IST day separators and the "Bot handed off"
 * system line at ticket_opened_at (when the thread has a ticket + reason).
 */
export function waBubbles(messages: WaMessageRow[], thread: WaThreadRow | null, now: number = Date.now()): BubbleItem[] {
  const entries: Timed[] = [];
  for (const m of messages) {
    const at = Date.parse(m.created_at);
    if (!Number.isFinite(at)) continue;
    const time = timeIST(m.created_at);
    const text = mediaText(m.body, m.type, m.media_url);
    const mediaUrl = m.type === "image" && m.media_url ? m.media_url : undefined;
    if (m.direction === "inbound") {
      entries.push({ at, item: { kind: "in", text, meta: time, mediaUrl } });
      continue;
    }
    const failed = m.status === "failed" ? failedReason(m) : undefined;
    const word = statusWord(m.status);
    if (m.template_name) {
      entries.push({ at, item: { kind: "template", text, meta: `Template ${m.template_name} · ${time}`, mediaUrl, failed } });
    } else if (m.sent_by === "bot") {
      const kb = usedMasterKb(m.ai_meta) ? " · from Master KB" : "";
      entries.push({ at, item: { kind: "bot", text, meta: `Bot · ${time}${kb} · ${word}`, mediaUrl, failed } });
    } else {
      entries.push({ at, item: { kind: "human", text, meta: `${firstNameOf(m.sent_by)} · ${time} · ${word}`, mediaUrl, failed } });
    }
  }
  if (thread?.ticket_opened_at && thread.escalation_reason && thread.ticket_status && thread.ticket_status !== "none") {
    const at = Date.parse(thread.ticket_opened_at);
    if (Number.isFinite(at)) {
      // +1ms so the line sorts after a message stamped the same instant.
      entries.push({ at: at + 1, item: { kind: "system", text: `Bot handed off: ${thread.escalation_reason}` } });
    }
  }
  return withDays(entries, now);
}

/** ig_messages -> bubbles. `ai_generated` or sent_by "bot" is the bot. */
export function igBubbles(messages: IgMessageRow[], now: number = Date.now()): BubbleItem[] {
  const entries: Timed[] = [];
  for (const m of messages) {
    const at = Date.parse(m.created_at);
    if (!Number.isFinite(at)) continue;
    const time = timeIST(m.created_at);
    const text = m.text && m.text.trim() ? m.text : m.media_url ? "Photo" : "";
    const mediaUrl = m.media_url || undefined;
    if (m.direction === "inbound") {
      entries.push({ at, item: { kind: "in", text, meta: time, mediaUrl } });
      continue;
    }
    const failed = m.status === "failed" ? m.error || "Not delivered" : undefined;
    const word = statusWord(m.status);
    if (m.ai_generated || m.sent_by === "bot") {
      entries.push({ at, item: { kind: "bot", text, meta: `Bot · ${time} · ${word}`, mediaUrl, failed } });
    } else {
      entries.push({ at, item: { kind: "human", text, meta: `${firstNameOf(m.sent_by)} · ${time} · ${word}`, mediaUrl, failed } });
    }
  }
  return withDays(entries, now);
}

// ---- facts ---------------------------------------------------------------

/** Latest inbound timestamp across the thread row and loaded messages. */
export function latestInboundAt(
  threadLastInbound: string | null | undefined,
  messages: { direction: string; created_at: string }[],
): string | null {
  let best = threadLastInbound ?? null;
  for (const m of messages) {
    if (m.direction !== "inbound") continue;
    if (!best || Date.parse(m.created_at) > Date.parse(best)) best = m.created_at;
  }
  return best;
}

const COD_WAITING = new Set(["pending", "needs_call"]);

/**
 * The customer's latest COD order still waiting on confirmation, matched by
 * the last 10 digits of the phone. Null when none.
 */
export function waitingCodOrder(orders: CodGateOrder[], waId: string | null | undefined): CodGateOrder | null {
  const me = digitsOf(waId).slice(-10);
  if (me.length < 10) return null;
  let best: CodGateOrder | null = null;
  for (const o of orders) {
    if (!o.confirmation_status || !COD_WAITING.has(o.confirmation_status)) continue;
    if (digitsOf(o.customer_phone).slice(-10) !== me) continue;
    if (!best) {
      best = o;
      continue;
    }
    const a = Date.parse(o.shopify_created_at ?? "") || 0;
    const b = Date.parse(best.shopify_created_at ?? "") || 0;
    if (a > b) best = o;
  }
  return best;
}

/** "#2231" from "2231" or "#2231". */
export function orderLabel(orderNumber: string | number | null | undefined): string {
  const s = String(orderNumber ?? "").trim();
  if (!s) return "";
  return s.startsWith("#") ? s : `#${s}`;
}

// ---- Instagram reply errors ---------------------------------------------

/** Copy for a failed Instagram reply, from the route's status + error code. */
export function igReplyErrorCopy(status: number, error: string | null | undefined): string {
  if (error === "window_closed") return "Instagram only allows replies within 24 hours of their last message.";
  if (error === "human_agent_required") return "Outside the 24-hour window. Human agent replies are not enabled yet.";
  if (status === 401 || status === 403) return "You are not allowed to reply here.";
  return error ? `Reply failed: ${error}` : "Reply failed. Try again.";
}

/** Copy for the WhatsApp thread status pill. */
export function waStatusPill(status: string | null | undefined): { tone: "info" | "warn" | "good" | "neu"; text: string } {
  if (status === "bot") return { tone: "info", text: "Bot is replying" };
  if (status === "human") return { tone: "warn", text: "You are replying" };
  if (status === "closed") return { tone: "good", text: "Closed" };
  return { tone: "neu", text: "Snoozed" };
}

// ---- routing -------------------------------------------------------------

/** "wa-<id>" | "ig-<id>" | "em-<id>" -> channel + bare id; null when malformed. */
export function parseConversationId(raw: string | null | undefined): { channel: "wa" | "ig" | "em"; id: string } | null {
  if (!raw) return null;
  let s = raw;
  try {
    s = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  const m = /^(wa|ig|em)-(.+)$/.exec(s);
  if (!m || !m[2]) return null;
  return { channel: m[1] as "wa" | "ig" | "em", id: m[2] };
}

// ---- fetch errors --------------------------------------------------------

/** Thrown by the thread queries when the route answers 404. */
export class NotFoundError extends Error {
  readonly status = 404;
  constructor(message = "not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * Only a real 404 means "this conversation does not exist". Anything else
 * (network blip, 5xx, aborted poll) is transient: the view keeps its last
 * data and keeps polling.
 */
export function isNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if (err instanceof NotFoundError) return true;
  const status = (err as { status?: unknown }).status;
  return status === 404 || status === "404";
}
