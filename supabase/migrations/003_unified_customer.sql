-- 003_unified_customer.sql
-- Unified customer record: persist the link between a CRM contact and its
-- WhatsApp contact so orders, email and WhatsApp activity resolve to one
-- person. The runtime matching layer in src/lib/customer-link.ts works
-- whether or not this migration has been applied; this migration just makes
-- the link durable and fast.
--
-- IMPORTANT: This project applies migrations through the Supabase dashboard
-- SQL editor. Copy/paste the body of this file into the editor to apply.

ALTER TABLE wa_contacts
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wa_contacts_contact_id ON wa_contacts(contact_id);

-- Backfill: link existing wa_contacts to CRM contacts.
-- Priority: shopify_customer_id → email → last-10-digit phone.

-- 1. shopify_customer_id (highest-confidence match)
UPDATE wa_contacts w
SET contact_id = c.id
FROM contacts c
WHERE w.contact_id IS NULL
  AND w.shopify_customer_id IS NOT NULL
  AND w.shopify_customer_id = c.shopify_customer_id;

-- 2. case-insensitive email
UPDATE wa_contacts w
SET contact_id = c.id
FROM contacts c
WHERE w.contact_id IS NULL
  AND w.email IS NOT NULL
  AND c.email IS NOT NULL
  AND lower(w.email) = lower(c.email);

-- 3. last-10-digit phone match (CRM phone is free-form; wa_id is E.164-ish)
UPDATE wa_contacts w
SET contact_id = c.id
FROM contacts c
WHERE w.contact_id IS NULL
  AND c.phone IS NOT NULL
  AND length(regexp_replace(coalesce(w.phone, w.wa_id, ''), '\D', '', 'g')) >= 10
  AND right(regexp_replace(coalesce(w.phone, w.wa_id, ''), '\D', '', 'g'), 10)
    = right(regexp_replace(c.phone, '\D', '', 'g'), 10);
