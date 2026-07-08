-- COD confirmation gate (RTO reduction).
-- Spec: docs/superpowers/specs/2026-07-08-cod-confirmation-gate-design.md
-- APPLY MANUALLY in the Supabase dashboard SQL editor (CLI migrations don't
-- run against this project). Must be applied BEFORE deploying the
-- shopify-webhook change that writes payment_gateway_names.

alter table shopify_orders
  add column if not exists confirmation_status text
    check (confirmation_status in ('pending','confirmed','cancelled','needs_call')),
  add column if not exists confirmation_sent_at timestamptz,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_via text
    check (confirmed_via in ('button','manual')),
  add column if not exists payment_gateway_names jsonb;

-- sweep + dashboard queue both filter on status; partial index keeps it tiny
create index if not exists shopify_orders_confirmation_status_idx
  on shopify_orders (confirmation_status)
  where confirmation_status is not null;

alter table wa_flow_settings
  add column if not exists cod_gate_enabled boolean not null default false,
  add column if not exists cod_reminder_delay_hours numeric not null default 6
    check (cod_reminder_delay_hours > 0),
  add column if not exists cod_needs_call_hours numeric not null default 24
    check (cod_needs_call_hours > 0);
