-- shopify_orders has RLS enabled with no anon/authenticated policy, so the
-- browser sees zero rows even with the column grants from the previous migration.
-- Add a read-only policy so /dashboard/shopify-attribution can read rows.
--
-- SAFE: this policy controls ROW visibility, not COLUMN visibility. The column
-- grants in 20260606140000 still apply — anon/authenticated can only SELECT the
-- attribution columns; customer_email/phone/name/line_items/raw remain ungranted
-- and error on access. So this exposes attribution rows, never order PII.
-- The backend uses service_role, which bypasses RLS entirely — unaffected.

alter table shopify_orders enable row level security;  -- idempotent (already on)

drop policy if exists shopify_orders_attr_read on shopify_orders;
create policy shopify_orders_attr_read
  on shopify_orders
  for select
  to anon, authenticated
  using (true);
