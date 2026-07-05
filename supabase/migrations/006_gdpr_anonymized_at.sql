-- GDPR / DPDP erasure support: mark when a contact's PII was anonymized.
-- The anonymize flow (src/lib/gdpr.ts) scrubs the identifying columns in place
-- and stamps this so the row is visibly a tombstone (orders stay linked for
-- financial integrity, but no longer resolve to a real person).

alter table contacts
  add column if not exists anonymized_at timestamptz;
