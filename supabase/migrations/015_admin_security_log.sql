-- Admin security view: sign-in history, live sessions, audit log for admins only.
--
-- 1. audit_log becomes admin-only. It holds teammates' IP addresses, so the
--    old "any signed-in user may read" policy is dropped. The app reads it
--    only through admin-gated routes using the service role.
-- 2. Every new Supabase Auth session (= a sign-in) is copied into audit_log as
--    'auth.login', and every session removal as 'auth.session_end'. auth.sessions
--    rows vanish on sign-out/expiry, so without this there is no lasting history.
--    The trigger bodies swallow every error: a logging failure must never block
--    a sign-in.
-- 3. admin_auth_sessions() lets the service role list live sessions (IP,
--    device, last refresh). Not callable by anon/authenticated.

-- 1 -------------------------------------------------------------------------
drop policy if exists "audit_log authenticated read" on audit_log;
revoke all on audit_log from authenticated;
revoke all on audit_log from anon;
create index if not exists audit_log_action_created_idx on audit_log (action, created_at desc);

-- 2 -------------------------------------------------------------------------
create or replace function public.log_auth_session_event()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  s auth.sessions;
begin
  begin
    if tg_op = 'INSERT' then s := new; else s := old; end if;
    insert into public.audit_log (actor_id, actor_email, action, entity_type, entity_id, summary, metadata, ip)
    values (
      s.user_id,
      (select email from auth.users where id = s.user_id),
      case when tg_op = 'INSERT' then 'auth.login' else 'auth.session_end' end,
      'session',
      s.id::text,
      case when tg_op = 'INSERT' then 'Signed in' else 'Session ended (signed out or expired)' end,
      jsonb_build_object('user_agent', s.user_agent, 'aal', s.aal::text),
      host(s.ip)
    );
  exception when others then
    -- Never block auth on a logging problem.
    null;
  end;
  if tg_op = 'INSERT' then return new; end if;
  return old;
end;
$$;

revoke all on function public.log_auth_session_event() from public, anon, authenticated;

drop trigger if exists pm_log_session_start on auth.sessions;
create trigger pm_log_session_start
  after insert on auth.sessions
  for each row execute function public.log_auth_session_event();

drop trigger if exists pm_log_session_end on auth.sessions;
create trigger pm_log_session_end
  after delete on auth.sessions
  for each row execute function public.log_auth_session_event();

-- Backfill sign-ins for sessions that exist today (earlier history is gone).
insert into public.audit_log (actor_id, actor_email, action, entity_type, entity_id, summary, metadata, ip, created_at)
select s.user_id, u.email, 'auth.login', 'session', s.id::text, 'Signed in',
       jsonb_build_object('user_agent', s.user_agent, 'aal', s.aal::text, 'backfilled', true),
       host(s.ip), s.created_at
from auth.sessions s
join auth.users u on u.id = s.user_id
where not exists (
  select 1 from public.audit_log a
  where a.action = 'auth.login' and a.entity_id = s.id::text
);

-- 3 -------------------------------------------------------------------------
create or replace function public.admin_auth_sessions()
returns table (
  id uuid,
  user_id uuid,
  email text,
  created_at timestamptz,
  last_active_at timestamptz,
  ip text,
  user_agent text,
  aal text,
  not_after timestamptz
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select s.id, s.user_id, u.email::text, s.created_at,
         coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at),
         host(s.ip), s.user_agent, s.aal::text, s.not_after
  from auth.sessions s
  join auth.users u on u.id = s.user_id
  order by 5 desc nulls last;
$$;

revoke all on function public.admin_auth_sessions() from public, anon, authenticated;
grant execute on function public.admin_auth_sessions() to service_role;
