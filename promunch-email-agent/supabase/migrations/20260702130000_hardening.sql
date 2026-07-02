-- Hardening pass from the architecture audit (non-security-critical items).
-- Safe to apply anytime; additive only. Run in the Supabase SQL editor.

-- 1. SECURITY DEFINER search_path hardening.
--    recompute_wa_rfm_tags() runs with owner privileges. Without a pinned
--    search_path, a crafted temp object could shadow a referenced object
--    (privilege-escalation hardening gap). Pin it.
alter function recompute_wa_rfm_tags() set search_path = public, pg_temp;

-- 2. Missing indexes on hot join/lookup paths (audit: these columns are queried
--    but were unindexed → sequential scans).
create index if not exists wa_link_clicks_contact_idx  on wa_link_clicks (contact_id);
create index if not exists outreach_events_resend_idx  on outreach_events (resend_email_id);
create index if not exists outreach_events_lead_idx    on outreach_events (lead_id);
