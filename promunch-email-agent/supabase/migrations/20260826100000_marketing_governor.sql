-- ═══════════════════════════════════════════════════════════════════════════
-- MARKETING FREQUENCY GOVERNOR — 2026-08-26
--
-- 84% of PROMUNCH's WhatsApp marketing was being rejected by Meta with #131049
-- ("This message was not delivered to maintain healthy ecosystem engagement").
-- Measured over 60 days of production traffic:
--
--   marketing-category templates   6,802 attempts   5,728 failed  (84%)
--   utility-category templates     2,025 attempts      34 failed  (1.7%)
--   free-form in the 24h window      195 sent          2 failed  (1%)
--
-- Utility and in-window free text deliver fine, so the phone number's quality is
-- NOT the problem. #131049 is Meta's PER-RECIPIENT marketing fatigue cap, and it
-- is a terminal verdict for that recipient, not a transient error. The old code
-- treated it as transient and retried into it on a 6h backoff, which is exactly
-- what deepens the fatigue. In August one customer absorbed 80 marketing
-- template attempts, none of which could ever have landed.
--
-- This table is the memory the governor needs: how many #131049 verdicts in a
-- row a given number has produced, and whether we have stood down on marketing
-- to them entirely.
--
-- SCOPE: MARKETING ONLY. Nothing here may ever block a utility template (order
-- confirmation, shipping update, order verify, ops alert) or a free-form message
-- inside the open 24h service window. Those run at 98-99% delivery and are the
-- business's lifeline.
--
-- Apply by hand in the Supabase dashboard SQL editor (the CLI migration path
-- does not work on this project). Fully idempotent — safe to re-run.
-- The edge functions are safe to deploy BEFORE this is applied: every read is
-- wrapped so a missing table simply means "nobody is suppressed".
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.wa_marketing_suppression (
  wa_id            text primary key,
  consecutive_caps integer     not null default 0,
  last_cap_at      timestamptz,
  suppressed_until timestamptz,
  reason           text,
  updated_at       timestamptz not null default now()
);

-- Bulk "who is currently suppressed" scan (the campaign sender's hold-out set).
create index if not exists wa_marketing_suppression_until_idx
  on public.wa_marketing_suppression (suppressed_until);

-- The governor counts a customer's recent marketing attempts by walking
-- wa_messages through their thread. wa_messages had no (thread_id, created_at)
-- index, so that count was a sequential scan on the biggest table in the
-- database, once per due journey run.
create index if not exists wa_messages_thread_created_idx
  on public.wa_messages (thread_id, created_at desc);

-- The campaign sender evaluates the same rule for a whole audience at once by
-- scanning the last 7 days of OUTBOUND TEMPLATE rows (keyed on contact_id, no
-- thread join). Partial index so it stays small and the scan stays bounded.
create index if not exists wa_messages_outbound_template_created_idx
  on public.wa_messages (created_at desc)
  where direction = 'outbound' and type = 'template';

-- ---------------------------------------------------------------------------
-- Atomic strike counter.
--
-- Meta can fire several status callbacks for the same number within the same
-- second (a broadcast batch all capping at once). A read-then-write increment
-- loses strikes under that concurrency, so do the whole thing in one statement.
--
-- Reaching p_strikes consecutive caps sets suppressed_until = now() +
-- p_suppress_days. A later DELIVERED marketing message clears both counters
-- (see wa_record_marketing_cap's counterpart in the edge module) because
-- delivery proves Meta still has a slot for us with that person.
-- ---------------------------------------------------------------------------
create or replace function public.wa_record_marketing_cap(
  p_wa_id         text,
  p_reason        text default null,
  p_strikes       integer default 3,
  p_suppress_days integer default 30
)
returns integer
language plpgsql
as $$
declare
  v_id    text := btrim(coalesce(p_wa_id, ''));
  v_caps  integer;
begin
  if v_id = '' then
    return 0;
  end if;

  insert into public.wa_marketing_suppression as s
    (wa_id, consecutive_caps, last_cap_at, suppressed_until, reason, updated_at)
  values
    (v_id, 1, now(),
     case when 1 >= p_strikes then now() + make_interval(days => p_suppress_days) else null end,
     p_reason, now())
  on conflict (wa_id) do update
    set consecutive_caps = s.consecutive_caps + 1,
        last_cap_at      = now(),
        suppressed_until = case
          when s.consecutive_caps + 1 >= p_strikes
            then greatest(coalesce(s.suppressed_until, now()), now() + make_interval(days => p_suppress_days))
          else s.suppressed_until
        end,
        reason           = coalesce(p_reason, s.reason),
        updated_at       = now()
  returning s.consecutive_caps into v_caps;

  return coalesce(v_caps, 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. This is an internal ledger written only by edge functions, so it
-- follows the `service_only` half of 20260718120000_rls_lockdown.sql: RLS on,
-- no policies, anon and authenticated fully revoked. (If a dashboard screen ever
-- needs to LIST suppressed numbers, add a select-only policy for
-- `authenticated` there — do not widen the grants here.)
-- ---------------------------------------------------------------------------
alter table public.wa_marketing_suppression enable row level security;
revoke all on public.wa_marketing_suppression from anon;
revoke all on public.wa_marketing_suppression from authenticated;
grant select, insert, update, delete on public.wa_marketing_suppression to service_role;

revoke all on function public.wa_record_marketing_cap(text, text, integer, integer) from public;
grant execute on function public.wa_record_marketing_cap(text, text, integer, integer) to service_role;

-- Verification (run after applying):
--   select count(*) from public.wa_marketing_suppression;                 -- 0
--   select public.wa_record_marketing_cap('__selftest__', 'probe', 3, 30); -- 1
--   delete from public.wa_marketing_suppression where wa_id = '__selftest__';
