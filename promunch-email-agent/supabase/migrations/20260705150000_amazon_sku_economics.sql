-- Per-SKU unit economics for the Amazon dashboard.
--
-- amazon_finance_events stores money at ORDER level; the per-item detail
-- (SKU, qty, each fee) only lives inside raw.ShipmentItemList. This migration
-- adds a flattened per-item ledger so the dashboard can answer "what does
-- Amazon take per unit of SKU X and what do we keep" without JSON spelunking.
--
-- amazon_sku_costs is the one input Amazon can't give us: our own cost of
-- goods per unit. Edited from the dashboard; joined into the margins view.

-- ---- Per-item finance ledger -------------------------------------------------
create table if not exists amazon_finance_item_events (
  id               bigserial primary key,
  amazon_order_id  text,
  order_item_id    text,
  event_type       text,               -- Shipment | Refund
  posted_date      timestamptz,
  seller_sku       text,
  quantity         integer default 0,
  principal        numeric not null default 0,  -- item price the buyer paid (ex tax)
  tax              numeric not null default 0,  -- product/shipping tax collected
  other_charges    numeric not null default 0,  -- shipping, giftwrap, TCS/TDS withheld, …
  gross            numeric not null default 0,  -- Σ all charges (= what flows in)
  promo            numeric not null default 0,  -- discounts (negative)
  referral_fee     numeric not null default 0,  -- Commission (negative)
  fba_fee          numeric not null default 0,  -- FBA pick&pack + weight handling (negative)
  closing_fee      numeric not null default 0,  -- fixed/variable closing fee (negative)
  other_fees       numeric not null default 0,  -- tech fee, chargebacks, misc (negative)
  net              numeric not null default 0,  -- gross + promo + all fees
  currency         text default 'INR',
  -- re-polls and backfills must never double-insert the same item event
  dedup_key        text unique
);
create index if not exists afie_sku_idx    on amazon_finance_item_events (seller_sku);
create index if not exists afie_posted_idx on amazon_finance_item_events (posted_date desc);
create index if not exists afie_order_idx  on amazon_finance_item_events (amazon_order_id);

-- ---- Cost of goods per SKU (manual input) ------------------------------------
create table if not exists amazon_sku_costs (
  seller_sku    text primary key,
  cost_per_unit numeric not null default 0,   -- our landed cost per sellable unit
  note          text,
  updated_at    timestamptz not null default now()
);

drop trigger if exists amazon_sku_costs_touch on amazon_sku_costs;
create trigger amazon_sku_costs_touch before update on amazon_sku_costs
  for each row execute function amazon_touch_updated_at();

-- ---- Settlement lines: keep the SKU + qty the report already carries ----------
alter table amazon_settlement_lines add column if not exists sku text;
alter table amazon_settlement_lines add column if not exists quantity integer;

-- ---- Lock down (same posture as the other amazon_* tables) --------------------
alter table amazon_finance_item_events enable row level security;
alter table amazon_sku_costs           enable row level security;
