-- Deals simplify (Oct 10 2026): owner-approved rebuild of /dashboard/deals.
--
--   1. Stages collapse from 8 to 7 plain names:
--        new · talking · samples · negotiating · won · lost · on_hold
--      Old -> new: new_inquiry->new, in_discussion->talking,
--      samples_requested/samples_sent->samples, negotiation->negotiating,
--      dormant->on_hold, won/lost unchanged.
--      A BEFORE trigger keeps mapping the old names, so a not-yet-redeployed
--      deal-scan (or an old browser tab) keeps working after this runs.
--   2. New deal fields: follow_up_at (date), owner_email (team member),
--      value_inr (numeric, for ₹ totals), contact_phone, source + source_ref
--      (where the deal came from), closed_reason (asked when closing as
--      Lost / On hold), human_touched_at (deal-scan never overrides a human
--      follow-up / next step / stage decision unless a NEW inbound email
--      arrives after this time).
--   3. deal_activity: append-only log (notes, calls, WhatsApp, meetings,
--      stage moves, scanner finds). Existing deals.notes are copied in once.
--
-- Deals never message anyone; nothing here sends. APPLY BY HAND in the
-- Supabase dashboard SQL editor (docs/runbooks/MIGRATIONS.md). Idempotent:
-- safe to re-paste. Apply BEFORE (or together with) the deal-scan redeploy;
-- the app code tolerates either order.

-- ---- 1. new columns ---------------------------------------------------------
alter table public.deals
  add column if not exists follow_up_at date,
  add column if not exists owner_email text,
  add column if not exists value_inr numeric(14, 2) check (value_inr is null or value_inr >= 0),
  add column if not exists contact_phone text,
  add column if not exists source text,
  add column if not exists source_ref text,
  add column if not exists closed_reason text,
  add column if not exists human_touched_at timestamptz;

-- source: where the deal came from. Backfill before adding the check.
update public.deals d set source = 'bulk_form'
  where d.source is null and exists (select 1 from public.bulk_inquiries b where b.deal_id = d.id);
update public.deals set source = 'manual'
  where source is null and first_email_at is null and email_count = 0;
update public.deals set source = 'email_scan' where source is null;
alter table public.deals alter column source set default 'email_scan';
alter table public.deals alter column source set not null;
alter table public.deals drop constraint if exists deals_source_check;
alter table public.deals add constraint deals_source_check
  check (source in ('email_scan', 'whatsapp', 'b2b_reply', 'bulk_form', 'manual'));

-- bulk-form deals: phone + reference into proper columns (was only in notes)
update public.deals d
   set contact_phone = coalesce(d.contact_phone,
         case when length(regexp_replace(b.phone, '\D', '', 'g')) = 10
              then '91' || regexp_replace(b.phone, '\D', '', 'g')
              else regexp_replace(b.phone, '\D', '', 'g') end),
       source_ref = coalesce(d.source_ref, 'B-' || b.ref_no)
  from (
    select distinct on (deal_id) deal_id, phone, ref_no
      from public.bulk_inquiries
     where deal_id is not null
     order by deal_id, created_at desc
  ) b
 where b.deal_id = d.id;

-- A bulk-form deal's "follow up" was set by the form, i.e. a deliberate
-- decision: protect it from the scanner sweep.
update public.deals
   set human_touched_at = coalesce(human_touched_at, updated_at)
 where source = 'bulk_form' or manual_stage_override;

create index if not exists deals_follow_up_at_idx on public.deals (follow_up_at) where follow_up_at is not null;
create index if not exists deals_contact_phone_idx on public.deals (contact_phone) where contact_phone is not null;
create index if not exists deals_source_ref_idx on public.deals (source, source_ref) where source_ref is not null;
create index if not exists deals_contact_email_idx on public.deals (lower(contact_email)) where contact_email is not null;

-- ---- 2. stages: old -> new --------------------------------------------------
do $$
declare c text;
begin
  -- drop every check constraint that mentions stage (name may vary)
  for c in
    select conname from pg_constraint
     where conrelid = 'public.deals'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%stage%'
  loop
    execute format('alter table public.deals drop constraint %I', c);
  end loop;
end $$;

create or replace function public.deals_normalize_stage(s text) returns text
language sql immutable as $$
  select case s
    when 'new_inquiry' then 'new'
    when 'in_discussion' then 'talking'
    when 'samples_requested' then 'samples'
    when 'samples_sent' then 'samples'
    when 'negotiation' then 'negotiating'
    when 'dormant' then 'on_hold'
    else s
  end
$$;

update public.deals set stage = public.deals_normalize_stage(stage)
 where stage in ('new_inquiry', 'in_discussion', 'samples_requested', 'samples_sent', 'negotiation', 'dormant');

update public.deals set closed_reason = 'No emails for a long time'
 where stage = 'on_hold' and closed_reason is null;

alter table public.deals alter column stage set default 'new';
alter table public.deals add constraint deals_stage_check
  check (stage in ('new', 'talking', 'samples', 'negotiating', 'won', 'lost', 'on_hold'));

-- Old writers (pre-redeploy deal-scan, stale tabs) still send old names:
-- map them before the check runs.
create or replace function public.deals_stage_compat() returns trigger
language plpgsql as $$
begin
  new.stage := public.deals_normalize_stage(new.stage);
  return new;
end;
$$;
drop trigger if exists deals_stage_compat on public.deals;
create trigger deals_stage_compat before insert or update of stage on public.deals
  for each row execute function public.deals_stage_compat();

alter function public.deals_normalize_stage(text) set search_path = public;
alter function public.deals_stage_compat() set search_path = public;

-- ---- 3. activity log (append-only) ------------------------------------------
create table if not exists public.deal_activity (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  kind text not null check (kind in ('note', 'call', 'whatsapp', 'meeting', 'email', 'stage', 'system')),
  body text not null check (length(body) between 1 and 4000),
  author text,              -- team member email, or 'scanner' / 'bulk_form'
  created_at timestamptz not null default now()
);
create index if not exists deal_activity_deal_idx on public.deal_activity (deal_id, created_at desc);

-- append-only: no edits (deletes only happen via the deal cascade / merge)
create or replace function public.deal_activity_no_update() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'deal_activity is append-only';
end;
$$;
drop trigger if exists deal_activity_no_update on public.deal_activity;
create trigger deal_activity_no_update before update on public.deal_activity
  for each row execute function public.deal_activity_no_update();

alter table public.deal_activity enable row level security;  -- service role only, no policies
revoke all on public.deal_activity from anon, authenticated;

-- copy existing free-text notes in once (marker author 'imported')
insert into public.deal_activity (deal_id, kind, body, author, created_at)
select d.id, 'note', left(d.notes, 4000), 'imported', d.updated_at
  from public.deals d
 where d.notes is not null and btrim(d.notes) <> ''
   and not exists (
     select 1 from public.deal_activity a where a.deal_id = d.id and a.author = 'imported'
   );

-- Verify after applying:
--   select stage, count(*) from deals group by 1 order by 1;          -- only new names
--   select source, count(*) from deals group by 1;
--   select count(*) from deal_activity where author = 'imported';
--   select tgname from pg_trigger where tgrelid = 'public.deals'::regclass and not tgisinternal;
