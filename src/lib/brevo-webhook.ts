// Pure parsing of Brevo webhook payloads (marketing email, transactional email,
// transactional SMS). No IO; /api/webhooks/brevo stores what this returns.

import { createHash, timingSafeEqual } from "node:crypto";

export type BrevoChannel = "email_marketing" | "email_transactional" | "sms";

export type ParsedBrevoEvent = {
  eventKey: string;
  channel: BrevoChannel;
  event: string;
  email: string | null;
  phone: string | null;
  campaignId: number | null;
  messageId: string | null;
  tag: string | null;
  url: string | null;
  reason: string | null;
  occurredAt: string | null;
  // What this event means for the CRM do-not-email list, if anything.
  suppress: "unsubscribe" | "complaint" | "bounce" | null;
  payload: Record<string, unknown>;
};

// Brevo spells some events differently across channels and docs
// ("soft_bounced", "proxy _open", "unsubscribed").
const EVENT_ALIASES: Record<string, string> = {
  soft_bounced: "soft_bounce",
  "proxy _open": "proxy_open",
  unsubscribed: "unsubscribe",
  reply: "replied",
  hardbounce: "hard_bounce",
  softbounce: "soft_bounce",
  uniqueopened: "unique_opened",
};

export function normalizeEvent(raw: string): string {
  const k = raw.trim().toLowerCase();
  return EVENT_ALIASES[k] ?? EVENT_ALIASES[k.replace(/[\s_]/g, "")] ?? k.replace(/\s+/g, "_");
}

const SUPPRESS: Record<string, ParsedBrevoEvent["suppress"]> = {
  unsubscribe: "unsubscribe",
  spam: "complaint",
  hard_bounce: "bounce",
  invalid_email: "bounce",
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);

export function channelOf(p: Record<string, unknown>): BrevoChannel {
  if ("camp_id" in p || "campaign name" in p || "list_id" in p) return "email_marketing";
  if ("sms_count" in p || "msg_status" in p || (typeof p.type === "string" && p.type.toLowerCase() === "sms") || ("messageId" in p && !("email" in p))) return "sms";
  return "email_transactional";
}

function occurredAt(p: Record<string, unknown>): string | null {
  const ts = num(p.ts_event) ?? num(p.ts_epoch) ?? num(p.ts);
  if (ts != null) {
    // ts_epoch is milliseconds; the others are seconds.
    const ms = ts > 1e12 ? ts : ts * 1000;
    return new Date(ms).toISOString();
  }
  const d = str(p.date_event) ?? str(p.date);
  if (d) {
    const t = Date.parse(d.includes("T") ? d : d.replace(" ", "T") + "Z");
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return null;
}

export function parseEvent(p: Record<string, unknown>): ParsedBrevoEvent | null {
  const rawEvent = str(p.event) ?? str(p.msg_status) ?? str(p.status);
  if (!rawEvent) return null;
  const event = normalizeEvent(rawEvent);
  const channel = channelOf(p);
  const email = str(p.email)?.toLowerCase() ?? null;
  const phone = channel === "sms" ? str(p.to) ?? str(p.phone) : null;
  const messageId = str(p["message-id"]) ?? (p.messageId != null ? String(p.messageId) : null);
  const campaignId = num(p.camp_id);
  const url = str(p.URL) ?? str(p.url) ?? str(p.link);
  const at = occurredAt(p);
  const keyParts = [channel, event, email ?? phone ?? "", messageId ?? "", campaignId ?? "", at ?? "", url ?? "", num(p.id) ?? ""];
  return {
    eventKey: createHash("sha256").update(JSON.stringify(keyParts)).digest("hex"),
    channel,
    event,
    email,
    phone,
    campaignId,
    messageId,
    tag: str(p.tag) ?? (Array.isArray(p.tags) ? p.tags.filter((t) => typeof t === "string").join(",") || null : null),
    url,
    reason: str(p.reason),
    occurredAt: at,
    suppress: channel === "sms" || !email ? null : SUPPRESS[event] ?? null,
    payload: p,
  };
}

/** Brevo sends one object, or an array when the webhook is batched. */
export function parseBody(body: unknown): ParsedBrevoEvent[] {
  const items = Array.isArray(body) ? body : [body];
  return items
    .filter((x): x is Record<string, unknown> => x != null && typeof x === "object" && !Array.isArray(x))
    .map(parseEvent)
    .filter((x): x is ParsedBrevoEvent => x != null);
}

/** Constant-time bearer check. Fails closed on a missing secret or header. */
export function verifyBearer(header: string | null, secret: string | null): boolean {
  if (!secret || !header) return false;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
