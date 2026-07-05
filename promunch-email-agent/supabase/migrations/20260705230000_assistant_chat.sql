-- Maya — dashboard AI assistant.
-- Chat history tables + a pg_cron introspection helper for the health tool.
-- Apply via the Supabase dashboard SQL editor (CLI migrations don't run here).

create table if not exists assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  title text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists assistant_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references assistant_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index if not exists assistant_messages_conversation_idx
  on assistant_messages (conversation_id, created_at);
create index if not exists assistant_conversations_updated_idx
  on assistant_conversations (updated_at desc);

-- Dashboard API reads/writes exclusively through service_role; nothing here is
-- exposed to anon or authenticated PostgREST clients.
alter table assistant_conversations enable row level security;
alter table assistant_messages enable row level security;
revoke all on assistant_conversations from anon, authenticated;
revoke all on assistant_messages from anon, authenticated;

-- PostgREST only exposes the public schema, so the assistant's health tool
-- cannot read cron.job directly. Wrap it in a definer function that returns
-- each job plus its most recent run outcome.
create or replace function public.assistant_cron_status()
returns table (
  jobname text,
  schedule text,
  active boolean,
  last_status text,
  last_start timestamptz
)
language sql
security definer
set search_path = public, cron
as $$
  select
    j.jobname::text,
    j.schedule::text,
    j.active,
    d.status::text as last_status,
    d.start_time as last_start
  from cron.job j
  left join lateral (
    select status, start_time
    from cron.job_run_details
    where jobid = j.jobid
    order by start_time desc
    limit 1
  ) d on true
  order by j.jobname;
$$;

revoke all on function public.assistant_cron_status() from public;
revoke all on function public.assistant_cron_status() from anon, authenticated;
grant execute on function public.assistant_cron_status() to service_role;
