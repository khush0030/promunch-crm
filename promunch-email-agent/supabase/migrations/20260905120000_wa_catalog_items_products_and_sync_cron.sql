-- WhatsApp bot: live Shopify product + inventory mirror.
--
-- 1. Creates wa_catalog_items (the 20260622160000 migration was never applied
--    in prod — table absent as of 2026-09-05) and extends it with the columns
--    the bot's lookup_product tool needs: product handle/URL, inventory count,
--    product-level grouping, description.
-- 2. Schedules shopify-catalog-sync on pg_cron every 30 minutes so stock and
--    prices stay current, and its generated "Live Product Catalog" KB doc is
--    re-embedded on every run.
--
-- Apply by pasting into the Supabase dashboard SQL editor. Idempotent.
-- After applying, run the sync once from the dashboard (/api/shopify/catalog)
-- or wait for the first cron tick, then verify:
--   select count(*), count(*) filter (where in_stock) from wa_catalog_items;
--   select name, status, chunk_count from kb_documents where name ilike 'Live Product Catalog%';
--   select jobname, schedule, active from cron.job where jobname = 'shopify-catalog-sync';

-- ── 1. Table (base definition from 20260622160000, unchanged) ───────────────
create table if not exists wa_catalog_items (
  retailer_id text primary key,          -- = Shopify variant id == Meta catalog retailer_id
  title       text not null,             -- short product name shown in list rows / logs
  category    text,                       -- groups items into product_list sections
  price_inr   numeric,                    -- optional, for the bot's own reasoning (cards show Meta price)
  in_stock    boolean not null default true,
  sort        integer not null default 0, -- lower = earlier within its category
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists wa_catalog_items_category_idx
  on wa_catalog_items (category, sort)
  where in_stock;

comment on table wa_catalog_items is
  'Thin mirror of the Shopify catalog for WhatsApp in-chat ordering and the bot''s lookup_product tool. retailer_id = Shopify variant id = Meta catalog retailer_id.';

alter table wa_catalog_items enable row level security;

-- ── 1b. Columns for lookup_product (product links + live inventory) ─────────
alter table wa_catalog_items
  add column if not exists product_id         text,     -- Shopify product numeric id (groups variants)
  add column if not exists product_title      text,     -- product title without the variant suffix
  add column if not exists variant_title      text,     -- "" for single-variant products
  add column if not exists handle             text,     -- Shopify product handle
  add column if not exists product_url        text,     -- https://promunch.in/products/<handle>
  add column if not exists inventory_quantity integer,  -- null when Shopify does not track it
  add column if not exists compare_at_inr     numeric,  -- struck-through MRP if set
  add column if not exists description        text,     -- plain-text description, truncated
  add column if not exists tags               text[] not null default '{}',
  add column if not exists last_synced_at     timestamptz;

create index if not exists wa_catalog_items_product_id_idx on wa_catalog_items (product_id);
create index if not exists wa_catalog_items_handle_idx     on wa_catalog_items (handle);

-- Trigram search so lookup_product can match "cream onion sticks" against
-- titles without exact wording. pg_trgm ships with Supabase.
create extension if not exists pg_trgm;
create index if not exists wa_catalog_items_title_trgm_idx
  on wa_catalog_items using gin (title gin_trgm_ops);

-- ── 2. pg_cron: shopify-catalog-sync every 30 min ───────────────────────────
-- Same vault-bearer pattern and literal project URL as
-- 20260705100000_cron_jobs_canonical.sql. cron.schedule() upserts by jobname.
select cron.schedule(
  'shopify-catalog-sync',
  '*/30 * * * *',
  $cmd$select net.http_post(
    url := 'https://hlykspakpewuilttnydm.supabase.co/functions/v1/shopify-catalog-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );$cmd$
);

-- ── 3. pg_cron: nightly kb-embed so kb_chunks can never drift from raw_text
-- again (they were three months stale on 2026-09-05). wa-ai-reply now reads
-- raw_text directly while the KB fits its budget; this keeps the semantic
-- path correct for when it does not.
select cron.schedule(
  'kb-embed-nightly',
  '15 2 * * *',
  $cmd$select net.http_post(
    url := 'https://hlykspakpewuilttnydm.supabase.co/functions/v1/kb-embed',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );$cmd$
);
