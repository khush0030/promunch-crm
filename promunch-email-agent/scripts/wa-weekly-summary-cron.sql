-- WhatsApp weekly recap schedule — run ONCE in the Supabase SQL editor.
-- Uses Supabase pg_cron (no frequency limit, unlike Vercel Hobby crons).
-- Mirrors the amazon-cron / wa-health pattern. Deploy wa-weekly-summary with
-- verify_jwt=false first, so net.http_post needs no auth header.

-- Mondays 03:30 UTC = 09:00 IST: post last-7-days WhatsApp recap to Slack.
select cron.schedule(
  'wa-weekly-summary',
  '30 3 * * 1',
  $$select net.http_post(url:='https://hlykspakpewuilttnydm.supabase.co/functions/v1/wa-weekly-summary')$$
);

-- To inspect / remove later:
--   select jobname, schedule, active from cron.job where jobname = 'wa-weekly-summary';
--   select cron.unschedule('wa-weekly-summary');
