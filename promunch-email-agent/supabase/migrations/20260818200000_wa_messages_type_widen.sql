-- wa_messages.type check constraint was too narrow: it never allowed 'button'
-- (template quick-reply taps) or 'order' (WhatsApp catalog cart), so every COD
-- gate Confirm/Cancel tap since the gate went live blew up the inbound insert
-- in wa-webhook and the tap was dropped before handleGateButton ever ran.
-- 92 dropped taps across 60 orders between 2026-07-25 and 2026-08-18.
--
-- Widen to every inbound message type Meta can deliver, plus 'unsupported' /
-- 'unknown' as the catch-all wa-webhook now clamps anything new to, so a future
-- Meta message type can never again break inbound processing.
--
-- Apply in the Supabase SQL editor BEFORE deploying wa-webhook.

alter table wa_messages drop constraint if exists wa_messages_type_check;

alter table wa_messages add constraint wa_messages_type_check
  check (type in (
    'text','template','image','document','audio','video',
    'interactive','reaction','system','button','order',
    'sticker','location','contacts','unsupported','unknown'
  ));
