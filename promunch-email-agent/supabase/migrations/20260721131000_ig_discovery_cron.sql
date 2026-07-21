-- Schedule ig-discovery-tick: polls running Apify discovery runs and imports
-- finished datasets into ig_prospects.
--
-- Apply AFTER `supabase functions deploy ig-discovery ig-discovery-tick`
-- (the job would 404 until the function exists — harmless but noisy).
-- Prereq: Vault secret `service_role_key` (see 20260705100000).
-- Idempotent: cron.schedule upserts by jobname.

create extension if not exists pg_cron;
create extension if not exists pg_net;

CREATE OR REPLACE FUNCTION _cron_post(target_url text, secret_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT format($cmd$select net.http_post(
    url := %L,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = %L),
      'Content-Type', 'application/json'
    )
  );$cmd$, target_url, secret_name);
$fn$;

DO $$
DECLARE
  fns text := 'https://hlykspakpewuilttnydm.supabase.co/functions/v1/';
BEGIN
  PERFORM cron.schedule('ig-discovery-tick', '*/5 * * * *', _cron_post(fns || 'ig-discovery-tick', 'service_role_key'));
END $$;

DROP FUNCTION _cron_post(text, text);

-- Verify: select jobname, schedule from cron.job where jobname like 'ig-%';
