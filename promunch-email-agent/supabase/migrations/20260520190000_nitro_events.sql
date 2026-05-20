-- Nitro (NitroCommerce) webhook ingestion.
-- Receives user activity, contact exports, consent, FBP, and HIU events.
-- Raw audit in nitro_events; derived state on wa_contacts.

------------------------------------------------------------------------
-- wa_contacts: extend for Nitro-derived attributes
------------------------------------------------------------------------
alter table wa_contacts
  add column if not exists nitro_user_id        text,
  add column if not exists ltv_cents            bigint not null default 0,
  add column if not exists order_count          int not null default 0,
  add column if not exists last_order_at        timestamptz,
  add column if not exists last_intent_at       timestamptz,
  add column if not exists last_intent_event    text,
  add column if not exists intent_score         int not null default 0,
  add column if not exists last_cart_value_cents bigint,
  add column if not exists first_session_at     timestamptz,
  add column if not exists consent_source       text,
  add column if not exists consent_verified_at  timestamptz,
  add column if not exists fbp                  text,
  add column if not exists geo_country          text,
  add column if not exists geo_state            text,
  add column if not exists geo_city             text,
  add column if not exists geo_postal           text;

create index if not exists wa_contacts_nitro_user_idx on wa_contacts (nitro_user_id);
create index if not exists wa_contacts_email_idx on wa_contacts (email) where email is not null;
create index if not exists wa_contacts_ltv_idx on wa_contacts (ltv_cents desc);
create index if not exists wa_contacts_intent_idx on wa_contacts (last_intent_at desc nulls last);

------------------------------------------------------------------------
-- nitro_events: raw audit log, dedupe-safe
------------------------------------------------------------------------
create table if not exists nitro_events (
  id              uuid primary key default gen_random_uuid(),
  org_token       text not null,
  event_name      text not null,                       -- view, product_view, orders/create, hiu_tagged, etc
  nitro_user_id   text,                                -- Nitro's userId
  contact_id      uuid references wa_contacts(id) on delete set null,
  customer_phone  text,                                -- E.164
  customer_email  text,
  customer_name   text,
  cart_value_cents bigint,
  order_id        bigint,
  order_number    int,
  resource_id     bigint,                              -- product_id / collection
  page_url        text,
  payload         jsonb not null,
  dedupe_key      text not null unique,                -- nitro_user_id|event_name|timestamp
  event_ts        timestamptz,                         -- timestamp from payload
  received_at     timestamptz not null default now()
);

create index if not exists nitro_events_user_idx on nitro_events (nitro_user_id, received_at desc);
create index if not exists nitro_events_phone_idx on nitro_events (customer_phone, received_at desc);
create index if not exists nitro_events_name_idx on nitro_events (event_name, received_at desc);
create index if not exists nitro_events_org_idx on nitro_events (org_token, received_at desc);
