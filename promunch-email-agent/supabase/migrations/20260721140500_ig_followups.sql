-- Instagram follow-up engine — automated, consistent nudges for collab threads
-- (the "influencer agreed to a video, then went quiet" problem).
--
-- Model: one ig_followups row = one scheduled nudge (wa_journey_runs style).
-- ig-followup-tick (pg_cron */15) drains due rows:
--   • inside Meta's 24h window            → auto-send via ig-send (sent_by 'followup_bot')
--   • outside the window / human-owned    → status 'awaiting_approval' (Tasks tab),
--     routed to a fallback channel: HUMAN_AGENT DM (7d, if approved by Meta) /
--     bio email / WhatsApp / manual copy-paste.
-- An inbound reply cancels the pending follow-up (ig-webhook); a stage change
-- re-arms the cadence for the new stage (dashboard stage route).
--
-- NO-SPAM proof (CLAUDE.md §0):
--   1. partial unique index → at most ONE live follow-up per thread
--   2. compare-and-set claim scheduled→sending → one tick winner
--   3. ig_messages.ai_meta->>'followup_id' is the durable send marker —
--      stale-claim recovery re-sends only when the marker is absent
--   4. ig-send window guard refuses out-of-window automated sends
--
-- Apply via the Supabase dashboard SQL editor.

create table if not exists public.ig_followups (
  id             uuid primary key default gen_random_uuid(),
  thread_id      uuid not null references public.ig_threads(id) on delete cascade,
  stage          text not null,                 -- collab_stage this cadence belongs to
  step           integer not null default 1,    -- 1-based index into the cadence days
  status         text not null default 'scheduled',
  -- scheduled | sending | awaiting_approval | sent | cancelled | expired | escalated
  next_action_at timestamptz not null,
  channel        text,                          -- decided at route time: ig_dm|ig_dm_human_agent|email|whatsapp|manual
  draft          text,                          -- generated at route time, editable in the Tasks tab
  attempts       integer not null default 0,
  claimed_at     timestamptz,
  last_error     text,
  meta           jsonb not null default '{}'::jsonb,  -- {days_silent, window_state, cancelled_reason, ...}
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- HARD INVARIANT: at most one live follow-up per thread. Racing arms lose with
-- a unique violation, which callers swallow.
create unique index if not exists ig_followups_live_uidx on public.ig_followups (thread_id)
  where status in ('scheduled','sending','awaiting_approval');
create index if not exists ig_followups_due_idx on public.ig_followups (status, next_action_at);
create index if not exists ig_followups_thread_idx on public.ig_followups (thread_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Settings: master switch (ships OFF), HUMAN_AGENT tag flag (separate Meta
-- approval — keep false until confirmed), and per-stage cadences.
-- Cadence days are offsets from when the thread went quiet: [3,6] = nudge on
-- day 3, then day 6, then stop. Stages without a key never get nudges.
-- ---------------------------------------------------------------------------
alter table public.ig_settings add column if not exists followups_enabled boolean not null default false;
alter table public.ig_settings add column if not exists human_agent_enabled boolean not null default false;
alter table public.ig_settings add column if not exists followup_cadences jsonb not null default
'{
  "in_convo":   {"days": [3, 6],         "goal": "keep the conversation alive and move toward barter terms"},
  "terms_sent": {"days": [2, 4, 7],      "goal": "get a yes or no on the barter terms"},
  "agreed":     {"days": [3, 6],         "goal": "collect the shipping address so the hamper can go out"},
  "shipped":    {"days": [5, 8, 12, 18], "goal": "warmly chase the promised video or reel"}
}'::jsonb;

-- Fallback-channel identifiers on the thread (bio_email filled by ig-analyze).
alter table public.ig_threads add column if not exists bio_email text;
alter table public.ig_threads add column if not exists phone text;

-- RLS: staff read via dashboard, writes service-role only (same model as
-- 20260718120000 for ig_threads).
alter table public.ig_followups enable row level security;
revoke all on public.ig_followups from anon;
revoke insert, update, delete on public.ig_followups from authenticated;
drop policy if exists ig_followups_staff_read on public.ig_followups;
create policy ig_followups_staff_read on public.ig_followups for select to authenticated using (true);
