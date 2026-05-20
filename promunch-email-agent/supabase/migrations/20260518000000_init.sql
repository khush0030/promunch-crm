-- PROMUNCH Email Agent — initial schema
-- Tracks the relationship between Gmail threads, Slack messages, and AI-drafted replies.

create extension if not exists "pgcrypto";

------------------------------------------------------------------------
-- email_threads
--   One row per Gmail thread that the agent has seen. Maps the Gmail
--   thread to the Slack message that anchors the conversation (so that
--   thread replies in Slack can be matched back to the right email).
------------------------------------------------------------------------
create table if not exists email_threads (
  id                  uuid primary key default gen_random_uuid(),

  -- Gmail identifiers
  gmail_thread_id     text not null unique,
  gmail_message_id    text not null,           -- the *latest* inbound message id
  gmail_history_id    text,
  in_reply_to_header  text,                    -- Message-Id of inbound msg, used when sending

  -- Sender / content snapshot (for context, not source of truth)
  from_email          text not null,
  from_name           text,
  to_email            text,
  subject             text,
  snippet             text,
  body_plain          text,
  body_html           text,

  -- Slack anchor
  slack_channel_id    text,
  slack_thread_ts     text,                    -- ts of the parent message in Slack
  slack_permalink     text,

  -- Lifecycle
  status              text not null default 'pending'
                      check (status in ('pending', 'sent', 'skipped', 'failed')),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists email_threads_slack_thread_ts_idx
  on email_threads (slack_thread_ts);

create index if not exists email_threads_status_idx
  on email_threads (status, created_at desc);

------------------------------------------------------------------------
-- draft_revisions
--   Every time Claude drafts a reply (initial + each regeneration after
--   user feedback) we store a row. is_current=true points to the draft
--   that the Approve button will send.
------------------------------------------------------------------------
create table if not exists draft_revisions (
  id                  uuid primary key default gen_random_uuid(),
  email_thread_id     uuid not null references email_threads(id) on delete cascade,
  revision            integer not null,
  body                text not null,                -- the draft reply text
  feedback            text,                         -- user feedback that triggered this revision (null for v1)
  model               text,                         -- e.g. claude-opus-4-6
  is_current          boolean not null default true,
  slack_message_ts    text,                         -- ts of slack message showing this draft
  created_at          timestamptz not null default now(),
  unique (email_thread_id, revision)
);

create index if not exists draft_revisions_current_idx
  on draft_revisions (email_thread_id) where is_current;

------------------------------------------------------------------------
-- sent_replies
--   Audit log of replies actually pushed back to Gmail.
------------------------------------------------------------------------
create table if not exists sent_replies (
  id                  uuid primary key default gen_random_uuid(),
  email_thread_id     uuid not null references email_threads(id),
  draft_revision_id   uuid references draft_revisions(id),
  gmail_message_id    text,                         -- id returned by gmail send
  body                text not null,
  approved_by_slack_user text,
  sent_at             timestamptz not null default now()
);

create index if not exists sent_replies_thread_idx
  on sent_replies (email_thread_id, sent_at desc);

------------------------------------------------------------------------
-- gmail_watch
--   Tracks the Gmail Pub/Sub watch so the renewal cron can keep it alive
--   (Gmail expires watches after 7 days).
------------------------------------------------------------------------
create table if not exists gmail_watch (
  email           text primary key,
  history_id      text,
  expiration      timestamptz,
  last_renewed_at timestamptz default now()
);

------------------------------------------------------------------------
-- oauth_tokens
--   Stores the long-lived Gmail OAuth refresh token. Only one row is
--   expected (for hello@promunch.in) but the schema permits multiple
--   mailboxes if you expand later.
------------------------------------------------------------------------
create table if not exists oauth_tokens (
  email           text primary key,
  refresh_token   text not null,
  scope           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

------------------------------------------------------------------------
-- updated_at trigger
------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists email_threads_updated_at on email_threads;
create trigger email_threads_updated_at
  before update on email_threads
  for each row execute function set_updated_at();

drop trigger if exists oauth_tokens_updated_at on oauth_tokens;
create trigger oauth_tokens_updated_at
  before update on oauth_tokens
  for each row execute function set_updated_at();
