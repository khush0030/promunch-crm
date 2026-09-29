-- 016_email_studio.sql
-- Email Studio: the in-CRM Klaviyo replacement (drag-and-drop builder,
-- templates, segments, approvals, revenue attribution).
-- Plan: https://claude.ai/code/artifact/ca478684-8765-459c-b5db-9b0efb034f8d
--
-- Apply by hand in the Supabase dashboard SQL editor (AGENTS.md §3).
-- Idempotent: safe to run twice. Service-role only (RLS on, no anon/auth
-- policies), matching the 004 lockdown; every read/write goes through
-- /api/email-studio/* with the service key.

-- ── Templates ───────────────────────────────────────────────────────────────
-- NOTE: email_templates already exists (B2B "Saved emails"), so this block is
-- a no-op in prod. 017 creates email_studio_templates and re-points the FK.
create table if not exists email_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  category      text not null default 'custom',
  subject       text,
  preview_text  text,
  design        jsonb not null,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table email_templates enable row level security;

-- ── Segments ────────────────────────────────────────────────────────────────
create table if not exists email_segments (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  rules         jsonb not null,
  last_count    integer,
  counted_at    timestamptz,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table email_segments enable row level security;

-- ── Studio settings (one row: brand kit + send guardrails) ──────────────────
create table if not exists email_studio_settings (
  id                    smallint primary key default 1 check (id = 1),
  brand                 jsonb not null default '{}'::jsonb,
  -- Campaigns above this many recipients need an owner/admin approval.
  approval_threshold    integer not null default 2000,
  -- Domain warm-up: while set, a campaign may not exceed this many
  -- recipients and every campaign needs approval. Null = warm-up over.
  warmup_max_recipients integer default 150,
  updated_by            text,
  updated_at            timestamptz not null default now()
);
insert into email_studio_settings (id) values (1) on conflict (id) do nothing;
alter table email_studio_settings enable row level security;

-- ── Campaigns: builder design + approval + test-send gate ───────────────────
alter table campaigns
  add column if not exists design          jsonb,
  add column if not exists template_id     uuid references email_templates(id) on delete set null,
  add column if not exists segment_id      uuid references email_segments(id) on delete set null,
  add column if not exists audience_rules  jsonb,
  add column if not exists utm_campaign    text,
  add column if not exists approval_status text not null default 'not_needed',
  add column if not exists approved_by     text,
  add column if not exists approved_at     timestamptz,
  add column if not exists test_sent_at    timestamptz,
  add column if not exists test_sent_hash  text,
  add column if not exists created_by      text,
  add column if not exists total_orders    integer not null default 0;

do $$ begin
  alter table campaigns add constraint campaigns_approval_status_check
    check (approval_status in ('not_needed', 'pending', 'approved', 'rejected'));
exception when duplicate_object then null; end $$;

-- Never email anyone twice: one claim row per (campaign, contact), enforced by
-- the database, not only by the campaign-level status lock.
create unique index if not exists campaign_emails_campaign_contact_uniq
  on campaign_emails (campaign_id, contact_id);

-- ── Revenue attribution ─────────────────────────────────────────────────────
-- One row per order credited to an email (campaign or flow). Filled nightly
-- by /api/cron/email-attribution-tick: UTM match first, else a click on that
-- email in the 5 days before the order (same email address).
create table if not exists email_attributions (
  id              uuid primary key default gen_random_uuid(),
  shopify_order_id text not null unique,
  order_number    text,
  order_at        timestamptz not null,
  revenue         numeric(12, 2) not null default 0,
  campaign_id     uuid references campaigns(id) on delete cascade,
  flow_id         uuid references flows(id) on delete cascade,
  contact_id      uuid references contacts(id) on delete set null,
  model           text not null check (model in ('utm', 'click_5d')),
  created_at      timestamptz not null default now()
);
create index if not exists email_attributions_campaign_idx on email_attributions (campaign_id);
create index if not exists email_attributions_flow_idx on email_attributions (flow_id);
alter table email_attributions enable row level security;

-- ── Image uploads for the builder ───────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('email-assets', 'email-assets', true, 5242880,
        array['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
on conflict (id) do nothing;
