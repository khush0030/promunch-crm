-- Unique single-use Shopify discount codes for email flow steps.
--
-- WHY: flow emails used one static code for everyone (PROMUNCH10, WELCOME10,
-- COMEBACK15), which leaks to coupon sites. src/lib/email/coupons.ts now mints
-- one code per (enrollment, percent_off) via Shopify discountCodeBasicCreate.
--
-- This table is the atomic claim + ledger:
--   1. the flow engine INSERTs a 'pending' row (code chosen up front); the
--      unique (enrollment_id, percent_off) index means two concurrent ticks can
--      never both win, so we never create two Shopify discounts for one person;
--   2. the winner creates the discount in Shopify, then flips the row to
--      'active' (or 'failed', and the email falls back to the static code);
--   3. a retry for the same enrollment reuses the stored code.
-- A 'pending' row older than 5 min (process died mid-create) is taken over and
-- re-created with the SAME code; Shopify rejects duplicate codes, so the
-- takeover can at worst adopt the already-created discount, never mint a second.
--
-- Service-role only: RLS on, no anon/authenticated policies, grants revoked.
-- Idempotent: safe to re-paste in the SQL editor.

create table if not exists public.email_flow_coupons (
  id                  uuid primary key default gen_random_uuid(),
  enrollment_id       uuid not null references public.flow_enrollments(id) on delete cascade,
  step_index          integer,
  percent_off         numeric(5,2) not null check (percent_off > 0 and percent_off <= 100),
  code                text not null,
  status              text not null default 'pending'
                        check (status in ('pending', 'active', 'failed')),
  shopify_discount_id text,
  expires_at          timestamptz,
  error               text,
  claimed_at          timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists email_flow_coupons_enrollment_pct_uniq
  on public.email_flow_coupons (enrollment_id, percent_off);

create unique index if not exists email_flow_coupons_code_uniq
  on public.email_flow_coupons (code);

create index if not exists email_flow_coupons_pending_idx
  on public.email_flow_coupons (claimed_at) where status = 'pending';

alter table public.email_flow_coupons enable row level security;
revoke all on public.email_flow_coupons from anon;
revoke all on public.email_flow_coupons from authenticated;
grant select, insert, update, delete on public.email_flow_coupons to service_role;

-- Verify:
--   select relrowsecurity from pg_class where relname = 'email_flow_coupons';  -- t
--   select indexname from pg_indexes where tablename = 'email_flow_coupons';
