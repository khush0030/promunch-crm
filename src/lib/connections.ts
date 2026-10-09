// Settings → Connections: one row per service the CRM depends on, with a
// live status derived from data the CRM already has (connector_events from
// the edge functions, plus the newest row in each pipeline's own table).
// Pure helpers only; GET /api/settings/connections does the reads.
//
// Never put a secret value in here or in anything this file returns.

export type ConnStatus = "healthy" | "degraded" | "down" | "unknown" | "off";

export type ConnEvent = { level: "info" | "warn" | "error"; event: string; message: string | null; created_at: string };

export type Connection = {
  id: string;
  label: string;
  status: ConnStatus;
  /** One plain sentence. The page adds "· 4 min ago" from lastAt. */
  headline: string;
  lastAt: string | null;
};

export const STATUS_LABEL: Record<ConnStatus, string> = {
  healthy: "Working",
  degraded: "Needs a look",
  down: "Broken",
  unknown: "No data",
  off: "Off",
};

const RANK: Record<ConnStatus, number> = { off: 0, healthy: 0, unknown: 1, degraded: 2, down: 3 };
export const worst = (a: ConnStatus, b: ConnStatus): ConnStatus => (RANK[a] >= RANK[b] ? a : b);

export function hoursSince(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? (now - t) / 3_600_000 : null;
}

// Same recovery-aware rule as /api/integrations: judged by the CURRENT state.
// A success logged after the last error means the connector recovered.
// `events` must be newest first.
export function statusFromEvents(events: ConnEvent[], now = Date.now()): ConnStatus {
  if (events.length === 0) return "unknown";
  const newest = events[0];
  if (newest.level === "error") return "down";
  if (newest.level === "warn") return "degraded";
  const lastError = events.find((e) => e.level === "error");
  if (!lastError) return "healthy";
  if (newest.created_at > lastError.created_at) return "healthy";
  return (hoursSince(lastError.created_at, now) ?? 99) < 24 ? "degraded" : "healthy";
}

// Edge functions sometimes log "[object Object]" or a stack trace as the
// message. Never show those; fall back to a plain sentence.
export function humanize(msg: string | null | undefined, fallback: string): string {
  const m = (msg ?? "").trim();
  if (!m || m.includes("[object Object]") || m.length < 4 || m.length > 160 || /\bat\s+\w+\s*\(/.test(m)) return fallback;
  return m;
}

// Freshness: a pipeline that should see traffic daily but has been quiet.
export function freshness(lastAt: string | null, okHours: number, staleHours: number, now = Date.now()): ConnStatus {
  const h = hoursSince(lastAt, now);
  if (h == null) return "unknown";
  if (h <= okHours) return "healthy";
  if (h <= staleHours) return "degraded";
  return "down";
}

// ---- per-service rules ----------------------------------------------------

export function shopifyConn(i: { lastOrderAt: string | null; events: ConnEvent[] }, now = Date.now()): Connection {
  const fromEvents = statusFromEvents(i.events, now);
  // Orders arrive many times a day; two quiet days is worth a look.
  const fresh = freshness(i.lastOrderAt, 48, 24 * 7, now);
  const base = { id: "shopify", label: "Shopify", lastAt: i.lastOrderAt };
  if (fromEvents === "down") {
    return { ...base, status: "down", headline: humanize(i.events[0]?.message, "The last Shopify order could not be saved. It retries automatically.") };
  }
  if (fromEvents === "unknown" && fresh === "unknown") return { ...base, status: "unknown", headline: "No Shopify orders on record yet." };
  const status = worst(fromEvents === "unknown" ? "healthy" : fromEvents, fresh === "unknown" ? "healthy" : fresh);
  const headline =
    status === "healthy" ? "Last order received" :
    fresh === "degraded" || fresh === "down" ? "No new Shopify order in a while. Check the store webhook." :
    humanize(i.events[0]?.message, "Shopify reported a problem recently. It retries automatically.");
  return { ...base, status, headline };
}

export function whatsappConn(
  i: { events: ConnEvent[]; lastInboundAt: string | null; lastOutboundAt: string | null; failed24h: number; sent24h: number; quality: string | null },
  now = Date.now(),
): Connection {
  let status = statusFromEvents(i.events, now);
  const lastAt = [i.lastInboundAt, i.lastOutboundAt].filter((x): x is string => !!x).sort().pop() ?? null;
  const fresh = freshness(lastAt, 24, 72, now);
  status = status === "unknown" ? fresh : worst(status, fresh === "unknown" ? "healthy" : fresh);
  const q = (i.quality ?? "").toUpperCase();
  const quality = q === "GREEN" ? "Quality high" : q === "YELLOW" ? "Quality medium" : q === "RED" ? "Quality low" : null;
  if (q === "RED") status = worst(status, "degraded");
  // Many sends failing (not the odd 131049 marketing cap) is worth a look.
  const failShare = i.sent24h + i.failed24h > 0 ? i.failed24h / (i.sent24h + i.failed24h) : 0;
  if (i.failed24h >= 10 && failShare > 0.5) status = worst(status, "degraded");
  const parts = [quality, `${i.sent24h} sent in 24h`, i.failed24h ? `${i.failed24h} failed` : null].filter(Boolean);
  let headline = parts.join(" · ");
  if (status === "down") headline = humanize(i.events[0]?.message, "WhatsApp messages are not getting through. Check the access token at Meta.");
  return { id: "whatsapp", label: "WhatsApp (Meta)", status, headline, lastAt };
}

export function amazonConn(i: { lastSyncAt: string | null }, now = Date.now()): Connection {
  const status = freshness(i.lastSyncAt, 6, 48, now);
  const headline =
    status === "unknown" ? "No Amazon sync on record yet." :
    status === "healthy" ? "Orders, stock and payouts synced" :
    "Amazon has not synced recently. Use Sync now on Insights · Amazon.";
  return { id: "amazon", label: "Amazon", status, headline, lastAt: i.lastSyncAt };
}

export function resendConn(i: { lastSentAt: string | null; failed24h: number; sent24h: number }): Connection {
  let status: ConnStatus = i.lastSentAt ? "healthy" : "unknown";
  if (i.failed24h > 0 && i.failed24h >= i.sent24h) status = "degraded";
  const headline =
    status === "unknown" ? "hello@promunch.in · no emails sent yet" :
    i.failed24h ? `hello@promunch.in · ${i.failed24h} failed in 24h` :
    "hello@promunch.in · last email sent";
  // Freshness is not a fault here: marketing email can go days without a send.
  return { id: "resend", label: "Email sending (Resend)", status, headline, lastAt: i.lastSentAt };
}

export type GmailWatch = { expiration: string | null } | null;

export function gmailConn(i: { events: ConnEvent[]; watch: GmailWatch; lastReceivedAt: string | null }, now = Date.now()): Connection {
  let status = statusFromEvents(i.events, now);
  let headline = "Reading new emails";
  const expH = hoursSince(i.watch?.expiration, now); // positive = already expired
  if (!i.watch?.expiration) {
    status = worst(status, "degraded");
    headline = "No Gmail push watch on record. New mail still arrives by the 2 minute check.";
  } else if (expH != null && expH > 0) {
    status = "down";
    headline = "The Gmail watch has expired. New emails will not arrive until it is renewed.";
  } else if (expH != null && expH > -48) {
    status = worst(status, "degraded");
    headline = "The Gmail watch expires within 2 days. The renewal job should refresh it.";
  } else if (status === "down" || status === "degraded") {
    const err = i.events.find((e) => e.level === "error" || e.level === "warn");
    headline = humanize(err?.message, "Email intake hit an error. It retries automatically.");
  }
  if (status === "unknown") status = freshness(i.lastReceivedAt, 48, 24 * 7, now);
  return { id: "gmail", label: "Support mailbox (Gmail)", status, headline, lastAt: i.events[0]?.created_at ?? i.lastReceivedAt };
}

export function voiceConn(
  i: { codOn: boolean | null; cartOn: boolean | null; lastCallAt: string | null; calls24h: number; notStarted24h: number },
): Connection {
  const on = !!(i.codOn || i.cartOn);
  if (!on) {
    return { id: "voice", label: "Voice agent (Sarvam)", status: "off", headline: "Calls are switched off in Call rules.", lastAt: i.lastCallAt };
  }
  let status: ConnStatus = i.lastCallAt ? "healthy" : "unknown";
  let headline = [i.codOn ? "COD calls on" : null, i.cartOn ? "cart calls on" : null].filter(Boolean).join(" · ");
  headline = headline.charAt(0).toUpperCase() + headline.slice(1);
  if (i.calls24h >= 3 && i.notStarted24h / i.calls24h > 0.5) {
    status = "degraded";
    headline = `${i.notStarted24h} of ${i.calls24h} calls in 24h could not start. Check the Sarvam key.`;
  }
  return { id: "voice", label: "Voice agent (Sarvam)", status, headline: i.lastCallAt ? `${headline} · last call` : headline, lastAt: i.lastCallAt };
}

export function instagramConn(i: { paused: boolean | null; events: ConnEvent[] }, now = Date.now()): Connection {
  if (i.paused) return { id: "instagram", label: "Instagram DMs", status: "off", headline: "Paused in Instagram settings.", lastAt: i.events[0]?.created_at ?? null };
  const status = statusFromEvents(i.events, now);
  const headline =
    status === "unknown" ? "No Instagram messages in the last 7 days." :
    status === "down" ? humanize(i.events[0]?.message, "Instagram replies are failing.") :
    "Receiving messages and comments";
  return { id: "instagram", label: "Instagram DMs", status, headline, lastAt: i.events[0]?.created_at ?? null };
}

export function openaiConn(i: { events: ConnEvent[]; awaitingDraft: number }, now = Date.now()): Connection {
  let status = statusFromEvents(i.events, now);
  let headline = "Drafting replies and answering on WhatsApp";
  const newest = i.events[0];
  if (status === "unknown") headline = "No support email needed a draft in the last 7 days.";
  else if (newest?.event === "draft_recovered") { status = "healthy"; headline = "Recovered and drafting again"; }
  else if (newest?.event === "credits_exhausted") { status = "down"; headline = "The OpenAI account is out of credits. Top up at platform.openai.com."; }
  else if (status === "down") headline = humanize(newest?.message, "AI drafting is failing. Emails still arrive without a draft.");
  if (i.awaitingDraft > 0 && status !== "down") {
    status = worst(status, "degraded");
    headline = `${i.awaitingDraft} email${i.awaitingDraft === 1 ? " is" : "s are"} waiting for an AI draft. They retry every 2 minutes.`;
  }
  return { id: "openai", label: "AI replies (OpenAI)", status, headline, lastAt: newest?.created_at ?? null };
}

export function summarize(conns: Connection[]): { total: number; working: number; needLook: number; off: number } {
  const counted = conns.filter((c) => c.status !== "off");
  return {
    total: counted.length,
    working: counted.filter((c) => c.status === "healthy").length,
    needLook: counted.filter((c) => c.status === "degraded" || c.status === "down").length,
    off: conns.length - counted.length,
  };
}
