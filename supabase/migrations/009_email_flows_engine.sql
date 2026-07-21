-- ============================================================
-- 009 — EMAIL FLOWS ENGINE
--
-- Turns the dormant flows/flow_enrollments skeleton (migration 001) into a real
-- journey engine, modelled on the proven WhatsApp wa_journey_runs machine:
--   • flow_enrollments becomes a scheduled-step queue (next_action_at + context)
--   • dedup_key makes enrolment idempotent (one enrolment per trigger entity)
--   • email_sends is the per-step claim ledger — insert-row-first is the atomic
--     "never email a customer twice" guard (AGENTS.md §4.1)
--
-- Safe to apply before the engine ships: no cron references these yet, and every
-- v1 flow is created in status='draft', so nothing sends until a flow is set
-- active AND the email-flow-tick cron is scheduled (a later migration).
--
-- Apply by hand in the Supabase dashboard SQL editor (docs/runbooks/MIGRATIONS).
-- ============================================================

-- ---- flow_enrollments: skeleton → state machine -----------------------------
ALTER TABLE flow_enrollments ADD COLUMN IF NOT EXISTS next_action_at TIMESTAMPTZ;
ALTER TABLE flow_enrollments ADD COLUMN IF NOT EXISTS context        JSONB;
ALTER TABLE flow_enrollments ADD COLUMN IF NOT EXISTS dedup_key      TEXT;
ALTER TABLE flow_enrollments ADD COLUMN IF NOT EXISTS attempts       INTEGER DEFAULT 0;
ALTER TABLE flow_enrollments ADD COLUMN IF NOT EXISTS deadline_at    TIMESTAMPTZ;
ALTER TABLE flow_enrollments ADD COLUMN IF NOT EXISTS last_error     TEXT;
ALTER TABLE flow_enrollments ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ DEFAULT NOW();

-- Widen the status vocabulary (was active|completed|exited).
ALTER TABLE flow_enrollments DROP CONSTRAINT IF EXISTS flow_enrollments_status_check;
ALTER TABLE flow_enrollments
  ADD CONSTRAINT flow_enrollments_status_check
  CHECK (status IN ('active', 'completed', 'exited', 'cancelled', 'converted', 'failed'));

-- Enrolment idempotency: one enrolment per (flow, trigger entity). The engine
-- enrols with ON CONFLICT DO NOTHING keyed on this, e.g. abandoned:<token>,
-- welcome:<contact_id>, postpurchase:<order_id>, winback:<contact_id>:<quarter>.
CREATE UNIQUE INDEX IF NOT EXISTS idx_flow_enrollments_flow_dedup
  ON flow_enrollments (flow_id, dedup_key)
  WHERE dedup_key IS NOT NULL;

-- Due-work scan (mirrors wa_journey_runs (status, next_action_at)).
CREATE INDEX IF NOT EXISTS idx_flow_enrollments_due
  ON flow_enrollments (status, next_action_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_flow_enrollments_contact ON flow_enrollments (contact_id);

-- ---- email_sends: per-step claim ledger -------------------------------------
CREATE TABLE IF NOT EXISTS email_sends (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID REFERENCES flow_enrollments(id) ON DELETE CASCADE,
  flow_id       UUID REFERENCES flows(id) ON DELETE SET NULL,
  step_index    INTEGER NOT NULL,
  contact_id    UUID REFERENCES contacts(id) ON DELETE CASCADE,
  email         TEXT,
  resend_id     TEXT,
  status        TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  error         TEXT,
  sent_at       TIMESTAMPTZ,
  opened_at     TIMESTAMPTZ,
  clicked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- The atomic claim: at most one non-failed send per (enrolment, step). A second
-- concurrent tick inserting the same (enrollment_id, step_index) hits this and
-- skips the send. 'failed' rows fall OUTSIDE the index so a retry can re-insert.
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_sends_claim
  ON email_sends (enrollment_id, step_index)
  WHERE status <> 'failed';

CREATE INDEX IF NOT EXISTS idx_email_sends_resend_id ON email_sends (resend_id);
CREATE INDEX IF NOT EXISTS idx_email_sends_flow ON email_sends (flow_id);

-- ---- RLS --------------------------------------------------------------------
-- flow_enrollments had a permissive anon policy from 001. The engine runs as
-- service_role; lock it down so anon/authenticated cannot read customer journey
-- state. (email_sends is service-role only from creation — RLS on, no policy.)
ALTER TABLE flow_enrollments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on flow_enrollments" ON flow_enrollments;
DROP POLICY IF EXISTS flow_enrollments_all ON flow_enrollments;

ALTER TABLE email_sends ENABLE ROW LEVEL SECURITY;

-- Verify:
--   \d flow_enrollments   (new columns + constraint)
--   select indexname from pg_indexes where tablename in ('flow_enrollments','email_sends');
