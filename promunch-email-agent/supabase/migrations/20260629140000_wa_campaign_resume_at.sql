-- Cap-aware multi-day campaign sending. A big list can't clear Meta's daily
-- marketing tier (~250/day for this number) in one go, so a campaign sends up
-- to the cap each day, defers the rest, and resumes the next day until every
-- contact is reached. resume_at is when the next daily wave may start; while it
-- is in the future the worker leaves the campaign dormant.
--
-- Run ONCE in the Supabase SQL editor.

alter table wa_campaigns
  add column if not exists resume_at timestamptz;
