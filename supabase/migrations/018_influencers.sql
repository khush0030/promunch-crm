-- 018_influencers.sql
-- Influencer delivery tracker (plan: docs/plans/2026-10-07-influencer-automation.md §4A,
-- build spec: docs/plans/2026-10-07-influencer-build-spec.md).
--
-- Barter-only v1. One influencer can have many deals (repeat collabs). Each deal
-- carries a public portal code (/c/[code]) the creator uses to read the brief,
-- acknowledge it, confirm the box arrived, submit drafts, and submit the post link.
--
-- NO-SPAM (CLAUDE.md §0): every automated message is one influencer_reminders
-- row; unique (deal_id, kind, step) means a given nudge can exist once, and the
-- tick claims scheduled→sending with compare-and-set before calling wa-send.
--
-- Apply by hand in the Supabase dashboard SQL editor. Idempotent.

-- ---------------------------------------------------------------------------
-- Settings (single row, id = 1)
-- ---------------------------------------------------------------------------
create table if not exists influencer_settings (
  id                         integer primary key default 1 check (id = 1),
  engine_enabled             boolean not null default false,   -- master switch for automated creator messages
  digest_enabled             boolean not null default false,   -- 9am owner WhatsApp digest
  digest_hour_ist            integer not null default 9,
  owner_wa_id                text,                               -- falls back to OWNER_WA_ID env in edge fns
  default_draft_due_days     integer not null default 10 check (default_draft_due_days between 7 and 15),
  default_post_after_approval_days integer not null default 3,
  -- creator nudges, offsets in hours/days relative to the gate's anchor
  nudges jsonb not null default '{
    "brief_ack":      {"after_hours": [24, 48], "escalate_after_hours": 72},
    "delivery_check": {"after_days_from_dispatch": [4, 6], "escalate_after_days": 8},
    "draft_due":      {"days_before_due": [2, 0], "days_after_due": [1, 3], "escalate_after_days": 5},
    "post_due":       {"days_before": [1], "overdue_after_days": 2, "ghosted_after_days": 7}
  }'::jsonb,
  -- our-side SLAs (hours) — breaches become team tasks + digest lines
  team_sla jsonb not null default '{
    "brief_approval_hours": 24, "dispatch_hours": 48, "draft_review_hours": 24
  }'::jsonb,
  updated_at                 timestamptz not null default now()
);
insert into influencer_settings (id) values (1) on conflict (id) do nothing;
alter table influencer_settings enable row level security;

-- ---------------------------------------------------------------------------
-- Creators
-- ---------------------------------------------------------------------------
create table if not exists influencers (
  id                 uuid primary key default gen_random_uuid(),
  handle             text not null,                 -- lowercase, no @
  ig_user_id         text,
  full_name          text,
  phone              text,                          -- digits incl. country code, same format as wa_contacts.wa_id
  email              text,
  city               text,
  niche              text[] not null default '{}',
  followers          integer,
  engagement_rate    numeric(6,3),                  -- percent, e.g. 3.250
  avg_views          integer,
  tier               text generated always as (
                       case when followers is null then null
                            when followers < 10000  then 'nano'
                            when followers < 50000  then 'micro'
                            when followers < 200000 then 'mid'
                            else 'macro' end) stored,
  status             text not null default 'active' check (status in ('active','paused','blocked')),
  discount_code      text,
  notes              text,
  prospect_id        uuid,                          -- ig_prospects.id if sourced there (no FK: table may be absent)
  ig_thread_id       uuid,                          -- ig_threads.id if the DM thread exists
  last_contact_at    timestamptz,
  last_contact_channel text,
  metrics_updated_at timestamptz,
  created_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists influencers_handle_uidx on influencers (lower(handle));
create index if not exists influencers_phone_idx on influencers (phone);
alter table influencers enable row level security;

-- Address kept apart so it can be gated separately (PII).
create table if not exists influencer_addresses (
  influencer_id uuid primary key references influencers(id) on delete cascade,
  name          text,
  line1         text,
  line2         text,
  city          text,
  state         text,
  pincode       text,
  phone         text,
  updated_at    timestamptz not null default now()
);
alter table influencer_addresses enable row level security;

create table if not exists influencer_metrics_snapshots (
  id              uuid primary key default gen_random_uuid(),
  influencer_id   uuid not null references influencers(id) on delete cascade,
  followers       integer,
  engagement_rate numeric(6,3),
  avg_likes       integer,
  avg_comments    integer,
  avg_views       integer,
  audience        jsonb,                            -- from Insights screenshot: {cities:[], age:[], gender:{}}
  source          text not null,                    -- business_discovery | apify | screenshot | manual
  captured_at     timestamptz not null default now()
);
create index if not exists influencer_metrics_inf_idx on influencer_metrics_snapshots (influencer_id, captured_at desc);
alter table influencer_metrics_snapshots enable row level security;

-- ---------------------------------------------------------------------------
-- Kits
-- ---------------------------------------------------------------------------
create table if not exists influencer_kits (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  items       jsonb not null default '[]'::jsonb,   -- [{variant_id, title, qty}]  (Shopify variant ids)
  cogs        numeric(10,2),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table influencer_kits enable row level security;

create table if not exists influencer_kit_rules (
  id            uuid primary key default gen_random_uuid(),
  priority      integer not null default 100,        -- lower wins
  min_followers integer,
  max_followers integer,
  niche         text,                                -- null = any
  kit_id        uuid not null references influencer_kits(id) on delete cascade,
  created_at    timestamptz not null default now()
);
alter table influencer_kit_rules enable row level security;

-- ---------------------------------------------------------------------------
-- Deals (one collab)
-- stage lifecycle:
--   agreed → brief_draft → brief_sent → brief_acknowledged → dispatched → delivered
--   → draft_submitted ⇄ changes_requested → draft_approved → posted → completed
--   side exits: cancelled | ghosted
-- ---------------------------------------------------------------------------
create table if not exists influencer_deals (
  id                     uuid primary key default gen_random_uuid(),
  influencer_id          uuid not null references influencers(id) on delete cascade,
  code                   text not null unique,       -- portal code, 12+ url-safe random chars
  type                   text not null default 'barter' check (type in ('barter','paid','hybrid')),
  fee                    numeric(10,2),               -- unused in v1 (barter only)
  stage                  text not null default 'agreed' check (stage in (
                           'agreed','brief_draft','brief_sent','brief_acknowledged','dispatched','delivered',
                           'draft_submitted','changes_requested','draft_approved','posted','completed',
                           'cancelled','ghosted')),
  deliverables           jsonb not null default '{"reels":1,"stories":0,"posts":0}'::jsonb,
  requires_draft_approval boolean not null default true,  -- v1: always true (owner, Oct 7 2026)
  usage_rights           text not null default 'none' check (usage_rights in ('none','organic_repost','partnership_ads')),
  usage_rights_days      integer,
  kit_id                 uuid references influencer_kits(id),
  draft_due_days         integer not null default 10 check (draft_due_days between 1 and 60),
  shopify_order_id       text,
  shopify_order_name     text,
  order_status_url       text,
  agreed_at              timestamptz not null default now(),
  brief_sent_at          timestamptz,
  brief_acknowledged_at  timestamptz,
  dispatched_at          timestamptz,
  delivered_at           timestamptz,
  draft_due_at           timestamptz,                -- delivered_at + draft_due_days (set on delivery, editable)
  draft_submitted_at     timestamptz,
  draft_approved_at      timestamptz,
  go_live_at             timestamptz,                -- planned post date
  posted_at              timestamptz,
  post_url               text,
  completed_at           timestamptz,
  revision_count         integer not null default 0,
  views_24h              integer,
  views_7d               integer,
  notes                  text,
  created_by             text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists influencer_deals_inf_idx on influencer_deals (influencer_id, created_at desc);
create index if not exists influencer_deals_stage_idx on influencer_deals (stage);
alter table influencer_deals enable row level security;

-- Briefs are versioned; only an approved version can be sent.
create table if not exists influencer_briefs (
  id               uuid primary key default gen_random_uuid(),
  deal_id          uuid not null references influencer_deals(id) on delete cascade,
  version          integer not null,
  status           text not null default 'draft' check (status in ('draft','approved','sent','superseded')),
  content          jsonb not null,
  -- {concept, hooks[], script, talking_points[], must_say[], checklist[], donts[],
  --  format:{length_sec, aspect, stories}, dates:{draft_due, go_live}, usage_rights_text}
  generated_by     text,                              -- 'ai' | email of editor
  approved_by      text,
  approved_at      timestamptz,
  sent_at          timestamptz,
  acknowledged_at  timestamptz,
  created_at       timestamptz not null default now(),
  unique (deal_id, version)
);
alter table influencer_briefs enable row level security;

create table if not exists influencer_drafts (
  id            uuid primary key default gen_random_uuid(),
  deal_id       uuid not null references influencer_deals(id) on delete cascade,
  version       integer not null,
  url           text,                                -- Drive / IG / any link
  storage_path  text,                                -- storage bucket 'influencer-drafts' if uploaded
  note          text,
  review_status text not null default 'pending' check (review_status in ('pending','approved','changes_requested')),
  review_note   text,
  reviewed_by   text,
  reviewed_at   timestamptz,
  submitted_at  timestamptz not null default now(),
  unique (deal_id, version)
);
alter table influencer_drafts enable row level security;

-- ---------------------------------------------------------------------------
-- Reminders: creator nudges (WhatsApp) + team tasks. One row = one action.
-- ---------------------------------------------------------------------------
create table if not exists influencer_reminders (
  id             uuid primary key default gen_random_uuid(),
  deal_id        uuid not null references influencer_deals(id) on delete cascade,
  kind           text not null,      -- brief_ack | delivery_check | draft_due | post_due | post_fix | team_brief_approval | team_dispatch | team_draft_review | escalation
  step           integer not null default 1,
  audience       text not null check (audience in ('creator','team','owner')),
  channel        text not null default 'whatsapp' check (channel in ('whatsapp','task')),
  status         text not null default 'scheduled' check (status in ('scheduled','sending','sent','done','cancelled','failed')),
  due_at         timestamptz not null,
  template_name  text,
  claimed_at     timestamptz,
  sent_at        timestamptz,
  wa_message_id  text,
  attempts       integer not null default 0,
  last_error     text,
  meta           jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  unique (deal_id, kind, step)       -- HARD INVARIANT: a given nudge exists once
);
create index if not exists influencer_reminders_due_idx on influencer_reminders (status, due_at);
alter table influencer_reminders enable row level security;

-- Atomic claim: returns the row only to the one caller that flips it.
create or replace function claim_influencer_reminder(p_id uuid)
returns setof influencer_reminders
language sql
security definer
set search_path = public
as $$
  update influencer_reminders
     set status = 'sending', claimed_at = now(), attempts = attempts + 1
   where id = p_id and status = 'scheduled'
  returning *;
$$;
revoke all on function claim_influencer_reminder(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Timeline
-- ---------------------------------------------------------------------------
create table if not exists influencer_events (
  id            uuid primary key default gen_random_uuid(),
  influencer_id uuid not null references influencers(id) on delete cascade,
  deal_id       uuid references influencer_deals(id) on delete cascade,
  type          text not null,       -- stage_change | brief_sent | brief_ack | nudge_sent | draft_submitted | draft_reviewed | dispatched | delivered | posted | note | contact
  channel       text,                -- instagram | whatsapp | portal | ops | shopify | dashboard
  actor         text,                -- email, 'creator', 'system'
  summary       text not null,
  meta          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists influencer_events_inf_idx on influencer_events (influencer_id, created_at desc);
create index if not exists influencer_events_deal_idx on influencer_events (deal_id, created_at desc);
alter table influencer_events enable row level security;

-- Storage bucket for uploaded drafts (private; read via signed URLs).
insert into storage.buckets (id, name, public)
values ('influencer-drafts', 'influencer-drafts', false)
on conflict (id) do nothing;
