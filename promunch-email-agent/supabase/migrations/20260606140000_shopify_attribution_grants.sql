-- Expose ONLY the attribution analytics columns of shopify_orders to the browser
-- (anon/authenticated) so the /dashboard/shopify-attribution page can read them.
--
-- Deliberately column-level: customer PII (customer_email, customer_phone,
-- customer_name, line_items, raw) is NOT granted, so the public anon key cannot
-- read order PII through PostgREST — only the aggregate-friendly attribution
-- fields. This is tighter than the legacy contacts/campaigns tables (which are
-- fully anon-readable); keep it that way.

grant select (
  shopify_id,
  order_number,
  total_price,
  subtotal_price,
  currency,
  financial_status,
  shopify_created_at,
  source_name,
  first_utm_source, first_utm_medium, first_utm_campaign, first_utm_content, first_utm_term,
  first_source, first_source_type, first_landing_page, first_referrer_url, first_referral_code, first_visit_at,
  last_utm_source, last_utm_medium, last_utm_campaign, last_utm_content, last_utm_term,
  last_source, last_source_type, last_landing_page, last_referrer_url, last_visit_at,
  moments_count, days_to_conversion, customer_order_index, attribution_synced_at
) on shopify_orders to anon, authenticated;

-- The pre-aggregated view (groups by first-touch channel). Granting the view is
-- safe — it only emits aggregates, never PII.
grant select on shopify_attribution_summary to anon, authenticated;
