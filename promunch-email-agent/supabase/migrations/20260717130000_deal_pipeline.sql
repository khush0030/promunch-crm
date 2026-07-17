-- ═══════════════════════════════════════════════════════════════════════════
-- Deal pipeline: AI-scanned B2B/influencer deal tracker over hello@promunch.in
-- ═══════════════════════════════════════════════════════════════════════════
-- The deal-scan edge function reads the mailbox (Gmail API), groups mail into
-- threads, has OpenAI classify each conversation (company, kind, stage,
-- samples, next step) and upserts into these tables. The CRM page
-- /dashboard/deals reads them via the Next.js API (service role).
--
-- Spec: docs/plans/2026-07-17-deal-pipeline.md
-- APPLY MANUALLY in the Supabase dashboard SQL editor (CLI push does not work
-- for this project). Idempotent: safe to re-run.
-- PREREQUISITE (cron): Vault secret `service_role_key` must exist (it does —
-- the canonical cron migration 20260705100000 depends on it too).

-- ── deals ────────────────────────────────────────────────────────────────────
create table if not exists deals (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  company_domain text,
  kind text not null default 'other'
    check (kind in ('hotel_hospitality','corporate_pantry_gifting','retail_qcommerce',
                    'distribution_wholesale','influencer_collab','brand_partnership',
                    'events_expo','vendor_pitch','other')),
  contact_name text,
  contact_email text,
  stage text not null default 'new_inquiry'
    check (stage in ('new_inquiry','in_discussion','samples_requested','samples_sent',
                     'negotiation','won','lost','dormant')),
  stage_updated_at timestamptz not null default now(),
  samples_sent_at timestamptz,
  next_step text,
  next_step_owner text check (next_step_owner in ('us','them')),
  follow_up_needed boolean not null default false,
  follow_up_reason text,
  commercials text,
  summary text,
  notes text,
  last_email_at timestamptz,
  last_email_direction text check (last_email_direction in ('inbound','outbound')),
  first_email_at timestamptz,
  email_count int not null default 0,
  ai_confidence numeric,
  -- set when a human edits stage from the dashboard; the scanner then never
  -- moves the stage again (it still refreshes activity fields + follow-ups)
  manual_stage_override boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deals_stage_idx on deals (stage);
create index if not exists deals_follow_up_idx on deals (follow_up_needed) where follow_up_needed;
create index if not exists deals_domain_idx on deals (lower(company_domain)) where company_domain is not null;

-- ── deal_emails: message ledger (also the scanner's idempotency set) ─────────
-- deal_id null = message was scanned and judged not-a-deal; the unique
-- gmail_message_id makes every rescan a no-op.
create table if not exists deal_emails (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references deals(id) on delete cascade,
  gmail_message_id text not null unique,
  gmail_thread_id text not null,
  direction text not null check (direction in ('inbound','outbound')),
  from_email text,
  to_email text,
  subject text,
  snippet text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists deal_emails_deal_idx on deal_emails (deal_id) where deal_id is not null;
create index if not exists deal_emails_thread_idx on deal_emails (gmail_thread_id);

-- ── deal_scan_state: singleton cursor for the scanner ────────────────────────
create table if not exists deal_scan_state (
  id smallint primary key default 1 check (id = 1),
  backfill_done boolean not null default false,
  backfill_page_token text,
  watermark_ms bigint,               -- newest internalDate fully processed (incremental mode)
  last_run_at timestamptz,
  last_error text,
  threads_scanned int not null default 0,
  updated_at timestamptz not null default now()
);

insert into deal_scan_state (id) values (1) on conflict (id) do nothing;

-- ── updated_at triggers (shared touch_updated_at pattern) ────────────────────
create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array['deals','deal_scan_state'] loop
    execute format('drop trigger if exists %I on %I', t || '_touch', t);
    execute format(
      'create trigger %I before update on %I for each row execute function touch_updated_at()',
      t || '_touch', t
    );
  end loop;
end $$;

-- ── grants: service-role only (edge fn + Next.js API both use service role) ──
revoke all on deals, deal_emails, deal_scan_state from anon, authenticated;

-- ── cron: scan every 30 minutes ──────────────────────────────────────────────
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'deal-scan-every-30min',
  '*/30 * * * *',
  $cmd$select net.http_post(
    url := 'https://hlykspakpewuilttnydm.supabase.co/functions/v1/deal-scan',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{"trigger":"cron"}'::jsonb
  );$cmd$
);

-- Verify after applying:
--   select id, backfill_done, last_run_at from deal_scan_state;
--   select jobname, schedule from cron.job where jobname = 'deal-scan-every-30min';
--   \d deals
