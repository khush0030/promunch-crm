-- Instagram inbound DM automation + collab CRM.
--
-- Mirrors the WhatsApp inbound stack (wa_threads / wa_messages / wa_jobs +
-- wa_reply_claims) one-for-one. The bot triages every inbound DM/comment
-- (collab | order | spam), auto-replies routine messages from the Master KB,
-- escalates real barter inquiries to a human, and tracks collab inquiries
-- through a pipeline. No outbound cold DM — Instagram forbids it.
--
-- NO-SPAM is non-negotiable (same invariant as WhatsApp): a missed reply is
-- recoverable, a duplicate is not. Every send takes the atomic per-turn claim
-- below before sending; the durable ig_jobs ledger + ig-jobs-tick retry it.

-- ---------------------------------------------------------------------------
-- Threads — one per Instagram user (IGSID) who messaged / commented.
-- ---------------------------------------------------------------------------
create table if not exists public.ig_threads (
  id                  uuid primary key default gen_random_uuid(),
  ig_user_id          text not null,                      -- Instagram-scoped sender id (IGSID)
  handle              text,
  full_name           text,
  profile_pic         text,
  status              text not null default 'bot',        -- 'bot' | 'human'
  classification      text not null default 'unknown',    -- 'collab' | 'order' | 'spam' | 'unknown'
  collab_stage        text,                               -- new|in_convo|terms_sent|agreed|shipped|posted|declined
  followers           integer,                            -- from Business Discovery (optional)
  engagement_rate     numeric,
  band_fit            boolean,                            -- inside the target 20k–100k micro band
  last_inbound_at     timestamptz,
  last_outbound_at    timestamptz,
  last_activity_at    timestamptz not null default now(),
  last_message_snippet text,
  unread_count        integer not null default 0,
  ticket_status       text,
  ticket_priority     text,
  ticket_category     text,
  ticket_opened_at    timestamptz,
  escalation_reason   text,
  assigned_to         text,
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (ig_user_id)
);
create index if not exists ig_threads_activity_idx on public.ig_threads (last_activity_at desc);
create index if not exists ig_threads_class_idx on public.ig_threads (classification);
create index if not exists ig_threads_stage_idx on public.ig_threads (collab_stage);

-- ---------------------------------------------------------------------------
-- Messages — durable ledger of every inbound + outbound DM / comment.
-- ---------------------------------------------------------------------------
create table if not exists public.ig_messages (
  id            uuid primary key default gen_random_uuid(),
  thread_id     uuid not null references public.ig_threads(id) on delete cascade,
  ig_user_id    text,
  direction     text not null,                            -- 'inbound' | 'outbound'
  kind          text not null default 'dm',               -- 'dm' | 'comment' | 'private_reply'
  text          text,
  media_url     text,
  ig_message_id text,                                     -- Meta mid (DM) — dedup key
  comment_id    text,                                     -- Meta comment id (comment / private_reply)
  status        text not null default 'received',         -- received|sent|delivered|read|failed
  sent_by       text,                                     -- 'bot' | 'human' | 'optout' | ...
  ai_generated  boolean not null default false,
  ai_meta       jsonb,
  error         text,
  created_at    timestamptz not null default now()
);
create index if not exists ig_messages_thread_idx on public.ig_messages (thread_id, created_at);
-- dedup inbound Meta retries: one row per mid / comment id
create unique index if not exists ig_messages_mid_uidx on public.ig_messages (ig_message_id) where ig_message_id is not null;
create unique index if not exists ig_messages_comment_uidx on public.ig_messages (comment_id) where comment_id is not null and direction = 'inbound';

-- ---------------------------------------------------------------------------
-- Durable background-job ledger (mirrors wa_jobs). Drained by ig-jobs-tick.
-- ---------------------------------------------------------------------------
create table if not exists public.ig_jobs (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,                             -- 'ai_reply'
  payload      jsonb not null default '{}'::jsonb,
  status       text not null default 'pending',           -- pending|done|failed
  attempts     integer not null default 0,
  max_attempts integer not null default 5,
  run_after    timestamptz not null default now(),
  last_error   text,
  created_at   timestamptz not null default now()
);
create index if not exists ig_jobs_due_idx on public.ig_jobs (status, run_after);

-- ---------------------------------------------------------------------------
-- Settings — single row id=1 (mirrors outreach_settings).
-- ---------------------------------------------------------------------------
create table if not exists public.ig_settings (
  id                 integer primary key default 1 check (id = 1),
  paused             boolean not null default false,
  auto_reply_enabled boolean not null default true,
  auto_reply_scope   text not null default 'routine_only', -- 'routine_only' | 'all'
  auto_reply_comments boolean not null default true,
  escalate_to_slack  boolean not null default true,
  min_followers      integer not null default 20000,
  max_followers      integer not null default 100000,
  barter_terms       text,
  updated_at         timestamptz not null default now()
);
insert into public.ig_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Atomic per-turn reply claim (mirrors wa_reply_claims / claim_ai_reply).
-- (thread_id, inbound_id) is the PK so exactly ONE run may send for a turn.
-- ---------------------------------------------------------------------------
create table if not exists public.ig_reply_claims (
  thread_id  uuid not null,
  inbound_id text not null,                               -- ig_messages.id of the inbound turn
  status     text not null default 'sending',             -- 'sending' | 'sent'
  claimed_at timestamptz not null default now(),
  primary key (thread_id, inbound_id)
);

create or replace function public.claim_ig_reply(p_thread uuid, p_inbound text)
returns boolean
language plpgsql
as $$
declare
  v_won boolean;
begin
  if p_thread is null or coalesce(p_inbound, '') = '' then
    return false;
  end if;

  insert into public.ig_reply_claims as c (thread_id, inbound_id, status, claimed_at)
  values (p_thread, p_inbound, 'sending', now())
  on conflict (thread_id, inbound_id) do update
    set status = 'sending', claimed_at = now()
    where c.status <> 'sent'
      and c.claimed_at < now() - interval '5 minutes'
  returning true into v_won;

  return coalesce(v_won, false);
end;
$$;

create or replace function public.mark_ig_reply_sent(p_thread uuid, p_inbound text)
returns void
language sql
as $$
  update public.ig_reply_claims
     set status = 'sent', claimed_at = now()
   where thread_id = p_thread and inbound_id = p_inbound
$$;

create or replace function public.release_ig_reply(p_thread uuid, p_inbound text)
returns void
language sql
as $$
  delete from public.ig_reply_claims
   where thread_id = p_thread and inbound_id = p_inbound and status <> 'sent'
$$;
