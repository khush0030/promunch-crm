-- Amazon SP-API mirror tables (orders, order items, FBA inventory, sync watermark).
-- Mirrors the Shopify pattern: edge function polls SP-API and upserts here; the
-- dashboard + Slack read from these tables, never from Amazon directly.

-- ---- Orders ----------------------------------------------------------------
create table if not exists amazon_orders (
  amazon_order_id           text primary key,
  order_status              text,
  purchase_date             timestamptz,
  last_update_date          timestamptz,
  order_total               numeric not null default 0,
  currency                  text not null default 'INR',
  fulfillment_channel       text,            -- AFN = FBA, MFN = merchant-fulfilled
  sales_channel             text,
  number_of_items_shipped   integer default 0,
  number_of_items_unshipped integer default 0,
  is_prime                  boolean default false,
  ship_service_level        text,
  -- internal Slack dedup ledger: set once a new-order alert is posted.
  alerted_at                timestamptz,
  -- line-items are fetched in a separate bounded pass (avoids WORKER_RESOURCE_LIMIT
  -- on wide first runs). false => this order still needs its items pulled.
  items_synced              boolean not null default false,
  raw                       jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index if not exists amazon_orders_purchase_date_idx on amazon_orders (purchase_date desc);
create index if not exists amazon_orders_status_idx on amazon_orders (order_status);
create index if not exists amazon_orders_unalerted_idx on amazon_orders (alerted_at) where alerted_at is null;

-- ---- Order line items ------------------------------------------------------
create table if not exists amazon_order_items (
  order_item_id    text primary key,
  amazon_order_id  text not null references amazon_orders (amazon_order_id) on delete cascade,
  seller_sku       text,
  asin             text,
  title            text,
  quantity_ordered integer default 0,
  item_price       numeric default 0,
  currency         text default 'INR',
  raw              jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists amazon_order_items_order_idx on amazon_order_items (amazon_order_id);
create index if not exists amazon_order_items_sku_idx on amazon_order_items (seller_sku);

-- ---- FBA inventory ---------------------------------------------------------
create table if not exists amazon_inventory (
  seller_sku             text primary key,
  asin                   text,
  fnsku                  text,
  product_name           text,
  total_quantity         integer default 0,
  fulfillable_quantity   integer default 0,
  reserved_quantity      integer default 0,
  inbound_working        integer default 0,
  inbound_shipped        integer default 0,
  inbound_receiving      integer default 0,
  -- low-stock Slack dedup: stamped when an alert fires; re-alert only after it clears + drops again.
  low_stock_alerted_at   timestamptz,
  raw                    jsonb,
  updated_at             timestamptz not null default now()
);
create index if not exists amazon_inventory_fulfillable_idx on amazon_inventory (fulfillable_quantity);

-- ---- Finances (settlement / fee events, flattened) -------------------------
create table if not exists amazon_finance_events (
  id               bigserial primary key,
  amazon_order_id  text,
  event_type       text,        -- e.g. Shipment, Refund, ServiceFee
  posted_date      timestamptz,
  principal        numeric default 0,
  fees             numeric default 0,
  net             numeric default 0,
  currency         text default 'INR',
  raw              jsonb,
  created_at       timestamptz not null default now(),
  -- dedup: the same event must not be inserted twice across re-polls.
  dedup_key        text unique
);
create index if not exists amazon_finance_order_idx on amazon_finance_events (amazon_order_id);
create index if not exists amazon_finance_posted_idx on amazon_finance_events (posted_date desc);

-- ---- Sync watermark --------------------------------------------------------
-- Single-row-per-key store for "last successful poll" timestamps so each run
-- only asks Amazon for what changed since last time.
create table if not exists amazon_sync_state (
  key        text primary key,   -- 'orders' | 'inventory' | 'finances'
  watermark  timestamptz,
  meta       jsonb,
  updated_at timestamptz not null default now()
);

-- Auto-bump updated_at on orders/inventory upserts.
create or replace function amazon_touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists amazon_orders_touch on amazon_orders;
create trigger amazon_orders_touch before update on amazon_orders
  for each row execute function amazon_touch_updated_at();

drop trigger if exists amazon_inventory_touch on amazon_inventory;
create trigger amazon_inventory_touch before update on amazon_inventory
  for each row execute function amazon_touch_updated_at();

-- ---- Lock down -------------------------------------------------------------
-- RLS on with NO anon/authenticated policy => the public anon key sees nothing.
-- The edge functions (service role) and the /api/amazon route (service role)
-- bypass RLS, so the dashboard reads through the server, never the browser.
-- This keeps `raw` (which can hold buyer info if a PII role is ever enabled)
-- off the public client entirely.
alter table amazon_orders         enable row level security;
alter table amazon_order_items    enable row level security;
alter table amazon_inventory      enable row level security;
alter table amazon_finance_events enable row level security;
alter table amazon_sync_state     enable row level security;
