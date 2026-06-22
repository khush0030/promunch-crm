-- WhatsApp catalog mirror — the lightweight bridge for in-chat ordering.
--
-- The rich product cards (image, price, description) live in the Meta Commerce
-- catalog and are rendered by WhatsApp itself. This table is only a thin mirror
-- of {retailer_id, title, category} so the AI agent knows WHICH retailer_ids to
-- put in a product_list message and can group them into sections. The
-- show_products tool in wa-ai-reply reads this table.
--
-- INVARIANT: retailer_id == the Shopify variant numeric id, AND matches the
-- `retailer_id` (a.k.a "Content ID") of the same item in the Meta catalog. That
-- single shared id is what lets a WhatsApp cart become a Shopify checkout link
-- with zero product-API lookups.

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
  'Thin mirror of the Meta Commerce catalog for WhatsApp in-chat ordering. retailer_id = Shopify variant id = Meta catalog retailer_id.';

-- Service role only (edge functions). No anon access — internal catalog routing.
alter table wa_catalog_items enable row level security;
