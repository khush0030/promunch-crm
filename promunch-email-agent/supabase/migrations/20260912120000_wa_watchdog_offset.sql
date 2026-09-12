-- wa-watchdog: run OFF the :X0 cron stampede.
--
-- Sep 12 2026: two false CRITICAL "no health_ok heartbeat in ever" pages. At
-- :00/:30 up to 15 pg_cron jobs fire the same second (wa-jobs-tick, campaign
-- worker, gmail-poll, 7x every-15, 2x every-30, wa-health AND wa-watchdog).
-- pg_net logged 5s DNS timeouts on those ticks; the watchdog's SELECT errored
-- and the old code read a failed query as "no heartbeat". health_ok had landed
-- 28 ms earlier.
--
-- Code fix (deployed separately): a query error now logs `watchdog_query_failed`
-- (warn, no Slack) instead of paging. This migration moves the watchdog to
-- :05/:15/:25/... so it (a) never competes with the stampede and (b) reads a
-- 5-minute-old heartbeat instead of racing wa-health's own insert.
--
-- Apply by hand in the Supabase dashboard SQL editor.

DO $$
DECLARE
  cmd text;
BEGIN
  SELECT command INTO cmd FROM cron.job WHERE jobname = 'wa-watchdog';
  IF cmd IS NULL THEN
    RAISE NOTICE 'wa-watchdog cron job not found; nothing to do';
    RETURN;
  END IF;
  PERFORM cron.unschedule('wa-watchdog');
  PERFORM cron.schedule('wa-watchdog', '5-59/10 * * * *', cmd);
END $$;

-- verify
SELECT jobname, schedule, active FROM cron.job WHERE jobname IN ('wa-health', 'wa-watchdog');
