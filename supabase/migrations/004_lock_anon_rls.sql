-- PROMUNCH CRM — 004: lock down public anon access to customer PII
--
-- SECURITY FIX (audit C1). The 001 schema created "Allow all ... FOR ALL TO
-- anon, authenticated USING(true)" policies on the core CRM tables. The anon
-- role is the PUBLIC key shipped in the browser bundle, so those policies let
-- anyone on the internet read AND write the entire customer database
-- (verified live: contacts + orders were dumping real names/emails/phones).
--
-- This migration removes the anon grant entirely and keeps access for the
-- authenticated role only (logged-in, allowlisted staff — there are no customer
-- logins). All server-side/webhook writes move to the service_role key, which
-- bypasses RLS. Apply this ONLY after the paired app changes are deployed:
--   * server API routes + webhooks switched to the service-role admin client
--   * dashboard client components switched to the session-carrying browser client
-- Applying it before those deploy will break the contacts/campaigns UI.
--
-- Apply via the Supabase dashboard SQL editor (this project applies by hand).

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

-- 3. Belt-and-suspenders: revoke any base table grants from anon so the public
--    key cannot reach these tables even if a future policy is added by mistake.
REVOKE ALL ON contacts, orders, campaigns, campaign_emails, flows, flow_enrollments, email_events FROM anon;

COMMIT;

-- Verify after applying (should all return 42501 / permission denied for anon):
--   curl "$URL/rest/v1/contacts?select=*&limit=1" -H "apikey: $ANON_KEY"
--   curl "$URL/rest/v1/orders?select=*&limit=1"   -H "apikey: $ANON_KEY"
