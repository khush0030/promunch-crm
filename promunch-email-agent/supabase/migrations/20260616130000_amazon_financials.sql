-- Amazon financials + settlement reconciliation.
-- Builds on 20260616120000_amazon_tables.sql.

-- (idempotent safety net in case the base migration ran before items_synced was added)
alter table amazon_orders add column if not exists items_synced boolean not null default false;

-- ---- Richer per-order economics on the finance ledger ----------------------
-- gross  = buyer paid; promo = discounts (neg); fees (neg) split by kind; net = payout contribution.
alter table amazon_finance_events add column if not exists gross        numeric not null default 0;
alter table amazon_finance_events add column if not exists promo        numeric not null default 0;
alter table amazon_finance_events add column if not exists referral_fee numeric not null default 0;
alter table amazon_finance_events add column if not exists fba_fee      numeric not null default 0;
alter table amazon_finance_events add column if not exists other_fees   numeric not null default 0;

-- ---- Settlements (bank-truth: what Amazon actually deposited) ---------------
create table if not exists amazon_settlements (
  settlement_id   text primary key,
  currency        text default 'INR',
  total_deposit   numeric,            -- the amount Amazon paid to the bank (report summary row)
  period_start    timestamptz,
  period_end      timestamptz,
  deposit_date    timestamptz,
  line_sum        numeric,            -- sum of all detail-line amounts (should equal total_deposit)
  computed_net    numeric,            -- our derived net from finance events over the same period
  variance        numeric,            -- computed_net - total_deposit  (≈0 when reconciled)
  reconciled      boolean default false,
  recon_note      text,
  alerted_at      timestamptz,        -- Slack dedup for variance alerts
  raw_summary     jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists amazon_settlements_deposit_idx on amazon_settlements (deposit_date desc);
create index if not exists amazon_settlements_unreconciled_idx on amazon_settlements (reconciled) where reconciled = false;

create table if not exists amazon_settlement_lines (
  id                 bigserial primary key,
  settlement_id      text not null references amazon_settlements (settlement_id) on delete cascade,
  line_index         integer not null,   -- row position in the report, for dedup
  amazon_order_id    text,
  transaction_type   text,
  amount_type        text,
  amount_description text,
  amount             numeric default 0,
  posted_date        timestamptz,
  unique (settlement_id, line_index)
);
create index if not exists amazon_settlement_lines_settlement_idx on amazon_settlement_lines (settlement_id);
create index if not exists amazon_settlement_lines_order_idx on amazon_settlement_lines (amazon_order_id);

-- Track which settlement reports we've already ingested.
create table if not exists amazon_report_state (
  report_document_id text primary key,
  report_type        text,
  ingested_at        timestamptz not null default now()
);

create trigger amazon_settlements_touch before update on amazon_settlements
  for each row execute function amazon_touch_updated_at();

-- Lock down (RLS on, no anon policy — read via service-role API route only).
alter table amazon_settlements      enable row level security;
alter table amazon_settlement_lines enable row level security;
alter table amazon_report_state     enable row level security;
