-- PROMUNCH WhatsApp + Knowledge Base — initial schema
-- Inbound/outbound WA via Meta Cloud API, AI customer support agent,
-- marketing/offer templates, ticket flags on threads, RAG KB with pgvector.

create extension if not exists "pgcrypto";
create extension if not exists "vector";

------------------------------------------------------------------------
-- wa_contacts
--   One per phone number (E.164). Cached display name + last-seen.
------------------------------------------------------------------------
create table if not exists wa_contacts (
  id              uuid primary key default gen_random_uuid(),
  wa_id           text not null unique,                -- Meta wa_id (digits, no +)
  phone           text not null,                       -- E.164 incl + (for display/send)
  name            text,                                -- WA profile name
  email           text,                                -- if known via CRM link
  shopify_customer_id text,                            -- optional link
  tags            text[] default '{}',
  opted_in        boolean default true,
  last_seen_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists wa_contacts_phone_idx on wa_contacts (phone);

------------------------------------------------------------------------
-- wa_threads
--   One per (contact). The "conversation". Ticket flags live here.
------------------------------------------------------------------------
create table if not exists wa_threads (
  id                  uuid primary key default gen_random_uuid(),
  contact_id          uuid not null references wa_contacts(id) on delete cascade,
  wa_id               text not null,                   -- denorm for fast lookup

  -- conversation state
  status              text not null default 'bot'
                      check (status in ('bot', 'human', 'snoozed', 'closed')),
  last_inbound_at     timestamptz,
  last_outbound_at    timestamptz,
  last_message_snippet text,
  unread_count        int not null default 0,

  -- ticket flags (kept on thread, no separate table)
  ticket_status       text not null default 'none'
                      check (ticket_status in ('none','open','pending','resolved','closed')),
  ticket_number       serial unique,                    -- human-friendly #
  ticket_priority     text default 'normal'
                      check (ticket_priority in ('low','normal','high','urgent')),
  ticket_category     text,                             -- e.g. order_issue, refund, product_query
  ticket_subject      text,
  ticket_assignee     text,                             -- email/user id
  ticket_opened_at    timestamptz,
  ticket_resolved_at  timestamptz,
  escalation_reason   text,                             -- why bot handed off

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (contact_id)
);

create index if not exists wa_threads_status_idx on wa_threads (status, last_inbound_at desc nulls last);
create index if not exists wa_threads_ticket_idx on wa_threads (ticket_status, ticket_priority, ticket_opened_at desc);

------------------------------------------------------------------------
-- wa_messages
--   Every message in/out. wa_message_id is Meta's id for dedupe.
------------------------------------------------------------------------
create table if not exists wa_messages (
  id              uuid primary key default gen_random_uuid(),
  thread_id       uuid not null references wa_threads(id) on delete cascade,
  contact_id      uuid not null references wa_contacts(id) on delete cascade,

  direction       text not null check (direction in ('inbound','outbound')),
  type            text not null default 'text'
                  check (type in ('text','template','image','document','audio','video','interactive','reaction','system')),
  body            text,                                 -- plain text content
  media_url       text,
  media_mime      text,

  wa_message_id   text unique,                          -- Meta wamid for dedupe
  status          text not null default 'received'
                  check (status in ('received','queued','sent','delivered','read','failed')),
  error           text,

  template_name   text,                                 -- if template send
  template_lang   text,
  template_vars   jsonb,

  sent_by         text,                                 -- 'bot' | user email
  ai_model        text,
  ai_meta         jsonb,                                -- {tokens, kb_chunks, etc}

  created_at      timestamptz not null default now()
);

create index if not exists wa_messages_thread_idx on wa_messages (thread_id, created_at desc);
create index if not exists wa_messages_direction_idx on wa_messages (direction, created_at desc);

------------------------------------------------------------------------
-- wa_templates
--   Cached mirror of Meta-approved templates plus our drafts.
------------------------------------------------------------------------
create table if not exists wa_templates (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  language        text not null default 'en',
  category        text not null check (category in ('marketing','utility','authentication','offer')),
  status          text not null default 'draft'
                  check (status in ('draft','pending','approved','rejected','disabled')),
  meta_template_id text,                                -- Meta-side id when synced
  header_type     text,                                 -- TEXT|IMAGE|VIDEO|DOCUMENT|null
  header_text     text,
  header_media_url text,
  body            text not null,                        -- {{1}} {{2}} placeholders
  footer          text,
  buttons         jsonb,                                -- [{type, text, url?, phone_number?}]
  variables       jsonb,                                -- [{name, sample}] for builder UI
  rejection_reason text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (name, language)
);

------------------------------------------------------------------------
-- wa_campaigns
--   Bulk template sends to a contact segment.
------------------------------------------------------------------------
create table if not exists wa_campaigns (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  template_id     uuid references wa_templates(id),
  audience_filter jsonb,                                -- e.g. {tags:['vip']}
  status          text not null default 'draft'
                  check (status in ('draft','scheduled','sending','completed','failed','cancelled')),
  scheduled_at    timestamptz,
  sent_count      int not null default 0,
  delivered_count int not null default 0,
  read_count      int not null default 0,
  failed_count    int not null default 0,
  created_by      text,
  created_at      timestamptz not null default now()
);

------------------------------------------------------------------------
-- kb_documents
--   Source docs for the AI support agent RAG.
------------------------------------------------------------------------
create table if not exists kb_documents (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  source_type     text not null default 'upload'
                  check (source_type in ('upload','url','manual')),
  source_uri      text,                                 -- storage path or url
  mime_type       text,
  size_bytes      bigint,
  raw_text        text,
  status          text not null default 'pending'
                  check (status in ('pending','processing','ready','failed')),
  error           text,
  chunk_count     int default 0,
  uploaded_by     text,
  created_at      timestamptz not null default now(),
  processed_at    timestamptz
);

------------------------------------------------------------------------
-- kb_chunks
--   Embedded chunks for similarity search. 1536 dims (OpenAI small)
--   or 1024 (Voyage). Use 1536 default; truncate or re-embed if model changes.
------------------------------------------------------------------------
create table if not exists kb_chunks (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references kb_documents(id) on delete cascade,
  chunk_index     int not null,
  content         text not null,
  token_count     int,
  embedding       vector(1536),
  metadata        jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists kb_chunks_doc_idx on kb_chunks (document_id, chunk_index);
create index if not exists kb_chunks_embedding_idx
  on kb_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

------------------------------------------------------------------------
-- match_kb_chunks() — similarity search RPC for the AI agent
------------------------------------------------------------------------
create or replace function match_kb_chunks(
  query_embedding vector(1536),
  match_threshold float default 0.5,
  match_count int default 6
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  similarity float
)
language sql stable
as $$
  select
    c.id,
    c.document_id,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from kb_chunks c
  where c.embedding is not null
    and 1 - (c.embedding <=> query_embedding) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

------------------------------------------------------------------------
-- updated_at touch triggers
------------------------------------------------------------------------
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists wa_contacts_touch on wa_contacts;
create trigger wa_contacts_touch before update on wa_contacts
  for each row execute function touch_updated_at();

drop trigger if exists wa_threads_touch on wa_threads;
create trigger wa_threads_touch before update on wa_threads
  for each row execute function touch_updated_at();

drop trigger if exists wa_templates_touch on wa_templates;
create trigger wa_templates_touch before update on wa_templates
  for each row execute function touch_updated_at();
