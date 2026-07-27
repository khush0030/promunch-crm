-- Dashboard control for confirmation template variants + brand voice tagline.
--
-- confirmation_template_first  — template sent on a customer's first order
--                                (NULL → order_confirmation_v2, today's behavior)
-- confirmation_template_repeat — template sent when the order phone already has
--                                an earlier shopify_orders row; empty/NULL or
--                                not-approved-at-Meta → falls back to first
-- tagline_text                 — brand sign-off appended to system-written
--                                free-text messages (NULL → "Your Munchy Pal 💚")
-- tagline_*                    — per-surface switches for that sign-off
--                                (NULL → true, today's behavior)
--
-- All columns nullable: applying this migration changes NOTHING until someone
-- edits the Flows tab. Edge functions fall back to FLOW_DEFAULTS on NULL.
alter table wa_flow_settings
  add column if not exists confirmation_template_first text,
  add column if not exists confirmation_template_repeat text,
  add column if not exists tagline_text text,
  add column if not exists tagline_bot_replies boolean,
  add column if not exists tagline_proactive_asks boolean,
  add column if not exists tagline_cod_gate boolean,
  add column if not exists tagline_checkout_footer boolean;

-- Seed the returning-customer template so the repeat-welcome fix goes live the
-- moment Meta approves order_confirmation_repeat_v1 (the send path falls back
-- to the first-order template until then, and while the value is unset).
-- One-time seed: only fills a NULL, so a later Flows-tab choice is never
-- overwritten by re-running this migration.
update wa_flow_settings
   set confirmation_template_repeat = 'order_confirmation_repeat_v1'
 where id = 1 and confirmation_template_repeat is null;
