-- orm-tick: every 15 minutes (Reputation / online reputation management engine).
--
-- ⚠ Apply AFTER `supabase functions deploy orm-tick` (scheduling first would
-- 404 every 15 min) and AFTER supabase/migrations/20261008200000_orm.sql.
-- Ships dark: every orm_sources row is disabled and orm_settings.alerts_enabled
-- is false until the owner turns them on in Reputation → Settings.
--
-- Prereq: Vault secret `service_role_key` (see 20260705100000). The command is
-- inlined because 20260705100000_cron_jobs_canonical.sql drops its
-- _cron_post helper; the bearer is read from Vault by the job at run time.
-- Idempotent: unschedule-then-schedule by jobname.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('orm-tick') where exists (select 1 from cron.job where jobname = 'orm-tick');
select cron.schedule('orm-tick', '*/15 * * * *', $cmd$select net.http_post(
    url := 'https://wlungshkwfuggtbantkb.supabase.co/functions/v1/orm-tick',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    )
  );$cmd$);

-- Verify: select jobname, schedule, active from cron.job where jobname = 'orm-tick';
--         select status, return_message, start_time from cron.job_run_details
--          where jobid = (select jobid from cron.job where jobname = 'orm-tick')
--          order by start_time desc limit 5;
