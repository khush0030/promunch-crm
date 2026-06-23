-- Link each lead to the exact discovery search that found it, so the dashboard
-- "Scrape history" can show precisely which leads a given run produced (instead
-- of matching loosely on category+city). Apply via Supabase dashboard SQL editor.

alter table leads add column if not exists search_id uuid references lead_searches(id) on delete set null;
create index if not exists leads_search_idx on leads (search_id);

-- Backfill existing leads to their search via the unique (category, city) pair.
update leads l
set search_id = s.id
from lead_searches s
where l.search_id is null
  and l.category = s.category
  and l.city = s.city;
