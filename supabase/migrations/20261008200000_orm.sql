-- Online reputation management (ORM): one feed of every review, comment and
-- mention of PROMUNCH. Plan: docs/plans/2026-10-08-orm-brand-monitoring.md.
-- Build contract: docs/plans/2026-10-08-orm-build-spec.md.
--
-- Free-tier design: official free APIs (Judge.me, YouTube, Reddit, Google
-- Alerts RSS) + Amazon reviews weekly via Apify capped at the free credit.
-- Ships dark: every source disabled and alerts off until the owner turns them on.

-- ---- settings (single row) -------------------------------------------------
create table if not exists public.orm_settings (
  id smallint primary key default 1 check (id = 1),
  alerts_enabled boolean not null default false,
  -- null/empty = use the SUPPORT_ALERT_WA_IDS edge secret (support alert list)
  alert_wa_ids text[] not null default '{}',
  -- brand terms a mention must contain (case-insensitive) to enter the feed
  keywords text[] not null default array['promunch', 'pro munch', 'promunch.snacks', 'promunch snacks'],
  -- a mention containing any of these is stored but marked irrelevant
  exclude_keywords text[] not null default '{}',
  -- Amazon: which ASINs to pull reviews for (weekly) and how many per ASIN
  amazon_asins text[] not null default '{}',
  amazon_reviews_per_asin int not null default 20 check (amazon_reviews_per_asin between 5 and 100),
  -- Apify hard cap per calendar month (USD). Default = the free plan credit.
  apify_monthly_budget_usd numeric(8,2) not null default 5,
  apify_month text,                       -- 'YYYY-MM' the spend below belongs to
  apify_spent_usd numeric(8,4) not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.orm_settings (id) values (1) on conflict (id) do nothing;

-- ---- sources ---------------------------------------------------------------
-- One row per collector. Secrets (API keys) live in app_secrets, never here.
create table if not exists public.orm_sources (
  key text primary key check (key in ('judgeme', 'youtube', 'reddit', 'rss', 'amazon', 'instagram')),
  label text not null,
  enabled boolean not null default false,
  every_minutes int not null check (every_minutes >= 15),
  config jsonb not null default '{}'::jsonb,   -- rss: {feeds:[url]}, youtube: {channel_id}
  cursor jsonb not null default '{}'::jsonb,   -- collector-owned (last seen ids/times)
  next_run_at timestamptz not null default now(),
  last_run_at timestamptz,
  last_status text check (last_status in ('ok', 'error', 'skipped', 'not_connected', 'budget')),
  last_error text,
  last_count int,
  updated_at timestamptz not null default now()
);
insert into public.orm_sources (key, label, every_minutes) values
  ('judgeme',   'Website reviews (Judge.me)', 60),
  ('youtube',   'YouTube',                    360),
  ('reddit',    'Reddit',                     120),
  ('rss',       'News and web (Google Alerts)', 60),
  ('amazon',    'Amazon reviews',             10080),
  ('instagram', 'Instagram and Facebook',     60)
on conflict (key) do nothing;

-- ---- mentions --------------------------------------------------------------
create table if not exists public.orm_mentions (
  id uuid primary key default gen_random_uuid(),
  source text not null references public.orm_sources(key),
  external_id text not null,
  url text,
  author_name text,
  author_handle text,
  author_followers int,
  title text,
  body text not null default '',
  rating numeric(3,1),                      -- stars (1-5) where the source has them
  posted_at timestamptz,
  collected_at timestamptz not null default now(),
  is_owned boolean not null default false,  -- on our own post/listing/channel
  product_ref text,                         -- ASIN, Judge.me product handle, video id
  parent_external_id text,                  -- thread parent (comment replies)
  raw jsonb not null default '{}'::jsonb,

  -- enrichment (orm-tick, AI)
  enriched_at timestamptz,
  relevant boolean,                         -- false = not about PROMUNCH (hidden from feed)
  sentiment smallint check (sentiment between -2 and 2),
  summary text,
  topics text[] not null default '{}',
  intent text check (intent in ('complaint', 'question', 'praise', 'suggestion', 'collab', 'spam', 'other')),
  urgency text check (urgency in ('critical', 'high', 'normal', 'low')),
  product text,                             -- e.g. 'Roasted Edamame (Masala Mania)'
  language text,
  order_ref text,                           -- order number seen in the text, if any
  contact_id uuid,
  enrich_error text,
  enrich_attempts int not null default 0,

  -- workflow (dashboard)
  status text not null default 'new' check (status in ('new', 'seen', 'replied', 'ignored', 'escalated')),
  assignee text,
  reply_draft text,
  reply_text text,
  replied_at timestamptz,
  replied_by text,
  note text,
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);
create index if not exists orm_mentions_posted_idx on public.orm_mentions (posted_at desc nulls last);
create index if not exists orm_mentions_status_idx on public.orm_mentions (status) where relevant is not false;
create index if not exists orm_mentions_unenriched_idx on public.orm_mentions (collected_at) where enriched_at is null;
create index if not exists orm_mentions_urgency_idx on public.orm_mentions (urgency, posted_at desc);

-- ---- alerts (exactly once per mention per kind) ----------------------------
create table if not exists public.orm_alert_log (
  id bigserial primary key,
  mention_id uuid not null references public.orm_mentions(id) on delete cascade,
  kind text not null check (kind in ('critical', 'low_rating', 'negative', 'spike')),
  status text not null default 'claimed' check (status in ('claimed', 'sent', 'failed', 'skipped')),
  detail jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (mention_id, kind)
);

-- ---- grants: server-side only (service_role); no anon/authenticated access --
alter table public.orm_settings  enable row level security;
alter table public.orm_sources   enable row level security;
alter table public.orm_mentions  enable row level security;
alter table public.orm_alert_log enable row level security;
revoke all on public.orm_settings, public.orm_sources, public.orm_mentions, public.orm_alert_log from anon, authenticated;
grant all on public.orm_settings, public.orm_sources, public.orm_mentions, public.orm_alert_log to service_role;
grant usage, select on sequence public.orm_alert_log_id_seq to service_role;
