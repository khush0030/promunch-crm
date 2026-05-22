-- Durable background-job queue for the WhatsApp stack.
--
-- Closes the "fire-and-forget" gap: wa-webhook used to invoke wa-ai-reply with
-- an un-retried fetch() — if that call failed, the inbound message got no
-- reply and nothing recorded it. Now wa-webhook enqueues a wa_jobs row; the
-- wa-jobs-tick cron drains it with retry + backoff, and dead-letters a
-- permanently-failing job to a human.

create table if not exists wa_jobs (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,                       -- 'ai_reply'
  payload      jsonb not null default '{}'::jsonb,  -- e.g. { thread_id, last_message }
  status       text not null default 'pending'
               check (status in ('pending','done','failed')),
  attempts     int  not null default 0,
  max_attempts int  not null default 5,
  run_after    timestamptz not null default now(),  -- earliest the cron may run it
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- the cron's hot path: pending jobs that are due, oldest first
create index if not exists wa_jobs_due_idx
  on wa_jobs (run_after) where status = 'pending';

drop trigger if exists wa_jobs_touch on wa_jobs;
create trigger wa_jobs_touch before update on wa_jobs
  for each row execute function touch_updated_at();
