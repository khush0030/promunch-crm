-- Amazon SP-API sync schedule — run ONCE in the Supabase SQL editor.
-- Uses Supabase pg_cron (no frequency limit, unlike Vercel Hobby crons).
-- Mirrors the wa-health scheduling pattern. verify_jwt=false on amazon-poll,
-- so net.http_post needs no auth header.

-- Every 15 min: orders + inventory + finances (near-real-time order alerts).
select cron.schedule(
  'amazon-poll',
  '*/15 * * * *',
  $$select net.http_post(url:='https://hlykspakpewuilttnydm.supabase.co/functions/v1/amazon-poll')$$
);

-- Daily 05:00 UTC (10:30 IST): ingest the latest settlement report + reconcile.
select cron.schedule(
  'amazon-settlements',
  '0 5 * * *',
  $$select net.http_post(url:='https://hlykspakpewuilttnydm.supabase.co/functions/v1/amazon-poll?only=settlements')$$
);

-- To inspect / remove later:
--   select jobname, schedule, active from cron.job where jobname like 'amazon-%';
--   select cron.unschedule('amazon-poll');
--   select cron.unschedule('amazon-settlements');
