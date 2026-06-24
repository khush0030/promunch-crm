-- Per-scrape product targeting: which PROMUNCH product(s) this scrape's cold
-- emails should pitch (Edamame, Soya Crunchies, Soya Sticks, Soya Chips...).
-- Stored on the search and copied to each lead so (re)drafting features them.
-- Apply via Supabase dashboard SQL editor.

alter table lead_searches add column if not exists products text[];
alter table leads add column if not exists products text[];
