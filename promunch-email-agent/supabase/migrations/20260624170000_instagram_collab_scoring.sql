-- Instagram Phase 2: collab scoring + AI barter-terms draft.
--
-- When a collab inquiry lands, ig-analyze enriches the thread via the official
-- Business Discovery API (followers, engagement, bio, recent captions — no
-- scraping), computes a 0–100 fit score (follower-band fit + engagement rate +
-- AI niche match), and drafts barter terms grounded in ig_settings.barter_terms
-- + the Master KB for a human to review, edit, and send.
--
-- NOTE: avg reel views is NOT exposed by Business Discovery for arbitrary
-- accounts, so the score uses band fit + ER + niche (recorded in fit_reason).
--
-- Apply via the Supabase dashboard SQL editor.

alter table public.ig_threads add column if not exists biography      text;
alter table public.ig_threads add column if not exists niche_score    integer;   -- 0–25, AI niche/brand relevance
alter table public.ig_threads add column if not exists fit_score      integer;   -- 0–100 composite
alter table public.ig_threads add column if not exists fit_reason     text;
alter table public.ig_threads add column if not exists collab_draft   text;      -- AI-drafted barter terms (human-editable)
alter table public.ig_threads add column if not exists collab_draft_at timestamptz;

create index if not exists ig_threads_fit_idx on public.ig_threads (fit_score desc nulls last);
