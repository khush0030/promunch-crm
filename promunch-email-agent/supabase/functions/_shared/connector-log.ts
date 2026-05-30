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

// First ping fires immediately; if the same connector+event keeps erroring,
// re-ping every RE_ALERT_HOURS so a multi-day outage cannot stay silent.
const RE_ALERT_HOURS = 6;

async function pingSlackOnError(input: ConnectorEventInput): Promise<void> {
  const botToken = Deno.env.get("SLACK_BOT_TOKEN");
  const channel = Deno.env.get("SLACK_CHANNEL_ID");
  if (!botToken || !channel) return;
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
    const r = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        authorization: `Bearer ${botToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel, text, unfurl_links: false, unfurl_media: false }),
    });
    if (!r.ok) console.warn("Slack chat.postMessage HTTP", r.status, await r.text());
  } catch (e) {
    console.warn("connector error Slack ping failed:", e);
  }
}
