-- Deal scan: event-driven sync + run lock.
-- gmail-webhook / gmail-poll now nudge deal-scan whenever new mail lands;
-- running_since is a soft lock (3-min lease) so concurrent nudges cannot
-- double-process a thread and create duplicate deals.
-- Spec: docs/plans/2026-07-17-deal-pipeline.md
-- APPLY MANUALLY in the Supabase dashboard SQL editor. Idempotent.

alter table deal_scan_state
  add column if not exists running_since timestamptz;

-- Verify after applying:
--   select id, running_since from deal_scan_state;
