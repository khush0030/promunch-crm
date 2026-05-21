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
  } catch (e) {
    console.warn(`connector_events insert failed (${input.connector}/${input.event}):`, e);
  }
}
