-- Flag HYPD "creator" seeding orders. HYPD gifts free product to creators as a
-- referral/influencer channel; those orders ride in at a token ₹0.01 total
-- (exactly 1 paisa). We tag them "HYPD Creator" natively in Shopify (so they're
-- filterable there) and flag them here so the CRM/dashboard can segment the
-- influencer channel and exclude ₹0.01 seeds from real-revenue reporting.

alter table shopify_orders
  add column if not exists is_creator boolean not null default false;

-- Backfill existing orders from the price signal (1 paisa total). Idempotent.
update shopify_orders set is_creator = true
  where is_creator = false and round(total_price * 100) = 1;

create index if not exists shopify_orders_creator_idx
  on shopify_orders (is_creator) where is_creator;

-- Dashboard reads shopify_orders via the anon key with column-level grants
-- (see 20260606140000_shopify_attribution_grants.sql). Expose the flag so the
-- CRM can segment the creator/influencer channel. Boolean, not PII — safe.
grant select (is_creator) on shopify_orders to anon, authenticated;
