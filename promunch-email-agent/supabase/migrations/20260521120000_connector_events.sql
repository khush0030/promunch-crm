-- PROMUNCH Email Agent — connector health / event log
-- Powers the CRM "Integrations" page: every connector (Gmail intake, Claude
-- drafting, AI-email→Slack, Shopify→Slack) writes an append-only event here
-- so the CRM can show live status + exactly what went wrong.

create extension if not exists "pgcrypto";

------------------------------------------------------------------------
-- connector_events
--   One row per connector event. level='error' rows are surfaced as the
--   "what is wrong" message in the CRM. Append-only — never updated.
------------------------------------------------------------------------
create table if not exists connector_events (
  id          uuid primary key default gen_random_uuid(),
  connector   text not null,          -- gmail_pipeline | anthropic | email_slack | shopify_slack | gmail_watch
  level       text not null default 'info'
              check (level in ('info', 'warn', 'error')),
  event       text not null,          -- short machine code, e.g. post_ok, post_failed, credits_exhausted
  message     text,                   -- human-readable detail shown in the CRM log
  detail      jsonb,                  -- structured payload (raw error, ids, counts)
  ref         text,                   -- optional reference (email_thread id, order number)
  created_at  timestamptz not null default now()
);

create index if not exists connector_events_connector_idx on connector_events (connector, created_at desc);
create index if not exists connector_events_level_idx     on connector_events (level, created_at desc);
create index if not exists connector_events_created_idx   on connector_events (created_at desc);

------------------------------------------------------------------------
-- email_threads: decouple AI drafting from Slack delivery
--   draft_status = 'ok'     → a Claude draft was generated
--                  'failed' → drafting failed; the email was still posted to
--                             Slack without a draft and will be auto-retried
--   draft_error  = last drafting error message (shown in the CRM)
------------------------------------------------------------------------
alter table email_threads
  add column if not exists draft_status text,
  add column if not exists draft_error  text;

create index if not exists email_threads_draft_status_idx
  on email_threads (draft_status) where draft_status = 'failed';
