// Shared domain types for the B2B Leads dashboard. Extracted from
// dashboard/leads/page.tsx so the split-out views can share them.

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

export type SearchRow = {
  id: string;
  category: string;
  city: string;
  status: string;
  pages_fetched: number;
  results_count: number;
  email_count: number;
  products: string[] | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type OutreachSettings = {
  daily_cap: number;
  paused: boolean;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  footer_address: string;
};

export type ApiResponse = {
  leads: Lead[];
  total: number;
  statusCounts: Record<string, number>;
  searches: SearchRow[];
  sentToday: number;
  activeEnrollments: number;
  settings: OutreachSettings | null;
};

// ── Lists / sequences / templates / analytics (leads v2) ────────────────────

export type ListSummary = {
  id: string;
  name: string;
  description: string | null;
  source_search_id: string | null;
  created_at: string;
  updated_at: string;
  leads: number;
  withEmail: number;
  contacted: number;
  replied: number;
  active_sequence: string | null;
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
  used_in_sequences: number;
};

export type SequenceStep = {
  id?: string;
  position: number;
  wait_days: number;
  template_id: string;
  template_name?: string;
  template_subject?: string;
  template_body?: string;
  sent?: number;
};

export type SequenceRow = {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  stop_on_reply: boolean;
  ai_polish: boolean;
  created_at: string;
  steps: SequenceStep[];
  enrollments: Record<string, number>;
};

export type AnalyticsHeadline = {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  open_rate: number;
  click_rate: number;
  reply_rate: number;
  bounce_rate: number;
};

export type AnalyticsData = {
  range: number | 'all';
  headline: AnalyticsHeadline;
  prior: { sent: number; open_rate: number; click_rate: number; reply_rate: number; bounce_rate: number } | null;
  series: { week: string; sent: number; opened: number }[];
  sequences: {
    id: string;
    name: string;
    status: string;
    grade: string;
    sent: number;
    open_rate: number;
    click_rate: number;
    reply_rate: number;
    bounce_rate: number;
  }[];
  templates: { id: string; name: string; sent: number; open_rate: number; reply_rate: number }[];
};
