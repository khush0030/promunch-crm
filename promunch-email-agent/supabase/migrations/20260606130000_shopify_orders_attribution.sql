-- Traffic attribution for Shopify orders.
--
-- The orders/create webhook payload does NOT carry the customer journey (UTM,
-- referrer, landing page) — that lives only on the Order's customerJourneySummary
-- in the Admin GraphQL API. We fetch it separately (see _shared/shopify-attribution.ts)
-- and store BOTH the first touch (discovery: "how did they find us") and the last
-- touch (conversion: "what closed the sale") so analytics can model either.

alter table shopify_orders
  -- Shopify's own sales channel for the order (web, pos, and HYPD's channel id, …)
  add column if not exists source_name        text,

  -- First touch — discovery
  add column if not exists first_utm_source    text,
  add column if not exists first_utm_medium    text,
  add column if not exists first_utm_campaign  text,
  add column if not exists first_utm_content   text,
  add column if not exists first_utm_term      text,
  add column if not exists first_source        text,   -- Shopify's classified source
  add column if not exists first_source_type   text,
  add column if not exists first_landing_page  text,
  add column if not exists first_referrer_url  text,
  add column if not exists first_referral_code text,
  add column if not exists first_visit_at      timestamptz,

  -- Last touch — conversion
  add column if not exists last_utm_source     text,
  add column if not exists last_utm_medium     text,
  add column if not exists last_utm_campaign   text,
  add column if not exists last_utm_content    text,
  add column if not exists last_utm_term       text,
  add column if not exists last_source         text,
  add column if not exists last_source_type    text,
  add column if not exists last_landing_page   text,
  add column if not exists last_referrer_url   text,
  add column if not exists last_visit_at       timestamptz,

  -- Journey shape
  add column if not exists moments_count        integer,
  add column if not exists days_to_conversion    integer,
  add column if not exists customer_order_index  integer,

  -- NULL = journey not yet fetched. Lets the backfill/cron find unsynced rows.
  add column if not exists attribution_synced_at timestamptz;

-- Backfill inserts historical orders that never hit the webhook; raw is NOT NULL
-- with no default, so give it one so attribution-only upserts can insert cleanly.
alter table shopify_orders alter column raw set default '{}'::jsonb;

create index if not exists shopify_orders_attr_synced_idx
  on shopify_orders (attribution_synced_at);
create index if not exists shopify_orders_first_utm_source_idx
  on shopify_orders (first_utm_source);
create index if not exists shopify_orders_last_utm_source_idx
  on shopify_orders (last_utm_source);

-- ---------------------------------------------------------------------------
-- Analytics view: revenue + orders grouped by FIRST-touch channel (discovery).
-- "utm:google/cpc/summer_sale" style buckets; NULL UTMs fall back to the
-- Shopify-classified source so direct/organic/referral still bucket cleanly.
-- ---------------------------------------------------------------------------
create or replace view shopify_attribution_summary as
select
  coalesce(first_utm_source, first_source, 'unknown')   as source,
  coalesce(first_utm_medium, first_source_type, 'none')  as medium,
  coalesce(first_utm_campaign, '(none)')                 as campaign,
  count(*)                                               as orders,
  count(*) filter (where customer_order_index <= 1)      as first_orders,
  sum(total_price)                                       as revenue,
  round(avg(total_price), 2)                             as aov,
  round(avg(days_to_conversion), 1)                      as avg_days_to_convert,
  min(shopify_created_at)                                as first_order_at,
  max(shopify_created_at)                                as last_order_at
from shopify_orders
group by 1, 2, 3
order by revenue desc nulls last;
