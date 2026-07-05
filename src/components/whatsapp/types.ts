// Shared domain types for the WhatsApp dashboard. Extracted from
// dashboard/whatsapp/page.tsx (audit R5) so the split-out views can share them.

export type Tab = "inbox" | "templates" | "campaigns" | "analytics" | "kb" | "tickets";

export type Contact = { id: string; wa_id: string; phone: string; name: string | null; tags?: string[] | null };

export type Thread = {
  id: string;
  wa_id: string;
  status: "bot" | "human" | "snoozed" | "closed";
  ticket_status: "none" | "open" | "pending" | "resolved" | "closed";
  ticket_number: number;
  ticket_priority: "low" | "normal" | "high" | "urgent" | null;
  ticket_category: string | null;
  ticket_subject: string | null;
  ticket_assignee: string | null;
  assigned_to: string | null;
  escalation_reason: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  last_message_snippet: string | null;
  last_message_direction: "inbound" | "outbound" | null;
  last_outbound_status: "received" | "queued" | "sent" | "delivered" | "read" | "failed" | null;
  unread_count: number;
  archived_at: string | null;
  contact: Contact;
};

export type Message = {
  id: string;
  direction: "inbound" | "outbound";
  type: string;
  body: string | null;
  media_url: string | null;
  status: string;
  template_name: string | null;
  sent_by: string | null;
  ai_meta: any;
  created_at: string;
};

export type Template = {
  id: string;
  name: string;
  language: string;
  category: "marketing" | "utility" | "authentication" | "offer";
  status: string;
  body: string;
  footer: string | null;
  header_text: string | null;
  header_type: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | null;
  header_media_url: string | null;
  buttons: TemplateButton[] | null;
  variables: any;
  rejection_reason: string | null;
  meta_template_id: string | null;
};

export type TemplateButton =
  | { type: "URL"; text: string; url: string; example?: string }
  | { type: "QUICK_REPLY"; text: string }
  | { type: "PHONE_NUMBER"; text: string; phone_number: string };

export type KbDoc = {
  id: string;
  name: string;
  source_type: string;
  mime_type: string | null;
  status: "pending" | "processing" | "ready" | "failed";
  chunk_count: number;
  error: string | null;
  created_at: string;
};

export type TeamMember = { id: string; email: string | null; name: string; role: string };

export type Campaign = {
  id: string;
  name: string;
  status: "draft" | "scheduled" | "sending" | "completed" | "failed" | "cancelled";
  template_id: string | null;
  template_vars: Record<string, string> | null;
  audience_filter: { tags?: string[] } | null;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  failed_count: number;
  last_error: string | null;
  scheduled_at: string | null;
  repeat_rule: "daily" | "weekly" | "monthly" | null;
  repeat_until: string | null;
  parent_campaign_id: string | null;
  created_at: string;
  template?: { id: string; name: string; language: string; category: string; status: string } | null;
};

export type Recipient = { contact_id: string; name: string | null; wa_id: string | null; status: string; attempts: number; duplicate: boolean; error: string | null; at: string };

export type RecipientSummary = { rows: number; contacts: number; received: number; delivered: number; read: number; failed: number; duplicates: number };
