-- ============================================================================
-- Campaign send: make duplicate delivery STRUCTURALLY IMPOSSIBLE.
--
-- Why: the sender deduped by reading the whole wa_messages ledger into a
-- "reached" set, then looping. Two independent failures broke that:
--   1. PostgREST capped the ledger read at 1000 rows. Once a campaign had
--      >1000 message rows, the reached set was blind to the rest, so anyone
--      outside that 1000-row window was re-sent EVERY batch (195 duplicate
--      deliveries on Edamame v2).
--   2. Read-then-send is a race even when complete (CLAUDE.md §0).
--
-- Fix: stop trusting application code for correctness. Enforce "at most one
-- in-flight-or-successful message per (campaign, contact)" with a Postgres
-- partial UNIQUE index. The sender now CLAIMS a recipient by inserting a
-- 'queued' row first; the index makes a second claim/insert fail, so a
-- duplicate can never even be sent to Meta — regardless of query caps,
-- concurrency, lock TTLs, multiple schedulers, retries, or future bugs.
--
-- 'failed' rows are intentionally EXCLUDED from the index, so a contact who
-- hit the daily marketing cap (#131049) is still eligible to retry next day.
-- ============================================================================

-- 0. Allow the 'duplicate' bookkeeping status (collapsed re-send rows). 'queued'
--    is already permitted by the existing check constraint.
alter table wa_messages drop constraint if exists wa_messages_status_check;
alter table wa_messages add constraint wa_messages_status_check
  check (status = any (array['received', 'queued', 'sent', 'delivered', 'read', 'failed', 'duplicate']));

-- 1. Collapse the duplicate successful rows that already exist, otherwise the
--    unique index can't be built. Keep the earliest send per (campaign,
--    contact); demote the rest to a non-counted 'duplicate' status (so
--    wa_campaign_recount, which only counts sent/delivered/read, self-corrects).
with ranked as (
  select id,
         row_number() over (partition by campaign_id, contact_id order by created_at) as rn
  from wa_messages
  where campaign_id is not null
    and contact_id is not null
    and status in ('sent', 'delivered', 'read')
)
update wa_messages m
set status = 'duplicate'
from ranked r
where m.id = r.id
  and r.rn > 1;

-- 2. The guarantee. NULL campaign_id (support/journey messages) is unaffected
--    because NULLs are distinct in a unique index, and the predicate keeps
--    'failed'/'duplicate'/'expired' rows out so retries stay possible.
create unique index if not exists wa_messages_campaign_recipient_uniq
  on wa_messages (campaign_id, contact_id)
  where campaign_id is not null
    and contact_id is not null
    and status in ('queued', 'sent', 'delivered', 'read');

-- 3. Recompute every campaign's counters now that duplicates are collapsed.
do $$
declare c uuid;
begin
  for c in select distinct campaign_id from wa_messages where campaign_id is not null loop
    perform wa_campaign_recount(c);
  end loop;
end $$;
