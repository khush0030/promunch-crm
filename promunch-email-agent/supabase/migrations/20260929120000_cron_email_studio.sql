-- ============================================================
-- CRON: Email Studio (email-campaign-tick every 5 min, attribution nightly)
--
-- email-campaign-tick drains campaigns whose scheduled_at has passed. It was
-- written in July (20260722120000) but never scheduled in prod, so a
-- "Scheduled" campaign would have sat forever. sendCampaign() takes the
-- atomic scheduled -> sending claim and a unique (campaign_id, contact_id)
-- claim row per recipient (migration 016), so an overlapping tick can never
-- send twice (AGENTS.md §4.1).
--
-- email-attribution-tick credits Shopify orders to the email that drove them
-- (UTM first, else a click in the prior 5 days). Read-only on orders.
--
-- Vercel Hobby blocks sub-daily crons, so these run on pg_cron and POST the
-- Next.js routes with the Vault bearer (see docs/runbooks/CRON_TOPOLOGY.md).
-- Offset from :00/:10 to stay out of the pg_cron stampede.
--
-- Apply by hand in the Supabase dashboard SQL editor (docs/runbooks/MIGRATIONS).
-- ============================================================

select cron.unschedule('email-campaign-tick')
where exists (select 1 from cron.job where jobname = 'email-campaign-tick');

select cron.schedule(
  'email-campaign-tick',
  '2-59/5 * * * *',
  $$
  select net.http_post(
    url := 'https://promunch-crm.vercel.app/api/cron/email-campaign-tick',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 5000
  );
  $$
);

select cron.unschedule('email-attribution-tick')
where exists (select 1 from cron.job where jobname = 'email-attribution-tick');

select cron.schedule(
  'email-attribution-tick',
  '17 */3 * * *',
  $$
  select net.http_post(
    url := 'https://promunch-crm.vercel.app/api/cron/email-attribution-tick',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 5000
  );
  $$
);
