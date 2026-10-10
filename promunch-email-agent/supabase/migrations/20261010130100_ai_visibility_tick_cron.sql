-- ai-visibility-tick: weekly, Monday 03:35 UTC (09:05 IST).
--
-- ⚠ Apply AFTER `supabase functions deploy ai-visibility-tick` (scheduling
-- first would 404) and AFTER 20261010130000_ai_visibility.sql.
-- One run asks every active ai_visibility_prompts question once (capped by
-- AI_VISIBILITY_MAX_PROMPTS, default 25). Cost estimate: about $0.30 to $0.60
-- per run on gpt-4.1-mini (see the spec). Nothing is sent to anyone.
--
-- Prereq: Vault secret `service_role_key` (see 20260705100000; on the Mumbai
-- project it must hold the sb_secret_… key, CRON_TOPOLOGY.md 2026-10-07). The
-- command is inlined because 20260705100000_cron_jobs_canonical.sql drops its
-- _cron_post helper; the bearer is read from Vault by the job at run time.
-- Offset to :35 to stay clear of the :X0 stampede and wa-weekly-summary (Mon 03:30).
-- Idempotent: unschedule-then-schedule by jobname.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('ai-visibility-tick') where exists (select 1 from cron.job where jobname = 'ai-visibility-tick');
select cron.schedule('ai-visibility-tick', '35 3 * * 1', $cmd$select net.http_post(
    url := 'https://wlungshkwfuggtbantkb.supabase.co/functions/v1/ai-visibility-tick',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{"trigger":"cron"}'::jsonb
  );$cmd$);

-- Verify: select jobname, schedule, active from cron.job where jobname = 'ai-visibility-tick';
--         select status, return_message, start_time from cron.job_run_details
--          where jobid = (select jobid from cron.job where jobname = 'ai-visibility-tick')
--          order by start_time desc limit 5;
--         select status, planned, answered, named, category_answered, cost_usd, error
--           from public.ai_visibility_runs order by started_at desc limit 5;
