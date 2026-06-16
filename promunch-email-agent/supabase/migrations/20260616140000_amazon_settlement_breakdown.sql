-- Settlement aggregates computed from the report's own line items.
-- gross_sales = Σ Principal; fees_total = Σ Amazon fees; refunds_total = Σ refund lines;
-- breakdown = per-description sums (Principal, Commission, FBA fees, Tax, …).
alter table amazon_settlements add column if not exists gross_sales   numeric not null default 0;
alter table amazon_settlements add column if not exists fees_total    numeric not null default 0;
alter table amazon_settlements add column if not exists refunds_total numeric not null default 0;
alter table amazon_settlements add column if not exists breakdown     jsonb;
