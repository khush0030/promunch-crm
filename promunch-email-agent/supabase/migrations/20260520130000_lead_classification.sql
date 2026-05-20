-- Lead classification columns on email_threads
-- Populated by _shared/classify.ts on every inbound message.

alter table email_threads
  add column if not exists lead_category text,
  add column if not exists urgency text,
  add column if not exists score integer,
  add column if not exists classification_meta jsonb;

create index if not exists email_threads_score_idx
  on email_threads (score desc nulls last, created_at desc);

create index if not exists email_threads_category_idx
  on email_threads (lead_category, created_at desc);
