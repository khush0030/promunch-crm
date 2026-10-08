-- Review feedback ask (owner-approved Oct 9 2026).
-- Code: promunch-email-agent/supabase/functions/_shared/review-feedback.ts
--       + review-feedback-flow.ts, wa-journey-tick, wa-webhook.
--
-- APPLY MANUALLY in the Supabase dashboard SQL editor, AFTER the app-side
-- supabase/migrations/20261009100000_orm_v2.sql (this file redefines the
-- orm_sources key check that orm_v2 last set). Idempotent.
--
-- Ships dark: review_feedback_enabled defaults to false, and with it false
-- nothing in the review journey changes.

-- 1. feature flag -------------------------------------------------------------
alter table public.wa_flow_settings
  add column if not exists review_feedback_enabled boolean not null default false;

-- 2. never-twice claim for tap replies ---------------------------------------
-- One row per answered ask. The FIRST tap inserts and gets the one reply; any
-- later tap on any button of the same ask hits the unique key (23505) and gets
-- no reply. ref = the review_request journey run id carried in the payload.
create table if not exists public.wa_review_feedback (
  id bigserial primary key,
  wa_id text not null,
  ref text not null,
  choice text not null check (choice in ('loved', 'okay', 'unhappy')),
  run_id uuid,
  order_ref text,
  tap_wa_message_id text,
  status text not null default 'claimed' check (status in ('claimed', 'replied', 'reply_failed')),
  reply_wa_message_id text,
  error text,
  ticket_opened boolean not null default false,
  orm_mention_id uuid,
  created_at timestamptz not null default now(),
  replied_at timestamptz,
  unique (wa_id, ref)
);
create index if not exists wa_review_feedback_created_idx on public.wa_review_feedback (created_at desc);
create index if not exists wa_review_feedback_choice_idx on public.wa_review_feedback (choice, created_at desc);

alter table public.wa_review_feedback enable row level security;
revoke all on public.wa_review_feedback from anon, authenticated;
grant all on public.wa_review_feedback to service_role;
grant usage, select on sequence public.wa_review_feedback_id_seq to service_role;

-- 3. ORM: 'whatsapp' source (fed by the Not happy tap, never collected) -------
alter table public.orm_sources drop constraint if exists orm_sources_key_check;
alter table public.orm_sources add constraint orm_sources_key_check
  check (key in ('judgeme', 'youtube', 'reddit', 'rss', 'amazon', 'instagram', 'competitors', 'whatsapp'));
insert into public.orm_sources (key, label, every_minutes, enabled)
  values ('whatsapp', 'WhatsApp review ask', 1440, false)
on conflict (key) do nothing;
