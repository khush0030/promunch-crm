// Shared types used across edge functions.

export interface EmailThread {
  id: string;
  gmail_thread_id: string;
  gmail_message_id: string;
  gmail_history_id: string | null;
  in_reply_to_header: string | null;
  from_email: string;
  from_name: string | null;
  to_email: string | null;
  subject: string | null;
  snippet: string | null;
  body_plain: string | null;
  body_html: string | null;
  slack_channel_id: string | null;
  slack_thread_ts: string | null;
  slack_permalink: string | null;
  status: "pending" | "sent" | "skipped" | "failed";
  created_at: string;
  updated_at: string;
}

export interface DraftRevision {
  id: string;
  email_thread_id: string;
  revision: number;
  body: string;
  feedback: string | null;
  model: string | null;
  is_current: boolean;
  slack_message_ts: string | null;
  created_at: string;
}

export interface ParsedEmail {
  gmail_message_id: string;
  gmail_thread_id: string;
  history_id: string | null;
  in_reply_to_header: string;   // The RFC 2822 Message-Id header
  from_email: string;
  from_name: string | null;
  to_email: string | null;
  subject: string | null;
  snippet: string | null;
  body_plain: string;
  body_html: string | null;
}
