-- Dashboard-managed settings for the automated WhatsApp journeys ("Flows" tab).
-- Singleton row (id = 1), same pattern as outreach_settings / ig_settings.
-- Edge functions read it per invocation and fall back to code defaults that
-- reproduce the previously hardcoded behavior exactly, so applying this
-- migration changes nothing until someone edits the settings in the dashboard.
--
-- APPLY MANUALLY in the Supabase dashboard SQL editor (CLI migrations don't
-- run against this project — see docs/SECURITY_RUNBOOK).

create table if not exists wa_flow_settings (
  id int primary key default 1 check (id = 1),

  -- order confirmation (utility, instant + sweep backstop)
  order_confirmation_enabled boolean not null default true,

  -- shipping update (utility, on fulfillment)
  shipping_update_enabled boolean not null default true,

  -- abandoned-cart recovery (marketing, 2-step + delivery guarantee)
  abandoned_cart_enabled boolean not null default true,
  cart_step1_delay_hours numeric not null default 1  check (cart_step1_delay_hours > 0),
  cart_step2_delay_hours numeric not null default 6  check (cart_step2_delay_hours > 0),
  cart_deadline_hours    numeric not null default 72 check (cart_deadline_hours > 0),
  cart_backoff_hours     numeric not null default 6  check (cart_backoff_hours > 0),
  cart_coupon_code       text    not null default 'PROMUNCH10',

  -- review request (marketing, timed post-purchase)
  review_request_enabled boolean not null default true,
  review_delay_days      numeric not null default 7 check (review_delay_days > 0),

  -- restock / replenishment reminder (marketing, timed post-purchase)
  replenishment_enabled    boolean not null default true,
  replenishment_delay_days numeric not null default 30 check (replenishment_delay_days > 0),

  updated_at timestamptz not null default now(),
  updated_by text
);

insert into wa_flow_settings (id) values (1) on conflict (id) do nothing;

-- service_role only (dashboard API + edge functions); no client access.
alter table wa_flow_settings enable row level security;
revoke all on wa_flow_settings from anon, authenticated;
