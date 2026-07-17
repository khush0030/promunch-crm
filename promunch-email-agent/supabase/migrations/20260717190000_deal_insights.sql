-- Deal insights: AI relationship read per deal (willingness, sentiment,
-- emotions, drivers, risks, recommended move) for the compact deals page.
-- interest_temp is a plain column so the list can render/sort cheaply;
-- the full read lives in insights (jsonb).
-- Spec: docs/plans/2026-07-17-deal-pipeline.md
-- APPLY MANUALLY (or via `supabase db query --linked -f <file>`). Idempotent.

alter table deals
  add column if not exists interest_temp text
    check (interest_temp in ('hot','warm','cool')),
  add column if not exists insights jsonb;

-- Verify after applying:
--   select count(*) filter (where insights is not null) as analysed, count(*) from deals;
