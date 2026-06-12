-- B2B outreach: AI drafts, approval queue, sends via Resend, suppression + event tracking.
-- Apply via Supabase dashboard SQL editor after 20260612100000_b2b_leads.sql.

create table if not exists outreach_drafts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  contact_id uuid not null references lead_contacts(id),
  subject text not null,
  body_text text not null,
  model text,                                -- e.g. 'gpt-4o-mini'
  status text not null default 'draft',
  -- draft | approved | sending | sent | failed | replied | bounced | discarded
  edited boolean not null default false,
  resend_email_id text,                      -- join key for the Resend webhook
  error text,
  approved_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists outreach_drafts_status_idx on outreach_drafts (status);
create index if not exists outreach_drafts_resend_idx on outreach_drafts (resend_email_id);
create index if not exists outreach_drafts_sent_at_idx on outreach_drafts (sent_at);
create index if not exists outreach_drafts_lead_idx on outreach_drafts (lead_id);

create table if not exists suppressions (
  email text primary key,                    -- lowercased
  reason text not null,                      -- bounce | complaint | manual | unsubscribe
  draft_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists outreach_settings (
  id int primary key default 1 check (id = 1),
  daily_cap int not null default 15,         -- warm-up: raise weekly 15 -> 30 -> 50
  paused boolean not null default false,
  from_name text not null default 'Khush from ProMunch',
  from_email text not null default 'khush@trypromunch.in',
  reply_to text,
  footer_address text not null default 'ProMunch (Oltaflock) · Mumbai, India'
);
insert into outreach_settings (id) values (1) on conflict (id) do nothing;

create table if not exists outreach_events (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid references outreach_drafts(id) on delete set null,
  lead_id uuid,
  resend_email_id text,
  type text not null,                        -- sent | delivered | opened | clicked | bounced | complained
  payload jsonb,
  created_at timestamptz not null default now()
);
create index if not exists outreach_events_draft_idx on outreach_events (draft_id);
