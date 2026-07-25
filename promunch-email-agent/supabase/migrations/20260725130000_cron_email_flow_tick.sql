-- ============================================================
-- CRON: email-flow-tick (every 15 min)
--
-- Drains due flow_enrollments and sends the current step. This is the switch
-- that makes the abandoned-cart EMAIL arm live: shopify-wa enrols phone-less
-- checkouts into the active checkout_abandoned flow (migration 011), but
-- nothing sends until this tick runs.
--
-- Vercel Hobby blocks sub-daily crons, so this runs on pg_cron and POSTs the
-- Next.js route with the Vault-stored bearer, matching wa-campaign-tick and
-- b2b-leads-tick. See docs/runbooks/CRON_TOPOLOGY.md.
--
-- NOTE: the route reads process.env.CRON_SECRET on Vercel; that value must
-- equal vault.decrypted_secrets['cron_secret']. They had drifted apart, which
-- is why b2b-leads-tick was returning 401 on every firing (visible only in
-- net._http_response, never alerted). Aligned 2026-07-25.
--
-- The engine's own guards make a double firing safe: the (enrollment_id,
-- step_index) partial-unique index on email_sends is the atomic claim, so a
-- replayed step is skipped, not re-sent (AGENTS.md §4.1).
--
-- Apply by hand in the Supabase dashboard SQL editor (docs/runbooks/MIGRATIONS).
-- ============================================================

select cron.unschedule('email-flow-tick')
where exists (select 1 from cron.job where jobname = 'email-flow-tick');

select cron.schedule(
  'email-flow-tick',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://promunch-crm.vercel.app/api/cron/email-flow-tick',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
      'Content-Type', 'application/json'
    )
  );
  $$
);

-- Verify:
--   select jobname, schedule, active from cron.job where jobname = 'email-flow-tick';
--   select status_code, content from net._http_response order by created desc limit 5;
