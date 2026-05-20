-- PROMUNCH Email Agent — email tracking log + brand learning corpus
-- Depends on 20260518000000_init.sql (email_threads).

create extension if not exists "pgcrypto";

------------------------------------------------------------------------
-- email_logs
--   Unified, append-only activity log for every tracked email event.
--   One row per event in the ticket lifecycle: an email arrived, a draft
--   was generated, a human gave feedback, a revision was produced, the
--   reply was approved & sent, skipped, or failed. This is the audit
--   timeline the dashboard reads.
------------------------------------------------------------------------
create table if not exists email_logs (
  id                uuid primary key default gen_random_uuid(),
  email_thread_id   uuid references email_threads(id) on delete set null,
  gmail_thread_id   text,
  gmail_message_id  text,
  event_type        text not null
                    check (event_type in (
                      'received', 'drafted', 'revised', 'feedback',
                      'approved', 'sent', 'skipped', 'failed', 'regenerated'
                    )),
  actor             text,            -- 'system' | 'claude' | a Slack user id
  from_email        text,
  subject           text,
  detail            jsonb,           -- event-specific payload (model, revision, error, etc.)
  created_at        timestamptz not null default now()
);

create index if not exists email_logs_thread_idx  on email_logs (email_thread_id, created_at desc);
create index if not exists email_logs_event_idx   on email_logs (event_type, created_at desc);
create index if not exists email_logs_created_idx on email_logs (created_at desc);
create index if not exists email_logs_from_idx    on email_logs (from_email);

------------------------------------------------------------------------
-- brand_knowledge
--   The agent's "brain". Every approved reply and every human feedback
--   correction is distilled into a row here. generateDraft() pulls the
--   most recent rows back into the system prompt as few-shot exemplars,
--   so the agent's voice and policies converge on PROMUNCH's over time.
------------------------------------------------------------------------
create table if not exists brand_knowledge (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null
                    check (kind in ('approved_reply', 'feedback_pattern', 'brand_fact')),
  inbound_subject   text,
  inbound_excerpt   text,
  final_reply       text,
  feedback          text,
  tags              text[],
  source_thread_id  uuid references email_threads(id) on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists brand_knowledge_kind_idx on brand_knowledge (kind, created_at desc);
