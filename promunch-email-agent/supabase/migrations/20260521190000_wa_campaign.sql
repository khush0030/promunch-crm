-- Marketing broadcast support for WhatsApp campaigns.
-- Links each sent message to its campaign, stores template variables on the
-- campaign, and adds an idempotent counter-recompute function.

-- Link sent messages back to their campaign (null for normal 1:1 sends).
alter table wa_messages
  add column if not exists campaign_id uuid references wa_campaigns(id) on delete set null;

create index if not exists wa_messages_campaign_idx on wa_messages (campaign_id);

-- Per-campaign template variables + run bookkeeping.
alter table wa_campaigns
  add column if not exists template_vars jsonb,
  add column if not exists started_at    timestamptz,
  add column if not exists completed_at  timestamptz,
  add column if not exists last_error    text;

-- Recompute a campaign's delivery funnel from wa_messages.
-- Idempotent: safe to call after every send batch and every Meta status callback.
create or replace function wa_campaign_recount(p_campaign uuid)
returns void language sql as $$
  update wa_campaigns c set
    sent_count      = s.sent,
    delivered_count = s.delivered,
    read_count      = s.read,
    failed_count    = s.failed
  from (
    select
      count(*) filter (where status in ('sent','delivered','read')) as sent,
      count(*) filter (where status in ('delivered','read'))        as delivered,
      count(*) filter (where status = 'read')                       as read,
      count(*) filter (where status = 'failed')                     as failed
    from wa_messages
    where campaign_id = p_campaign
  ) s
  where c.id = p_campaign;
$$;
