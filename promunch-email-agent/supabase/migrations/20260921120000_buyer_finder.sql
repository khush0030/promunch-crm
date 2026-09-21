-- Buyer Finder: pay-as-you-go decision-maker email lookup (provider-agnostic).
--
-- Apply BY HAND in the Supabase dashboard SQL editor, then run the
-- verification query at the bottom. Nothing here touches sending.
--
-- Pieces:
--   1. lead_contacts gains person + mailbox-verification columns
--   2. finder_providers   : per-vendor on/off, priority, MONTHLY CREDIT CAP
--   3. provider_usage_events : spend ledger, one row per paid call
--   4. reserve_provider_credits() : atomic cap check + idempotency claim,
--      taken BEFORE every paid call (same claim-first rule as the send paths)

-- 1. lead_contacts ----------------------------------------------------------
alter table lead_contacts add column if not exists person_name text;
alter table lead_contacts add column if not exists person_title text;
alter table lead_contacts add column if not exists decision_category text;   -- hr | buyer | operations | ...
-- Independent mailbox status from a paid finder/verifier. Deliberately
-- separate from verify_status (which is only a syntax + MX check).
alter table lead_contacts add column if not exists mailbox_status text;      -- valid | risky | ...
alter table lead_contacts add column if not exists mailbox_provider text;
alter table lead_contacts add column if not exists mailbox_checked_at timestamptz;

-- 2. finder_providers -------------------------------------------------------
create table if not exists finder_providers (
  provider text primary key,
  kind text not null default 'finder' check (kind in ('finder', 'verifier')),
  enabled boolean not null default false,
  priority int not null default 100,                 -- lower runs first
  monthly_credit_cap int not null default 0,         -- 0 = blocked until the owner sets a cap
  updated_at timestamptz not null default now()
);

-- Ships OFF with a zero cap: nothing can spend until the owner opts in.
insert into finder_providers (provider, kind, priority)
values ('anymailfinder', 'finder', 10)
on conflict (provider) do nothing;

-- 3. provider_usage_events --------------------------------------------------
create table if not exists provider_usage_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  operation text not null,                           -- decision-maker | ...
  lead_id uuid references leads(id) on delete set null,
  domain text,
  request_key text not null,                         -- provider:op:domain:category:30-day-bucket
  credits_reserved int not null,
  credits_charged int,                               -- null until settled
  status text not null default 'reserved'
    check (status in ('reserved', 'ok', 'not_found', 'risky', 'error', 'uncertain', 'released')),
  detail text,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

-- One live paid call per key. 'released' (definitive failure before any
-- charge) frees the key for a retry; 'uncertain' (timeout after send) does
-- NOT, so an ambiguous paid call is never blindly repeated.
create unique index if not exists provider_usage_events_key_uidx
  on provider_usage_events (request_key) where status <> 'released';
create index if not exists provider_usage_events_month_idx
  on provider_usage_events (provider, created_at);
create index if not exists provider_usage_events_lead_idx
  on provider_usage_events (lead_id);

-- 4. atomic reserve ---------------------------------------------------------
create or replace function reserve_provider_credits(
  p_provider text,
  p_operation text,
  p_lead_id uuid,
  p_domain text,
  p_request_key text,
  p_credits int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg finder_providers%rowtype;
  existing provider_usage_events%rowtype;
  used int;
  new_id uuid;
begin
  -- Serialise per provider so two concurrent reserves cannot both pass the cap.
  perform pg_advisory_xact_lock(hashtext('provider_credits:' || p_provider));

  select * into cfg from finder_providers where provider = p_provider;
  if not found or not cfg.enabled then
    return jsonb_build_object('outcome', 'disabled');
  end if;

  select * into existing from provider_usage_events
   where request_key = p_request_key and status <> 'released';
  if found then
    return jsonb_build_object('outcome', 'duplicate', 'id', existing.id, 'prior_status', existing.status);
  end if;

  select coalesce(sum(coalesce(credits_charged, credits_reserved)), 0) into used
    from provider_usage_events
   where provider = p_provider
     and status in ('reserved', 'ok', 'uncertain')
     and created_at >= date_trunc('month', now());

  if cfg.monthly_credit_cap <= 0 or used + p_credits > cfg.monthly_credit_cap then
    return jsonb_build_object('outcome', 'cap_exceeded', 'used', used, 'cap', cfg.monthly_credit_cap);
  end if;

  insert into provider_usage_events (provider, operation, lead_id, domain, request_key, credits_reserved)
  values (p_provider, p_operation, p_lead_id, p_domain, p_request_key, p_credits)
  returning id into new_id;

  return jsonb_build_object('outcome', 'reserved', 'id', new_id, 'used', used + p_credits, 'cap', cfg.monthly_credit_cap);
end;
$$;

-- Security: service-role only, same as the other lead tables.
alter table finder_providers enable row level security;
alter table provider_usage_events enable row level security;
revoke all on finder_providers from anon, authenticated;
revoke all on provider_usage_events from anon, authenticated;
revoke all on function reserve_provider_credits(text, text, uuid, text, text, int) from public, anon, authenticated;
grant execute on function reserve_provider_credits(text, text, uuid, text, text, int) to service_role;

-- Verification (run after applying; expect 1 provider row, enabled=false, cap=0,
-- and the 6 new lead_contacts columns):
--   select provider, enabled, monthly_credit_cap from finder_providers;
--   select column_name from information_schema.columns
--    where table_name = 'lead_contacts'
--      and column_name in ('person_name','person_title','decision_category',
--                          'mailbox_status','mailbox_provider','mailbox_checked_at');
