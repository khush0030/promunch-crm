-- Instagram influencer DISCOVERY (Apify-powered) + prospect pipeline.
--
-- Owner decision 2026-07-21: the old "no Apify / no scraping" rule from
-- docs/instagram/instagram-influencer-pipeline.md is REVERSED for discovery.
-- Apify actors (search / hashtag / profile / reel scrapers) find candidate
-- creators and pull public metrics (followers, last-3-post likes/comments,
-- bio, bio email). Scraped data feeds SEARCH + SCORING ONLY — it never feeds
-- an automated send. Instagram still forbids cold DMs via the API, so first
-- contact with a prospect is always human-touched (manual DM assist from the
-- dashboard, or a bio-email via Resend).
--
-- Tables:
--   ig_discovery_runs — one row per Apify actor run (polled by ig-discovery-tick)
--   ig_prospects      — one row per discovered creator (handle-unique)
--   ig_outreach_log   — prospect-side sends (email / manual DM), pre-thread
--
-- Apply via the Supabase dashboard SQL editor.

-- ---------------------------------------------------------------------------
-- Apify actor runs — async: ig-discovery starts them, ig-discovery-tick
-- (pg_cron */5) polls status and imports the dataset when finished.
-- ---------------------------------------------------------------------------
create table if not exists public.ig_discovery_runs (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null,                       -- 'search' | 'hashtag' | 'profiles' | 'reels'
  query          text,                                -- keyword / hashtag (null for enrich batches)
  actor          text not null,                       -- apify actor id used
  apify_run_id   text,
  parent_run_id  uuid references public.ig_discovery_runs(id),
  status         text not null default 'queued',      -- queued|running|succeeded|imported|failed
  input          jsonb not null default '{}'::jsonb,
  items_count    integer,
  usage_usd      numeric,                             -- from Apify run stats (daily budget guard)
  error          text,
  started_by     text,
  created_at     timestamptz not null default now(),
  finished_at    timestamptz
);
create index if not exists ig_discovery_runs_status_idx on public.ig_discovery_runs (status, created_at);

-- ---------------------------------------------------------------------------
-- Prospects — discovered creators. Filterable by followers / ER / fit score.
-- Linked to ig_threads when the creator later DMs the business account.
-- ---------------------------------------------------------------------------
create table if not exists public.ig_prospects (
  id               uuid primary key default gen_random_uuid(),
  handle           text not null unique,
  full_name        text,
  profile_pic      text,
  biography        text,
  external_url     text,
  followers        integer,
  media_count      integer,
  avg_likes        numeric,                            -- last-3 posts
  avg_comments     numeric,
  avg_views        numeric,                            -- from reel scrape (shortlist-only)
  engagement_rate  numeric,                            -- (avg_likes+avg_comments)/followers
  last3            jsonb,                              -- raw last-3 post metrics for the drawer
  niche            text,
  niche_score      integer,                            -- 0–25 (same scale as ig_threads)
  fit_score        integer,                            -- 0–100 (same formula as ig-analyze)
  fit_reason       text,
  bio_email        text,                               -- regexed out of the biography
  phone            text,
  status           text not null default 'new',        -- new|shortlisted|contacted|in_convo|rejected
  source           text,                               -- 'search:<q>' | 'hashtag:<tag>' | 'manual'
  discovery_run_id uuid references public.ig_discovery_runs(id),
  thread_id        uuid references public.ig_threads(id),
  contacted_at     timestamptz,
  contacted_via    text,                               -- 'ig_manual' | 'email' | 'whatsapp'
  pitch_dm         text,                               -- AI pitch draft (DM flavour)
  pitch_email_subject text,
  pitch_email_body text,
  pitch_drafted_at timestamptz,
  scraped_at       timestamptz,                        -- last profile enrich
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists ig_prospects_filter_idx on public.ig_prospects (status, followers, engagement_rate);
create index if not exists ig_prospects_fit_idx on public.ig_prospects (fit_score desc nulls last);

-- ---------------------------------------------------------------------------
-- Prospect-side outreach ledger (no ig_thread exists yet). Thread-side sends
-- stay in ig_messages.
-- ---------------------------------------------------------------------------
create table if not exists public.ig_outreach_log (
  id          uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.ig_prospects(id) on delete cascade,
  channel     text not null,                           -- 'email' | 'ig_manual' | 'whatsapp'
  subject     text,
  body        text,
  status      text not null default 'sent',
  resend_id   text,
  created_at  timestamptz not null default now()
);
create index if not exists ig_outreach_log_prospect_idx on public.ig_outreach_log (prospect_id, created_at);

-- ---------------------------------------------------------------------------
-- Settings knobs (cost control).
-- ---------------------------------------------------------------------------
alter table public.ig_settings add column if not exists discovery_daily_budget_usd numeric not null default 5;
alter table public.ig_settings add column if not exists discovery_max_profiles_per_run integer not null default 100;

-- ---------------------------------------------------------------------------
-- RLS — same lockdown model as 20260718120000: staff (authenticated) may read
-- prospects/runs from the dashboard, writes are service-role only; the
-- outreach log is service-role only.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ig_prospects','ig_discovery_runs'] LOOP
    EXECUTE format('alter table public.%I enable row level security', t);
    EXECUTE format('revoke all on public.%I from anon', t);
    EXECUTE format('revoke insert, update, delete on public.%I from authenticated', t);
    EXECUTE format('drop policy if exists %I on public.%I', t || '_staff_read', t);
    EXECUTE format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_staff_read', t);
  END LOOP;

  EXECUTE 'alter table public.ig_outreach_log enable row level security';
  EXECUTE 'revoke all on public.ig_outreach_log from anon';
  EXECUTE 'revoke all on public.ig_outreach_log from authenticated';
END $$;
