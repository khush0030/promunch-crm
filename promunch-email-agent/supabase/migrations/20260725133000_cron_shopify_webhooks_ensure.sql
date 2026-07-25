-- ============================================================
-- CRON: shopify-webhooks-ensure (daily, self-healing)
--
-- The abandoned-cart pipeline died because a Shopify webhook subscription went
-- missing and NOTHING could see it: no error, no event, no alert. Cart
-- enrolment just decayed to ~0.5/day against ~6/day of real abandoned checkouts
-- and looked, from inside the database, exactly like "not many people abandon
-- carts".
--
-- This runs the auditor daily with POST, so a missing checkouts/* subscription
-- is re-registered automatically and logged to connector_events as
-- webhook_subscription_repaired. A gap it cannot fix logs
-- webhook_subscription_gap at level 'error', which surfaces on the dashboard.
--
-- POST is safe to repeat: the auditor only creates a subscription that is
-- absent, and only for checkouts/* (orders/* is audit-only — it already works
-- through another app and must not gain a second delivery path).
--
-- Apply by hand in the Supabase dashboard SQL editor (docs/runbooks/MIGRATIONS).
-- ============================================================

select cron.unschedule('shopify-webhooks-ensure')
where exists (select 1 from cron.job where jobname = 'shopify-webhooks-ensure');

select cron.schedule(
  'shopify-webhooks-ensure',
  '15 4 * * *',   -- 09:45 IST daily
  $$
  select net.http_post(
    url := 'https://hlykspakpewuilttnydm.supabase.co/functions/v1/shopify-webhooks-ensure',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    )
  );
  $$
);

-- Verify:
--   select jobname, schedule, active from cron.job where jobname = 'shopify-webhooks-ensure';
--   select * from connector_events where event like 'webhook_subscription%' order by created_at desc;
