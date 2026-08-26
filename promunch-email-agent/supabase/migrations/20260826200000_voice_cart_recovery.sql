-- Sarvam voice-agent rescue call for abandoned carts (design: docs/plans/2026-08-26-sarvam-voice-cart-recovery-design.md).
-- Apply by hand in the Supabase SQL editor.

create table if not exists voice_calls (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid references wa_journey_runs(id) on delete set null,
  wa_id          text not null,
  order_ref      text,
  attempt_id     text,
  interaction_id text,
  webhook_token  text not null,
  status         text not null default 'dialing'
                 check (status in ('dialing','connected','no_answer','busy','failed','start_failed','unknown')),
  outcome        text,
  duration_s     int,
  failure_reason text,
  transcript     jsonb,
  agent_vars     jsonb,
  link_sent_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists voice_calls_wa_created_idx on voice_calls (wa_id, created_at desc);
create index if not exists voice_calls_order_ref_idx on voice_calls (order_ref);
create index if not exists voice_calls_dialing_idx on voice_calls (created_at) where status = 'dialing';
alter table voice_calls enable row level security;
grant select, insert, update on voice_calls to service_role;

alter table wa_contacts add column if not exists voice_dnd boolean not null default false;

alter table wa_flow_settings
  add column if not exists voice_call_enabled     boolean not null default false,
  add column if not exists cart_voice_delay_hours numeric not null default 6,
  add column if not exists voice_min_cart_value   numeric not null default 0,
  add column if not exists voice_call_start_hour  int     not null default 10,
  add column if not exists voice_call_end_hour    int     not null default 20,
  add column if not exists voice_language         text    not null default 'Hindi';

-- Retention: transcripts are the bulky part; keep the row, drop the text after 180d.
create or replace function public.purge_voice_transcripts() returns bigint
language plpgsql security definer set search_path to 'public' as $$
declare n bigint := 0;
begin
  update voice_calls set transcript = null
   where transcript is not null and created_at < now() - interval '180 days';
  get diagnostics n = row_count;
  return n;
end $$;
select cron.schedule('voice-transcript-purge', '20 3 * * *', $$select public.purge_voice_transcripts()$$);
