-- PROMUNCH CRM — 007: allow phone-only contacts
--
-- WHY: 93% of Shopify orders (HYPD marketplace + guest checkouts) arrive with
-- a phone number but NO email. contacts.email was NOT NULL, so those buyers
-- could never enter the CRM at all — the contact list only ever held the small
-- email-carrying minority. This drops the NOT NULL, keeps email UNIQUE (NULLs
-- don't collide), and guards data quality:
--   * every contact must still be reachable (email OR phone OR shopify id)
--   * phone-only rows are unique per phone (partial index) so webhook races
--     can't create duplicates; email-carrying rows keep email as identity.
--
-- Applied 2026-07-06 via the Supabase Management API (database/query).

BEGIN;

ALTER TABLE contacts ALTER COLUMN email DROP NOT NULL;

ALTER TABLE contacts ADD CONSTRAINT contacts_reachable_chk
  CHECK (email IS NOT NULL OR phone IS NOT NULL OR shopify_customer_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_phone_only_unique
  ON contacts (phone) WHERE email IS NULL;

COMMIT;
