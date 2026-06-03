-- Atomic per-order claim for WhatsApp order confirmations.
--
-- WHY: confirmationAlreadySent() is a read-then-send check. Multiple trigger
-- paths (shopify-webhook inline, shopify-wa, the Postgres trigger, the sweep
-- cron) fire for the same order within the same second; each reads "not sent
-- yet" before any has written its wa_messages row, so two or more of them send.
-- That is exactly how order #2050 was messaged twice (and #2023/#2024 four
-- times). A read-then-write check can never be safe against that race.
--
-- This table closes the race AT THE DATABASE: order_ref is the PRIMARY KEY, so
-- exactly ONE caller can hold the claim for a given order. The claim_*()
-- function is atomic (single INSERT ... ON CONFLICT statement), so concurrent
-- callers are serialised by Postgres — one wins, the rest stand down.
--
-- No-spam is the non-negotiable here: a missed confirmation is recoverable (the
-- sweep retries), a duplicate is not. So a FAILED send releases its claim (the
-- sweep can retry), and a SUCCESSFUL send marks the claim 'sent' so it can
-- never be re-sent. A claim that is left 'sending' (e.g. a crashed run) becomes
-- steal-able again after 10 minutes so one crash can't silently mute an order.

create table if not exists public.wa_confirmation_claims (
  order_ref  text primary key,
  status     text not null default 'sending',   -- 'sending' | 'sent'
  claimed_at timestamptz not null default now()
);

-- Normalise an order ref the same way the TS code does: trim + drop leading '#'.
create or replace function public.norm_order_ref(p_ref text)
returns text
language sql
immutable
as $$ select regexp_replace(btrim(coalesce(p_ref, '')), '^#', '') $$;

-- Try to claim an order for confirmation. Returns TRUE only to the single
-- caller that may now send. Atomic: the whole thing is one statement.
--   - fresh order            -> INSERT wins  -> true
--   - already 'sent'         -> WHERE fails  -> false  (never re-send)
--   - 'sending' < 10 min ago -> WHERE fails  -> false  (someone is sending now)
--   - 'sending' > 10 min ago -> stolen       -> true   (prior run died; retry)
create or replace function public.claim_order_confirmation(p_ref text)
returns boolean
language plpgsql
as $$
declare
  v_ref text := public.norm_order_ref(p_ref);
  v_won boolean;
begin
  if v_ref = '' then
    return false;
  end if;

  insert into public.wa_confirmation_claims as c (order_ref, status, claimed_at)
  values (v_ref, 'sending', now())
  on conflict (order_ref) do update
    set status = 'sending', claimed_at = now()
    where c.status <> 'sent'
      and c.claimed_at < now() - interval '10 minutes'
  returning true into v_won;

  return coalesce(v_won, false);
end;
$$;

-- Promote a claim to 'sent' once Meta has accepted the message — locks it so it
-- can never be stolen or re-sent.
create or replace function public.mark_order_confirmation_sent(p_ref text)
returns void
language sql
as $$
  update public.wa_confirmation_claims
     set status = 'sent', claimed_at = now()
   where order_ref = public.norm_order_ref(p_ref)
$$;

-- Release a claim after a FAILED send so the sweep can retry immediately
-- (instead of waiting out the 10-minute stale window).
create or replace function public.release_order_confirmation(p_ref text)
returns void
language sql
as $$
  delete from public.wa_confirmation_claims
   where order_ref = public.norm_order_ref(p_ref)
     and status <> 'sent'
$$;
