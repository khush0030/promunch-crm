-- Abandoned-cart recovery: at-least-once DELIVERY guarantee.
--
-- WHY: abandoned_checkout runs were marked 'failed' and dropped the moment a
-- send errored, and a template that returned ok:true but was later async-failed
-- by Meta (#131049 marketing frequency cap) was never retried. Every such cart
-- is missed recovery revenue. This adds the state a run needs to keep trying
-- until ONE message is confirmed delivered or a deadline passes.
--
-- NO-DUP invariant (CLAUDE.md §0): delivered_at is the terminal success flag —
-- once set, all retries cancel. A run is only ever REOPENED from a delivery
-- FAILURE (proof it did not deliver), so at-least-once never becomes twice.

alter table wa_journey_runs
  add column if not exists attempts     int         not null default 0,
  add column if not exists deadline_at  timestamptz,
  add column if not exists delivered_at timestamptz;

-- Allow the new terminal state 'expired' (cart gave up after its retry deadline).
alter table wa_journey_runs drop constraint if exists wa_journey_runs_status_check;
alter table wa_journey_runs add constraint wa_journey_runs_status_check
  check (status in ('active','completed','cancelled','converted','failed','expired'));

-- Link an outbound message back to the journey run that sent it, so the async
-- status webhook (delivered / failed) can confirm or reopen the right run.
alter table wa_messages
  add column if not exists journey_run_id uuid;

create index if not exists wa_messages_journey_run_idx
  on wa_messages (journey_run_id)
  where journey_run_id is not null;

-- Fast lookup of live cart runs that are past their retry deadline.
create index if not exists wa_journey_runs_deadline_idx
  on wa_journey_runs (deadline_at)
  where status = 'active' and deadline_at is not null;

-- Backfill: give any cart run already in flight a deadline (enrolment time + 72h)
-- so the new retry loop can't keep probing it forever. Past-deadline ones get a
-- deadline in the past and will be expired on the next tick.
update wa_journey_runs
   set deadline_at = coalesce(created_at, now()) + interval '72 hours'
 where journey_key = 'abandoned_checkout'
   and status = 'active'
   and deadline_at is null;
