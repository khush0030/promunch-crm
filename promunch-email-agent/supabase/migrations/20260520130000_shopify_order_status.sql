alter table shopify_orders
  add column if not exists fulfillment_status text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists refunded_amount numeric(12,2) not null default 0,
  add column if not exists slack_thread_ts text;
