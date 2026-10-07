-- voice-tick: every minute. Apply AFTER `supabase functions deploy voice-tick`
-- (scheduling first would 404 every minute). The command is inlined because
-- 20260705100000_cron_jobs_canonical.sql drops its _cron_post helper at the
-- end; the bearer is still read from Vault by the job at run time.
select cron.unschedule('voice-tick') where exists (select 1 from cron.job where jobname = 'voice-tick');
select cron.schedule('voice-tick', '* * * * *', $cmd$select net.http_post(
    url := 'https://wlungshkwfuggtbantkb.supabase.co/functions/v1/voice-tick',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    )
  );$cmd$);
