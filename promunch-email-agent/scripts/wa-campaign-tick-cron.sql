-- Fire scheduled + recurring WhatsApp campaigns every 15 min via Supabase
-- pg_cron (the Vercel Hobby plan can't run sub-daily crons). This posts to the
-- Next.js cron route on the production dashboard, authenticated with CRON_SECRET.
--
-- Without this, campaigns set to "schedule" (and recurring series) never fire.
--
-- Run ONCE in the Supabase SQL editor. Replace <CRON_SECRET> with the exact
-- value of the CRON_SECRET env var set on the Vercel project.

select cron.schedule(
  'wa-campaign-tick',
  '*/15 * * * *',
  $$select net.http_post(
      url:='https://promunch-crm.vercel.app/api/cron/wa-campaign-tick',
      headers:='{"Authorization":"Bearer <CRON_SECRET>","Content-Type":"application/json"}'::jsonb
    )$$
);

-- Inspect / remove later:
--   select jobname, schedule, active from cron.job where jobname = 'wa-campaign-tick';
--   select cron.unschedule('wa-campaign-tick');
