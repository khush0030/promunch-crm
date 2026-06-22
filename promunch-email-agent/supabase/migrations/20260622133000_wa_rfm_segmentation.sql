-- RFM segmentation for WhatsApp bulk campaigns.
--
-- Rolls up shopify_orders by customer_phone (a normalised wa_id, same shape as
-- wa_contacts.wa_id) into Recency / Frequency / Monetary, assigns one tier, and
-- writes it as an `rfm:<tier>` tag onto wa_contacts. The campaign sender
-- (wa-campaign-send) already filters audience by tag overlap, so segmenting a
-- blast is just `audience_filter: {tags: ['rfm:vip']}`.
--
-- HYPD creator seeds (₹0.01 orders, is_creator=true) are excluded — they are
-- not real customers. See memory: hypd-creator-tagging.

------------------------------------------------------------------------
-- View: wa_customer_rfm
--   One row per buyer phone. Tier precedence is first-match top-to-bottom.
------------------------------------------------------------------------
create or replace view wa_customer_rfm as
with agg as (
  select
    customer_phone                                          as wa_id,
    count(*)::int                                           as order_count,
    coalesce(sum(total_price), 0)                           as total_spent,
    max(shopify_created_at)                                 as last_order_at,
    (current_date - max(shopify_created_at)::date)::int     as recency_days,
    (array_agg(customer_name order by shopify_created_at desc)
       filter (where customer_name is not null and customer_name <> ''))[1]
                                                            as customer_name
  from shopify_orders
  where customer_phone is not null
    and coalesce(is_creator, false) = false
  group by customer_phone
)
select
  agg.*,
  case
    when total_spent >= 3000 or order_count >= 5      then 'rfm:vip'
    when recency_days > 180                           then 'rfm:dormant'
    when recency_days between 91 and 180              then 'rfm:at_risk'
    when order_count >= 2                             then 'rfm:loyal'      -- recency <= 90 implied
    when order_count = 1 and recency_days <= 30       then 'rfm:new'
    else                                                  'rfm:one_time'    -- 1 order, 31-90 days
  end as rfm_tier
from agg;

comment on view wa_customer_rfm is
  'Per-customer RFM rollup from shopify_orders (excludes HYPD creators). rfm_tier is the segment tag.';

------------------------------------------------------------------------
-- Function: recompute_wa_rfm_tags()
--   Upserts wa_contacts from the view: creates rows for phone-only buyers
--   who never messaged us, and (re)writes the single rfm:* tag on everyone.
--   Idempotent — safe to run nightly. Returns rows affected.
--
--   Tag handling: strips any existing rfm:* tags, keeps all manual tags,
--   appends the freshly-computed tier. WA profile name wins over Shopify name.
------------------------------------------------------------------------
create or replace function recompute_wa_rfm_tags()
returns integer
language plpgsql
security definer
as $$
declare
  affected integer;
begin
  insert into wa_contacts (wa_id, phone, name, tags, opted_in)
  select
    r.wa_id,
    '+' || r.wa_id,
    r.customer_name,
    array[r.rfm_tier],
    true
  from wa_customer_rfm r
  on conflict (wa_id) do update
  set tags = (
        select coalesce(array_agg(t), '{}')
        from unnest(wa_contacts.tags) t
        where t not like 'rfm:%'
      ) || array[excluded.tags[1]],
      name       = coalesce(wa_contacts.name, excluded.name),
      updated_at = now();

  get diagnostics affected = row_count;
  return affected;
end;
$$;

comment on function recompute_wa_rfm_tags() is
  'Backfill + refresh: upserts wa_contacts from wa_customer_rfm and rewrites rfm:* tags. Run nightly via wa-rfm-tick.';
