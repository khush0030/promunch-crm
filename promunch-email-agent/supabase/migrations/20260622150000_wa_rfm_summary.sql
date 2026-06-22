-- Segment-overview aggregate for the campaigns dashboard.
-- One row per RFM tier: customer count + total spend + avg recency.
-- Server-side aggregation so counts are exact (a tier can exceed the
-- PostgREST 1000-row response cap). Reads the wa_customer_rfm view from
-- migration 20260622133000_wa_rfm_segmentation.

create or replace function wa_rfm_summary()
returns table (
  rfm_tier    text,
  customers   bigint,
  spend       numeric,
  avg_recency numeric
)
language sql
stable
as $$
  select
    rfm_tier,
    count(*)::bigint              as customers,
    coalesce(sum(total_spent), 0) as spend,
    round(avg(recency_days), 0)   as avg_recency
  from wa_customer_rfm
  group by rfm_tier;
$$;

comment on function wa_rfm_summary() is
  'Per-RFM-tier rollup (customers, spend, avg recency) for the WhatsApp campaigns segment overview.';
