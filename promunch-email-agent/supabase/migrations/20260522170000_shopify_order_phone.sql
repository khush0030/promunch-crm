-- Customer phone on shopify_orders, so the WhatsApp AI agent can match an
-- order to whoever is chatting — by their WhatsApp number, no asking.
--
-- customer_phone holds a normalised wa_id (digits only, India default): the
-- same shape as wa_threads.wa_id, so a join is a plain equality match.

alter table shopify_orders
  add column if not exists customer_phone text;

create index if not exists shopify_orders_phone_idx
  on shopify_orders (customer_phone) where customer_phone is not null;

-- Backfill existing rows from the raw Shopify payload. Mirrors toWaId() in
-- supabase/functions/_shared/journeys.ts: strip non-digits, drop a trunk 0,
-- prepend 91 for a bare 10-digit Indian mobile, keep 11–15 digit numbers.
update shopify_orders set customer_phone = sub.wa_id
from (
  select id, case
    when digits = ''                                          then null
    when length(digits) = 11 and left(digits, 1) = '0'        then '91' || substring(digits from 2)
    when length(digits) = 10                                  then '91' || digits
    when length(digits) between 11 and 15                     then digits
    else null
  end as wa_id
  from (
    select id, regexp_replace(
      coalesce(
        raw -> 'customer'         ->> 'phone',
        raw                       ->> 'phone',
        raw -> 'shipping_address' ->> 'phone',
        raw -> 'billing_address'  ->> 'phone',
        ''
      ), '\D', '', 'g') as digits
    from shopify_orders
  ) d
) sub
where shopify_orders.id = sub.id
  and shopify_orders.customer_phone is null;
