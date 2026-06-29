-- WhatsApp ticket watchdog — run ONCE in the Supabase SQL editor.
-- Uses Supabase pg_cron (no frequency limit, unlike Vercel Hobby crons).
-- Mirrors the amazon-cron / wa-weekly-summary pattern. wa-ticket-watchdog is
-- deployed with verify_jwt=false, so net.http_post needs no auth header.
--
-- PREREQUISITE: apply migration 20260629120000_wa_ticket_watchdog.sql first
-- (adds ticket_last_alert_at / ticket_alert_count to wa_threads).

-- Every 15 min: re-ping the team about any open/pending ticket that is past its
-- SLA and still unassigned. Escalates per nag; stops when a human claims or
-- resolves it. Urgent tickets also ping ops on WhatsApp (if OPS_WA_ID is set).
select cron.schedule(
  'wa-ticket-watchdog-reping',
  '*/15 * * * *',
  $$select net.http_post(url:='https://hlykspakpewuilttnydm.supabase.co/functions/v1/wa-ticket-watchdog')$$
);

-- Daily 03:30 UTC = 09:00 IST: post the open-ticket digest to Slack.
select cron.schedule(
  'wa-ticket-watchdog-digest',
  '30 3 * * *',
  $$select net.http_post(url:='https://hlykspakpewuilttnydm.supabase.co/functions/v1/wa-ticket-watchdog?mode=digest')$$
);

-- Inspect / remove later:
--   select jobname, schedule, active from cron.job where jobname like 'wa-ticket-watchdog-%';
--   select cron.unschedule('wa-ticket-watchdog-reping');
--   select cron.unschedule('wa-ticket-watchdog-digest');
