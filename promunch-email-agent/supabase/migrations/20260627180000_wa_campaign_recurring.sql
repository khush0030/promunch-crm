-- Recurring / ongoing WhatsApp campaigns. A campaign with a repeat_rule acts as
-- a recurring DEFINITION: the wa-campaign-tick cron, when it fires, spawns a
-- one-time CHILD campaign for that occurrence (parent_campaign_id set) and
-- advances the parent's scheduled_at to the next occurrence — until repeat_until
-- passes, when the parent is marked completed. Each occurrence is its own send
-- (own campaign_id ledger) so recipients can be messaged again each cycle.
--
-- Run ONCE in the Supabase SQL editor.

alter table wa_campaigns
  add column if not exists repeat_rule        text
    check (repeat_rule in ('daily','weekly','monthly')),
  add column if not exists repeat_until       timestamptz,
  add column if not exists parent_campaign_id uuid references wa_campaigns(id) on delete set null;

-- Find due recurring parents quickly.
create index if not exists wa_campaigns_recurring_idx
  on wa_campaigns (scheduled_at)
  where repeat_rule is not null and status = 'scheduled';
