-- Abandoned-cart recovery: ONE live sequence per CUSTOMER, not per checkout.
--
-- WHY: shopify-wa took its enrolment lock on the Shopify CHECKOUT TOKEN, and
-- Shopify mints a brand-new token every time the same person abandons again.
-- So one human could hold several parallel abandoned_checkout sequences, each
-- firing its own 2 marketing templates on its own retry schedule.
--
-- Production evidence, contact c6e87326-e55e-4ebc-9598-ae798a31b785, Aug 2026:
--   4 x abandoned_cart_reminder  at 2026-08-03T18:15 (four different run ids)
--   4 x abandoned_cart_recovery  at 2026-08-03T23:15
--   ...the same four runs again every 6h for 72h.
-- 80 marketing sends to one person in a month. Across August: 537 cart
-- marketing attempts to only 35 distinct people. That is a CLAUDE.md §0
-- never-message-twice violation and the direct cause of Meta throttling us with
-- #131049 ("healthy ecosystem engagement"), a PER-RECIPIENT fatigue cap.
--
-- WHAT THIS DOES
--   1. Collapses every currently-stacked live sequence down to the newest cart
--      (stops the bleeding the moment this is pasted).
--   2. Adds a PARTIAL UNIQUE INDEX that makes a second live sequence for the
--      same customer impossible at the database, backing the atomic
--      per-customer claim taken in shopify-wa/index.ts.
--
-- The code side (shopify-wa) now REFRESHES a customer's running sequence to
-- point at their newest cart instead of enrolling a second one, and keeps the
-- ORIGINAL deadline_at / next_action_at so a serial abandoner cannot be chased
-- indefinitely.
--
-- Idempotent and safe to re-run: the cleanup statements match nothing once they
-- have run, and the index uses IF NOT EXISTS.
--
-- APPLY BY HAND in the Supabase dashboard SQL editor (the CLI path does not
-- work for this project).

begin;

-- ---------------------------------------------------------------------------
-- 1. Collapse stacked sequences: keep the NEWEST cart per customer.
--
-- "Newest cart" = the order_ref whose live runs were created most recently.
-- Every live run belonging to an OLDER cart of the same customer is cancelled.
-- Cancelled (not expired/failed) because nothing went wrong with the send: the
-- sequence is simply superseded by a fresher cart from the same person.
-- ---------------------------------------------------------------------------
with carts as (
  select wa_id,
         order_ref,
         max(created_at) as newest_at,
         row_number() over (
           partition by wa_id
           order by max(created_at) desc, max(id::text) desc
         ) as rn
    from public.wa_journey_runs
   where journey_key = 'abandoned_checkout'
     and status = 'active'
   group by wa_id, order_ref
)
update public.wa_journey_runs r
   set status = 'cancelled',
       last_error = 'superseded by this customer''s newer cart — one live abandoned-cart sequence per customer (migration 20260826101000)'
  from carts c
 where r.journey_key = 'abandoned_checkout'
   and r.status = 'active'
   and r.wa_id = c.wa_id
   and r.order_ref is not distinct from c.order_ref
   and c.rn > 1;

-- ---------------------------------------------------------------------------
-- 2. Belt and braces: within whatever survives, keep at most one live run per
--    (customer, step). A cart legitimately has TWO live runs at once — the
--    reminder step and the recovery step — so the uniqueness key must include
--    the step, not just wa_id. Runs enrolled before per-step templates existed
--    carry no context.template; wa-journey-tick reads those as the journey
--    default (abandoned_cart_recovery), so they are folded into that slot here
--    and by the index below. This also guarantees step 3 can never fail.
-- ---------------------------------------------------------------------------
with ranked as (
  select id,
         row_number() over (
           partition by wa_id, coalesce(context->>'template', 'abandoned_cart_recovery')
           order by created_at desc, id::text desc
         ) as rn
    from public.wa_journey_runs
   where journey_key = 'abandoned_checkout'
     and status = 'active'
)
update public.wa_journey_runs r
   set status = 'cancelled',
       last_error = 'superseded duplicate live cart step for this customer (migration 20260826101000)'
  from ranked k
 where r.id = k.id
   and k.rn > 1;

-- ---------------------------------------------------------------------------
-- 3. The constraint.
--
-- Shape: partial unique on (wa_id, step template) scoped to live cart runs.
--   - A naive unique on (wa_id) alone would NOT work: the reminder step and the
--     recovery step of the SAME cart are both 'active' at the same time, so it
--     would reject every normal enrolment.
--   - Including the step template allows exactly the intended shape — one live
--     reminder + one live recovery per person — and rejects a second parallel
--     sequence, which is the actual bug.
--   - coalesce(..., 'abandoned_cart_recovery') matters: NULLs are distinct in a
--     unique index, so without it several legacy template-less runs for one
--     customer would slip through. The default mirrors TIMED_JOURNEYS, i.e.
--     exactly what wa-journey-tick would send for such a run.
--   - jsonb ->> and coalesce are IMMUTABLE, so this is a legal index expression.
--
-- NOTE for anyone wiring code against this: a PARTIAL unique index CANNOT be
-- used as an ON CONFLICT target through PostgREST (this repo has been bitten by
-- that before — see the cart-recovery incident). shopify-wa therefore does a
-- plain INSERT and treats a 23505 as "this customer already has a live
-- sequence"; the atomic per-customer claim (claim_order_confirmation, keyed
-- 'abandoned_customer:<wa_id>') is the primary guard and this index is the
-- backstop that survives a claim being stolen or bypassed.
-- ---------------------------------------------------------------------------
create unique index if not exists wa_journey_runs_one_live_cart_per_customer
  on public.wa_journey_runs (wa_id, (coalesce(context->>'template', 'abandoned_cart_recovery')))
  where journey_key = 'abandoned_checkout' and status = 'active';

commit;

-- ---------------------------------------------------------------------------
-- Verification (run after applying). Expect zero rows: no customer should have
-- more than one live cart sequence, and none should have a duplicate step.
-- ---------------------------------------------------------------------------
-- select wa_id, count(distinct order_ref) as live_carts, count(*) as live_runs
--   from public.wa_journey_runs
--  where journey_key = 'abandoned_checkout' and status = 'active'
--  group by wa_id
-- having count(distinct order_ref) > 1 or count(*) > 2;
