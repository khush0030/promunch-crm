-- M3: authenticate the pg_cron -> edge-function calls
--
-- The 12 cron/worker functions now require an internal auth gate
-- (_shared/require-internal.ts) that checks for
--   Authorization: Bearer <service_role key>
-- Previously most cron jobs sent NO auth header (and one had the anon key
-- hardcoded inline). This re-schedules every job to send the service_role
-- bearer, pulled from Vault at RUN TIME so the key never sits in the job
-- definition and survives future rotations.
--
-- ── PREREQUISITES (in this order) ───────────────────────────────────────────
-- 1. Finish C2 key rotation first.
-- 2. Put the CURRENT service_role key in Vault (same key Supabase auto-injects
--    into the functions as SUPABASE_SERVICE_ROLE_KEY — that's what the gate
--    compares against, so they MUST match):
--       -- if it doesn't exist yet:
--       select vault.create_secret('<NEW_SERVICE_ROLE_KEY>', 'service_role_key');
--       -- if it already exists (catalog-sync created it):
--       select vault.update_secret(
--         (select id from vault.secrets where name = 'service_role_key'),
--         '<NEW_SERVICE_ROLE_KEY>');
-- 3. Deploy the 12 gated functions, then run this script.
--
-- Verify: an unauthenticated curl to any of these functions returns 401;
-- cron runs (which now carry the bearer) return 2xx.

-- Command builder: returns the net.http_post SQL as text. The Vault lookup is
-- literal text inside the returned command, so it is evaluated on each cron
-- run — the key is never stored in the job row.
CREATE OR REPLACE FUNCTION _m3_post(target_url text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT format($cmd$select net.http_post(
    url := %L,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    )
  );$cmd$, target_url);
$fn$;

DO $$
DECLARE
  base text := 'https://hlykspakpewuilttnydm.supabase.co/functions/v1/';
BEGIN
  PERFORM cron.schedule('amazon-poll',               '*/15 * * * *',    _m3_post(base || 'amazon-poll'));
  PERFORM cron.schedule('amazon-settlements',        '0 5 * * *',       _m3_post(base || 'amazon-poll?only=settlements'));
  PERFORM cron.schedule('gmail-poll-every-2min',     '*/2 * * * *',     _m3_post(base || 'gmail-poll'));
  PERFORM cron.schedule('gmail-watch-renew-daily',   '0 6 * * *',       _m3_post(base || 'gmail-watch-renew'));
  PERFORM cron.schedule('nudge-pending-15min',       '*/15 * * * *',    _m3_post(base || 'nudge-pending'));
  PERFORM cron.schedule('shopify-daily-summary',     '29 18 * * *',     _m3_post(base || 'shopify-daily-summary'));
  PERFORM cron.schedule('shopify-monthly-recap',     '29 18 28-31 * *', _m3_post(base || 'shopify-daily-summary?period=month'));
  PERFORM cron.schedule('shopify-weekly-recap',      '29 18 * * 0',     _m3_post(base || 'shopify-daily-summary?period=week'));
  PERFORM cron.schedule('wa-campaign-worker',        '*/2 * * * *',     _m3_post(base || 'wa-campaign-worker'));
  PERFORM cron.schedule('wa-health',                 '*/10 * * * *',    _m3_post(base || 'wa-health'));
  PERFORM cron.schedule('wa-jobs-tick',              '* * * * *',       _m3_post(base || 'wa-jobs-tick'));
  PERFORM cron.schedule('wa-journey-tick',           '*/15 * * * *',    _m3_post(base || 'wa-journey-tick'));
  PERFORM cron.schedule('wa-rfm-tick-nightly',       '30 1 * * *',      _m3_post(base || 'wa-rfm-tick'));
  PERFORM cron.schedule('wa-ticket-watchdog-digest', '30 3 * * *',      _m3_post(base || 'wa-ticket-watchdog?mode=digest'));
  PERFORM cron.schedule('wa-ticket-watchdog-reping', '*/15 * * * *',    _m3_post(base || 'wa-ticket-watchdog'));
  PERFORM cron.schedule('wa-weekly-summary',         '30 3 * * 1',      _m3_post(base || 'wa-weekly-summary'));
END $$;

DROP FUNCTION _m3_post(text);

-- Sanity check — every command should now contain the Vault lookup:
--   select jobname, command from cron.job order by jobname;
