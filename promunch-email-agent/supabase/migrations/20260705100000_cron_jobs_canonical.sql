-- ═══════════════════════════════════════════════════════════════════════════
-- CANONICAL pg_cron TOPOLOGY (audit: "operational reproducibility")
--
-- Before this migration the cron schedule lived in one-off scripts
-- (scripts/*-cron.sql, scripts/m3-gate-cron-auth.sql) applied by hand, so a
-- fresh database could not be reproduced from migrations alone. This file is
-- now the single source of truth for every pg_cron job. The full scheduling
-- map (including the two Vercel crons and the self-continuation pattern) is
-- documented in docs/CRON_TOPOLOGY.md.
--
-- Idempotent: cron.schedule() upserts by jobname, so re-running is safe.
--
-- ── PREREQUISITES ────────────────────────────────────────────────────────────
-- 1. Vault secret `service_role_key` = the CURRENT service_role key (matches
--    what Supabase injects into edge functions — the requireInternal gate
--    compares against it):
--      select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
--    or, if it exists:
--      select vault.update_secret(
--        (select id from vault.secrets where name = 'service_role_key'),
--        '<SERVICE_ROLE_KEY>');
-- 2. Vault secret `cron_secret` = the CRON_SECRET env var on the Vercel
--    project (used by the wa-campaign-tick job that posts to the Next.js
--    cron route):
--      select vault.create_secret('<CRON_SECRET>', 'cron_secret');
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Command builder: returns the net.http_post SQL as text, with the bearer
-- pulled from Vault BY THE JOB at run time — the secret never sits in the
-- job definition and survives key rotations.
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
  app text := 'https://promunch-crm.vercel.app';
BEGIN
  -- ── Edge functions (service_role bearer; gated by _shared/require-internal.ts)
  PERFORM cron.schedule('amazon-poll',                  '*/15 * * * *',    _cron_post(fns || 'amazon-poll',                          'service_role_key'));
  PERFORM cron.schedule('amazon-settlements',           '0 5 * * *',       _cron_post(fns || 'amazon-poll?only=settlements',         'service_role_key'));
  PERFORM cron.schedule('gmail-poll-every-2min',        '*/2 * * * *',     _cron_post(fns || 'gmail-poll',                           'service_role_key'));
  PERFORM cron.schedule('gmail-watch-renew-daily',      '0 6 * * *',       _cron_post(fns || 'gmail-watch-renew',                    'service_role_key'));
  PERFORM cron.schedule('nudge-pending-15min',          '*/15 * * * *',    _cron_post(fns || 'nudge-pending',                        'service_role_key'));
  PERFORM cron.schedule('shopify-daily-summary',        '29 18 * * *',     _cron_post(fns || 'shopify-daily-summary',                'service_role_key'));
  PERFORM cron.schedule('shopify-monthly-recap',        '29 18 28-31 * *', _cron_post(fns || 'shopify-daily-summary?period=month',   'service_role_key'));
  PERFORM cron.schedule('shopify-weekly-recap',         '29 18 * * 0',     _cron_post(fns || 'shopify-daily-summary?period=week',    'service_role_key'));
  PERFORM cron.schedule('shopify-catalog-sync-nightly', '30 19 * * *',     _cron_post(fns || 'shopify-catalog-sync',                 'service_role_key'));
  PERFORM cron.schedule('wa-campaign-worker',           '*/2 * * * *',     _cron_post(fns || 'wa-campaign-worker',                   'service_role_key'));
  PERFORM cron.schedule('wa-health',                    '*/10 * * * *',    _cron_post(fns || 'wa-health',                            'service_role_key'));
  PERFORM cron.schedule('wa-jobs-tick',                 '* * * * *',       _cron_post(fns || 'wa-jobs-tick',                         'service_role_key'));
  PERFORM cron.schedule('wa-journey-tick',              '*/15 * * * *',    _cron_post(fns || 'wa-journey-tick',                      'service_role_key'));
  PERFORM cron.schedule('wa-rfm-tick-nightly',          '30 1 * * *',      _cron_post(fns || 'wa-rfm-tick',                          'service_role_key'));
  PERFORM cron.schedule('wa-ticket-watchdog-digest',    '30 3 * * *',      _cron_post(fns || 'wa-ticket-watchdog?mode=digest',       'service_role_key'));
  PERFORM cron.schedule('wa-ticket-watchdog-reping',    '*/15 * * * *',    _cron_post(fns || 'wa-ticket-watchdog',                   'service_role_key'));
  PERFORM cron.schedule('wa-weekly-summary',            '30 3 * * 1',      _cron_post(fns || 'wa-weekly-summary',                    'service_role_key'));

  -- ── Next.js cron routes (CRON_SECRET bearer; Vercel Hobby can't run
  --    sub-daily crons, so pg_cron fires this one)
  PERFORM cron.schedule('wa-campaign-tick',             '*/15 * * * *',    _cron_post(app || '/api/cron/wa-campaign-tick',           'cron_secret'));
END $$;

DROP FUNCTION _cron_post(text, text);

-- Verify after applying:
--   select jobname, schedule, active from cron.job order by jobname;
-- Every command should contain a vault.decrypted_secrets lookup (no literal keys).
