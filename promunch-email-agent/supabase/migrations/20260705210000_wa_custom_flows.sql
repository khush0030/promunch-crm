-- User-created WhatsApp flows (Flows tab "New flow" builder).
-- A custom flow = Shopify trigger -> ordered steps, each (delay, approved
-- template, var mapping). Enrolment happens in shopify-wa/shopify-webhook via
-- _shared/custom-flows.ts (atomic claimSend per flow+entity, so a customer can
-- never be enrolled twice); delivery reuses wa_journey_runs + wa-journey-tick
-- with journey_key 'custom:<flow id>'.
--
-- APPLY MANUALLY in the Supabase dashboard SQL editor.

create table if not exists wa_custom_flows (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  enabled boolean not null default true,
  trigger_event text not null check (trigger_event in ('order_placed', 'order_fulfilled', 'checkout_abandoned')),
  -- [{ delay_hours: number, template: string, language: string, vars: {"1":"{name}", ...} }, ...]
  steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

-- service_role only (dashboard API + edge functions); no client access.
alter table wa_custom_flows enable row level security;
revoke all on wa_custom_flows from anon, authenticated;
