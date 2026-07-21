-- Deal kind was write-once after creation: a misclassified deal (e.g. an
-- influencer collab filed under hotel_hospitality) could never be corrected
-- by later scans. Mirror the stage pattern: the scanner may update kind
-- freely UNLESS a human set it from the dashboard.
alter table public.deals
  add column if not exists manual_kind_override boolean not null default false;
