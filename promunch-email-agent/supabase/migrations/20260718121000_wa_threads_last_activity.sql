-- ═══════════════════════════════════════════════════════════════════════════
-- wa_threads.last_activity_at — 2026-07-18 audit finding
--
-- The inbox API (src/app/api/whatsapp/threads/route.ts) orders threads by
-- last_activity_at, and the documented product rule is "inbox orders by last
-- activity, inbound OR outbound" — but the column was never created on
-- wa_threads (only ig_threads has it). Ordering silently regressed.
--
-- This adds the column, backfills it from the message ledger, indexes the
-- inbox sort, and maintains it with a trigger on wa_messages inserts — so no
-- edge-function send path needs to change.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.wa_threads
  add column if not exists last_activity_at timestamptz;

-- Backfill: latest message in the thread, else the thread's own created_at.
update public.wa_threads t
   set last_activity_at = coalesce(
     (select max(m.created_at) from public.wa_messages m where m.thread_id = t.id),
     t.created_at)
 where t.last_activity_at is null;

alter table public.wa_threads
  alter column last_activity_at set default now(),
  alter column last_activity_at set not null;

create index if not exists wa_threads_last_activity_idx
  on public.wa_threads (last_activity_at desc);

create or replace function public.bump_wa_thread_activity()
returns trigger language plpgsql as $$
begin
  update public.wa_threads
     set last_activity_at = greatest(coalesce(last_activity_at, new.created_at), new.created_at)
   where id = new.thread_id;
  return new;
end $$;

drop trigger if exists wa_messages_bump_thread_activity on public.wa_messages;
create trigger wa_messages_bump_thread_activity
  after insert on public.wa_messages
  for each row execute function public.bump_wa_thread_activity();
