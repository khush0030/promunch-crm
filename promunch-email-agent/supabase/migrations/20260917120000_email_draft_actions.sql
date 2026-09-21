-- email_threads.status: allow the 'sending' claim state approve.ts already writes.
alter table email_threads drop constraint if exists email_threads_status_check;
alter table email_threads add constraint email_threads_status_check
  check (status in ('pending', 'sending', 'sent', 'skipped', 'failed'));
-- CRM approvals record the team member's email (Slack approvals keep the Slack user id).
alter table sent_replies add column if not exists approved_by_email text;
-- A customer reply that lands while our reply is mid-send must not reopen the
-- thread (a second Approve could then win a fresh claim). process-email sets
-- this flag instead; approve.ts moves the thread back to 'pending' after the
-- send finishes.
alter table email_threads add column if not exists requeue_after_send boolean not null default false;
