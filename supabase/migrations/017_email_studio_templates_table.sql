-- 017_email_studio_templates_table.sql
-- Fix-up for 016: `email_templates` already exists as the B2B leads
-- "Saved emails" table (20260706130000_b2b_lists_sequences), so 016's
-- CREATE TABLE IF NOT EXISTS was a no-op and campaigns.template_id ended up
-- referencing the B2B table. Email Studio gets its own table instead; the
-- B2B table is left exactly as it was.
--
-- Apply by hand in the Supabase dashboard SQL editor. Idempotent.

create table if not exists email_studio_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  category      text not null default 'custom',
  subject       text,
  preview_text  text,
  design        jsonb not null,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table email_studio_templates enable row level security;

alter table campaigns drop constraint if exists campaigns_template_id_fkey;
update campaigns set template_id = null
  where template_id is not null
    and not exists (select 1 from email_studio_templates t where t.id = campaigns.template_id);
alter table campaigns
  add constraint campaigns_template_id_fkey
  foreign key (template_id) references email_studio_templates(id) on delete set null;
