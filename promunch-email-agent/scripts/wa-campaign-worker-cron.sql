-- Durable WhatsApp campaign engine — run ONCE in the Supabase SQL editor.
--
-- This is the ONLY scheduler you need for campaigns. It fires the Supabase
-- wa-campaign-worker edge function every 2 minutes, which promotes scheduled
-- campaigns, drives in-flight sends, and auto-heals any stall. No Vercel, no
-- Hobby cron limit, no CRON_SECRET — same pattern as the working
-- shopify-daily-summary job.
--
-- PREREQUISITE: the pg_net extension must be enabled
-- (Dashboard -> Database -> Extensions -> pg_net -> Enable). Without it
-- net.http_post silently does nothing and nothing fires.

-- Remove the old Vercel-route campaign tick if it was ever scheduled.
-- (Safe to run even if it doesn't exist.)
do $$ begin
  perform cron.unschedule('wa-campaign-tick');
exception when others then null; end $$;

select cron.schedule(
  'wa-campaign-worker',
  '*/2 * * * *',
  $$select net.http_post(url:='https://hlykspakpewuilttnydm.supabase.co/functions/v1/wa-campaign-worker')$$
);

-- Verify:
--   select jobname, schedule, active from cron.job where jobname = 'wa-campaign-worker';
--   select jobname, status, return_message, start_time
--     from cron.job_run_details where jobname = 'wa-campaign-worker'
--     order by start_time desc limit 5;
-- Remove later:  select cron.unschedule('wa-campaign-worker');
