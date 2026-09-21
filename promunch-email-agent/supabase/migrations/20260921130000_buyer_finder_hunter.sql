-- Buyer Finder, part 2: add Hunter (free plan: 50 credits/month, API included)
-- and fix cap accounting so a query that spent a credit but returned only
-- unverified addresses still counts against the monthly cap.
--
-- Apply BY HAND in the Supabase SQL editor AFTER 20260921120000_buyer_finder.sql.

-- Hunter runs first (lower priority number = tried first), so the free credits
-- are used before any paid provider. Ships OFF with a zero cap, like the others.
insert into finder_providers (provider, kind, priority)
values ('hunter', 'finder', 5)
on conflict (provider) do nothing;

-- Cap accounting now counts every status that can carry a charge. Only
-- 'released' (definitive failure before any charge) and 'error' are excluded.
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
     and status in ('reserved', 'ok', 'uncertain', 'risky', 'not_found')
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

revoke all on function reserve_provider_credits(text, text, uuid, text, text, int) from public, anon, authenticated;
grant execute on function reserve_provider_credits(text, text, uuid, text, text, int) to service_role;

-- Verification (expect hunter priority 5 and anymailfinder priority 10, both enabled=false, cap=0):
--   select provider, priority, enabled, monthly_credit_cap from finder_providers order by priority;
