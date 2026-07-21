-- ═══════════════════════════════════════════════════════════════════════════
-- EMAIL MARKETING CRON — 2026-07-22
--
-- Schedules the scheduled-campaign drainer. pg_cron POSTs to the Next.js route
-- with the CRON_SECRET bearer (Vercel Hobby cannot run sub-daily crons, so the
-- campaign scheduler lives here like wa-campaign-tick).
--
-- ⚠ CUSTOMER-VISIBLE EFFECT: once this job exists, any campaign saved with
-- status='scheduled' and a past-or-now scheduled_at WILL send to its audience
-- within ~15 minutes. It only touches rows already in 'scheduled' state, and
-- sendCampaign takes an atomic claim so a campaign can never double-send. If you
-- are not ready for scheduled campaigns to fire, do not apply this yet.
--
-- Prereq: Vault secret `cron_secret` = the CRON_SECRET env on Vercel
--   (see 20260705100000). Idempotent: cron.schedule upserts by jobname.
--
-- The flow-engine tick (email-flow-tick) is added in a later migration with the
-- flow engine (Phase 3), not here.
-- ═══════════════════════════════════════════════════════════════════════════

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
  app text := 'https://promunch-crm.vercel.app';
BEGIN
  PERFORM cron.schedule('email-campaign-tick', '*/15 * * * *', _cron_post(app || '/api/cron/email-campaign-tick', 'cron_secret'));
  -- Flow engine: drains due flow_enrollments and sends the current step. Only
  -- flows set status='active' send; nothing fires while every flow is a draft.
  PERFORM cron.schedule('email-flow-tick', '*/15 * * * *', _cron_post(app || '/api/cron/email-flow-tick', 'cron_secret'));
END $$;

DROP FUNCTION _cron_post(text, text);

-- Verify: select jobname, schedule, active from cron.job where jobname in ('email-campaign-tick','email-flow-tick');
