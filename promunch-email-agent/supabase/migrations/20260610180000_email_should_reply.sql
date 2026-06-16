-- email_threads.should_reply was used in code (process-email.ts insert/update
-- on the auto-skip path, nudge-pending's filter) but never created by a
-- migration. Inbound mail the classifier marks no-reply (newsletter /
-- marketing / transactional / automated_notification / spam) hit an insert/
-- update that referenced this column, and Postgres raised
--   42703: column "should_reply" of relation "email_threads" does not exist
-- The raw Postgrest error (a plain object, not an Error) bubbled up to the
-- gmail-webhook catch and stringified to the useless "[object Object]".
--
-- Default true so existing rows keep being treated as reply-worthy; the
-- classifier sets it false on the auto-skip path.

alter table email_threads
  add column if not exists should_reply boolean not null default true;

-- nudge-pending filters `.neq("should_reply", false)` over pending threads.
create index if not exists email_threads_should_reply_idx
  on email_threads (should_reply, status, created_at desc)
  where should_reply is not false;
