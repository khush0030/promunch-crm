-- ═══════════════════════════════════════════════════════════════════════════
-- WhatsApp campaign journeys (follow-ups)
--
-- Additive + idempotent. Paste ONCE into the Supabase SQL editor AFTER
-- 20260929120100_wa_campaign_engine_v2.sql and 20260929130000_wa_warm_audience.sql,
-- and BEFORE deploying the follow-up-aware wa-campaign-send / wa-campaign-worker
-- or the dashboard that creates follow-ups.
--
-- A follow-up is an ordinary wa_campaigns row linked to its parent. It reuses
-- the engine, the per-campaign unique claim (wa_messages_campaign_recipient_uniq),
-- the daily marketing claim, the governor and quiet hours. Its audience is
-- always { retarget: { campaign_id: followup_of, stage: followup_stage,
-- min_hours_since: followup_after_hours } } (written by the dashboard API).
--
--   1. wa_campaigns.followup_of / followup_after_hours / followup_stage
--   2. wa_campaign_filter_match: copied VERBATIM from 20260929130000 (every
--      existing shape behaves identically) plus, inside `retarget`:
--        min_hours_since  per-person timing: eligible only once the contact's
--                         anchor (first REACHED parent message, else first
--                         attempt) is at least that many hours old. A present
--                         but malformed value matches nobody.
--        new stages       delivered, read, replied, clicked, not_clicked,
--                         ordered, not_ordered (see comments below).
--      With min_hours_since, 'not_read' also requires DELIVERED (never remind
--      someone whose first message is still in flight).
--      Every NEW stage requires the parent to have REACHED the contact (Meta
--      accepted it: sent/delivered/read). A contact whose parent send has an
--      unknown outcome (ambiguous) is never in any follow-up.
--   3. wa_campaign_followup_timing(parent, hours): who is still waiting for
--      their time; used by the engine (never complete early) and the dashboard.
--   4. wa_campaign_audience_counts: same keys as before plus waiting_for_time
--      and next_eligible_at.
--   5. wa_campaign_ordered_count(campaign): people reached by a campaign who
--      then placed a paid order (journey card).
--
-- Opt-outs between steps: wa_campaign_audience / _counts still require
-- opted_in = true and not tier:suppressed, re-evaluated on every batch.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.wa_campaigns
  add column if not exists followup_of          uuid references public.wa_campaigns(id) on delete set null,
  add column if not exists followup_after_hours integer,
  add column if not exists followup_stage       text;

alter table public.wa_campaigns drop constraint if exists wa_campaigns_followup_after_hours_check;
alter table public.wa_campaigns add constraint wa_campaigns_followup_after_hours_check
  check (followup_after_hours is null or followup_after_hours between 1 and 720);

alter table public.wa_campaigns drop constraint if exists wa_campaigns_followup_stage_check;
alter table public.wa_campaigns add constraint wa_campaigns_followup_stage_check
  check (followup_stage is null or followup_stage in
    ('delivered','read','not_read','read_no_reply','replied','clicked','not_clicked','ordered','not_ordered'));

-- All three together, or none. (followup_of becomes NULL when the parent row is
-- deleted: ON DELETE SET NULL. The check allows that orphan shape too, since
-- the dashboard deletes a parent's follow-ups with it and an orphan's retarget
-- filter points at a campaign with no messages, so it matches nobody.)
alter table public.wa_campaigns drop constraint if exists wa_campaigns_followup_fields_check;
alter table public.wa_campaigns add constraint wa_campaigns_followup_fields_check
  check (
    (followup_after_hours is null and followup_stage is null and followup_of is null)
    or (followup_after_hours is not null and followup_stage is not null)
  );

create index if not exists wa_campaigns_followup_of_idx
  on public.wa_campaigns (followup_of) where followup_of is not null;

-- Never the exact same message twice after one parent: the dashboard refuses
-- an identical follow-up (same template, blanks and picture) with a
-- read-then-insert check; this makes it atomic for two concurrent creates
-- (double submit, two tabs), which would otherwise put the same message on
-- the same phones twice (on different days, past the daily claim).
-- jsonb::text is canonical (key order independent); hashed so long blanks
-- never exceed the btree row limit. Safe on live data: no row has
-- followup_of before this migration.
create unique index if not exists wa_campaigns_followup_identical_uniq
  on public.wa_campaigns (followup_of, template_id,
                          md5(coalesce(template_vars, '{}'::jsonb)::text),
                          md5(coalesce(header_media_url, '')))
  where followup_of is not null;

comment on column public.wa_campaigns.followup_of is
  'Parent campaign of a follow-up step. NULL for ordinary campaigns.';
comment on column public.wa_campaigns.followup_after_hours is
  'Per-person delay: a contact becomes eligible this many hours after the parent first reached them.';
comment on column public.wa_campaigns.followup_stage is
  'Who in the parent gets the follow-up: delivered, read, not_read, read_no_reply, replied, clicked, not_clicked, ordered, not_ordered.';

-- ---------------------------------------------------------------------------
-- 2. Audience match (copied from 20260929130000 + retarget extensions)
-- ---------------------------------------------------------------------------
-- audience_filter shapes (all optional, combined with AND):
--   { tags: [..] }           OR  (contact has ANY of these)      -- legacy, unchanged
--   { tags_all: [..] }       AND (contact has ALL of these)
--   { exclude_tags: [..] }   contact has NONE of these
--   { engagement: 'warm' }   see 20260929130000 (unchanged)
--   { retarget: { campaign_id, stage, min_hours_since? } }  recipients of an earlier campaign:
--        not_read       got it (sent/delivered) but never read it            (unchanged)
--                       (with min_hours_since: must be DELIVERED, not just sent)
--        not_delivered  attempted, never reached (all failed, none ambiguous) (unchanged)
--        read_no_reply  read it, no inbound message since that campaign's send (unchanged)
--        failed_cap     failed on Meta's #131049 cap, never reached          (unchanged)
--        delivered      reached their phone (delivered or read)
--        read           read it
--        replied        reached, then any inbound from them after it reached them
--        clicked        reached, and clicked one of its tracked links
--        not_clicked    delivered, and no click on its tracked links
--        ordered        reached, then a paid order (total_price > 1, not an HYPD
--                       creator seed) on customer_phone = wa_id after it reached them
--        not_ordered    delivered, and no such order
--   {}                       everyone
create or replace function public.wa_campaign_filter_match(p_filter jsonb)
returns table (contact_id uuid)
language sql stable security definer set search_path = public as $$
  with f as (
    select
      coalesce(array(select jsonb_array_elements_text(
        case when jsonb_typeof(p_filter->'tags') = 'array' then p_filter->'tags' else '[]'::jsonb end)), '{}') as tags_any,
      coalesce(array(select jsonb_array_elements_text(
        case when jsonb_typeof(p_filter->'tags_all') = 'array' then p_filter->'tags_all' else '[]'::jsonb end)), '{}') as tags_all,
      coalesce(array(select jsonb_array_elements_text(
        case when jsonb_typeof(p_filter->'exclude_tags') = 'array' then p_filter->'exclude_tags' else '[]'::jsonb end)), '{}') as tags_not,
      case when jsonb_typeof(p_filter->'retarget') = 'object' then p_filter->'retarget' else null end as rt,
      nullif(p_filter->>'engagement', '') as eng,
      -- min_hours_since: absent -> NULL (no timing rule, existing behaviour);
      -- present but not a whole number 0..9999 -> -1 (matches nobody, never
      -- sends early by accident).
      case
        when p_filter->'retarget' is null or jsonb_typeof(p_filter->'retarget') <> 'object' then null
        when not (p_filter->'retarget' ? 'min_hours_since') then null
        when jsonb_typeof(p_filter->'retarget'->'min_hours_since') = 'null' then null
        when (p_filter->'retarget'->>'min_hours_since') ~ '^[0-9]{1,4}$'
          then (p_filter->'retarget'->>'min_hours_since')::int
        else -1
      end as rt_hours
  ),
  rt_agg as (
    select m.contact_id,
           bool_or(m.status in ('sent','delivered','read')) as reached,
           bool_or(m.status in ('delivered','read'))        as delivered,
           bool_or(m.status = 'read')                       as was_read,
           bool_or(m.status = 'failed' and (m.error_class = 'cap' or m.error ~* '(healthy ecosystem|131049)')) as capped,
           bool_or(m.status = 'failed' and (m.error_class = 'ambiguous' or m.error ~* 'ambiguous')) as unknown_outcome,
           min(m.created_at)                                as first_at,
           -- when the campaign first REACHED them (Meta accepted it)
           min(m.created_at) filter (where m.status in ('sent','delivered','read')) as reached_at
      from wa_messages m, f
     where f.rt is not null
       and m.campaign_id = nullif(f.rt->>'campaign_id', '')::uuid
       and m.direction = 'outbound'
       and m.contact_id is not null
     group by m.contact_id
  ),
  rt_ids as (
    select a.contact_id
      from rt_agg a, f
     where
       -- per-person timing (only when min_hours_since is given)
       (f.rt_hours is null
         or (f.rt_hours >= 0
             and coalesce(a.reached_at, a.first_at) <= now() - make_interval(hours => f.rt_hours)))
       and case f.rt->>'stage'
             -- With a timing rule (a follow-up) 'not_read' also needs DELIVERED:
             -- a row still 'sent' after the delay means the phone has not
             -- received it yet (offline; Meta keeps retrying), and a "you
             -- didn't read it" reminder must never land together with, or
             -- before, the first message. Without a timing rule: unchanged.
             when 'not_read'      then a.reached and not a.was_read
                                       and (f.rt_hours is null or a.delivered)
             -- never REACHED (no sent/delivered/read row) and no send whose
             -- outcome is unknown: a 'sent' row may still deliver (Meta retries
             -- for days) and an ambiguous one may already have landed, so
             -- re-targeting either could put the same offer on the phone twice.
             when 'not_delivered' then not a.reached and not a.unknown_outcome
             when 'read_no_reply' then a.was_read and not exists (
                 select 1 from wa_messages i where i.contact_id = a.contact_id
                    and i.direction = 'inbound' and i.created_at >= a.first_at)
             when 'failed_cap'    then a.capped and not a.reached and not a.unknown_outcome
             -- follow-up stages: all require that the parent REACHED them, so a
             -- contact with only an ambiguous / failed parent send is never in.
             when 'delivered'     then a.delivered
             when 'read'          then a.was_read
             when 'replied'       then a.reached and exists (
                 select 1 from wa_messages i where i.contact_id = a.contact_id
                    and i.direction = 'inbound' and i.created_at >= a.reached_at)
             when 'clicked'       then a.reached and exists (
                 select 1 from wa_short_links s join wa_link_clicks k on k.code = s.code
                  where s.sent_by = 'campaign:' || nullif(f.rt->>'campaign_id', '')::uuid::text
                    and s.contact_id = a.contact_id)
             when 'not_clicked'   then a.delivered and not exists (
                 select 1 from wa_short_links s join wa_link_clicks k on k.code = s.code
                  where s.sent_by = 'campaign:' || nullif(f.rt->>'campaign_id', '')::uuid::text
                    and s.contact_id = a.contact_id)
             when 'ordered'       then a.reached and exists (
                 select 1 from wa_contacts wc join shopify_orders o on o.customer_phone = wc.wa_id
                  where wc.id = a.contact_id
                    and coalesce(o.total_price, 0) > 1
                    and coalesce(o.is_creator, false) = false
                    and o.shopify_created_at >= a.reached_at)
             when 'not_ordered'   then a.delivered and not exists (
                 select 1 from wa_contacts wc join shopify_orders o on o.customer_phone = wc.wa_id
                  where wc.id = a.contact_id
                    and coalesce(o.total_price, 0) > 1
                    and coalesce(o.is_creator, false) = false
                    and o.shopify_created_at >= a.reached_at)
             else false
           end
  ),
  -- Marketing templates, same set as wa_campaign_audience_counts() / the
  -- marketing governor.
  mkt as (
    select name from wa_templates where lower(category) in ('marketing','offer')
    union select unnest(array['abandoned_cart_recovery','abandoned_cart_reminder','abandoned_checkout',
                              'replenishment_reminder','review_request','edamame_launch'])
  ),
  warm_ids as (
    select c.id
      from wa_contacts c, f
     where f.eng = 'warm'
       and (
         exists (select 1 from wa_messages i
                  where i.contact_id = c.id and i.direction = 'inbound'
                    and i.created_at >= now() - interval '90 days')
         or exists (select 1 from wa_messages r
                     where r.contact_id = c.id and r.direction = 'outbound' and r.status = 'read'
                       and r.created_at >= now() - interval '90 days')
         or exists (select 1 from shopify_orders o
                     where o.customer_phone = c.wa_id
                       and coalesce(o.total_price, 0) > 1
                       and coalesce(o.is_creator, false) = false
                       and o.shopify_created_at >= now() - interval '60 days')
       )
       and not exists (select 1 from wa_messages w
                        where w.contact_id = c.id and w.direction = 'outbound' and w.type = 'template'
                          and w.template_name in (select name from mkt)
                          and w.status in ('queued','sent','delivered','read','failed')
                          and not (w.status = 'failed' and w.wa_message_id is null
                                   and coalesce(w.error_class, '') in ('structural','transient'))
                          and w.created_at >= now() - interval '7 days')
       and not exists (select 1 from wa_messages x
                        where x.contact_id = c.id and x.direction = 'outbound' and x.status = 'failed'
                          and (x.error_class = 'cap' or x.error ~* '(healthy ecosystem|131049)')
                          and x.created_at >= now() - interval '14 days')
  )
  select c.id
    from wa_contacts c, f
   where (cardinality(f.tags_any) = 0 or c.tags && f.tags_any)
     and (cardinality(f.tags_all) = 0 or c.tags @> f.tags_all)
     and (cardinality(f.tags_not) = 0 or c.tags is null or not (c.tags && f.tags_not))
     and (f.rt is null or c.id in (select r.contact_id from rt_ids r))
     and (f.eng is null or c.id in (select w.id from warm_ids w));
$$;

-- Unchanged from 20260929120100 (re-stated so this file is self-contained).
create or replace function public.wa_campaign_audience(p_filter jsonb, p_campaign_id uuid default null)
returns table (id uuid, wa_id text, name text, email text, tags text[])
language sql stable security definer set search_path = public as $$
  select c.id, c.wa_id, c.name, c.email, c.tags
    from wa_contacts c
    join wa_campaign_filter_match(coalesce(p_filter, '{}'::jsonb)) fm on fm.contact_id = c.id
   where c.opted_in = true
     and (c.tags is null or not (c.tags @> array['tier:suppressed']))
   order by c.id;
$$;

-- ---------------------------------------------------------------------------
-- 3. Follow-up timing
-- ---------------------------------------------------------------------------
-- For a parent campaign and a delay in hours, per contact the anchor is the
-- first parent message that REACHED them (else their first attempt) — the SAME
-- anchor wa_campaign_filter_match uses for min_hours_since. Returns:
--   waiting_for_time  reached, still opted in + not suppressed, and their
--                     anchor + hours is still in the future ("N more will
--                     become eligible")
--   next_eligible_at  earliest future anchor + hours among those people
--   next_due_at       earliest future anchor + hours among ALL parent contacts
--   last_due_at       latest anchor + hours among ALL parent contacts (the
--                     engine never completes a follow-up while this is in the
--                     future: conservative, never early)
--   parent_contacts   contacts the parent has any outbound row for
create or replace function public.wa_campaign_followup_timing(p_parent uuid, p_hours int)
returns jsonb
language sql stable security definer set search_path = public as $$
  with a as (
    select m.contact_id,
           bool_or(m.status in ('sent','delivered','read')) as reached,
           coalesce(min(m.created_at) filter (where m.status in ('sent','delivered','read')),
                    min(m.created_at)) + make_interval(hours => greatest(coalesce(p_hours, 0), 0)) as due_at
      from wa_messages m
     where m.campaign_id = p_parent
       and m.direction = 'outbound'
       and m.contact_id is not null
     group by m.contact_id
  ),
  w as (
    select a.* from a join wa_contacts c on c.id = a.contact_id
     where a.reached and a.due_at > now()
       and c.opted_in = true
       and (c.tags is null or not (c.tags @> array['tier:suppressed']))
  )
  select jsonb_build_object(
    'waiting_for_time', (select count(*) from w),
    'next_eligible_at', (select min(due_at) from w),
    'next_due_at',      (select min(due_at) from a where due_at > now()),
    'last_due_at',      (select max(due_at) from a),
    'parent_contacts',  (select count(*) from a)
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Preview counts (copied from 20260929120100 + waiting_for_time)
-- ---------------------------------------------------------------------------
create or replace function public.wa_campaign_audience_counts(
  p_filter jsonb, p_campaign_id uuid default null, p_per_24h int default 1, p_per_7d int default 3
) returns jsonb
language sql stable security definer set search_path = public as $$
  with matched as (
    select c.id, c.wa_id, c.opted_in, c.tags
      from wa_contacts c
      join wa_campaign_filter_match(coalesce(p_filter, '{}'::jsonb)) fm on fm.contact_id = c.id
  ),
  base as (
    select m.* from matched m
     where m.opted_in = true
       and (m.tags is null or not (m.tags @> array['tier:suppressed']))
       and not exists (select 1 from wa_marketing_suppression s
                        where s.wa_id = m.wa_id and s.suppressed_until > now())
  ),
  reached as (
    select b.id from base b
     where p_campaign_id is not null and exists (
       select 1 from wa_messages w where w.campaign_id = p_campaign_id and w.contact_id = b.id
          and w.direction = 'outbound' and w.status in ('queued','sent','delivered','read'))
  ),
  open_base as (select b.* from base b where b.id not in (select id from reached)),
  ticket as (
    select o.id from open_base o
     where exists (select 1 from wa_threads t where t.contact_id = o.id and t.ticket_status in ('open','pending'))
  ),
  cart as (
    select o.id from open_base o
     where o.id not in (select id from ticket)
       and exists (select 1 from wa_journey_runs r where r.wa_id = o.wa_id
                      and r.journey_key = 'abandoned_checkout' and r.status = 'active')
  ),
  mkt as (
    select name from wa_templates where lower(category) in ('marketing','offer')
    union select unnest(array['abandoned_cart_recovery','abandoned_cart_reminder','abandoned_checkout',
                              'replenishment_reminder','review_request','edamame_launch'])
  ),
  gov as (
    select o.id from open_base o
     where o.id not in (select id from ticket) and o.id not in (select id from cart)
       and (
         (select count(*) from wa_messages w
           where w.contact_id = o.id and w.direction = 'outbound' and w.type = 'template'
             and w.template_name in (select name from mkt)
             and w.status in ('queued','sent','delivered','read','failed')
             and not (w.status = 'failed' and w.wa_message_id is null
                      and coalesce(w.error_class, '') in ('structural','transient'))
             and w.created_at >= now() - interval '24 hours') >= p_per_24h
         or
         (select count(*) from wa_messages w
           where w.contact_id = o.id and w.direction = 'outbound' and w.type = 'template'
             and w.template_name in (select name from mkt)
             and w.status in ('queued','sent','delivered','read','failed')
             and not (w.status = 'failed' and w.wa_message_id is null
                      and coalesce(w.error_class, '') in ('structural','transient'))
             and w.created_at >= now() - interval '7 days') >= p_per_7d
       )
  ),
  daily as (
    select o.id from open_base o
     where o.id not in (select id from ticket) and o.id not in (select id from cart)
       and o.id not in (select id from gov)
       and exists (select 1 from wa_marketing_daily_claims d
                    where d.contact_id = o.id
                      and d.ist_day = (now() at time zone 'Asia/Kolkata')::date
                      and d.source_id is distinct from coalesce(p_campaign_id::text, ''))
  ),
  -- follow-up timing (only for a retarget filter with a valid min_hours_since)
  fu as (
    select wa_campaign_followup_timing(
             nullif(p_filter->'retarget'->>'campaign_id', '')::uuid,
             (p_filter->'retarget'->>'min_hours_since')::int) as t
     where jsonb_typeof(p_filter->'retarget') = 'object'
       and (p_filter->'retarget'->>'min_hours_since') ~ '^[0-9]{1,4}$'
  )
  select jsonb_build_object(
    'total_matched',        (select count(*) from matched),
    'excluded_suppressed',  (select count(*) from matched) - (select count(*) from base),
    'already_reached',      (select count(*) from reached),
    'excluded_ticket',      (select count(*) from ticket),
    'excluded_cart',        (select count(*) from cart),
    'excluded_governor',    (select count(*) from gov),
    'excluded_daily_claim', (select count(*) from daily),
    'eligible_total',       (select count(*) from open_base),
    'eligible',             (select count(*) from open_base)
                              - (select count(*) from ticket) - (select count(*) from cart)
                              - (select count(*) from gov) - (select count(*) from daily),
    'waiting_for_time',     coalesce((select (t->>'waiting_for_time')::int from fu), 0),
    'next_eligible_at',     (select t->'next_eligible_at' from fu)
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. Ordered count (journey card)
-- ---------------------------------------------------------------------------
create or replace function public.wa_campaign_ordered_count(p_campaign uuid)
returns integer
language sql stable security definer set search_path = public as $$
  with a as (
    select m.contact_id, min(m.created_at) as reached_at
      from wa_messages m
     where m.campaign_id = p_campaign and m.direction = 'outbound' and m.contact_id is not null
       and m.status in ('sent','delivered','read')
     group by m.contact_id
  )
  select count(*)::int
    from a join wa_contacts c on c.id = a.contact_id
   where exists (select 1 from shopify_orders o
                  where o.customer_phone = c.wa_id
                    and coalesce(o.total_price, 0) > 1
                    and coalesce(o.is_creator, false) = false
                    and o.shopify_created_at >= a.reached_at);
$$;

-- ---------------------------------------------------------------------------
-- Grants: service_role only (same as the originals)
-- ---------------------------------------------------------------------------
revoke all on function public.wa_campaign_filter_match(jsonb) from public, anon, authenticated;
revoke all on function public.wa_campaign_audience(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.wa_campaign_audience_counts(jsonb, uuid, int, int) from public, anon, authenticated;
revoke all on function public.wa_campaign_followup_timing(uuid, int) from public, anon, authenticated;
revoke all on function public.wa_campaign_ordered_count(uuid) from public, anon, authenticated;
grant execute on function public.wa_campaign_filter_match(jsonb) to service_role;
grant execute on function public.wa_campaign_audience(jsonb, uuid) to service_role;
grant execute on function public.wa_campaign_audience_counts(jsonb, uuid, int, int) to service_role;
grant execute on function public.wa_campaign_followup_timing(uuid, int) to service_role;
grant execute on function public.wa_campaign_ordered_count(uuid) to service_role;

commit;

-- Verify:
--   select column_name from information_schema.columns
--    where table_name = 'wa_campaigns' and column_name like 'followup_%';        -- 3 rows
--   select count(*) from wa_campaign_audience('{"tags":["rfm:vip"]}'::jsonb);    -- unchanged
--   select count(*) from wa_campaign_audience('{"engagement":"nonsense"}'::jsonb); -- 0
--   select wa_campaign_audience_counts('{}'::jsonb) ? 'waiting_for_time';        -- true
--   select wa_campaign_followup_timing('<campaign id>'::uuid, 48);
