-- Meta Commerce catalogue feed needs an image and a SKU per variant.
--
-- The feed at /api/public/meta-catalog.csv is built from wa_catalog_items and
-- Meta rejects any row without an image_link, so shopify-catalog-sync now
-- captures the variant image (falling back to the product's featured image)
-- and the SKU.
--
-- Apply by pasting into the Supabase dashboard SQL editor. Idempotent.
-- Verify:
--   select count(*) filter (where image_url is not null) as with_image,
--          count(*) from wa_catalog_items;

alter table wa_catalog_items
  add column if not exists image_url text,
  add column if not exists sku       text;

comment on column wa_catalog_items.image_url is
  'Variant image, falling back to the product featured image. Required by the Meta catalogue feed.';
