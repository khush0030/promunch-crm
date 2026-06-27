-- WhatsApp click tracking. URLs in free-text sends are rewritten to a short
-- /r/<code> link (see wa-send + _shared/links.ts); the redirect logs a click
-- and 302s to the real destination. Powers the "Link clicks" funnel stage and
-- click->order conversion in the dashboard Analytics tab.
--
-- Run ONCE in the Supabase SQL editor (migrations are applied manually here).

create table if not exists wa_short_links (
  id             bigserial primary key,
  code           text unique not null,
  target_url     text not null,
  contact_id     uuid,
  thread_id      uuid,
  journey_run_id uuid,
  sent_by        text,
  created_at     timestamptz not null default now()
);

create table if not exists wa_link_clicks (
  id          bigserial primary key,
  code        text not null,
  contact_id  uuid,
  clicked_at  timestamptz not null default now(),
  ua          text
);

create index if not exists wa_link_clicks_clicked_idx on wa_link_clicks (clicked_at desc);
create index if not exists wa_link_clicks_code_idx on wa_link_clicks (code);
create index if not exists wa_short_links_created_idx on wa_short_links (created_at desc);
