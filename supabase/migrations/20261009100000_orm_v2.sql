-- ORM v2 (Oct 9 2026): KPIs + free "next level" features.
-- Contract: docs/plans/2026-10-09-orm-v2-spec.md. Ships dark: the weekly
-- digest and spike alerts default OFF until the owner has seen a test.

-- ---- complaint cases on mentions (C) ---------------------------------------
alter table public.orm_mentions
  add column if not exists case_status text check (case_status in ('open', 'in_progress', 'resolved')),
  add column if not exists case_outcome text check (case_outcome in ('recovered', 'refund', 'replacement', 'explained', 'no_response', 'not_actionable')),
  add column if not exists case_opened_at timestamptz,
  add column if not exists case_resolved_at timestamptz,
  -- how the public reply went out: 'manual' (copy and open) or 'judgeme_api'
  add column if not exists reply_channel text check (reply_channel in ('manual', 'judgeme_api')),
  add column if not exists reply_external_id text;
create index if not exists orm_mentions_case_idx on public.orm_mentions (case_status) where case_status is not null;

-- one public reply per mention, ever (never-twice for Judge.me API replies)
create table if not exists public.orm_reply_claims (
  mention_id uuid primary key references public.orm_mentions(id) on delete cascade,
  claimed_by text,
  status text not null default 'claimed' check (status in ('claimed', 'posted', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  posted_at timestamptz
);

-- ---- settings (A, B, C, F) -------------------------------------------------
alter table public.orm_settings
  add column if not exists weekly_digest_enabled boolean not null default false,
  add column if not exists weekly_digest_dow smallint not null default 1 check (weekly_digest_dow between 0 and 6), -- 1 = Monday (IST)
  add column if not exists weekly_digest_hour_ist smallint not null default 9 check (weekly_digest_hour_ist between 0 and 23),
  add column if not exists spike_alerts_enabled boolean not null default false,
  add column if not exists spike_threshold smallint not null default 3 check (spike_threshold between 2 and 20),
  add column if not exists spike_window_days smallint not null default 7 check (spike_window_days between 1 and 30),
  -- every new negative/complaint mention opens a case automatically
  add column if not exists auto_case_on_negative boolean not null default true,
  -- [{ "asin": "B0...", "brand": "Brand", "label": "Their roasted chana 200g" }]
  add column if not exists competitor_asins jsonb not null default '[]'::jsonb;

-- ---- weekly digest log (A): exactly once per IST week ----------------------
create table if not exists public.orm_digest_log (
  week text primary key,               -- 'YYYY-Www' (ISO week, IST)
  status text not null default 'claimed' check (status in ('claimed', 'sent', 'failed', 'skipped_empty')),
  attempts int not null default 1,
  detail jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---- spike alerts (B): exactly once per product+topic per window ------------
create table if not exists public.orm_spike_log (
  key text primary key,                -- '<product>|<topic>|<window start YYYY-MM-DD>'
  product text,
  topic text,
  count int not null,
  mention_ids uuid[] not null default '{}',
  status text not null default 'claimed' check (status in ('claimed', 'sent', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

-- ---- competitor benchmark (F): monthly snapshot per ASIN --------------------
create table if not exists public.orm_competitor_snapshots (
  id bigserial primary key,
  asin text not null,
  brand text,
  label text,
  is_ours boolean not null default false,
  rating numeric(3,2),
  review_count int,
  price_inr numeric(10,2),
  taken_on date not null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (asin, taken_on)
);

-- competitors source row for the collector schedule (monthly)
alter table public.orm_sources drop constraint if exists orm_sources_key_check;
alter table public.orm_sources add constraint orm_sources_key_check
  check (key in ('judgeme', 'youtube', 'reddit', 'rss', 'amazon', 'instagram', 'competitors'));
insert into public.orm_sources (key, label, every_minutes, enabled)
  values ('competitors', 'Competitor ratings (Amazon)', 43200, false)
on conflict (key) do nothing;

alter table public.orm_reply_claims enable row level security;
alter table public.orm_digest_log enable row level security;
alter table public.orm_spike_log enable row level security;
alter table public.orm_competitor_snapshots enable row level security;
revoke all on public.orm_reply_claims, public.orm_digest_log, public.orm_spike_log, public.orm_competitor_snapshots from anon, authenticated;
grant all on public.orm_reply_claims, public.orm_digest_log, public.orm_spike_log, public.orm_competitor_snapshots to service_role;
grant usage, select on sequence public.orm_competitor_snapshots_id_seq to service_role;
