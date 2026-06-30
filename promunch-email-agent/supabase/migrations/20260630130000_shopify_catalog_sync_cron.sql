-- Nightly Shopify → catalog + KB sync.
--
-- shopify-catalog-sync mirrors the live Shopify catalog into wa_catalog_items
-- (the WhatsApp ordering cards) AND rebuilds the generated "Live Product
-- Catalog" kb_documents row + re-embeds it, so the bot answers product
-- questions from current Shopify. Run it once a day at 01:00 IST (19:30 UTC).
--
-- Requires pg_cron + pg_net (both standard on Supabase). The function is
-- verify_jwt=false, but the gateway still needs an apikey header — we pass the
-- service-role key from Vault so it is never written into the cron definition.
--
-- ONE-TIME (run once, replace the value with your real service-role key):
--   select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent: drop any prior copy before (re)scheduling.
select cron.unschedule('shopify-catalog-sync-nightly')
where exists (select 1 from cron.job where jobname = 'shopify-catalog-sync-nightly');

select cron.schedule(
  'shopify-catalog-sync-nightly',
  '30 19 * * *',                       -- 19:30 UTC = 01:00 IST daily
  $$
  select net.http_post(
    url     := 'https://hlykspakpewuilttnydm.supabase.co/functions/v1/shopify-catalog-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);
