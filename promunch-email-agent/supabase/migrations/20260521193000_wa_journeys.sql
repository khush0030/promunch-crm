-- Shopify -> WhatsApp automated journeys.
-- wa_journey_runs is a scheduled-message queue: one row = one timed WhatsApp
-- template send. The wa-journey-tick cron drains due rows.
-- Event-driven messages (order confirmation, shipping update) are sent
-- immediately by the shopify-wa webhook and are NOT rows here.

create table if not exists wa_journey_runs (
  id             uuid primary key default gen_random_uuid(),
  journey_key    text not null,                 -- abandoned_checkout | review_request | replenishment_reminder
  wa_id          text not null,                 -- recipient (digits, no +)
  status         text not null default 'active'
                 check (status in ('active','completed','cancelled','converted','failed')),
  next_action_at timestamptz not null,          -- when the message is due
  context        jsonb not null default '{}'::jsonb,   -- { vars: {"1":..,"2":..} }
  order_ref      text,                          -- Shopify order name or checkout token (idempotency)
  last_error     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists wa_journey_runs_due_idx on wa_journey_runs (status, next_action_at);
create index if not exists wa_journey_runs_ref_idx on wa_journey_runs (order_ref);
create index if not exists wa_journey_runs_wa_idx  on wa_journey_runs (wa_id, journey_key, status);

drop trigger if exists wa_journey_runs_touch on wa_journey_runs;
create trigger wa_journey_runs_touch before update on wa_journey_runs
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Seed the 5 journey templates as drafts so they appear in the Templates tab.
-- Edit copy there if you like, then submit each to Meta for approval.
-- ON CONFLICT DO NOTHING — never clobbers a template you already created.
-- ---------------------------------------------------------------------------
insert into wa_templates (name, language, category, status, body, footer, variables)
values
  ('order_confirmation', 'en', 'utility', 'draft',
   E'Hi {{1}}! \xF0\x9F\x8E\x89 Your PROMUNCH order {{2}} is confirmed.\n\nOrder total: \xE2\x82\xB9{{3}}\n\nWe''re packing your munchies now \xE2\x80\x94 you''ll get a tracking update once it ships. Questions? Just reply here.',
   'PROMUNCH \xE2\x80\x94 Your Munchy Pal',
   '[{"name":"1","sample":"Aarav"},{"name":"2","sample":"#1042"},{"name":"3","sample":"499"}]'::jsonb),

  ('shipping_update', 'en', 'utility', 'draft',
   E'Good news, {{1}}! \xF0\x9F\x93\xA6\n\nYour PROMUNCH order {{2}} has shipped. Track it here:\n{{3}}',
   'PROMUNCH \xE2\x80\x94 Your Munchy Pal',
   '[{"name":"1","sample":"Aarav"},{"name":"2","sample":"#1042"},{"name":"3","sample":"https://promunch.in/track"}]'::jsonb),

  ('abandoned_checkout', 'en', 'marketing', 'draft',
   E'Hi {{1}}, you left some munchies behind \xF0\x9F\x9B\x92\n\nYour PROMUNCH cart is still saved. Complete your order here:\n{{2}}',
   'Reply STOP to opt out',
   '[{"name":"1","sample":"Aarav"},{"name":"2","sample":"https://promunch.in/cart"}]'::jsonb),

  ('review_request', 'en', 'marketing', 'draft',
   E'Hey {{1}}! Hope you''re loving your PROMUNCH snacks \xF0\x9F\x98\x8B\n\nWould you share a quick review? It genuinely helps us:\n{{2}}',
   'Reply STOP to opt out',
   '[{"name":"1","sample":"Aarav"},{"name":"2","sample":"https://promunch.in/reviews"}]'::jsonb),

  ('replenishment_reminder', 'en', 'marketing', 'draft',
   E'Running low, {{1}}? \xF0\x9F\xA5\x9C\n\nIt''s been about a month since your last PROMUNCH order. Restock your munchy stash here:\n{{2}}',
   'Reply STOP to opt out',
   '[{"name":"1","sample":"Aarav"},{"name":"2","sample":"https://promunch.in"}]'::jsonb)
on conflict (name, language) do nothing;
