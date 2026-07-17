// Shared types for the deal pipeline (mirrors promunch-email-agent
// migration 20260717130000_deal_pipeline.sql).

export type DealStage =
  | "new_inquiry"
  | "in_discussion"
  | "samples_requested"
  | "samples_sent"
  | "negotiation"
  | "won"
  | "lost"
  | "dormant";

export type DealKind =
  | "hotel_hospitality"
  | "corporate_pantry_gifting"
  | "retail_qcommerce"
  | "distribution_wholesale"
  | "influencer_collab"
  | "brand_partnership"
  | "events_expo"
  | "vendor_pitch"
  | "other";

export type Direction = "inbound" | "outbound";

export type Deal = {
  id: string;
  company_name: string;
  company_domain: string | null;
  kind: DealKind;
  contact_name: string | null;
  contact_email: string | null;
  stage: DealStage;
  stage_updated_at: string;
  samples_sent_at: string | null;
  next_step: string | null;
  next_step_owner: "us" | "them" | null;
  follow_up_needed: boolean;
  follow_up_reason: string | null;
  commercials: string | null;
  summary: string | null;
  notes: string | null;
  last_email_at: string | null;
  last_email_direction: Direction | null;
  first_email_at: string | null;
  email_count: number;
  ai_confidence: number | null;
  manual_stage_override: boolean;
  created_at: string;
  updated_at: string;
};

export type DealEmail = {
  id: string;
  deal_id: string | null;
  gmail_message_id: string;
  gmail_thread_id: string;
  direction: Direction;
  from_email: string | null;
  to_email: string | null;
  subject: string | null;
  snippet: string | null;
  sent_at: string | null;
};

export type ScanState = {
  last_run_at: string | null;
  backfill_done: boolean;
  threads_scanned: number;
  last_error: string | null;
};

export type DealsResponse = {
  deals: Deal[];
  scan: ScanState | null;
};

export type DealDetailResponse = {
  deal: Deal;
  emails: DealEmail[];
};
