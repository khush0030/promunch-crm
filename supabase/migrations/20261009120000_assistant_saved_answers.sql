-- Ask Maya → Saved answers.
-- A saved answer is a named question that re-runs with fresh numbers when
-- someone opens it; the answer text at save time is kept as a snapshot.
-- Apply by hand in the Supabase dashboard SQL editor (CLI migrations don't
-- run here). Idempotent. Until this is applied the Ask Maya page hides Save
-- and the Saved answers list (GET /api/assistant/saved returns available:false).

create table if not exists assistant_saved_answers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  question text not null check (char_length(question) between 1 and 2000),
  answer text,
  conversation_id uuid references assistant_conversations(id) on delete set null,
  shared boolean not null default true,
  pinned boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assistant_saved_answers_created_idx
  on assistant_saved_answers (created_at desc);

-- Dashboard API reads/writes through service_role only.
alter table assistant_saved_answers enable row level security;
revoke all on assistant_saved_answers from anon, authenticated;
