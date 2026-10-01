-- voice-tick: every minute. Apply AFTER `supabase functions deploy voice-tick`
-- (scheduling first would 404 every minute). _cron_post comes from
-- 20260705100000_cron_jobs_canonical.sql.
select cron.unschedule('voice-tick') where exists (select 1 from cron.job where jobname = 'voice-tick');
select cron.schedule('voice-tick', '* * * * *',
  _cron_post('https://hlykspakpewuilttnydm.supabase.co/functions/v1/voice-tick', 'service_role_key'));
