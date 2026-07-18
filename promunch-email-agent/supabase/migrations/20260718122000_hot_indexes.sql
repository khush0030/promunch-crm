-- ═══════════════════════════════════════════════════════════════════════════
-- HOT-PATH INDEXES — 2026-07-18 audit finding
--
-- These queries run on every order webhook / every job tick / every analytics
-- load and were doing sequential scans on the two biggest tables:
--   • confirmedOrderRefs (_shared/confirmations.ts) filters wa_messages by
--     template_name + status on EVERY order-confirmation send and sweep run.
--   • wa-jobs-tick dedup guard filters wa_messages by sent_by + status.
--   • shopify-webhook counts prior orders by customer_email on every order;
--     crm-contact.ts looks contacts up the same way on every AI reply.
--   • _shared/orders.ts looks up shopify_orders by order_number on every
--     WhatsApp AI order query and slash command.
--   • COD reminder scan filters by confirmation_status + confirmation_sent_at.
-- ═══════════════════════════════════════════════════════════════════════════

create index if not exists wa_messages_template_status_idx
  on public.wa_messages (template_name, status, created_at desc);

create index if not exists wa_messages_sent_by_status_idx
  on public.wa_messages (sent_by, status);

create index if not exists shopify_orders_customer_email_idx
  on public.shopify_orders (customer_email);

create index if not exists shopify_orders_order_number_idx
  on public.shopify_orders (order_number);

create index if not exists shopify_orders_confirmation_pending_idx
  on public.shopify_orders (confirmation_status, confirmation_sent_at);
