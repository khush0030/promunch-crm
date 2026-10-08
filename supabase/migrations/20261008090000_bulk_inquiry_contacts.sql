-- ═══════════════════════════════════════════════════════════════════════════
-- Bulk inquiries → CRM contacts (tag "bulk" + full form metadata)
-- ═══════════════════════════════════════════════════════════════════════════
-- Every bulk_inquiries row is mirrored onto a contacts row:
--   * matched by email (case-insensitive); else a phone-only contact with the
--     same number (email is null) is adopted; else a new contact is created
--     (source 'import': contacts_source_check allows shopify|manual|import|klaviyo;
--     the bulk tag + properties.bulk_inquiries[].source say where it came from);
--   * tags gets 'bulk' (existing tags kept, no duplicates);
--   * organization / city / phone / first_name only fill blanks, never overwrite;
--   * properties.bulk_inquiries = every submission from that email (recomputed
--     from bulk_inquiries, so it is idempotent), properties.bulk_last_inquiry_at;
--   * consent fields are never touched; anonymized (GDPR) contacts are skipped.
-- Runs from an AFTER INSERT trigger that can never block the form intake.
-- Backfill at the bottom covers rows already stored (Pify imports included).
-- APPLY MANUALLY (dashboard SQL editor or `supabase db query --linked -f`). Idempotent.

create or replace function bulk_inquiry_sync_contact(p_email text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_hist jsonb;
  r bulk_inquiries%rowtype;
  v_first text;
  v_last text;
begin
  select * into r from bulk_inquiries where lower(email) = lower(p_email)
    order by created_at desc limit 1;
  if not found then return null; end if;

  select jsonb_agg(jsonb_build_object(
      'ref', 'B-' || b.ref_no,
      'pify_ref', case when b.submission_key like 'pify-%' then substr(b.submission_key, 6) end,
      'source', case when b.page_url = 'pify-import' then 'pify_form' else 'website_form' end,
      'submitted_at', b.created_at,
      'name', b.name,
      'company', b.company,
      'order_type', b.use_case,
      'quantity', b.quantity_band,
      'products', to_jsonb(b.products),
      'needed_by', b.needed_by,
      'requirement', b.notes,
      'phone', b.phone,
      'city', b.city,
      'deal_id', b.deal_id
    ) order by b.created_at)
    into v_hist
    from bulk_inquiries b where lower(b.email) = lower(p_email);

  v_first := split_part(trim(r.name), ' ', 1);
  v_last := nullif(trim(substr(trim(r.name), length(v_first) + 1)), '');

  select id into v_id from contacts where lower(email) = lower(p_email)
    order by created_at limit 1;
  if v_id is null then
    select id into v_id from contacts
      where email is null and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10)
                            = right(regexp_replace(r.phone, '\D', '', 'g'), 10)
      order by created_at limit 1;
    if v_id is not null then
      update contacts set email = lower(p_email) where id = v_id and anonymized_at is null;
    end if;
  end if;

  if v_id is null then
    insert into contacts (email, first_name, last_name, phone, organization, city, country, tags, source, properties)
    values (lower(p_email), v_first, v_last, r.phone, r.company, r.city, 'IN', array['bulk'], 'import',
            jsonb_build_object('bulk_inquiries', v_hist, 'bulk_last_inquiry_at', r.created_at))
    returning id into v_id;
  else
    update contacts set
      tags = (select array_agg(distinct t order by t) from unnest(coalesce(tags, '{}'::text[]) || array['bulk']) t),
      organization = coalesce(nullif(organization, ''), r.company),
      city = coalesce(nullif(city, ''), r.city),
      phone = coalesce(nullif(phone, ''), r.phone),
      first_name = coalesce(nullif(first_name, ''), v_first),
      last_name = case when nullif(first_name, '') is null then coalesce(nullif(last_name, ''), v_last) else last_name end,
      properties = coalesce(properties, '{}'::jsonb)
                   || jsonb_build_object('bulk_inquiries', v_hist, 'bulk_last_inquiry_at', r.created_at),
      updated_at = now()
    where id = v_id and anonymized_at is null;
  end if;
  return v_id;
end $$;

create or replace function bulk_inquiry_contact_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform bulk_inquiry_sync_contact(new.email);
  return new;
exception when others then
  raise warning 'bulk_inquiry_sync_contact failed for %: %', new.id, sqlerrm;
  return new;  -- never block the form intake
end $$;

drop trigger if exists bulk_inquiry_contact on bulk_inquiries;
create trigger bulk_inquiry_contact after insert on bulk_inquiries
  for each row execute function bulk_inquiry_contact_trg();

-- Backfill (skips the owner's live-test rows).
select bulk_inquiry_sync_contact(e)
from (select distinct lower(email) e from bulk_inquiries
      where submission_key not like 'livetest%') s;

-- Verify:
--   select email, organization, city, tags, jsonb_array_length(properties->'bulk_inquiries')
--     from contacts where 'bulk' = any(tags);
