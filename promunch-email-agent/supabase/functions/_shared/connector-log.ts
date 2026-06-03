// Connector health log.
//
// Every connector (Gmail intake, Claude drafting, AI-email→Slack,
// Shopify→Slack, the Gmail watch) writes events here. The CRM Integrations
// page reads connector_events to show live status + the last error.
//
// Logging must never break a pipeline — all failures are swallowed.

import { db } from "./supabase.ts";

export type ConnectorId =
  | "gmail_pipeline"   // Gmail → CRM intake (poll + webhook)
  | "anthropic"        // Claude draft generation
  | "email_slack"      // AI support emails posted to Slack
  | "shopify_slack"    // Shopify order cards posted to Slack
  | "gmail_watch"      // the 7-day Gmail Pub/Sub watch
  | "whatsapp"         // WhatsApp Cloud API inbound webhook
  | "shopify_wa";      // Shopify → WhatsApp journeys

export type ConnectorLevel = "info" | "warn" | "error";

export interface ConnectorEventInput {
  connector: ConnectorId;
  level: ConnectorLevel;
  event: string;                          // short code: post_ok, post_failed, …
  message?: string | null;                // human-readable detail for the CRM
  detail?: Record<string, unknown> | null;
  ref?: string | null;                    // email_thread id, order number, …
  /**
   * If set, skip the insert when an event with the same connector+event was
   * already logged within this many minutes. Prevents log spam when a
   * connector fails repeatedly (e.g. Anthropic out of credits, retried by the
   * 2-minute poll).
   */
  throttleMinutes?: number;
}

export async function logConnector(input: ConnectorEventInput): Promise<void> {
  try {
    if (input.throttleMinutes && input.throttleMinutes > 0) {
      const since = new Date(Date.now() - input.throttleMinutes * 60_000).toISOString();
      const { data: recent } = await db()
        .from("connector_events")
        .select("id")
        .eq("connector", input.connector)
        .eq("event", input.event)
        .gte("created_at", since)
        .limit(1)
        .maybeSingle();
      if (recent) return; // already logged recently — don't spam
    }

    await db().from("connector_events").insert({
      connector: input.connector,
      level: input.level,
      event: input.event,
      message: input.message ?? null,
      detail: input.detail ?? null,
      ref: input.ref ?? null,
    });

    // page the team on Slack when a pipeline errors — no error sits silent
    if (input.level === "error") await pingSlackOnError(input);
  } catch (e) {
    console.warn(`connector_events insert failed (${input.connector}/${input.event}):`, e);
  }
}

// WhatsApp-domain alerts (whatsapp + shopify_wa connectors, send-failure alerts,
// the watchdog) go to the dedicated whatsapp-health channel; everything else to
// the default channel. Set WA_HEALTH_CHANNEL_ID to the whatsapp-health channel id.
export function slackChannelFor(connector: string): string | undefined {
  const wa = Deno.env.get("WA_HEALTH_CHANNEL_ID");
  const def = Deno.env.get("SLACK_CHANNEL_ID");
  if (connector === "whatsapp" || connector === "shopify_wa") return wa ?? def;
  return def;
}

// Post a message to Slack. Returns false if creds missing or the call failed.
export async function postSlack(channel: string | undefined, text: string): Promise<boolean> {
  const botToken = Deno.env.get("SLACK_BOT_TOKEN");
  if (!botToken || !channel) return false;
  try {
    const r = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { authorization: `Bearer ${botToken}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel, text, unfurl_links: false, unfurl_media: false }),
    });
    if (!r.ok) { console.warn("postSlack HTTP", r.status, await r.text()); return false; }
    const j = await r.json().catch(() => ({}));
    if (!j?.ok) { console.warn("postSlack error", j?.error); return false; }
    return true;
  } catch (e) { console.warn("postSlack failed:", e); return false; }
}

// First ping fires immediately; if the same connector+event keeps erroring,
// re-ping every RE_ALERT_HOURS so a multi-day outage cannot stay silent.
const RE_ALERT_HOURS = 6;

async function pingSlackOnError(input: ConnectorEventInput): Promise<void> {
  const channel = slackChannelFor(input.connector);
  if (!channel) return;
  try {
    const since = new Date(Date.now() - RE_ALERT_HOURS * 3600_000).toISOString();
    const { count } = await db()
      .from("connector_events")
      .select("id", { count: "exact", head: true })
      .eq("connector", input.connector)
      .eq("event", input.event)
      .eq("level", "error")
      .gte("created_at", since);
    // the row inserted above is counted — first error in the window pings,
    // the rest stay quiet until the window rolls over
    if ((count ?? 0) > 1) return;

    const text = `:rotating_light: *${input.connector}* error — \`${input.event}\`\n${input.message ?? "(no message)"}`;
    await postSlack(channel, text);
  } catch (e) {
    console.warn("connector error Slack ping failed:", e);
  }
}


// ============================================================================
// WhatsApp SEND-failure alerting — fires on EVERY failed outbound message.
//
// wa-send is the single chokepoint for all outbound WhatsApp (confirmations,
// journeys, campaigns, AI replies, dashboard). Calling alertWaSendFailure there
// means no failed send is ever silent. Errors are classified so the loud ones
// (auth/template/rate — i.e. real outages / action needed) alert fast, while
// expected deliverability rejections (Meta frequency cap, recipient not on
// WhatsApp) are logged + alerted but throttled so they can't flood Slack.
// ============================================================================

export type WaErrorCategory = "auth" | "template" | "rate" | "system" | "deliverability" | "unknown";

export interface WaErrorExplain {
  category: WaErrorCategory;
  cause: string;
  action: boolean; // true = a human needs to do something (real fault/outage)
}

// Map a Meta WhatsApp error (code + message) to a plain-English cause.
// Ref: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
export function explainWaError(code: number | undefined, message: string | undefined): WaErrorExplain {
  const m = (message ?? "").toLowerCase();
  const c = code ?? 0;

  // AUTH / token — every send fails until refreshed. This is THE downtime case.
  if (c === 190 || c === 0 || c === 401 || m.includes("access token") || m.includes("authenticate") || m.includes("session has expired"))
    return { category: "auth", action: true, cause: "Access token expired or invalid — EVERY WhatsApp send fails until the token is refreshed in Supabase secrets. Fix immediately." };

  // TEMPLATE problems — paused, disabled, not approved, param mismatch.
  if ((c >= 132000 && c <= 132099) || m.includes("template"))
    return { category: "template", action: true, cause: "Template problem — paused, disabled, not approved at Meta, or parameter count/format mismatch. Check the Templates tab and Meta Manager." };

  // RATE limits — sending too fast / number throttled.
  if (c === 131048 || c === 130429 || c === 80007 || c === 131056 || m.includes("rate limit") || m.includes("too many"))
    return { category: "rate", action: true, cause: "Meta is rate-limiting this number. Back off; sustained limits mean we're sending too fast or quality dropped." };

  // Per-user MARKETING frequency cap / quality filter — template IS approved.
  if (c === 131049 || c === 131050 || c === 130472 || m.includes("healthy ecosystem"))
    return { category: "deliverability", action: false, cause: "Meta's per-user MARKETING frequency cap — template is approved, but Meta throttled delivery to this user (too many marketing messages / low engagement). Expected for marketing templates; not a system fault." };

  // Recipient cannot receive.
  if (c === 131026 || m.includes("undeliverable"))
    return { category: "deliverability", action: false, cause: "Recipient can't receive — number isn't on WhatsApp, hasn't accepted WhatsApp's terms, or can't get this message type. Recipient-side." };

  // Re-engagement — free-form sent outside the 24h window.
  if (c === 131047 || m.includes("re-engagement"))
    return { category: "deliverability", action: false, cause: "Free-form message sent outside the 24h customer-care window — an approved template is required to re-open the conversation." };

  // Meta server error.
  if (m.startsWith("http 5") || (c >= 500 && c < 600))
    return { category: "system", action: true, cause: "Meta API returned a server error (5xx) — usually transient on Meta's side; watch for a sustained outage." };

  return { category: "unknown", action: true, cause: "Unrecognised WhatsApp error — investigate the raw Meta response." };
}

const maskPhone = (to: string) => {
  const d = String(to ?? "").replace(/\D/g, "");
  return d.length >= 6 ? `+${d.slice(0, d.length - 4).slice(0, 5)}…${d.slice(-4)}` : (to || "?");
};

// Alert on a single failed WhatsApp send. Records a connector_events row (so the
// dashboard + history see it) and posts to Slack, throttled by category+code so
// retries / repeated rejections don't spam the channel.
export async function alertWaSendFailure(args: {
  to: string;
  kind: string;                 // 'template' | 'text' | 'image'
  templateName?: string | null;
  error?: string;
  errorCode?: number;
  errorDetail?: string;
  sentBy?: string;
}): Promise<void> {
  try {
    const ex = explainWaError(args.errorCode, args.error);
    // Action-needed faults ping fast (5 min); expected rejections are quieter (30 min).
    const throttleMinutes = ex.action ? 5 : 30;
    const event = `send_failed:${ex.category}:${args.errorCode ?? "na"}`;

    // Has an identical alert fired recently? (throttle the Slack post, not the record)
    const since = new Date(Date.now() - throttleMinutes * 60_000).toISOString();
    const { data: recent } = await db()
      .from("connector_events")
      .select("id")
      .eq("connector", "whatsapp")
      .eq("event", event)
      .gte("created_at", since)
      .limit(1)
      .maybeSingle();

    // Always record it. Deliverability rejections are 'warn' so they never flip
    // the dashboard's WhatsApp status to degraded; real faults are 'error'.
    await db().from("connector_events").insert({
      connector: "whatsapp",
      level: ex.action ? "error" : "warn",
      event,
      message: `Send failed (${args.kind}${args.templateName ? `/${args.templateName}` : ""}) → ${maskPhone(args.to)}: ${args.error ?? "unknown"}`,
      ref: args.to,
      detail: { category: ex.category, cause: ex.cause, code: args.errorCode ?? null, meta_detail: args.errorDetail ?? null, sent_by: args.sentBy ?? null },
    });

    if (recent) return; // throttled — recorded above, but don't re-ping Slack

    const channel = slackChannelFor("whatsapp");
    if (!channel) return;

    const head = ex.action ? ":rotating_light: *WhatsApp send failed — ACTION NEEDED*" : ":warning: *WhatsApp send not delivered*";
    const lines = [
      head,
      `*To:* ${maskPhone(args.to)}`,
      `*Message:* ${args.kind}${args.templateName ? ` · \`${args.templateName}\`` : ""}${args.sentBy ? `  _(${args.sentBy})_` : ""}`,
      `*Meta said:* ${args.error ?? "unknown"}${args.errorCode ? ` (#${args.errorCode})` : ""}`,
      `*Why:* ${ex.cause}`,
    ];
    await postSlack(channel, lines.join("\n"));
  } catch (e) {
    console.warn("alertWaSendFailure failed:", e);
  }
}
