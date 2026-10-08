-- Bulk inquiry team alerts (Oct 8 2026).
-- * Email: every website bulk form submission is emailed to the team list
--   below (from no-reply@promunch.in, Reply-To = the customer). Sent once per
--   inquiry: team_email_status pending→sending compare-and-set before Resend.
-- * WhatsApp: bulk-lead-alert now also copies the ping to SUPPORT_ALERT_WA_IDS
--   (per-recipient claims bulk_alert:<id>:<wa_id>); code-only, no SQL needed.
-- Pify imports are marked 'skipped' so history never emails the team.
-- APPLY MANUALLY (dashboard SQL editor or `supabase db query --linked -f`). Idempotent.

alter table bulk_inquiry_settings
  add column if not exists team_alert_emails text[] not null
    default array['hello@promunch.in', 'parth.mutha@vippysoya.com'];

alter table bulk_inquiries
  add column if not exists team_email_status text not null default 'pending',
  add column if not exists team_email_at timestamptz;

do $$ begin
  alter table bulk_inquiries add constraint bulk_inquiries_team_email_status_check
    check (team_email_status in ('pending','sending','sent','failed','skipped'));
exception when duplicate_object then null; end $$;

-- Existing rows (Pify imports + the owner's live test) never alert the team.
update bulk_inquiries set team_email_status = 'skipped' where team_email_status = 'pending';

-- Verify: select team_alert_emails from bulk_inquiry_settings;
