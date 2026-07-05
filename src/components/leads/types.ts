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
  settings: OutreachSettings | null;
};
