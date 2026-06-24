-- B2B outreach replies inbox. Inbound emails (replies to cold emails) arrive via
-- a Resend inbound webhook, get matched to the lead by sender address, and are
-- stored here. The lead + its sent draft are flagged 'replied' so the dashboard
-- "Replies" tab surfaces them with the reply text.
-- Apply via Supabase dashboard SQL editor.

create table if not exists outreach_replies (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete cascade,
  draft_id uuid references outreach_drafts(id) on delete set null,
  contact_id uuid references lead_contacts(id),
  from_email text,
  from_name text,
  subject text,
  body_text text,
  body_html text,
  resend_inbound_id text,          -- inbound message id (for dedup)
  in_reply_to text,                -- original Message-ID this replies to
  received_at timestamptz not null default now(),
  raw jsonb,
  created_at timestamptz not null default now()
);
create index if not exists outreach_replies_lead_idx on outreach_replies (lead_id);
create index if not exists outreach_replies_received_idx on outreach_replies (received_at desc);
create unique index if not exists outreach_replies_inbound_uq
  on outreach_replies (resend_inbound_id) where resend_inbound_id is not null;
