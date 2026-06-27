-- Chat assignment: which team member owns a WhatsApp conversation. Distinct
-- from ticket_assignee (which is per-support-ticket); assigned_to is the chat
-- owner used by the inbox "Mine / Unassigned" filters. Stored as the member's
-- email (team identity = Supabase auth user, no separate members table).
--
-- Roles live in auth user_metadata.role (owner|admin|agent), not here.
--
-- Run ONCE in the Supabase SQL editor.

alter table wa_threads
  add column if not exists assigned_to text;

create index if not exists wa_threads_assigned_idx
  on wa_threads (assigned_to) where assigned_to is not null;
