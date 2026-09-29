-- 20260930110000_email_engine_guards.sql
-- Email flow engine guards: A/B variant ledger + frequency-cap setting +
-- indexes for the cross-program "emailed recently?" lookup.
--
-- Apply by hand in the Supabase dashboard SQL editor (AGENTS.md §3).
-- Idempotent: safe to run twice. Additive only; the app code tolerates this
-- migration being unapplied (variant insert retries without the column,
-- freq_cap_hours falls back to env EMAIL_FREQ_CAP_HOURS, else 16).

-- ── A/B testing: which subject/preview variant a flow step sent ─────────────
-- 'A' = the step's own subject/preview, 'B'.. = subject_variants/preview_variants.
-- Null = the step had no A/B test (or the send predates this migration).
alter table email_sends add column if not exists variant text;

create index if not exists idx_email_sends_flow_step_variant
  on email_sends (flow_id, step_index, variant);

-- ── Frequency cap ("smart sending") ─────────────────────────────────────────
-- Hours a contact must go without ANY marketing email (flow step or campaign)
-- before another program emails them. 0 disables. Null = use env/default 16.
alter table email_studio_settings add column if not exists freq_cap_hours integer;

do $$ begin
  alter table email_studio_settings add constraint email_studio_settings_freq_cap_hours_check
    check (freq_cap_hours is null or (freq_cap_hours >= 0 and freq_cap_hours <= 336));
exception when duplicate_object then null; end $$;

-- Recent-send lookups by contact + time (flow tick batch + campaign audience).
create index if not exists idx_email_sends_contact_sent
  on email_sends (contact_id, sent_at desc);
create index if not exists idx_campaign_emails_contact_sent
  on campaign_emails (contact_id, sent_at desc);

-- Verify:
--   select column_name from information_schema.columns
--    where table_name in ('email_sends','email_studio_settings')
--      and column_name in ('variant','freq_cap_hours');
--   select indexname from pg_indexes
--    where indexname in ('idx_email_sends_flow_step_variant',
--                        'idx_email_sends_contact_sent',
--                        'idx_campaign_emails_contact_sent');
