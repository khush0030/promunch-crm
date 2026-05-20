-- Shopify orders capture for Slack notifications + daily/MTD totals.

create table if not exists shopify_orders (
  id              bigserial primary key,
  shopify_id      bigint unique not null,
  order_number    text not null,
  total_price     numeric(12,2) not null,
  subtotal_price  numeric(12,2),
  currency        text not null default 'INR',
  financial_status text,
  customer_email  text,
  customer_name   text,
  line_items      jsonb not null default '[]'::jsonb,
  shopify_created_at timestamptz not null,
  raw             jsonb not null,
  created_at      timestamptz not null default now()
);

create index if not exists shopify_orders_created_idx on shopify_orders (shopify_created_at desc);
