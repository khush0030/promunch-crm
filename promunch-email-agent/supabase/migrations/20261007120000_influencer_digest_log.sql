-- influencer_digest_log: exactly-once guard for the daily influencer owner
-- digest sent by the influencer-tick edge function.
--
-- One row per IST calendar date. The tick INSERTs (day) before sending; the
-- primary key means only one tick run can win a given day. A row left
-- 'failed' (Meta refused, nothing delivered) may be re-claimed by a
-- compare-and-set on attempts (max 3). 'unknown' (network error, outcome
-- unclear) is never retried automatically (CLAUDE.md §0: when in doubt, do
-- not send).
--
-- Requires 018_influencers.sql (app-side) to be applied first.
-- Apply by hand in the Supabase dashboard SQL editor. Idempotent.

create table if not exists influencer_digest_log (
  day            date primary key,                 -- IST date
  status         text not null default 'claimed'
                 check (status in ('claimed','sent','failed','unknown','skipped_empty')),
  attempts       integer not null default 1,
  wa_message_id  text,
  detail         jsonb,                            -- the counts that were reported
  last_error     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table influencer_digest_log enable row level security;
-- No policies: service-role only (edge functions).

-- Verify: select * from influencer_digest_log order by day desc limit 5;
