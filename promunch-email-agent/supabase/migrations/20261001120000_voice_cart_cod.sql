-- Voice agent v2: 15-minute cart call + COD confirmation call.
-- Design: docs/plans/2026-10-01-voice-agent-cart-cod-design.md
-- APPLY BY HAND (Supabase SQL editor or `supabase db query --linked`), BEFORE deploying the functions.

alter table voice_calls
  add column if not exists purpose     text not null default 'cart',
  add column if not exists attempt_no  int  not null default 1,
  add column if not exists tool_action text,
  add column if not exists shopify_id  bigint;

do $$ begin
  alter table voice_calls add constraint voice_calls_purpose_check
    check (purpose in ('cart','cod_confirm'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table voice_calls add constraint voice_calls_tool_action_check
    check (tool_action is null or tool_action in ('confirm','cancel_request'));
exception when duplicate_object then null; end $$;

-- DB backstop for "never call twice": one live COD dial per order per attempt
-- number. start_failed rows are excluded so a failed start can be retried with
-- the same attempt number (the customer's phone never rang).
create unique index if not exists voice_calls_cod_attempt_uq
  on voice_calls (shopify_id, attempt_no)
  where purpose = 'cod_confirm' and status <> 'start_failed';
create index if not exists voice_calls_purpose_created_idx on voice_calls (purpose, created_at desc);
create index if not exists voice_calls_shopify_idx on voice_calls (shopify_id) where shopify_id is not null;

-- Row-level claim counter for COD dials (compare-and-swap in voice-tick).
alter table shopify_orders add column if not exists voice_attempts int not null default 0;

alter table shopify_orders drop constraint if exists shopify_orders_confirmed_via_check;
alter table shopify_orders add constraint shopify_orders_confirmed_via_check
  check (confirmed_via in ('button','manual','voice'));

alter table wa_flow_settings
  add column if not exists cart_voice_delay_minutes numeric not null default 15,
  add column if not exists cod_voice_enabled        boolean not null default false,
  add column if not exists cod_voice_delay_hours    numeric not null default 2,
  add column if not exists cod_voice_max_attempts   int     not null default 2,
  add column if not exists cod_voice_retry_hours    numeric not null default 3;

do $$ begin
  alter table wa_flow_settings add constraint wa_flow_settings_cart_voice_delay_minutes_check
    check (cart_voice_delay_minutes between 5 and 180);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table wa_flow_settings add constraint wa_flow_settings_cod_voice_check
    check (cod_voice_delay_hours > 0 and cod_voice_retry_hours > 0 and cod_voice_max_attempts between 1 and 3);
exception when duplicate_object then null; end $$;
