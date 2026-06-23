-- Capture a per-scrape outreach brief (what we're pitching + an optional
-- subject-line hint) so cold-email drafts lead with the user's chosen offer
-- instead of the AI guessing the angle. Stored on the search and copied onto
-- each lead at discovery so per-lead (re)drafting can read it too.
-- Apply via Supabase dashboard SQL editor.

alter table lead_searches add column if not exists offer text;
alter table lead_searches add column if not exists subject_hint text;

alter table leads add column if not exists offer text;
alter table leads add column if not exists subject_hint text;
