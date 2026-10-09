-- ═══════════════════════════════════════════════════════════════════════════
-- B2B leads: ONE path. Find -> Pick -> Write -> Approve -> Send (+ follow-ups)
-- -> Replies. Owner approved Oct 10 2026.
--
-- What this does
--   1. Lead statuses gain `approved` (queued to send) and `skipped` ("Don't
--      send": permanent, never re-drafted). Old rows that were "Don't send"-ed
--      (status ready + only discarded drafts) become `skipped`.
--   2. outreach_batches: one row per "Write emails for N" (the Approve queue
--      for that batch + its optional follow-ups). outreach_drafts.batch_id.
--   3. Follow-ups ride the existing sequence engine via INTERNAL sequences and
--      templates (hidden from the UI: email_sequences.internal,
--      email_templates.internal).
--   4. Never email a business twice, enforced by the database:
--        a. at most ONE live-or-sent first email per lead (partial unique index)
--        b. at most one send per follow-up step (partial unique index)
--        c. b2b_claim_send(): ONE atomic claim for every send that also checks
--           pause, the IST daily cap (in-flight sends count), suppression,
--           closed leads and "this address / website was already emailed",
--           all under one advisory lock.
--   5. Cheap counts: b2b_lead_status_counts(), b2b_list_status_counts().
--   6. Server-side finding: the pg_cron driver moves from hourly to every
--      2 min and drains every active search round-robin.
--
-- Apply by hand in the Supabase dashboard SQL editor (docs/runbooks/MIGRATIONS.md).
-- Idempotent: safe to re-run. The app degrades gracefully before it is applied
-- (old non-atomic cap check, no follow-ups, no batch filter).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Search fairness (round-robin by updated_at, claimed by compare-and-set
--       on updated_at in the app; no new column needed) ─────────────────────
create index if not exists lead_searches_active_idx on lead_searches (status, updated_at);

-- ── 2. Settings: follow-up defaults ─────────────────────────────────────────
alter table outreach_settings add column if not exists follow_up_days int not null default 4;
alter table outreach_settings add column if not exists follow_up_count int not null default 1;
alter table outreach_settings add column if not exists follow_up_default_on boolean not null default false;

-- ── 3. Internal (hidden) sequences + templates for follow-ups ───────────────
alter table email_templates add column if not exists internal boolean not null default false;
alter table email_sequences add column if not exists internal boolean not null default false;

-- ── 4. Batches ──────────────────────────────────────────────────────────────
create table if not exists outreach_batches (
  id uuid primary key default gen_random_uuid(),
  list_id uuid references lead_lists(id) on delete set null,
  source text not null default 'ai' check (source in ('ai', 'saved')),
  template_id uuid references email_templates(id) on delete set null,
  follow_up_count int not null default 0 check (follow_up_count between 0 and 2),
  follow_up_days int not null default 4 check (follow_up_days between 1 and 30),
  sequence_id uuid references email_sequences(id) on delete set null,
  lead_count int not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table outreach_batches enable row level security; -- service_role only (same as other B2B tables)

alter table outreach_drafts add column if not exists batch_id uuid references outreach_batches(id) on delete set null;
create index if not exists outreach_drafts_batch_idx on outreach_drafts (batch_id);
create index if not exists outreach_drafts_lead_status_idx on outreach_drafts (lead_id, status);

drop trigger if exists outreach_batches_touch on outreach_batches;
create trigger outreach_batches_touch before update on outreach_batches
  for each row execute function touch_updated_at();

-- ── 5. Map old rows to the new statuses ─────────────────────────────────────
-- "Don't send" used to put the lead back to ready, where the tick re-drafted
-- it. Those leads (ready, at least one discarded draft, nothing live or sent)
-- were explicitly declined: they become skipped, permanently.
update leads l
set status = 'skipped', updated_at = now()
where l.status = 'ready'
  and exists (select 1 from outreach_drafts d where d.lead_id = l.id and d.status = 'discarded')
  and not exists (
    select 1 from outreach_drafts d
    where d.lead_id = l.id and d.status in ('draft', 'approved', 'sending', 'sent', 'replied', 'bounced')
  );

-- Drafts approved under the old flow were sent immediately; nothing is queued.
-- Leads whose live draft is already 'approved' get the matching lead status.
update leads l
set status = 'approved', updated_at = now()
where l.status = 'drafted'
  and exists (select 1 from outreach_drafts d where d.lead_id = l.id and d.status = 'approved' and d.enrollment_id is null);

-- ── 6. No double email: one first email per lead, ever ──────────────────────
-- Clean-up first: a lead that was already emailed must not keep an unsent
-- first-email draft (that would be a second email).
update outreach_drafts d
set status = 'discarded', error = 'already emailed (one-path cleanup)', updated_at = now()
where d.enrollment_id is null
  and d.status in ('draft', 'approved')
  and exists (
    select 1 from outreach_drafts s
    where s.lead_id = d.lead_id and s.id <> d.id and s.enrollment_id is null
      and s.status in ('sending', 'sent', 'replied', 'bounced')
  );
-- More than one unsent live draft for the same lead: keep the newest.
update outreach_drafts d
set status = 'discarded', error = 'duplicate draft (one-path cleanup)', updated_at = now()
where d.enrollment_id is null
  and d.status in ('draft', 'approved')
  and exists (
    select 1 from outreach_drafts n
    where n.lead_id = d.lead_id and n.id <> d.id and n.enrollment_id is null
      and n.status in ('draft', 'approved') and n.created_at > d.created_at
  );

do $$
begin
  create unique index if not exists outreach_drafts_one_first_email
    on outreach_drafts (lead_id)
    where enrollment_id is null and status in ('draft', 'approved', 'sending', 'sent', 'replied', 'bounced');
exception when unique_violation then
  raise notice 'outreach_drafts_one_first_email NOT created: a lead already has two sent first emails (historical). b2b_claim_send still blocks new repeats.';
end $$;

do $$
begin
  create unique index if not exists outreach_drafts_one_send_per_step
    on outreach_drafts (enrollment_id, step_position)
    where enrollment_id is not null and status <> 'failed';
exception when unique_violation then
  raise notice 'outreach_drafts_one_send_per_step NOT created: historical duplicate step sends exist.';
end $$;

-- ── 7. The one atomic send claim ────────────────────────────────────────────
-- Moves a draft from one of p_from to 'sending' only if every rule passes,
-- under a global advisory lock so two senders can never both squeeze under the
-- daily cap or both email the same address. In-flight sends (status sending,
-- updated in the last 15 min) count toward the cap.
create or replace function b2b_claim_send(p_draft_id uuid, p_from text[] default array['approved'])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings outreach_settings%rowtype;
  v_draft outreach_drafts%rowtype;
  v_email text;
  v_domain text;
  v_lead_status text;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  v_used int;
begin
  perform pg_advisory_xact_lock(hashtext('b2b_outreach_send'));

  select * into v_settings from outreach_settings where id = 1;
  if not found then return jsonb_build_object('outcome', 'no_settings'); end if;

  select * into v_draft from outreach_drafts where id = p_draft_id for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if not (v_draft.status = any (p_from)) then
    return jsonb_build_object('outcome', 'not_sendable', 'status', v_draft.status);
  end if;

  if v_settings.paused then return jsonb_build_object('outcome', 'paused'); end if;

  select count(*) into v_used
  from outreach_drafts
  where sent_at >= v_day_start
     or (status = 'sending' and sent_at is null and updated_at > now() - interval '15 minutes');
  if v_used >= v_settings.daily_cap then
    return jsonb_build_object('outcome', 'cap', 'used', v_used, 'cap', v_settings.daily_cap);
  end if;

  select lower(email) into v_email from lead_contacts where id = v_draft.contact_id;
  if v_email is null then return jsonb_build_object('outcome', 'no_contact'); end if;
  if exists (select 1 from suppressions where lower(email) = v_email) then
    return jsonb_build_object('outcome', 'suppressed');
  end if;

  select status, domain into v_lead_status, v_domain from leads where id = v_draft.lead_id;
  if v_lead_status in ('replied', 'bounced', 'suppressed', 'skipped') then
    return jsonb_build_object('outcome', 'lead_closed', 'lead_status', v_lead_status);
  end if;

  -- First emails only: never a second "first" email to the same address or the
  -- same business website (two map listings of one company). Follow-ups are
  -- guarded by their own enrollment + step claim.
  if v_draft.enrollment_id is null then
    if exists (
      select 1 from outreach_drafts d
      join lead_contacts c on c.id = d.contact_id
      where d.id <> p_draft_id
        and lower(c.email) = v_email
        and (d.sent_at is not null or d.status in ('sending', 'sent', 'replied', 'bounced'))
    ) then
      return jsonb_build_object('outcome', 'already_emailed', 'why', 'address');
    end if;
    if v_domain is not null and v_domain not in (
      'instagram.com', 'facebook.com', 'fb.com', 'linkedin.com', 'twitter.com', 'x.com', 'youtube.com',
      'wa.me', 'whatsapp.com', 'wix.com', 'linktr.ee', 'google.com', 'business.site', 'sites.google.com',
      'justdial.com', 'indiamart.com', 'tradeindia.com'
    ) and exists (
      select 1 from outreach_drafts d
      join leads l on l.id = d.lead_id
      where d.id <> p_draft_id
        and d.lead_id <> v_draft.lead_id
        and l.domain = v_domain
        and (d.sent_at is not null or d.status in ('sending', 'sent', 'replied', 'bounced'))
    ) then
      return jsonb_build_object('outcome', 'already_emailed', 'why', 'website');
    end if;
  end if;

  update outreach_drafts
  set status = 'sending',
      approved_at = coalesce(approved_at, now()),
      error = null,
      updated_at = now()
  where id = p_draft_id;

  return jsonb_build_object('outcome', 'claimed', 'used', v_used + 1, 'cap', v_settings.daily_cap);
end $$;

revoke all on function b2b_claim_send(uuid, text[]) from public;
revoke all on function b2b_claim_send(uuid, text[]) from anon, authenticated;
grant execute on function b2b_claim_send(uuid, text[]) to service_role;

-- ── 8. Cheap counts (replace 12 count queries + 20k-row scans) ──────────────
create or replace function b2b_lead_status_counts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
  from (select status, count(*) as n from leads group by status) t;
$$;

create or replace function b2b_list_status_counts(p_list_ids uuid[] default null)
returns table (list_id uuid, status text, unreachable bigint, n bigint)
language sql
stable
security definer
set search_path = public
as $$
  select m.list_id,
         l.status,
         count(*) filter (where l.error = 'site unreachable') as unreachable,
         count(*) as n
  from lead_list_members m
  join leads l on l.id = m.lead_id
  where p_list_ids is null or m.list_id = any (p_list_ids)
  group by m.list_id, l.status;
$$;

revoke all on function b2b_lead_status_counts() from public;
revoke all on function b2b_lead_status_counts() from anon, authenticated;
grant execute on function b2b_lead_status_counts() to service_role;
revoke all on function b2b_list_status_counts(uuid[]) from public;
revoke all on function b2b_list_status_counts(uuid[]) from anon, authenticated;
grant execute on function b2b_list_status_counts(uuid[]) to service_role;

-- ── 9. Driver: every 2 minutes (was hourly) ─────────────────────────────────
-- Replaces the hourly job from 20260706130000 (jobname 'b2b-leads-tick');
-- also clears a 'leads-tick' name in case the Oct 9 host repoint renamed it,
-- so exactly ONE job drives /api/cron/leads-tick. Same Vault bearer
-- (cron_secret == Vercel CRON_SECRET). Host is admin.promunch.in since Oct 9.
-- The tick does bounded work (~2 min) and every step claims its rows, so an
-- overlapping run is safe.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('b2b-leads-tick') where exists (select 1 from cron.job where jobname = 'b2b-leads-tick');
select cron.unschedule('leads-tick') where exists (select 1 from cron.job where jobname = 'leads-tick');

select cron.schedule(
  'b2b-leads-tick',
  '*/2 * * * *',
  $cmd$select net.http_get(
    url := 'https://admin.promunch.in/api/cron/leads-tick',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 280000
  );$cmd$
);

-- Lead status vocabulary after this migration (leads.status, free text):
--   new | crawling | listed | no_contacts | no_website        (finding)
--   ready                                                     (has email, nothing written)
--   drafting                                                  (AI writing, claimed)
--   drafted                                                   (waiting for approval)
--   approved                                                  (queued, the tick sends it)
--   contacted | replied | bounced                             (after sending)
--   suppressed | skipped                                      (never contact)

-- Verify:
--   select jobname, schedule, active from cron.job where jobname in ('b2b-leads-tick', 'leads-tick');
--   select status_code, created from net._http_response order by created desc limit 5;
--   select b2b_lead_status_counts();
--   select indexname from pg_indexes where indexname like 'outreach_drafts_one_%';
