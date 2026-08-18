-- Never-message-twice guard for the MANUAL WhatsApp send path.
--
-- WHY: automated sends (order confirmations, AI reply turns) each own a natural
-- claim key (order_ref, thread_id+inbound_id) and are protected by
-- wa_confirmation_claims / wa_reply_claims. A human-typed inbox message has NO
-- such key, so nothing guarded it. Today a double-click of the template Send
-- button, a double-press of Enter, or two agents replying to the same thread at
-- once each produce TWO identical WhatsApp messages to the customer — the exact
-- thing CLAUDE.md §0 forbids.
--
-- This closes the race AT THE DATABASE, the same way the confirmation claim does:
-- dedup_key is the PRIMARY KEY, and claim_manual_send() is a single atomic
-- INSERT ... ON CONFLICT statement, so concurrent callers are serialised by
-- Postgres — one wins and sends, the rest stand down.
--
-- The one difference from the confirmation claim: this claim is TIME-WINDOWED,
-- not permanent. A manual message legitimately CAN be sent to the same customer
-- again later (unlike a one-per-order confirmation), so a key becomes claimable
-- again once the window elapses. Inside the window, an identical message to the
-- same destination is treated as a duplicate and skipped.

create table if not exists public.wa_manual_send_claims (
  dedup_key  text primary key,
  claimed_at timestamptz not null default now()
);

-- Try to claim a manual send. Returns TRUE only to the single caller that may
-- now send. Atomic (one statement).
--   - fresh key                        -> INSERT wins  -> true
--   - key claimed < window ago         -> WHERE fails  -> false (duplicate; skip)
--   - key claimed > window ago (stale)  -> re-claimed   -> true  (legit resend)
--   - empty key                        -> nothing to dedup -> true (fail open)
create or replace function public.claim_manual_send(p_key text, p_window_seconds int default 90)
returns boolean
language plpgsql
as $$
declare
  v_won boolean;
begin
  if coalesce(btrim(p_key), '') = '' then
    return true;
  end if;

  insert into public.wa_manual_send_claims as c (dedup_key, claimed_at)
  values (p_key, now())
  on conflict (dedup_key) do update
    set claimed_at = now()
    where c.claimed_at < now() - make_interval(secs => greatest(coalesce(p_window_seconds, 90), 0))
  returning true into v_won;

  return coalesce(v_won, false);
end;
$$;

-- Release a claim after a FAILED send so a retry is not blocked for the whole
-- window (a missed message is recoverable; a duplicate is not — but a send that
-- never reached Meta produced no message, so the agent must be able to retry).
create or replace function public.release_manual_send(p_key text)
returns void
language sql
as $$
  delete from public.wa_manual_send_claims where dedup_key = p_key
$$;
