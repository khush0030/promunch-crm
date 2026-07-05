-- ═══════════════════════════════════════════════════════════════════════════
-- B2B Leads v2: saved lead lists, email templates, sequences (auto follow-ups),
-- enrollments, and the hourly pg_cron driver.
--
-- Spec: docs/superpowers/specs/2026-07-05-b2b-leads-v2-design.md
-- Idempotent: safe to re-run.
--
-- PREREQUISITE (once): Vault secret `cron_secret` must equal the CRON_SECRET
-- env var on the Vercel project (already required by wa-campaign-tick):
--   select vault.create_secret('<CRON_SECRET>', 'cron_secret');
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Lists ────────────────────────────────────────────────────────────────────
create table if not exists lead_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  source_search_id uuid references lead_searches(id) on delete set null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists lead_list_members (
  list_id uuid not null references lead_lists(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (list_id, lead_id)
);
create index if not exists lead_list_members_lead_idx on lead_list_members (lead_id);

-- ── Templates ────────────────────────────────────────────────────────────────
create table if not exists email_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null,
  body_text text not null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Sequences ────────────────────────────────────────────────────────────────
create table if not exists email_sequences (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'draft' check (status in ('draft','active','paused','archived')),
  stop_on_reply boolean not null default true,
  ai_polish boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists email_sequence_steps (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references email_sequences(id) on delete cascade,
  position int not null,
  template_id uuid not null references email_templates(id),
  wait_days int not null default 0 check (wait_days >= 0),
  unique (sequence_id, position)
);

create table if not exists sequence_enrollments (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references email_sequences(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  contact_id uuid not null references lead_contacts(id),
  list_id uuid references lead_lists(id) on delete set null,
  status text not null default 'active'
    check (status in ('active','sending','completed','replied','bounced','stopped')),
  current_step int not null default 0,
  next_send_at timestamptz,
  last_sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sequence_id, lead_id)
);
create index if not exists seq_enroll_due_idx on sequence_enrollments (next_send_at) where status = 'active';
create index if not exists seq_enroll_lead_idx on sequence_enrollments (lead_id);

-- ── Wire sequence sends through the existing draft/send/webhook machinery ───
alter table outreach_drafts add column if not exists enrollment_id uuid references sequence_enrollments(id) on delete set null;
alter table outreach_drafts add column if not exists step_position int;
create index if not exists outreach_drafts_enrollment_idx on outreach_drafts (enrollment_id);

-- ── Send window (IST hours, [start, end)) ────────────────────────────────────
alter table outreach_settings add column if not exists send_window_start int not null default 9;
alter table outreach_settings add column if not exists send_window_end int not null default 18;

-- ── Every search materialises a list ─────────────────────────────────────────
alter table lead_searches add column if not exists list_id uuid references lead_lists(id) on delete set null;

-- Backfill: one list per existing search, then membership from leads.search_id.
insert into lead_lists (name, source_search_id, created_at)
select initcap(s.category) || ' — ' || initcap(s.city), s.id, s.created_at
from lead_searches s
where not exists (select 1 from lead_lists l where l.source_search_id = s.id);

update lead_searches s
set list_id = l.id
from lead_lists l
where l.source_search_id = s.id and s.list_id is null;

insert into lead_list_members (list_id, lead_id, added_at)
select s.list_id, ld.id, ld.created_at
from leads ld
join lead_searches s on s.id = ld.search_id
where s.list_id is not null
on conflict do nothing;

-- ── updated_at triggers (same convention as other tables) ────────────────────
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['lead_lists','email_templates','email_sequences','sequence_enrollments']
  loop
    execute format('drop trigger if exists %I on %I', t || '_touch', t);
    execute format('create trigger %I before update on %I for each row execute function touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- ── Hourly driver: pg_cron -> Next.js cron route (GET, CRON_SECRET bearer) ──
-- Vercel Hobby only allows daily crons; this fires the same backstop route
-- hourly so sequence follow-ups go out within an hour of falling due.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'b2b-leads-tick',
  '5 * * * *',
  $cmd$select net.http_get(
    url := 'https://promunch-crm.vercel.app/api/cron/leads-tick',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    )
  );$cmd$
);

-- Verify after applying:
--   select jobname, schedule, active from cron.job where jobname = 'b2b-leads-tick';
--   select count(*) from lead_lists;
