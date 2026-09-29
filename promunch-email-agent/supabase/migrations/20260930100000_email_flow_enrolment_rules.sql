-- ============================================================
-- EMAIL FLOW ENROLMENT RULES: one live abandoned-cart sequence per contact
--
-- Before: abandoned-cart email enrolment deduped per CHECKOUT TOKEN, so every
-- new checkout by the same shopper started a PARALLEL cart sequence (prod saw
-- 31 overlapping pairs; one contact got 8 enrolments / 14 emails).
--
-- After (code: _shared/email-flows.ts + src/lib/email/enroll.ts): a new
-- checkout for a contact who already has an ACTIVE cart enrolment in that flow
-- REFRESHES it in place (cart items, recovery URL, token list, deadline) and
-- never resets current_step. This index is the database backstop for that rule
-- and makes the concurrent-webhook race fail loudly (23505) instead of stacking
-- a second sequence; the enrol code catches 23505 and folds into the winner.
--
-- Scope: only abandoned-cart enrolments (dedup_key 'abandoned:<token>'). Other
-- flows (post-purchase per order, etc.) may legitimately run in parallel.
--
-- Step 1 cancels pre-existing duplicate ACTIVE cart enrolments (keeps the most
-- advanced one per (flow, contact), oldest on a tie) with last_error
-- 'superseded', otherwise the unique index cannot be built. Cancelling sends
-- nothing and only stops FUTURE steps of the redundant sequence. At authoring
-- time (Sep 29 2026) a read-only count found 0 such rows (0 active enrolments
-- at all), so this step is expected to be a no-op.
--
-- Pre-check (optional, read-only):
--   select count(*) - count(distinct (flow_id, contact_id)) as would_cancel
--   from flow_enrollments where status = 'active' and dedup_key like 'abandoned:%';
--
-- Idempotent. Apply by hand in the Supabase dashboard SQL editor
-- (docs/runbooks/MIGRATIONS.md). Safe before or after the code deploy: old code
-- hitting the index gets a 23505 on a duplicate cart insert, which it already
-- swallows (try/catch + console.warn), i.e. the duplicate is simply not created.
-- ============================================================

with ranked as (
  select id,
         row_number() over (
           partition by flow_id, contact_id
           order by current_step desc, entered_at asc nulls last, id
         ) as rn
  from flow_enrollments
  where status = 'active'
    and dedup_key like 'abandoned:%'
)
update flow_enrollments f
   set status = 'cancelled',
       last_error = 'superseded',
       updated_at = now()
  from ranked r
 where f.id = r.id
   and r.rn > 1;

create unique index if not exists idx_flow_enrollments_one_active_cart
  on flow_enrollments (flow_id, contact_id)
  where status = 'active' and dedup_key like 'abandoned:%';

-- Supports the "was this checkout token merged into a running sequence?"
-- lookup (context @> '{"checkout_tokens":["<token>"]}') used by both the
-- enrol refresh and the order-conversion-by-checkout path.
create index if not exists idx_flow_enrollments_context_gin
  on flow_enrollments using gin (context jsonb_path_ops);

-- Verify:
--   select indexname, indexdef from pg_indexes
--   where tablename = 'flow_enrollments'
--     and indexname in ('idx_flow_enrollments_one_active_cart', 'idx_flow_enrollments_context_gin');
--   select count(*) from flow_enrollments where last_error = 'superseded';
