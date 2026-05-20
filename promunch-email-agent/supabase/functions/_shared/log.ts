// Unified email-tracking event log.
//
// Every tracked step in the ticket lifecycle calls logEvent(). Logging must
// never break the pipeline, so all failures are swallowed (warned, not thrown).

import { db } from "./supabase.ts";

export type EmailEventType =
  | "received"
  | "drafted"
  | "revised"
  | "feedback"
  | "approved"
  | "sent"
  | "skipped"
  | "failed"
  | "regenerated";

export interface LogEventInput {
  eventType: EmailEventType;
  emailThreadId?: string | null;
  gmailThreadId?: string | null;
  gmailMessageId?: string | null;
  actor?: string | null; // "system" | "claude" | a Slack user id
  fromEmail?: string | null;
  subject?: string | null;
  detail?: Record<string, unknown> | null;
}

export async function logEvent(input: LogEventInput): Promise<void> {
  try {
    await db().from("email_logs").insert({
      email_thread_id: input.emailThreadId ?? null,
      gmail_thread_id: input.gmailThreadId ?? null,
      gmail_message_id: input.gmailMessageId ?? null,
      event_type: input.eventType,
      actor: input.actor ?? "system",
      from_email: input.fromEmail ?? null,
      subject: input.subject ?? null,
      detail: input.detail ?? null,
    });
  } catch (e) {
    console.warn(`email_logs insert failed (${input.eventType}):`, e);
  }
}
