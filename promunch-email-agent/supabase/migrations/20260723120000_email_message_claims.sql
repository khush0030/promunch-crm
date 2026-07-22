-- Atomic per-message claim for Gmail intake (draft pipeline).
--
-- WHY: processIncomingMessage() is entered by both gmail-webhook (Pub/Sub push)
-- and gmail-poll (every 2 min). Pub/Sub delivery is AT-LEAST-ONCE, so the same
-- Gmail message id can arrive twice near-simultaneously, and a push can race the
-- poll. Each invocation did a read-then-act (check email_threads, compute
-- nextRevision, insert) with no serialisation, so two invocations for the SAME
-- message both did the work: two OpenAI draft calls, two Slack posts, and a race
-- on draft_revisions(email_thread_id, revision) that threw 23505.
--
-- This closes the race AT THE DATABASE, before the expensive fetch + OpenAI
-- draft: gmail_message_id is the PRIMARY KEY, and claim_email_message() is a
-- single atomic INSERT ... ON CONFLICT statement, so concurrent callers are
-- serialised by Postgres — exactly one wins and proceeds, the rest stand down.
--
-- Same family as claim_order_confirmation (wa_confirmation_claims). Difference:
-- there is no terminal 'sent' state here — a Gmail message whose draft FAILED is
-- deliberately re-processed by the poll (retryFailedDraft), and that path is
-- already guarded by the email_threads.gmail_message_id row + insertRevision
-- backoff. So this claim only needs to serialise the in-flight FIRST-processing
-- window. The claim is therefore steal-able after p_window_seconds so a crashed
-- run (won the claim, died before writing the thread row) is retried by the next
-- poll instead of muting the message forever.

create table if not exists public.email_message_claims (
  gmail_message_id text primary key,
  claimed_at       timestamptz not null default now()
);

-- Try to claim a Gmail message for processing. Returns TRUE only to the single
-- caller that may now proceed. Atomic: the whole thing is one statement.
--   - fresh message                 -> INSERT wins      -> true
--   - claimed < window ago          -> WHERE fails      -> false (dup in flight)
--   - claimed > window ago (crashed) -> stolen/re-claim  -> true  (poll retry)
create or replace function public.claim_email_message(
  p_message_id    text,
  p_window_seconds int default 300
)
returns boolean
language plpgsql
as $$
declare
  v_id  text := btrim(coalesce(p_message_id, ''));
  v_won boolean;
begin
  if v_id = '' then
    return false;
  end if;

  insert into public.email_message_claims as c (gmail_message_id, claimed_at)
  values (v_id, now())
  on conflict (gmail_message_id) do update
    set claimed_at = now()
    where c.claimed_at < now() - make_interval(secs => p_window_seconds)
  returning true into v_won;

  return coalesce(v_won, false);
end;
$$;

-- Edge functions call this with the service-role key. Lock it down otherwise.
revoke all on function public.claim_email_message(text, int) from public;
grant execute on function public.claim_email_message(text, int) to service_role;
grant select, insert, update on public.email_message_claims to service_role;
