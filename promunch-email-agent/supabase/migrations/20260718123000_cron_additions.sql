-- ═══════════════════════════════════════════════════════════════════════════
-- CRON ADDITIONS — 2026-07-18 audit findings H1 (sweep unscheduled) and
-- C3 (dead-man's switch unscheduled)
--
-- ⚠ CUSTOMER-VISIBLE EFFECT (read before applying):
-- Scheduling wa-confirmation-sweep turns on the documented "final safety net"
-- for order confirmations. Effect: an order from the last 24h whose instant
-- confirmation genuinely failed will now receive its WhatsApp confirmation
-- late instead of never (24h lookback, 2-min grace, 5-attempt cap, wa_messages
-- ledger dedup — no order can be confirmed twice). If you do not want that
-- behavior yet, comment out the wa-confirmation-sweep line before running.
--
-- wa-watchdog is internal-only (Slack alert when wa-health heartbeats stop).
-- Note the pg_cron copy of the watchdog shares fate with pg_cron itself; the
-- INDEPENDENT copy is the Vercel cron on /api/cron/wa-watchdog (vercel.json,
-- twice daily) which catches pg_cron dying entirely.
--
-- Also brings the canonical topology doc back in sync: deal-scan-every-30min
-- (20260717130000) and b2b-leads-tick (20260706130000) already exist as jobs;
-- they are listed in docs/runbooks/CRON_TOPOLOGY.md now.
--
-- Prereq: Vault secret `service_role_key` (see 20260705100000).
-- Idempotent: cron.schedule upserts by jobname.
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
  fns text := 'https://hlykspakpewuilttnydm.supabase.co/functions/v1/';
BEGIN
  -- Order-confirmation safety net (see header warning).
  PERFORM cron.schedule('wa-confirmation-sweep', '*/15 * * * *', _cron_post(fns || 'wa-confirmation-sweep', 'service_role_key'));

  -- WA dead-man's switch: alerts Slack if wa-health heartbeats stop
  -- (token death, function outage). pg_cron-scheduled copy; the Vercel cron
  -- covers pg_cron's own death.
  PERFORM cron.schedule('wa-watchdog', '*/10 * * * *', _cron_post(fns || 'wa-watchdog', 'service_role_key'));
END $$;

DROP FUNCTION _cron_post(text, text);

-- Verify: select jobname, schedule from cron.job order by jobname;
