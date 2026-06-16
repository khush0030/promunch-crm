-- Atomic per-turn claim for WhatsApp AI replies.
--
-- WHY: wa-webhook fires an instant fast-path wa-ai-reply for EVERY inbound
-- message, and wa-jobs-tick re-invokes it on retry. When a customer sends three
-- messages in a few seconds, three runs race; each reads the thread and each
-- sends — the customer gets three replies. And if a fast-path send succeeds but
-- the run dies before marking its job done (edge teardown), the cron retries
-- and sends a duplicate. A read-then-send check can never be safe against that
-- race (same root cause as the order-confirmation dupes — see
-- 20260602160000_wa_confirmation_claims.sql).
--
-- This closes the race AT THE DATABASE: (thread_id, inbound_id) is the PRIMARY
-- KEY, so exactly ONE run may hold the claim for a given inbound turn. Combined
-- with the "a newer inbound arrived -> stand down" check in wa-ai-reply, a
-- rapid-fire burst collapses into a single reply to the fullest context.
--
-- No-spam is non-negotiable: a missed reply is recoverable (a later run / the
-- cron retries), a duplicate is not. So a FAILED send releases its claim, a
-- SUCCESSFUL send marks it 'sent' (can never be re-sent), and a claim left
-- 'sending' by a crashed run becomes steal-able after 5 minutes so one crash
-- can't permanently mute a customer.

create table if not exists public.wa_reply_claims (
  thread_id  uuid not null,
  inbound_id text not null,                      -- wa_messages.id of the inbound turn
  status     text not null default 'sending',    -- 'sending' | 'sent'
  claimed_at timestamptz not null default now(),
  primary key (thread_id, inbound_id)
);

-- Try to claim a turn for an AI reply. Returns TRUE only to the single run that
-- may now send. Atomic: the whole thing is one statement.
--   - fresh turn             -> INSERT wins  -> true
--   - already 'sent'         -> WHERE fails  -> false  (never re-send)
--   - 'sending' < 5 min ago  -> WHERE fails  -> false  (another run is sending)
--   - 'sending' > 5 min ago  -> stolen       -> true   (prior run died; retry)
create or replace function public.claim_ai_reply(p_thread uuid, p_inbound text)
returns boolean
language plpgsql
as $$
declare
  v_won boolean;
begin
  if p_thread is null or coalesce(p_inbound, '') = '' then
    return false;
  end if;

  insert into public.wa_reply_claims as c (thread_id, inbound_id, status, claimed_at)
  values (p_thread, p_inbound, 'sending', now())
  on conflict (thread_id, inbound_id) do update
    set status = 'sending', claimed_at = now()
    where c.status <> 'sent'
      and c.claimed_at < now() - interval '5 minutes'
  returning true into v_won;

  return coalesce(v_won, false);
end;
$$;

-- Lock a claim as 'sent' once wa-send accepted the reply — can never re-send.
create or replace function public.mark_ai_reply_sent(p_thread uuid, p_inbound text)
returns void
language sql
as $$
  update public.wa_reply_claims
     set status = 'sent', claimed_at = now()
   where thread_id = p_thread and inbound_id = p_inbound
$$;

-- Release a claim after a FAILED send so a retry can re-send immediately.
create or replace function public.release_ai_reply(p_thread uuid, p_inbound text)
returns void
language sql
as $$
  delete from public.wa_reply_claims
   where thread_id = p_thread and inbound_id = p_inbound and status <> 'sent'
$$;
