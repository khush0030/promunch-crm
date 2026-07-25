-- ============================================================
-- 012 — MAKE THE FLOW-ENROLMENT DEDUP INDEX USABLE AS AN ON CONFLICT TARGET
--
-- Migration 009 created the enrolment dedup index as a PARTIAL index:
--
--   CREATE UNIQUE INDEX ... ON flow_enrollments (flow_id, dedup_key)
--     WHERE dedup_key IS NOT NULL;
--
-- Postgres will only match an ON CONFLICT target to a partial index when the
-- statement repeats the index predicate. enrolEmailFlow() enrols through
-- PostgREST:
--
--   .upsert({...}, { onConflict: "flow_id,dedup_key", ignoreDuplicates: true })
--
-- which emits `ON CONFLICT (flow_id, dedup_key) DO NOTHING` with NO predicate,
-- so every enrolment would have failed with
--   42P10: there is no unique or exclusion constraint matching the ON CONFLICT
--          specification
-- and shopify-wa swallows it (the enrol call is wrapped in try/catch and only
-- console.warn's). The email cart arm would have looked "switched on" and
-- quietly enrolled nobody — the same silent-failure shape as the missing
-- checkouts/* webhook.
--
-- A plain UNIQUE index is behaviourally identical here: Postgres treats NULLs as
-- distinct, so rows with a NULL dedup_key can still coexist freely, which is all
-- the WHERE clause was buying. It just also works as a conflict target.
--
-- Apply by hand in the Supabase dashboard SQL editor (docs/runbooks/MIGRATIONS).
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_flow_enrollments_flow_dedup_v2
  ON flow_enrollments (flow_id, dedup_key);

DROP INDEX IF EXISTS idx_flow_enrollments_flow_dedup;

-- Verify (expect idx_flow_enrollments_flow_dedup_v2, no WHERE clause):
--   select indexname, indexdef from pg_indexes
--   where tablename = 'flow_enrollments' and indexname like '%dedup%';
