-- Atomic per-campaign send lock. Guarantees only ONE wa-campaign-send
-- invocation processes a campaign at a time. Without it, concurrent senders
-- (manual resume + self-chain + worker heartbeat) each read the same
-- "already messaged" set and re-send to the same contacts — the duplicate
-- incident (86 customers messaged twice on Edamame v2).
--
-- A sender claims the lock with a guarded UPDATE (win only if null or stale),
-- holds it for the batch, then releases it before chaining the next batch.
--
-- Run ONCE in the Supabase SQL editor.

alter table wa_campaigns
  add column if not exists send_lock_at timestamptz;
