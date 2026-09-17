-- Brevo integration: webhook ledger, settings, send guards, event claims.
--
-- WHY
-- ---
-- Brevo is the email marketing tool (docs/plans/2026-09-17-brevo-integration.md).
-- The CRM now receives Brevo webhooks, syncs contacts to a Brevo list, sends
-- campaigns from the dashboard and posts order events that start Brevo
-- automations. Every one of those can repeat (webhook redelivery, double click,
-- Shopify webhook retry), so each gets a table whose unique key turns a repeat
-- into a no-op instead of a second email.
--
--   1. brevo_events          ledger of every webhook event (unique event_key)
--   2. brevo_settings        singleton: sync target test|live, test list, flags
--   3. brevo_campaign_tests  test sends, tied to the campaign version tested
--   4. brevo_campaign_sends  one-send claim per campaign (send now / schedule)
--   5. brevo_event_claims    one Brevo event per (order, event name)
--
-- All service-role only. Idempotent. Paste into the Supabase dashboard SQL
-- editor (docs/runbooks/MIGRATIONS.md).

------------------------------------------------------------------------
-- 1. Webhook ledger
------------------------------------------------------------------------
create table if not exists brevo_events (
  id           bigint generated always as identity primary key,
  -- Deterministic key built by /api/webhooks/brevo from the payload, so a
  -- redelivered event hits the unique index instead of being counted twice.
  event_key    text not null unique,
  channel      text not null check (channel in ('email_marketing', 'email_transactional', 'sms')),
  event        text not null,
  email        text,
  phone        text,
  campaign_id  integer,
  message_id   text,
  tag          text,
  url          text,
  reason       text,
  occurred_at  timestamptz,
  payload      jsonb not null,
  received_at  timestamptz not null default now()
);
create index if not exists brevo_events_email_idx on brevo_events (lower(email));
create index if not exists brevo_events_campaign_idx on brevo_events (campaign_id, event);
create index if not exists brevo_events_occurred_idx on brevo_events (occurred_at desc);

------------------------------------------------------------------------
-- 2. Settings (singleton)
------------------------------------------------------------------------
create table if not exists brevo_settings (
  id                 int primary key default 1 check (id = 1),
  -- 'test' = only test_emails are synced/evented; 'live' = the real audience.
  -- Only the owner flips this (enforced in the API route).
  sync_target        text not null default 'test' check (sync_target in ('test', 'live')),
  test_emails        text[] not null default array['kmutha@vippysoya.com'],
  test_list_id       integer,
  live_list_id       integer,
  events_enabled     boolean not null default false,
  sms_enabled        boolean not null default false,
  last_sync_at       timestamptz,
  last_sync_cursor   timestamptz,
  last_sync_count    integer,
  last_sync_error    text,
  updated_at         timestamptz not null default now(),
  updated_by         text
);
insert into brevo_settings (id) values (1) on conflict (id) do nothing;

------------------------------------------------------------------------
-- 3. Test sends
------------------------------------------------------------------------
create table if not exists brevo_campaign_tests (
  id                    bigint generated always as identity primary key,
  channel               text not null check (channel in ('email', 'sms')),
  campaign_id           integer not null,
  -- Brevo's modifiedAt at the time of the test. A real send is allowed only if
  -- a test exists for the campaign's CURRENT modifiedAt (edit after test =
  -- test again).
  campaign_modified_at  text not null,
  recipients            text[] not null,
  sent_by               text not null,
  sent_at               timestamptz not null default now()
);
create index if not exists brevo_campaign_tests_lookup on brevo_campaign_tests (channel, campaign_id, campaign_modified_at);

------------------------------------------------------------------------
-- 4. Send claims (never send a campaign twice)
------------------------------------------------------------------------
create table if not exists brevo_campaign_sends (
  channel          text not null check (channel in ('email', 'sms')),
  campaign_id      integer not null,
  action           text not null check (action in ('send_now', 'schedule')),
  scheduled_at     timestamptz,
  recipient_count  integer,
  claimed_by       text not null,
  claimed_at       timestamptz not null default now(),
  -- pending until Brevo answers; ok | failed afterwards. A failed claim is
  -- released by the route (row deleted) only when Brevo definitely refused.
  result           text not null default 'pending' check (result in ('pending', 'ok', 'failed')),
  error            text,
  primary key (channel, campaign_id)
);

------------------------------------------------------------------------
-- 5. Order event claims
------------------------------------------------------------------------
create table if not exists brevo_event_claims (
  order_id    text not null,
  event_name  text not null,
  email       text,
  status      text not null default 'claimed' check (status in ('claimed', 'sent', 'failed', 'skipped')),
  error       text,
  created_at  timestamptz not null default now(),
  primary key (order_id, event_name)
);

------------------------------------------------------------------------
-- Grants: service role only
------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['brevo_events', 'brevo_settings', 'brevo_campaign_tests', 'brevo_campaign_sends', 'brevo_event_claims'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on %I to service_role', t);
  end loop;
end $$;

-- Verify:
--   select * from brevo_settings;
--   select count(*) from brevo_events;

------------------------------------------------------------------------
-- 6. pg_cron: brevo-events every 10 min (offset from the :X0 stampede)
------------------------------------------------------------------------
-- Posts order events to Brevo. The route does nothing until the owner turns
-- on brevo_settings.events_enabled, and in test mode only test addresses are
-- evented. brevo_event_claims makes an overlapping firing a no-op.
select cron.unschedule('brevo-events')
where exists (select 1 from cron.job where jobname = 'brevo-events');

select cron.schedule(
  'brevo-events',
  '3-59/10 * * * *',
  $$
  select net.http_post(
    url := 'https://promunch-crm.vercel.app/api/cron/brevo-events',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
      'Content-Type', 'application/json'
    )
  );
  $$
);

-- Verify:
--   select jobname, schedule, active from cron.job where jobname = 'brevo-events';
--   select status_code, content from net._http_response order by created desc limit 5;
