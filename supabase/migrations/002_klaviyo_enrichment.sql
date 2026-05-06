-- 002_klaviyo_enrichment.sql
-- Adds columns to capture full Klaviyo profile data + list/segment membership.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS klaviyo_id            TEXT,
  ADD COLUMN IF NOT EXISTS external_id           TEXT,
  ADD COLUMN IF NOT EXISTS address1              TEXT,
  ADD COLUMN IF NOT EXISTS address2              TEXT,
  ADD COLUMN IF NOT EXISTS zip                   TEXT,
  ADD COLUMN IF NOT EXISTS locale                TEXT,
  ADD COLUMN IF NOT EXISTS timezone              TEXT,
  ADD COLUMN IF NOT EXISTS organization          TEXT,
  ADD COLUMN IF NOT EXISTS title                 TEXT,
  ADD COLUMN IF NOT EXISTS image_url             TEXT,
  ADD COLUMN IF NOT EXISTS accepts_marketing     BOOLEAN,
  ADD COLUMN IF NOT EXISTS email_consent         TEXT,
  ADD COLUMN IF NOT EXISTS sms_consent           TEXT,
  ADD COLUMN IF NOT EXISTS consent_source        TEXT,
  ADD COLUMN IF NOT EXISTS consent_timestamp     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS klaviyo_created_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS klaviyo_updated_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_event_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS klaviyo_lists         TEXT[],
  ADD COLUMN IF NOT EXISTS klaviyo_segments      TEXT[],
  ADD COLUMN IF NOT EXISTS properties            JSONB,
  ADD COLUMN IF NOT EXISTS predictive_analytics  JSONB;

CREATE INDEX IF NOT EXISTS idx_contacts_klaviyo_id ON contacts(klaviyo_id);
CREATE INDEX IF NOT EXISTS idx_contacts_external_id ON contacts(external_id);
CREATE INDEX IF NOT EXISTS idx_contacts_last_event_at ON contacts(last_event_at);
CREATE INDEX IF NOT EXISTS idx_contacts_klaviyo_lists ON contacts USING GIN (klaviyo_lists);
CREATE INDEX IF NOT EXISTS idx_contacts_klaviyo_segments ON contacts USING GIN (klaviyo_segments);

-- Source check constraint allows 'klaviyo' as a valid source.
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_source_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_source_check
  CHECK (source IN ('shopify', 'manual', 'import', 'klaviyo'));
