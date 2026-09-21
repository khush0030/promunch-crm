-- One-off (owner decision D1, 21 Sep 2026): clear the email backlog.
--
-- Pending support-email threads older than 14 days are marked 'skipped'.
-- This emails NOBODY and does NOT teach the classifier (no brand_knowledge
-- writes, no skipThread): it is a plain status change in the database.
--
-- Run AFTER migration 20260917120000_email_draft_actions.sql, in the Supabase
-- dashboard SQL editor. Safe to run twice: the second run matches 0 rows,
-- because it only touches rows that are still 'pending'. Threads that are
-- 'sending', 'sent', 'failed' or 'skipped' are never touched.

-- 1) Preview: how many threads will be cleared, and their age range.
select count(*)        as threads_to_clear,
       min(created_at) as oldest,
       max(created_at) as newest
from email_threads
where status = 'pending'
  and created_at < now() - interval '14 days';

-- 2) Clear them, and write one 'skipped' row per thread to email_logs (the
--    same audit table the edge functions write through _shared/log.ts), so
--    the thread history shows why it left the queue. Runs as one statement.
with cleared as (
  update email_threads
     set status = 'skipped', updated_at = now()
   where status = 'pending'
     and created_at < now() - interval '14 days'
  returning id, gmail_thread_id, gmail_message_id, from_email, subject
), logged as (
  insert into email_logs (email_thread_id, gmail_thread_id, gmail_message_id, event_type, actor, from_email, subject, detail)
  select id, gmail_thread_id, gmail_message_id, 'skipped', 'system', from_email, subject,
         jsonb_build_object('reason', 'backlog_clear_2026_09_21', 'older_than_days', 14, 'emailed', false)
    from cleared
  returning email_thread_id
)
select id from cleared;
