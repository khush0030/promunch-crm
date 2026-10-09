// Shared domain types for the B2B one-path dashboard.
import type { Stage } from "@/lib/leads/lead-status";

export type Contact = {
  id: string;
  email: string;
  source: string;
  source_url: string | null;
  kind: string;
  role_hint: string | null;
  verify_status: string;
  confidence: string;
  is_primary: boolean;
  person_name?: string | null;
  person_title?: string | null;
  decision_category?: string | null;
  mailbox_status?: string | null;
  mailbox_provider?: string | null;
  mailbox_checked_at?: string | null;
};

export type Draft = {
  id: string;
  contact_id: string;
  subject: string;
  body_text: string;
  status: string;
  edited: boolean;
  error: string | null;
  sent_at: string | null;
  enrollment_id?: string | null;
  step_position?: number | null;
};

export type Lead = {
  id: string;
  name: string;
  website: string | null;
  domain: string | null;
  address: string | null;
  city: string | null;
  category: string | null;
  status: string;
  fit_score: number | null;
  fit_reason: string | null;
  enrichment: Enrichment | null;
  enriched_at: string | null;
  products: string[] | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  lead_contacts: Contact[];
  outreach_drafts: Draft[];
  outreach_replies: Reply[];
};

export type Reply = {
  id: string;
  from_email: string | null;
  from_name: string | null;
  subject: string | null;
  body_text: string | null;
  received_at: string;
};

export type Enrichment = {
  summary?: string;
  scale?: string;
  fitAngle?: string;
  decisionMaker?: string;
  talkingPoints?: string[];
};

export type OutreachSettings = {
  daily_cap: number;
  paused: boolean;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  footer_address: string;
  send_window_start?: number | null;
  send_window_end?: number | null;
  follow_up_days?: number | null;
  follow_up_count?: number | null;
  follow_up_default_on?: boolean | null;
};

/** GET /api/leads/status: the strip + live finding cards. */
export type SearchProgress = {
  id: string;
  category: string;
  city: string;
  status: string;
  error: string | null;
  list_id: string | null;
  created_at: string;
  active: boolean;
  found: number;
  checked: number;
  withEmail: number;
  noEmail: number;
  unreachable: number;
  noWebsite: number;
};

export type StatusResponse = {
  counts: Record<string, number>;
  sentToday: number;
  inFollowUps: number;
  settings: OutreachSettings | null;
  searches: SearchProgress[];
};

export type ListSummary = {
  id: string;
  name: string;
  description: string | null;
  source_search_id: string | null;
  category: string | null;
  city: string | null;
  created_at: string;
  total: number;
  stages: Partial<Record<Stage, number>>;
  finding: boolean;
};

export type ListLead = Lead & {
  added_at: string;
  last_contacted_at: string | null;
  enrollment: {
    status: string;
    current_step: number;
    next_send_at: string | null;
    sequence_name: string | null;
  } | null;
};

export type TemplateRow = {
  id: string;
  name: string;
  subject: string;
  body_text: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

/** GET /api/leads/approve */
export type ApproveDraft = {
  id: string;
  lead_id: string;
  contact_id: string;
  subject: string;
  body_text: string;
  status: string;
  edited: boolean;
  error: string | null;
  created_at: string;
  batch_id?: string | null;
  leads: {
    id: string;
    name: string;
    website: string | null;
    domain: string | null;
    city: string | null;
    category: string | null;
    status: string;
    fit_score: number | null;
    fit_reason: string | null;
    enrichment: Enrichment | null;
    products: string[] | null;
  };
  lead_contacts: {
    id: string;
    email: string;
    person_name: string | null;
    person_title: string | null;
    verify_status: string;
    mailbox_status: string | null;
    role_hint: string | null;
  } | null;
};

export type BatchRow = {
  id: string;
  created_at: string;
  lead_count: number;
  follow_up_count: number;
  follow_up_days: number;
  source: string;
  list_id: string | null;
  lead_lists: { name: string } | null;
};
