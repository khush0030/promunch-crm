-- ═══════════════════════════════════════════════════════════════════════════
-- RLS LOCKDOWN — 2026-07-18 production audit, finding S1/S2 (CRITICAL)
--
-- Every table created May–June 2026 in this migration set shipped with NO row
-- level security and NO grant changes. Supabase's default grants expose
-- public-schema tables to the `anon` and `authenticated` roles over PostgREST,
-- so anyone holding the public anon key (it ships in the dashboard's browser
-- bundle on a public login page) could read — and write — customer chat
-- transcripts (wa_messages), support email bodies (email_threads), the B2B
-- pipeline, and, worst of all, oauth_tokens (plaintext Gmail refresh token
-- for hello@promunch.in = full mailbox takeover).
--
-- Model applied here (matches app-set 004_lock_anon_rls.sql and the
-- shopify_orders grants):
--   • RLS ON everywhere, all direct access revoked from anon.
--   • Staff-visible tables get a SELECT-only policy for `authenticated`
--     (the dashboard team; domain-allowlisted at signup + middleware).
--     Writes stay service_role-only (edge functions / API routes).
--   • Secret-bearing or purely-internal tables (oauth_tokens, gmail_watch,
--     job queues, claim ledgers, outreach_settings) get NO policies at all:
--     service_role only.
--
-- Idempotent: drop policy if exists before create. Safe to re-run.
--
-- AFTER APPLYING: also rotate the Google OAuth refresh token if
-- `select count(*) from oauth_tokens` was ever reachable with the anon key
-- (assume it was — run the re-OAuth flow in promunch-email-agent/CLAUDE.md §6).
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  staff_read text[] := ARRAY[
    'wa_contacts','wa_threads','wa_messages','wa_templates','wa_campaigns',
    'wa_journey_runs','wa_catalog_items','wa_short_links','wa_link_clicks',
    'kb_documents','kb_chunks',
    'email_threads','draft_revisions','sent_replies','email_logs','brand_knowledge',
    'connector_events',
    'lead_searches','leads','lead_contacts','lead_lists','lead_list_members',
    'outreach_drafts','outreach_events','outreach_replies','suppressions',
    'email_templates','email_sequences','email_sequence_steps','sequence_enrollments',
    'ig_threads','ig_messages','ig_settings'
  ];
  service_only text[] := ARRAY[
    'oauth_tokens','gmail_watch',
    'wa_jobs','ig_jobs',
    'wa_confirmation_claims','wa_reply_claims','ig_reply_claims',
    'outreach_settings'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY staff_read LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'skipping missing table %', t;
      CONTINUE;
    END IF;
    EXECUTE format('alter table public.%I enable row level security', t);
    EXECUTE format('revoke all on public.%I from anon', t);
    EXECUTE format('revoke insert, update, delete on public.%I from authenticated', t);
    EXECUTE format('drop policy if exists %I on public.%I', t || '_staff_read', t);
    EXECUTE format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_staff_read', t);
  END LOOP;

  FOREACH t IN ARRAY service_only LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'skipping missing table %', t;
      CONTINUE;
    END IF;
    EXECUTE format('alter table public.%I enable row level security', t);
    EXECUTE format('revoke all on public.%I from anon', t);
    EXECUTE format('revoke all on public.%I from authenticated', t);
  END LOOP;
END $$;

-- Verification (run after applying; both must return zero rows):
--   select tablename from pg_tables
--    where schemaname = 'public' and rowsecurity = false;
--   select table_name, grantee, privilege_type
--     from information_schema.role_table_grants
--    where grantee = 'anon' and table_schema = 'public'
--      and table_name in ('oauth_tokens','wa_messages','email_threads','leads');
