-- One-time backfill: re-clean shopify_orders.customer_name with the same
-- normalizeName() algorithm the webhook now uses (camelCase split + dedup
-- repeated words). Fixes HYPD marketplace mangled names like
-- "DarshikaPandey DarshikaPandey" -> "Darshika Pandey".
-- Safe to re-run (idempotent). Run in Supabase dashboard SQL editor.

-- 1) Port of normalizeName(first, last) -> cleaned full name.
create or replace function pg_temp.normalize_name(p_first text, p_last text)
returns text language plpgsql immutable as $$
declare
  v_raw   text;
  v_word  text;
  v_seen  text[] := '{}';
  v_out   text[] := '{}';
begin
  v_raw := btrim(coalesce(p_first, '') || ' ' || coalesce(p_last, ''));
  if v_raw = '' then return null; end if;
  -- split camelCase glue: "DarshikaPandey" -> "Darshika Pandey"
  v_raw := regexp_replace(v_raw, '([a-z])([A-Z])', '\1 \2', 'g');
  -- dedup repeated words, case-insensitive, keep first occurrence
  foreach v_word in array regexp_split_to_array(v_raw, '\s+') loop
    if v_word <> '' and not (lower(v_word) = any(v_seen)) then
      v_seen := array_append(v_seen, lower(v_word));
      v_out  := array_append(v_out, v_word);
    end if;
  end loop;
  if array_length(v_out, 1) is null then return null; end if;
  return array_to_string(v_out, ' ');
end;
$$;

-- 2) Mirror webhook precedence: customer -> shipping_address -> billing_address.
create or replace function pg_temp.name_from_order(p_raw jsonb)
returns text language sql immutable as $$
  select coalesce(
    pg_temp.normalize_name(p_raw->'customer'->>'first_name',         p_raw->'customer'->>'last_name'),
    pg_temp.normalize_name(p_raw->'shipping_address'->>'first_name', p_raw->'shipping_address'->>'last_name'),
    pg_temp.normalize_name(p_raw->'billing_address'->>'first_name',  p_raw->'billing_address'->>'last_name'),
    -- last resort: single 'name' field passed as first arg
    pg_temp.normalize_name(p_raw->'customer'->>'name', null)
  );
$$;

-- 3) Preview what would change (run this first to eyeball it).
-- select order_number, customer_name as old_name,
--        pg_temp.name_from_order(raw) as new_name
-- from shopify_orders
-- where raw is not null
--   and pg_temp.name_from_order(raw) is distinct from customer_name
-- order by shopify_created_at desc;

-- 4) Apply.
update shopify_orders
set customer_name = pg_temp.name_from_order(raw)
where raw is not null
  and pg_temp.name_from_order(raw) is distinct from customer_name;
