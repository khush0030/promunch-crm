-- ═══════════════════════════════════════════════════════════════════════════
-- Bulk order inquiries (promunch.in/pages/bulk-orders)
-- ═══════════════════════════════════════════════════════════════════════════
-- Replaces the third-party Pify form. The storefront widget
-- (/api/public/bulk-form-embed) posts to /api/public/bulk-inquiry, which:
--   1. inserts one row here (idempotent on submission_key),
--   2. creates a deal in the existing pipeline (/dashboard/deals),
--   3. sends ONE branded auto-reply from hello@promunch.in via Resend.
-- The insert trigger below asks the edge function `bulk-lead-alert` to ping
-- the lead desk on WhatsApp (LEADS_WA_ID); a 10-minute cron sweeps any ping
-- the trigger missed. Both paths claim `lead_alert:bulk:<id>` (exactly once).
--
-- Never-twice (promunch-email-agent/CLAUDE.md §0):
--   * submission_key UNIQUE: a double-click / retry cannot create two rows.
--   * auto_reply_key UNIQUE: one auto-reply per email address per IST day,
--     taken with an atomic UPDATE before Resend is called.
--   * email_status pending→sending is a compare-and-set; only one caller wins.
--
-- APPLY MANUALLY in the Supabase dashboard SQL editor, AFTER
-- `supabase functions deploy bulk-lead-alert` (the trigger + cron call it).
-- Prereq: Vault secret `service_role_key` (see 20260705100000). Idempotent.

-- ── table ────────────────────────────────────────────────────────────────────
create table if not exists bulk_inquiries (
  id uuid primary key default gen_random_uuid(),
  ref_no bigint generated always as identity (start with 1001),
  submission_key text not null unique,
  created_at timestamptz not null default now(),

  name text not null,
  company text not null,
  email text not null,
  phone text not null,
  city text not null,
  use_case text not null
    check (use_case in ('gifting','pantry','events','resale','other')),
  quantity_band text not null
    check (quantity_band in ('50-100','100-500','500-2000','2000+','unsure')),
  products text[] not null default '{}',
  needed_by date,
  notes text,
  page_url text,
  user_agent text,

  deal_id uuid references deals(id) on delete set null,

  -- auto-reply email (Resend)
  email_status text not null default 'pending'
    check (email_status in ('pending','sending','sent','failed','skipped_duplicate','skipped_disabled')),
  auto_reply_key text unique,
  email_subject text,
  email_opener text,
  resend_email_id text,
  email_sent_at timestamptz,
  email_error text,

  -- lead-desk WhatsApp ping (edge fn bulk-lead-alert)
  wa_alert_status text not null default 'pending'
    check (wa_alert_status in ('pending','sent','skipped','failed')),
  wa_alert_at timestamptz
);

create index if not exists bulk_inquiries_created_idx on bulk_inquiries (created_at desc);
create index if not exists bulk_inquiries_email_idx on bulk_inquiries (lower(email));
create index if not exists bulk_inquiries_wa_pending_idx on bulk_inquiries (created_at)
  where wa_alert_status = 'pending';

alter table bulk_inquiries enable row level security;  -- service role only, no policies

-- ── settings (singleton) ─────────────────────────────────────────────────────
-- autoreply_enabled is the kill switch: false = rows + deals + WhatsApp pings
-- still happen, but no customer email is sent (email_status skipped_disabled).
create table if not exists bulk_inquiry_settings (
  id smallint primary key default 1 check (id = 1),
  autoreply_enabled boolean not null default true,
  whatsapp_display text not null default '+91 72722 58545',
  quote_promise text not null default 'Quote within one working day',
  updated_at timestamptz not null default now()
);
insert into bulk_inquiry_settings (id) values (1) on conflict (id) do nothing;
alter table bulk_inquiry_settings enable row level security;

-- ── trigger: ask bulk-lead-alert to ping the lead desk right away ───────────
create extension if not exists pg_net;

create or replace function bulk_inquiry_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://wlungshkwfuggtbantkb.supabase.co/functions/v1/bulk-lead-alert',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('id', new.id),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  -- Never block the insert: the cron sweep below retries the ping.
  return new;
end $$;

drop trigger if exists bulk_inquiry_notify on bulk_inquiries;
create trigger bulk_inquiry_notify after insert on bulk_inquiries
  for each row execute function bulk_inquiry_notify();

-- ── cron backstop: sweep pings the trigger missed ────────────────────────────
create extension if not exists pg_cron;
select cron.unschedule('bulk-lead-alert-sweep')
  where exists (select 1 from cron.job where jobname = 'bulk-lead-alert-sweep');
select cron.schedule('bulk-lead-alert-sweep', '*/10 * * * *', $cmd$select net.http_post(
    url := 'https://wlungshkwfuggtbantkb.supabase.co/functions/v1/bulk-lead-alert',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{"sweep":true}'::jsonb
  );$cmd$);

-- Verify:
--   select * from bulk_inquiry_settings;
--   select jobname, schedule, active from cron.job where jobname = 'bulk-lead-alert-sweep';
--   select ref_no, email, email_status, wa_alert_status, deal_id from bulk_inquiries order by created_at desc limit 5;
