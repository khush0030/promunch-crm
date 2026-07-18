-- ═══════════════════════════════════════════════════════════════════════════
-- wa_threads.last_activity_at — 2026-07-18 audit finding (REVISED ON APPLY)
--
-- The audit flagged that no migration in this repo ever creates
-- wa_threads.last_activity_at even though the inbox API orders by it. On
-- applying, production turned out to ALREADY have the column — added
-- out-of-band (hand-run SQL never recorded here) as a STORED GENERATED
-- column:
--
--   last_activity_at timestamptz
--     generated always as (greatest(last_inbound_at, last_outbound_at)) stored
--
-- That design is self-maintaining and correct ("inbox orders by last
-- activity, inbound OR outbound"), so this migration now simply RECORDS it
-- for fresh-database reproducibility and adds the missing sort index (which
-- production did not have). Threads with neither timestamp sort as NULL —
-- the API falls back to created_at ordering only if the column is absent.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'wa_threads'
       AND column_name = 'last_activity_at'
  ) THEN
    EXECUTE 'alter table public.wa_threads add column last_activity_at timestamptz
             generated always as (greatest(last_inbound_at, last_outbound_at)) stored';
  END IF;
END $$;

create index if not exists wa_threads_last_activity_idx
  on public.wa_threads (last_activity_at desc);

-- Verify:
--   select column_name, is_generated, generation_expression
--     from information_schema.columns
--    where table_name = 'wa_threads' and column_name = 'last_activity_at';
