-- ═══════════════════════════════════════════════════════════════════════════
-- WhatsApp campaign engine v2 (Phase 2: send-engine correctness)
--
-- Additive + idempotent. Paste ONCE into the Supabase SQL editor BEFORE
-- deploying the v2 wa-campaign-send / wa-campaign-worker / wa-webhook. The v2
-- engine refuses to run (clear 500, nothing sent) until this is applied.
--
--   1. wa_campaigns: 'paused' status + new columns (per-campaign header media,
--      audience snapshot, reply/click/skip counters, lifecycle stamps,
--      recount debounce, skip/hold breakdowns).
--   2. wa_messages.error_class: stored classification of a failure so the
--      engine knows what is retryable (cap / transient / structural) and what
--      is never retried (terminal / optout / ambiguous / unknown).
--   3. wa_marketing_daily_claims: atomic "one marketing message per contact
--      per IST day across ALL campaigns" claim (never-message-twice, B6).
--   4. wa_campaign_recount v2: counts DISTINCT contacts for failures, adds
--      replied_count + clicked_count, ignores inbound rows; plus a debounced
--      variant for the status webhook.
--   5. wa_campaign_audience / wa_campaign_audience_counts: one audience
--      definition used by the engine AND the dashboard preview.
--
-- Invariants preserved: the partial unique index
-- wa_messages_campaign_recipient_uniq (campaign_id, contact_id) WHERE status IN
-- (queued, sent, delivered, read) is untouched and remains THE hard
-- per-campaign no-duplicate guarantee.
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- 1. wa_campaigns
-- ---------------------------------------------------------------------------
-- Drop EVERY check constraint on wa_campaigns.status (the original was an inline
-- check whose auto-generated name is normally wa_campaigns_status_check, but a
-- differently named copy would otherwise survive and keep rejecting 'paused').
-- Existing rows only use draft/scheduled/sending/completed/failed/cancelled, a
-- subset of the new list, so the re-add validates on live data.
do $$
declare r record;
begin
  for r in
    select con.conname from pg_constraint con
     where con.conrelid = 'public.wa_campaigns'::regclass and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.wa_campaigns drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.wa_campaigns add constraint wa_campaigns_status_check
  check (status in ('draft','scheduled','sending','paused','completed','failed','cancelled'));

alter table public.wa_campaigns
  add column if not exists header_media_url  text,
  add column if not exists total_audience    integer,
  add column if not exists replied_count     integer not null default 0,
  add column if not exists clicked_count     integer not null default 0,
  add column if not exists skipped_count     integer not null default 0,
  add column if not exists skipped_breakdown jsonb,
  add column if not exists held_breakdown    jsonb,
  add column if not exists paused_at         timestamptz,
  add column if not exists cancelled_at      timestamptz,
  add column if not exists last_recount_at   timestamptz;

comment on column public.wa_campaigns.header_media_url is
  'Per-campaign header media override (image/video/document URL). Must match the template header format.';
comment on column public.wa_campaigns.skipped_breakdown is
  'Contacts permanently skipped by reason: optout, terminal, unknown_error, ambiguous, transient_exhausted, structural_exhausted, cap_exhausted, and (at completion) held_governor/held_cart/held_ticket/held_daily_claim.';
comment on column public.wa_campaigns.held_breakdown is
  'Contacts currently held back (deferred, not dropped): governor, cart, ticket, daily_claim.';

-- ---------------------------------------------------------------------------
-- 2. wa_messages.error_class
-- ---------------------------------------------------------------------------
alter table public.wa_messages add column if not exists error_class text;
alter table public.wa_messages drop constraint if exists wa_messages_error_class_check;
alter table public.wa_messages add constraint wa_messages_error_class_check
  check (error_class is null or error_class in
    ('cap','optout','terminal','structural','transient','ambiguous','unknown'));

-- inbound reply attribution looks outbound rows up by wamid (already unique-indexed)
-- and counts inbound rows per campaign:
create index if not exists wa_messages_campaign_dir_idx
  on public.wa_messages (campaign_id, direction) where campaign_id is not null;

-- Per-contact ledger lookups (governor window + preview counts + retarget
-- read_no_reply) had no contact index: every correlated subquery in
-- wa_campaign_audience_counts was a sequential scan of wa_messages per contact.
create index if not exists wa_messages_contact_created_idx
  on public.wa_messages (contact_id, created_at desc) where contact_id is not null;

create index if not exists wa_short_links_campaign_idx
  on public.wa_short_links (sent_by) where sent_by like 'campaign:%';

-- ---------------------------------------------------------------------------
-- 3. Cross-campaign daily marketing claim
-- ---------------------------------------------------------------------------
create table if not exists public.wa_marketing_daily_claims (
  contact_id uuid not null references public.wa_contacts(id) on delete cascade,
  ist_day    date not null,
  source     text not null,           -- 'campaign' today (journeys not wired yet)
  source_id  text not null,           -- campaign id
  created_at timestamptz not null default now(),
  primary key (contact_id, ist_day)
);
create index if not exists wa_marketing_daily_claims_day_idx
  on public.wa_marketing_daily_claims (ist_day);

alter table public.wa_marketing_daily_claims enable row level security;
revoke all on public.wa_marketing_daily_claims from anon;
revoke all on public.wa_marketing_daily_claims from authenticated;
grant select, insert, update, delete on public.wa_marketing_daily_claims to service_role;

-- Returns true when the caller holds the claim for (contact, day): either it
-- just inserted it, or the existing claim belongs to the SAME source+id
-- (re-entrant, e.g. a same-campaign retry after a structural fix). The primary
-- key makes this atomic: two campaigns racing for one contact on one day, only
-- one insert wins.
create or replace function public.wa_take_marketing_daily_claim(
  p_contact uuid, p_day date, p_source text, p_source_id text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_src text; v_id text;
begin
  insert into wa_marketing_daily_claims (contact_id, ist_day, source, source_id)
  values (p_contact, p_day, p_source, p_source_id)
  on conflict (contact_id, ist_day) do nothing;
  if found then return true; end if;
  select source, source_id into v_src, v_id
    from wa_marketing_daily_claims where contact_id = p_contact and ist_day = p_day;
  return v_src = p_source and v_id = p_source_id;
end $$;

revoke all on function public.wa_take_marketing_daily_claim(uuid, date, text, text) from public, anon, authenticated;
grant execute on function public.wa_take_marketing_daily_claim(uuid, date, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Recount v2 (+ debounced variant)
-- ---------------------------------------------------------------------------
create or replace function public.wa_campaign_recount(p_campaign uuid)
returns void language sql as $$
  update wa_campaigns c set
    sent_count      = s.sent,
    delivered_count = s.delivered,
    read_count      = s.read,
    failed_count    = s.failed,
    replied_count   = s.replied,
    clicked_count   = s.clicked,
    last_recount_at = now()
  from (
    select
      (select count(*) from wa_messages m where m.campaign_id = p_campaign and m.direction = 'outbound'
         and m.status in ('sent','delivered','read'))                                   as sent,
      (select count(*) from wa_messages m where m.campaign_id = p_campaign and m.direction = 'outbound'
         and m.status in ('delivered','read'))                                          as delivered,
      (select count(*) from wa_messages m where m.campaign_id = p_campaign and m.direction = 'outbound'
         and m.status = 'read')                                                         as read,
      -- DISTINCT contacts whose attempts all failed (a contact retried 3x is one failure,
      -- and a contact who failed then later got it is not a failure)
      (select count(distinct m.contact_id) from wa_messages m
         where m.campaign_id = p_campaign and m.direction = 'outbound' and m.status = 'failed'
           and not exists (select 1 from wa_messages r where r.campaign_id = p_campaign
             and r.contact_id = m.contact_id and r.direction = 'outbound'
             and r.status in ('queued','sent','delivered','read')))                     as failed,
      (select count(distinct m.contact_id) from wa_messages m
         where m.campaign_id = p_campaign and m.direction = 'inbound')                  as replied,
      (select count(distinct s.code) from wa_short_links s
         join wa_link_clicks k on k.code = s.code
         where s.sent_by = 'campaign:' || p_campaign::text)                             as clicked
  ) s
  where c.id = p_campaign;
$$;

-- Recount at most once per p_min_seconds per campaign (the status webhook fires
-- once per message state change; a full recount per callback was O(n^2) over a
-- campaign). The guarded UPDATE is the debounce token: only the caller that
-- advances last_recount_at runs the recount. The worker heartbeat does a final
-- undebounced recount so the last callbacks of a burst are never lost.
create or replace function public.wa_campaign_recount_debounced(p_campaign uuid, p_min_seconds int default 30)
returns boolean language plpgsql as $$
declare won boolean;
begin
  update wa_campaigns set last_recount_at = now()
   where id = p_campaign
     and (last_recount_at is null or last_recount_at < now() - make_interval(secs => p_min_seconds))
  returning true into won;
  if coalesce(won, false) then
    perform wa_campaign_recount(p_campaign);
    return true;
  end if;
  return false;
end $$;

revoke all on function public.wa_campaign_recount(uuid) from public, anon, authenticated;
revoke all on function public.wa_campaign_recount_debounced(uuid, int) from public, anon, authenticated;
grant execute on function public.wa_campaign_recount(uuid) to service_role;
grant execute on function public.wa_campaign_recount_debounced(uuid, int) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Audience
-- ---------------------------------------------------------------------------
-- audience_filter shapes (all optional, combined with AND):
--   { tags: [..] }           OR  (contact has ANY of these)      -- legacy, unchanged
--   { tags_all: [..] }       AND (contact has ALL of these)
--   { exclude_tags: [..] }   contact has NONE of these
--   { retarget: { campaign_id, stage } }  recipients of an earlier campaign:
--        not_read       got it (sent/delivered) but never read it
--        not_delivered  attempted, never reached (all attempts failed, none ambiguous)
--        read_no_reply  read it, no inbound message since that campaign's send
--        failed_cap     failed on Meta's #131049 cap, never reached
--   {}                       everyone
-- Engagement presets / RFM segments are tag lists and ride on `tags`.

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
      case when jsonb_typeof(p_filter->'retarget') = 'object' then p_filter->'retarget' else null end as rt
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
  )
  select c.id
    from wa_contacts c, f
   where (cardinality(f.tags_any) = 0 or c.tags && f.tags_any)
     and (cardinality(f.tags_all) = 0 or c.tags @> f.tags_all)
     and (cardinality(f.tags_not) = 0 or c.tags is null or not (c.tags && f.tags_not))
     and (f.rt is null or c.id in (select r.contact_id from rt_ids r));
$$;

-- The send-eligible base set: opted in, not tier:suppressed (NULL-safe: no tags
-- = not suppressed), matching the filter. Temporary holds (governor, cart,
-- ticket, daily claim) are applied by the engine per batch.
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

-- Preview counts, mirroring the engine's exclusions in the order it applies them.
-- Governor window mirrors _shared/marketing-governor.ts marketingHoldSet():
-- marketing-template ATTEMPTS per contact (queued/sent/delivered/read/failed),
-- excluding synchronous structural/transient rejections that never reached Meta's
-- delivery pipeline (no wamid).
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
                              - (select count(*) from gov) - (select count(*) from daily)
  );
$$;

revoke all on function public.wa_campaign_filter_match(jsonb) from public, anon, authenticated;
revoke all on function public.wa_campaign_audience(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.wa_campaign_audience_counts(jsonb, uuid, int, int) from public, anon, authenticated;
grant execute on function public.wa_campaign_filter_match(jsonb) to service_role;
grant execute on function public.wa_campaign_audience(jsonb, uuid) to service_role;
grant execute on function public.wa_campaign_audience_counts(jsonb, uuid, int, int) to service_role;

-- Backfill the new counters once (distinct-contact failures, replies, clicks).
do $$
declare c uuid;
begin
  for c in select id from wa_campaigns loop
    perform wa_campaign_recount(c);
  end loop;
end $$;

-- Verify:
--   select column_name from information_schema.columns
--    where table_name = 'wa_campaigns' and column_name in ('header_media_url','total_audience','skipped_breakdown');
--   select wa_campaign_audience_counts('{}'::jsonb);
--   select count(*) from wa_campaign_audience('{"tags":["rfm:vip"]}'::jsonb);
