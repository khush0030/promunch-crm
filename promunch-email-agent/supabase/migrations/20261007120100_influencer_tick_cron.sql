-- influencer-tick: every 15 minutes (influencer delivery reminder engine).
--
-- ⚠ Apply AFTER `supabase functions deploy influencer-send influencer-tick`
-- (scheduling first would 404 every 15 min) and AFTER 018_influencers.sql +
-- 20261007120000_influencer_digest_log.sql. Creator messages still ship dark:
-- influencer_settings.engine_enabled and digest_enabled default to false.
--
-- Prereq: Vault secret `service_role_key` (see 20260705100000). The command is
-- inlined because 20260705100000_cron_jobs_canonical.sql drops its
-- _cron_post helper; the bearer is read from Vault by the job at run time.
-- Idempotent: unschedule-then-schedule by jobname.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('influencer-tick') where exists (select 1 from cron.job where jobname = 'influencer-tick');
select cron.schedule('influencer-tick', '*/15 * * * *', $cmd$select net.http_post(
    url := 'https://hlykspakpewuilttnydm.supabase.co/functions/v1/influencer-tick',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    )
  );$cmd$);

-- Verify: select jobname, schedule, active from cron.job where jobname = 'influencer-tick';
--         select status, return_message, start_time from cron.job_run_details
--          where jobid = (select jobid from cron.job where jobname = 'influencer-tick')
--          order by start_time desc limit 5;
