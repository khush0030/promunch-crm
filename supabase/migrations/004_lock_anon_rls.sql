-- PROMUNCH CRM — 004: lock down public anon access to customer PII
--
-- SECURITY FIX (audit C1). The 001 schema created "Allow all ... FOR ALL TO
-- anon, authenticated USING(true)" policies on the core CRM tables. The anon
-- role is the PUBLIC key shipped in the browser bundle, so those policies let
-- anyone on the internet read AND write the entire customer database
-- (verified live: contacts + orders were dumping real names/emails/phones).
--
-- ROOT CAUSE: at some point `service_role` was REVOKED on contacts/orders, so
-- the dashboard was wired to reach those tables with the public anon key
-- instead — which is what opened the breach. This migration reverses that:
-- anon loses all access; the authenticated (staff) role and service_role get
-- proper grants so the app keeps working with server-side service-role calls
-- and session-based browser reads.
--
-- Apply ONLY after the paired app deploy (server routes -> service-role client,
-- client components -> session browser client). Applying before the deploy will
-- break the still-anon dashboard. Run in the Supabase dashboard SQL editor.

BEGIN;

-- 1. Drop the public "Allow all" policies (anon + authenticated, USING(true)).
DROP POLICY IF EXISTS "Allow all contacts"         ON contacts;
DROP POLICY IF EXISTS "Allow all orders"           ON orders;
DROP POLICY IF EXISTS "Allow all campaigns"        ON campaigns;
DROP POLICY IF EXISTS "Allow all campaign_emails"  ON campaign_emails;
DROP POLICY IF EXISTS "Allow all flows"            ON flows;
DROP POLICY IF EXISTS "Allow all flow_enrollments" ON flow_enrollments;
DROP POLICY IF EXISTS "Allow all email_events"     ON email_events;

-- 2. Recreate them for the authenticated role only. RLS stays enabled, so the
--    anon role now has no matching policy and is denied by default.
CREATE POLICY "staff full access contacts"         ON contacts         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff full access orders"           ON orders           FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff full access campaigns"        ON campaigns        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff full access campaign_emails"  ON campaign_emails  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff full access flows"            ON flows            FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff full access flow_enrollments" ON flow_enrollments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff full access email_events"     ON email_events     FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3. Revoke every base grant from the public anon role (closes the breach even
--    if a policy is ever re-added by mistake).
REVOKE ALL ON contacts, orders, campaigns, campaign_emails, flows, flow_enrollments, email_events FROM anon;

-- 4. Grant the roles the app actually uses:
--    * service_role — used by all server API routes + webhooks (bypasses RLS);
--      it was previously revoked on contacts/orders, which forced the anon
--      workaround. Restore full access so the server routes work.
--    * authenticated — used by dashboard client components via the session
--      browser client; RLS policies above still gate it to staff.
GRANT ALL ON contacts, orders, campaigns, campaign_emails, flows, flow_enrollments, email_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON contacts, orders, campaigns, campaign_emails, flows, flow_enrollments, email_events TO authenticated;

COMMIT;

-- Verify after applying:
--   anon  -> permission denied (breach closed):
--     curl "$URL/rest/v1/contacts?select=*&limit=1" -H "apikey: $ANON_KEY"
--   service_role -> 200 (server routes work):
--     curl "$URL/rest/v1/contacts?select=id&limit=1" -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY"
