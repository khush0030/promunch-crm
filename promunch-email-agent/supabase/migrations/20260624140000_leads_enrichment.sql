-- Stage 3 of the lead pipeline: company enrichment. After a site is crawled we
-- run an AI pass that profiles the company (what they do, scale, who to pitch,
-- specific hooks) and store it here as structured JSON. The cold-email drafter
-- reads it so outreach is sharply personalised instead of generic.
-- Apply via Supabase dashboard SQL editor.

alter table leads add column if not exists enrichment jsonb;
alter table leads add column if not exists enriched_at timestamptz;
