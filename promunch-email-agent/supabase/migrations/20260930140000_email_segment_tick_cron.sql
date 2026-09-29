-- ============================================================
-- CRON: email-segment-tick (daily 04:30 UTC = 10:00 IST)
--
-- Flows with trigger_type 'segment_entry' (win-back, VIP, sunset) and
-- 'date_based' (first-order anniversary) have no event that enrols them.
-- This daily job POSTs /api/cron/email-segment-tick, which evaluates each
-- ACTIVE such flow's trigger_config.segment / .kind and enrols matching
-- consented, active, non-suppressed contacts (email IS NOT NULL).
--
-- It never sends: it only writes flow_enrollments, idempotent on the
-- (flow_id, dedup_key) unique index, capped at trigger_config.max_per_run
-- (default 300) new enrolments per flow per run to protect domain warm-up.
-- email-flow-tick does the sending and takes its email_sends claim first
-- (AGENTS.md §4.1). No active segment flow => the job enrols nobody.
--
-- Vercel Hobby blocks sub-daily crons, and all email crons already live on
-- pg_cron with the Vault bearer (docs/runbooks/CRON_TOPOLOGY.md), so this one
-- does too. :30 keeps it off the :00/:10 pg_cron stampede. The route may take
-- well over 5s on a full evaluation; pg_net's timeout only bounds how long
-- pg_net waits for the response, the Vercel function (maxDuration 300) keeps
-- running.
--
-- Apply by hand in the Supabase dashboard SQL editor (docs/runbooks/MIGRATIONS).
-- Dry run first (no writes):
--   curl -H "Authorization: Bearer $CRON_SECRET" \
--     "https://promunch-crm.vercel.app/api/cron/email-segment-tick?dry=1"
-- ============================================================

select cron.unschedule('email-segment-tick')
where exists (select 1 from cron.job where jobname = 'email-segment-tick');

select cron.schedule(
  'email-segment-tick',
  '30 4 * * *',
  $$
  select net.http_post(
    url := 'https://promunch-crm.vercel.app/api/cron/email-segment-tick',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 5000
  );
  $$
);

-- Verify:
--   select jobname, schedule, active from cron.job where jobname = 'email-segment-tick';
--   select status, return_message, start_time from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'email-segment-tick')
--   order by start_time desc limit 5;
