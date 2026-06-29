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
  | "shopify_wa"       // Shopify → WhatsApp journeys
  | "instagram";       // Instagram inbound DM / comment automation

export type ConnectorLevel = "info" | "warn" | "error";

// Turn any thrown value into a readable string. Critically handles Supabase/
// Postgrest error objects ({message, code, details, hint}) which are PLAIN
// objects, not Error instances — String() renders them as "[object Object]",
// swallowing the real cause. Use this instead of `String(e)` everywhere.
export function errStr(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    const parts = [o.message, o.code, o.details, o.hint].filter(Boolean);
    if (parts.length) return parts.join(" | ");
    try { return JSON.stringify(e); } catch { /* fall through */ }
  }
  return String(e);
}

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
  if (connector === "instagram") return Deno.env.get("IG_SLACK_CHANNEL_ID") ?? def;
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

// ============================================================================
// STRUCTURED ALERTS — every error posted to Slack uses the same shape so it
// reads like a triaged issue, not a raw log line:
//   {sev} · {service}
//   Issue:        what happened, in one line
//   Likely cause: the most probable reason
//   Expected?:    routine / unusual / critical — so you know whether to worry
//   What to do:   the next concrete action
//   Details:      the event code + ref for grepping
// ============================================================================

export type Severity = "critical" | "warning" | "info";

export interface AlertClass {
  severity: Severity;
  expected: boolean; // true = happens routinely, usually no action
  cause: string;
  action: string;
}

const CONNECTOR_LABEL: Record<string, string> = {
  gmail_pipeline: "Gmail intake",
  anthropic: "AI drafting",
  email_slack: "AI email → Slack",
  shopify_slack: "Shopify → Slack",
  gmail_watch: "Gmail watch",
  whatsapp: "WhatsApp",
  shopify_wa: "WhatsApp journeys",
  instagram: "Instagram DMs",
};

function severityBits(sev: Severity): { emoji: string; expectedLine: (expected: boolean) => string } {
  const emoji = sev === "critical" ? ":red_circle:" : sev === "warning" ? ":large_yellow_circle:" : ":large_blue_circle:";
  return {
    emoji,
    expectedLine: (expected: boolean) =>
      sev === "critical"
        ? ":rotating_light: Critical — act now"
        : expected
        ? ":white_check_mark: Routine — usually no action needed"
        : ":exclamation: Unusual — worth a look",
  };
}

// Build the structured Slack text. `extra` lines are inserted under Issue
// (e.g. recipient / what Meta said) before the diagnosis fields.
export function buildStructuredAlert(a: {
  connector: string;
  event: string;
  ref?: string | null;
  issue: string;
  cls: AlertClass;
  extra?: string[];
}): string {
  const label = CONNECTOR_LABEL[a.connector] ?? a.connector;
  const { emoji, expectedLine } = severityBits(a.cls.severity);
  return [
    `${emoji} *${a.cls.severity.toUpperCase()} · ${label}*`,
    `*Issue:* ${a.issue}`,
    ...(a.extra ?? []),
    `*Likely cause:* ${a.cls.cause}`,
    `*Expected?:* ${expectedLine(a.cls.expected)}`,
    `*What to do:* ${a.cls.action}`,
    `*Details:* \`${a.event}\`${a.ref ? ` · ref \`${a.ref}\`` : ""}`,
  ].join("\n");
}

// Generic classifier for connector_events errors (every connector). Keys off
// the event code + message keywords; WhatsApp send failures use the richer
// explainWaError path instead.
export function classifyConnectorEvent(connector: string, event: string, message: string | undefined): AlertClass {
  const e = (event ?? "").toLowerCase();
  const m = (message ?? "").toLowerCase();
  const label = CONNECTOR_LABEL[connector] ?? connector;

  // Monitoring went dark / a service is unreachable.
  if (e.includes("watchdog") || e === "health_down")
    return {
      severity: "critical", expected: false,
      cause: `The ${label} service stopped responding — usually an expired token/API key, the upstream API being down, or a stopped cron.`,
      action: "Check that function's logs and that its cron is running. WhatsApp: verify WHATSAPP_ACCESS_TOKEN; Gmail: re-run OAuth.",
    };

  // Auth / credential failure — that integration is fully down.
  if (m.includes("token") || m.includes("auth") || m.includes("credential") || m.includes("unauthor") || m.includes("resolve authentication") || m.includes("permission"))
    return {
      severity: "critical", expected: false,
      cause: "An access token or credential expired or is invalid — this integration is fully down until it's refreshed.",
      action: "Refresh the token/secret and redeploy. Gmail: re-run the OAuth flow; WhatsApp: update WHATSAPP_ACCESS_TOKEN; AI: check the API key.",
    };

  // Rate limit / quota / credits.
  if (m.includes("rate limit") || m.includes("quota") || m.includes("credit") || m.includes("billing") || m.includes("429") || m.includes("insufficient"))
    return {
      severity: "warning", expected: false,
      cause: "Hit a provider rate limit or ran out of credits/quota.",
      action: "Check the provider's billing/usage. WhatsApp: slow the send rate; AI: top up credits.",
    };

  // A handler threw / a job didn't complete.
  if (e.includes("fail") || e.includes("error") || e.includes("stuck") || e.includes("gave_up"))
    return {
      severity: "warning", expected: false,
      cause: "A step threw or didn't complete — the Issue line above carries the specific error.",
      action: "Open the function logs for the stack trace. If it looks transient, replay/retry; if it repeats, investigate.",
    };

  return {
    severity: "warning", expected: false,
    cause: "Unclassified error event.",
    action: "Review the function logs for context.",
  };
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

    const cls = classifyConnectorEvent(input.connector, input.event, input.message ?? undefined);
    const text = buildStructuredAlert({
      connector: input.connector,
      event: input.event,
      ref: input.ref ?? null,
      issue: input.message ?? "(no message)",
      cls,
    });
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
  if ((c >= 132000 && c <= 132099) || c === 131008 || m.includes("template") || m.includes("required parameter"))
    return { category: "template", action: true, cause: "Template problem — paused, disabled, not approved at Meta, or parameter count/format mismatch. Check the Templates tab and Meta Manager." };

  // RATE limits — sending too fast / number throttled.
  if (c === 131048 || c === 130429 || c === 80007 || c === 131056 || m.includes("rate limit") || m.includes("too many"))
    return { category: "rate", action: true, cause: "Meta is rate-limiting this number. Back off; sustained limits mean we're sending too fast or quality dropped." };

  // Per-user MARKETING frequency cap / quality filter — template IS approved.
  if (c === 131049 || c === 131050 || c === 130472 || m.includes("healthy ecosystem"))
    return { category: "deliverability", action: false, cause: "Meta's per-user MARKETING frequency cap — template is approved, but Meta throttled delivery to this user (too many marketing messages / low engagement). Expected for marketing templates; not a system fault." };

  // Media header fetch/upload — Meta couldn't pull the template's header image/
  // video/document. Almost always transient (Meta's fetch of the public link
  // timed out) and per-recipient; a genuinely broken/expired header URL fails
  // the WHOLE batch, which the sender's 0-delivered circuit breaker catches and
  // halts loudly. So an isolated #131053 is expected noise, not a fault.
  if (c === 131053 || m.includes("media upload error"))
    return { category: "deliverability", action: false, cause: "Meta couldn't fetch/upload the template's header media for this recipient (#131053) — usually a transient fetch timeout on Meta's side. If EVERY send fails this way, the header media URL is broken/expired (the wholesale-failure circuit breaker halts the campaign in that case)." };

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

    // Routine deliverability rejections (Meta per-user MARKETING frequency cap
    // #131049/#131050, recipient not on WhatsApp, outside-24h-window) are recorded
    // above for the dashboard/history but NEVER posted to Slack — they're expected
    // noise, not faults. Only action-needed errors (auth/template/rate/system/
    // unknown) reach the channel, so the WhatsApp status stays urgent-only.
    if (!ex.action) return;

    const channel = slackChannelFor("whatsapp");
    if (!channel) return;

    const SEV: Record<WaErrorCategory, Severity> = {
      auth: "critical", template: "critical", rate: "warning", system: "warning", deliverability: "info", unknown: "warning",
    };
    const ACTION: Record<WaErrorCategory, string> = {
      auth: "Refresh WHATSAPP_ACCESS_TOKEN in Supabase secrets and redeploy — every send is failing until then.",
      template: "Open the Templates tab / Meta Manager: confirm the template is approved, not paused, and its parameter count/format matches what we send.",
      rate: "Slow the send rate; check this number's messaging limits and quality rating in Meta Manager.",
      system: "Usually transient on Meta's side — it auto-retries. Only worry if these keep coming.",
      deliverability: "No action — Meta declined delivery to this one recipient. Normal for marketing templates and unreachable numbers.",
      unknown: "Check the raw Meta response in the wa-send / wa-webhook logs.",
    };
    const templateLabel = args.templateName
      ? `\`${args.templateName}\``
      : args.kind === "text" ? "free-text message" : args.kind === "image" ? "image message" : args.kind;
    const text = buildStructuredAlert({
      connector: "whatsapp",
      event,
      ref: maskPhone(args.to),
      issue: `Couldn't deliver to ${maskPhone(args.to)}.`,
      extra: [
        `*Template / action:* ${templateLabel}${args.sentBy ? `  ·  triggered by \`${args.sentBy}\`` : ""}`,
        `*Meta said:* ${args.error ?? "unknown"}${args.errorCode ? ` (#${args.errorCode})` : ""}`,
      ],
      cls: { severity: SEV[ex.category], expected: ex.category === "deliverability", cause: ex.cause, action: ACTION[ex.category] },
    });
    await postSlack(channel, text);
  } catch (e) {
    console.warn("alertWaSendFailure failed:", e);
  }
}
