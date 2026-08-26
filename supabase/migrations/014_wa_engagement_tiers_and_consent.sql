-- 014 — WhatsApp audience quality: engagement tiers + an auditable consent trail.
--
-- WHY
-- ---
-- wa_contacts holds 1,413 rows and 1,410 of them carry opted_in = true, but only
-- 82 people have ever sent us an inbound WhatsApp message. The list was bulk
-- imported from Shopify order phones, so `opted_in` says nothing about whether
-- Meta will actually deliver a marketing template. In the last 30 days 890 of
-- 1,151 marketing sends were refused with "not delivered to maintain healthy
-- ecosystem engagement" (Meta #131049) — a PER-RECIPIENT fatigue cap handed out
-- on predicted engagement.
--
-- This migration makes that visible and targetable:
--   1. wa_contact_engagement — a live view that classifies every contact.
--   2. recompute_wa_engagement_tags() — writes the class as a `tier:*` tag on
--      wa_contacts so the EXISTING campaign sender can filter on it unchanged
--      (wa-campaign-send resolves an audience only via
--      audience_filter.tags -> wa_contacts.tags overlap).
--   3. wa_audience_health() — the honest scoreboard the dashboard renders.
--   4. wa_contacts.consent_text + wa_consent_events — record the exact wording a
--      person agreed to when they opt in through the storefront widget.
--
-- Idempotent. Paste into the Supabase dashboard SQL editor (see
-- docs/runbooks/MIGRATIONS.md — the CLI path does not work for this project).

------------------------------------------------------------------------
-- 1. Consent trail
------------------------------------------------------------------------

-- wa_contacts already has consent_source + consent_verified_at (both NULL on
-- every row today — nothing has ever captured a real opt-in). Add the wording.
alter table wa_contacts add column if not exists consent_text text;

comment on column wa_contacts.consent_text is
  'Exact wording the person agreed to at opt-in. NULL = no recorded consent (bulk import).';

-- Append-only audit log: one row per consent action, never updated. wa_contacts
-- carries the latest state; this carries the history you can show a regulator.
create table if not exists wa_consent_events (
  id            uuid primary key default gen_random_uuid(),
  wa_id         text not null,
  contact_id    uuid references wa_contacts(id) on delete set null,
  action        text not null default 'opt_in'
                  check (action in ('opt_in', 'opt_out')),
  source        text not null,
  consent_text  text,
  page_url      text,
  user_agent    text,
  ip_hash       text,
  created_at    timestamptz not null default now()
);

create index if not exists wa_consent_events_wa_id_idx   on wa_consent_events (wa_id);
create index if not exists wa_consent_events_created_idx on wa_consent_events (created_at desc);

comment on table wa_consent_events is
  'Append-only consent audit trail: who agreed to what wording, when, from where. Written by /api/public/wa-optin.';

alter table wa_consent_events enable row level security;
revoke all on wa_consent_events from anon, authenticated;
grant select, insert on wa_consent_events to service_role;

------------------------------------------------------------------------
-- 2. Engagement tiers (live view)
------------------------------------------------------------------------
--
-- Tier ladder, first match wins:
--
--   tier:suppressed  opted out (bare STOP), OR Meta refused 3+ marketing sends
--                    to them in the last 90 days and they have never replied.
--                    Messaging these people burns quota and hurts our quality
--                    rating; they are the list's dead weight.
--   tier:engaged     sent us an inbound message in the last 90 days. This is the
--                    only cohort Meta reliably delivers marketing to.
--   tier:reachable   has replied to us at some point, but not in 90 days.
--   tier:subscribed  explicitly opted in through the storefront widget
--                    (consent_verified_at set) and has not messaged us yet.
--                    Genuine consent, unproven engagement.
--   tier:imported    phone came from a Shopify order or a CRM/CSV import and has
--                    never messaged us. ~71% of the list. This is a cold list.
--
-- Note the deliberate ordering: the Meta-block check sits ABOVE `subscribed`.
-- Somebody who explicitly opted in but whose last three marketing messages were
-- all refused is not reachable by marketing today, and calling them
-- "subscribed" would flatter the number. Their consent record is untouched, so
-- they climb back out of suppression the moment they reply to us.

create or replace view wa_contact_engagement as
with inbound as (
  select
    contact_id,
    max(created_at)  as last_inbound_at,
    count(*)::int    as inbound_count
  from wa_messages
  where direction = 'inbound' and contact_id is not null
  group by contact_id
),
blocks as (
  select
    contact_id,
    count(*)::int as blocks_90d
  from wa_messages
  where direction = 'outbound'
    and status = 'failed'
    and contact_id is not null
    and created_at >= now() - interval '90 days'
    -- Meta #131049. The Cloud API returns the prose, not the code, on the
    -- delivery callback, so match both.
    and (error ilike '%healthy ecosystem%' or error ilike '%131049%')
  group by contact_id
)
select
  c.id,
  c.wa_id,
  c.name,
  c.tags,
  c.opted_in,
  c.consent_source,
  c.consent_verified_at,
  i.last_inbound_at,
  coalesce(i.inbound_count, 0) as inbound_count,
  coalesce(b.blocks_90d, 0)    as blocks_90d,
  case
    when c.opted_in is not true                                  then 'tier:suppressed'
    when i.last_inbound_at >= now() - interval '90 days'          then 'tier:engaged'
    when i.last_inbound_at is not null                            then 'tier:reachable'
    when coalesce(b.blocks_90d, 0) >= 3                           then 'tier:suppressed'
    when c.consent_verified_at is not null                        then 'tier:subscribed'
    else                                                               'tier:imported'
  end as engagement_tier
from wa_contacts c
left join inbound i on i.contact_id = c.id
left join blocks  b on b.contact_id = c.id;

comment on view wa_contact_engagement is
  'Live engagement classification of every wa_contacts row. engagement_tier is the tier:* tag written by recompute_wa_engagement_tags().';

revoke all on wa_contact_engagement from anon, authenticated;
grant select on wa_contact_engagement to service_role;

------------------------------------------------------------------------
-- 3. Persist the tier as a tag
------------------------------------------------------------------------
-- Same shape as recompute_wa_rfm_tags(): strip the old tier:* tag, keep every
-- other tag, append the fresh one. Tag (not a column) on purpose — the campaign
-- sender resolves its audience purely through a tag overlap on wa_contacts, so a
-- tag makes engagement targetable with zero change to the edge function.

create or replace function recompute_wa_engagement_tags()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected integer;
begin
  with fresh as (
    select
      e.id,
      (
        select coalesce(array_agg(t order by t), '{}')
        from unnest(coalesce(c.tags, '{}')) t
        where t not like 'tier:%'
      ) || array[e.engagement_tier] as new_tags
    from wa_contact_engagement e
    join wa_contacts c on c.id = e.id
  )
  update wa_contacts c
     set tags = f.new_tags,
         updated_at = now()
    from fresh f
   where f.id = c.id
     and c.tags is distinct from f.new_tags;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

comment on function recompute_wa_engagement_tags() is
  'Rewrites the single tier:* tag on every wa_contacts row from wa_contact_engagement. Idempotent; run daily.';

------------------------------------------------------------------------
-- 4. Audience health scoreboard
------------------------------------------------------------------------
-- One round trip for the dashboard panel. Marketing = any outbound message whose
-- template_name maps to a wa_templates row with category 'marketing'.

create or replace function wa_audience_health()
returns json
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with eng as (
  select id, engagement_tier, opted_in from wa_contact_engagement
),
mkt as (
  select m.status, e.engagement_tier
  from wa_messages m
  left join eng e on e.id = m.contact_id
  where m.direction = 'outbound'
    and m.created_at >= now() - interval '30 days'
    and m.template_name is not null
    and exists (
      select 1 from wa_templates t
      where t.name = m.template_name and t.category = 'marketing'
    )
),
tiers as (
  select engagement_tier, count(*)::int as n from eng group by 1
)
select json_build_object(
  'total',        (select count(*)::int from wa_contacts),
  'opted_in',     (select count(*)::int from wa_contacts where opted_in),
  'tiers',        (select coalesce(json_object_agg(engagement_tier, n), '{}'::json) from tiers),
  'marketing30d', json_build_object(
                    'sent',      (select count(*)::int from mkt),
                    'failed',    (select count(*)::int from mkt where status = 'failed'),
                    'delivered', (select count(*)::int from mkt where status <> 'failed')),
  'warm30d',      json_build_object(
                    'sent',   (select count(*)::int from mkt
                                where engagement_tier in ('tier:engaged','tier:reachable','tier:subscribed')),
                    'failed', (select count(*)::int from mkt
                                where engagement_tier in ('tier:engaged','tier:reachable','tier:subscribed')
                                  and status = 'failed')),
  'cold30d',      json_build_object(
                    'sent',   (select count(*)::int from mkt
                                where engagement_tier in ('tier:imported','tier:suppressed')),
                    'failed', (select count(*)::int from mkt
                                where engagement_tier in ('tier:imported','tier:suppressed')
                                  and status = 'failed')),
  'inbound30d',   (select count(distinct contact_id)::int from wa_messages
                    where direction = 'inbound' and created_at >= now() - interval '30 days'),
  'consent30d',   (select count(*)::int from wa_contacts
                    where consent_verified_at >= now() - interval '30 days'),
  'consentTotal', (select count(*)::int from wa_contacts where consent_verified_at is not null),
  'generated_at', now()
);
$$;

comment on function wa_audience_health() is
  'Audience-quality scoreboard for the WhatsApp dashboard: tier mix, 30d marketing delivery split warm vs cold, consent capture.';

------------------------------------------------------------------------
-- 5. First run + PostgREST schema reload
------------------------------------------------------------------------
select recompute_wa_engagement_tags();
notify pgrst, 'reload schema';
