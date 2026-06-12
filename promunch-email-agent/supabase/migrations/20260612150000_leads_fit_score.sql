-- AI "ProMunch fit" score per lead (0-100, gpt-4o-mini, scored after crawl).
-- Apply via Supabase dashboard SQL editor.

alter table leads add column if not exists fit_score int;
alter table leads add column if not exists fit_reason text;
create index if not exists leads_fit_idx on leads (fit_score desc nulls last);
