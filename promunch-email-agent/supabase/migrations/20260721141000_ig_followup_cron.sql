-- Schedule the Instagram cron jobs (go-live only):
--   ig-jobs-tick     — inbound AI-reply retry net (was never in the canonical
--                      cron migration because IG predates go-live)
--   ig-followup-tick — the follow-up engine drain
--
-- ⚠ Apply ONLY at Instagram go-live, AFTER
--   `supabase functions deploy ig-jobs-tick ig-followup-tick`
-- (the jobs 404 until the functions exist — harmless but noisy) and after
-- 20260721140500_ig_followups. Follow-ups still ship dark:
-- ig_settings.followups_enabled defaults to false.
--
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
  PERFORM cron.schedule('ig-jobs-tick', '* * * * *', _cron_post(fns || 'ig-jobs-tick', 'service_role_key'));
  PERFORM cron.schedule('ig-followup-tick', '*/15 * * * *', _cron_post(fns || 'ig-followup-tick', 'service_role_key'));
END $$;

DROP FUNCTION _cron_post(text, text);

-- Verify: select jobname, schedule from cron.job where jobname like 'ig-%';
