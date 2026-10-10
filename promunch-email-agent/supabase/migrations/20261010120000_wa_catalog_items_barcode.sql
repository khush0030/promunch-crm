-- Product feeds carry the GTIN (AI-visibility phase 1, task 5).
--
-- An audit found every Shopify product missing a GTIN. The owner is entering
-- the EAN-13 into each variant's Shopify "Barcode" field; shopify-catalog-sync
-- now copies that raw value here, and the Meta catalogue feed
-- (/api/public/meta-catalog) emits it as `gtin` only when it passes the GS1
-- check digit (src/lib/gtin.ts). Invalid or empty barcodes are stored as-is
-- (or null) and simply left out of the feed.
--
-- Deploy order is forgiving: both shopify-catalog-sync and the feed route
-- detect a missing `barcode` column and carry on without it, so the code may
-- ship before this file is pasted. Apply it, then wait for the next 30-minute
-- sync (or run it from the dashboard) to fill the column.
--
-- Apply by pasting into the Supabase dashboard SQL editor. Idempotent.
-- Verify:
--   select count(*) as variants,
--          count(barcode) as with_barcode,
--          count(*) filter (where barcode ~ '^[0-9]{13}$') as ean13_shaped
--   from wa_catalog_items where in_stock;
--   select retailer_id, title, barcode from wa_catalog_items order by sort;

alter table wa_catalog_items
  add column if not exists barcode text;

comment on column wa_catalog_items.barcode is
  'Raw Shopify variant Barcode (expected EAN-13 GTIN). Unvalidated here; the Meta feed emits it as gtin only when the GS1 check digit is valid.';
