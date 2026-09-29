-- ═══════════════════════════════════════════════════════════════════════════
-- WhatsApp campaigns: "Warm" audience preset + CSV list tagging
--
-- Additive + idempotent. Paste into the Supabase SQL editor AFTER
-- 20260929120100_wa_campaign_engine_v2.sql (this file replaces the
-- wa_campaign_filter_match() defined there, copied from it verbatim (incl. the
-- reviewed not_delivered / failed_cap unknown-outcome rules) plus one new key).
--
-- 1. audience_filter { engagement: 'warm' }  (docs/whatsapp/WA_DELIVERABILITY_PLAYBOOK.md §3)
--      opted in and not tier:suppressed        (applied by wa_campaign_audience /
--                                               wa_campaign_audience_counts, unchanged)
--      AND ( inbound message in the last 90 days
--         OR any outbound message READ in the last 90 days
--         OR a paid Shopify order (total_price > 1, not an HYPD creator seed)
--            on customer_phone = wa_id in the last 60 days )
--      AND no marketing-template attempt to them in the last 7 days
--      AND no Meta #131049 ("held back by Meta") on them in the last 14 days
--    Any other `engagement` value matches NOBODY (never silently widens an
--    audience). The engine (wa-campaign-send -> wa_campaign_audience) and the
--    dashboard preview (wa_campaign_audience_counts) both resolve through this
--    one function, so preview == send.
--
--    The dashboard API normaliser (src/lib/wa-campaigns.ts
--    normalizeAudienceFilter) keeps `engagement: 'warm'` and rejects any other
--    value. The campaign wizard also refuses to launch unless the API echoes
--    the exact audience back.
--    Until THIS migration is applied, a saved {engagement:'warm'} is ignored by
--    the v2 function (it would match everyone opted in), so apply it before
--    anyone launches a Warm campaign.
--
-- 2. wa_add_list_tag(tag, wa_ids[]): appends a `list:*` tag to EXISTING
--    contacts from an uploaded CSV (import-csv only tags the rows it inserts).
--    Never changes opted_in, so someone who replied STOP stays out.
-- ═══════════════════════════════════════════════════════════════════════════

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
      nullif(p_filter->>'engagement', '') as eng
  ),
  rt_agg as (
    select m.contact_id,
           bool_or(m.status in ('sent','delivered','read')) as reached,
           bool_or(m.status in ('delivered','read'))        as delivered,
           bool_or(m.status = 'read')                       as was_read,
           bool_or(m.status = 'failed' and (m.error_class = 'cap' or m.error ~* '(healthy ecosystem|131049)')) as capped,
           bool_or(m.status = 'failed' and (m.error_class = 'ambiguous' or m.error ~* 'ambiguous')) as unknown_outcome,
           min(m.created_at)                                as first_at
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
     where case f.rt->>'stage'
             when 'not_read'      then a.reached and not a.was_read
             -- never REACHED (no sent/delivered/read row) and no send whose
             -- outcome is unknown: a 'sent' row may still deliver (Meta retries
             -- for days) and an ambiguous one may already have landed, so
             -- re-targeting either could put the same offer on the phone twice.
             when 'not_delivered' then not a.reached and not a.unknown_outcome
             when 'read_no_reply' then a.was_read and not exists (
                 select 1 from wa_messages i where i.contact_id = a.contact_id
                    and i.direction = 'inbound' and i.created_at >= a.first_at)
             when 'failed_cap'    then a.capped and not a.reached and not a.unknown_outcome
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

revoke all on function public.wa_campaign_filter_match(jsonb) from public, anon, authenticated;
grant execute on function public.wa_campaign_filter_match(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 2. CSV list tag for existing contacts
-- ---------------------------------------------------------------------------
create or replace function public.wa_add_list_tag(p_tag text, p_wa_ids text[])
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if p_tag is null or p_tag !~ '^list:[a-z0-9][a-z0-9_-]{0,80}$' then
    raise exception 'list tag must look like list:<name>';
  end if;
  update wa_contacts c
     set tags = coalesce(c.tags, '{}') || array[p_tag]
   where c.wa_id = any(p_wa_ids)
     and not (coalesce(c.tags, '{}') @> array[p_tag]);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.wa_add_list_tag(text, text[]) from public, anon, authenticated;
grant execute on function public.wa_add_list_tag(text, text[]) to service_role;

-- Verify:
--   select count(*) from wa_campaign_audience('{"engagement":"warm"}'::jsonb);   -- about 500 on Sep 29 2026
--   select wa_campaign_audience_counts('{"engagement":"warm"}'::jsonb);
--   select count(*) from wa_campaign_audience('{"engagement":"nonsense"}'::jsonb); -- 0, never everyone
--   select count(*) from wa_campaign_audience('{"tags":["rfm:vip"]}'::jsonb);     -- unchanged
