-- PROMUNCH CRM - Initial Schema
-- Migration: 001_initial_schema.sql

-- ============================================================
-- Updated At Trigger Function
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- CONTACTS
-- ============================================================
CREATE TABLE IF NOT EXISTS contacts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 TEXT NOT NULL UNIQUE,
  first_name            TEXT,
  last_name             TEXT,
  phone                 TEXT,
  shopify_customer_id   TEXT UNIQUE,
  total_orders          INTEGER DEFAULT 0,
  total_spent           DECIMAL(12, 2) DEFAULT 0,
  average_order_value   DECIMAL(12, 2) DEFAULT 0,
  first_purchase_date   TIMESTAMPTZ,
  last_purchase_date    TIMESTAMPTZ,
  tags                  TEXT[],
  status                TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'unsubscribed', 'bounced')),
  source                TEXT DEFAULT 'shopify' CHECK (source IN ('shopify', 'manual', 'import')),
  city                  TEXT,
  state                 TEXT,
  country               TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_shopify_customer_id ON contacts(shopify_customer_id);
CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);

CREATE TRIGGER contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- ORDERS
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id        UUID REFERENCES contacts(id) ON DELETE SET NULL,
  shopify_order_id  TEXT UNIQUE,
  order_number      TEXT,
  total_amount      DECIMAL(12, 2),
  currency          TEXT DEFAULT 'INR',
  status            TEXT CHECK (status IN ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'refunded')),
  products          JSONB,
  placed_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_contact_id ON orders(contact_id);
CREATE INDEX IF NOT EXISTS idx_orders_shopify_order_id ON orders(shopify_order_id);

-- ============================================================
-- CAMPAIGNS
-- ============================================================
CREATE TABLE IF NOT EXISTS campaigns (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  subject               TEXT,
  preview_text          TEXT,
  body_html             TEXT,
  status                TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'paused')),
  segment_filter        JSONB,
  scheduled_at          TIMESTAMPTZ,
  sent_at               TIMESTAMPTZ,
  total_recipients      INTEGER DEFAULT 0,
  total_sent            INTEGER DEFAULT 0,
  total_delivered       INTEGER DEFAULT 0,
  total_opened          INTEGER DEFAULT 0,
  total_clicked         INTEGER DEFAULT 0,
  total_bounced         INTEGER DEFAULT 0,
  total_unsubscribed    INTEGER DEFAULT 0,
  revenue_attributed    DECIMAL(12, 2) DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- CAMPAIGN EMAILS
-- ============================================================
CREATE TABLE IF NOT EXISTS campaign_emails (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id    UUID REFERENCES contacts(id) ON DELETE CASCADE,
  status        TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed')),
  resend_id     TEXT,
  sent_at       TIMESTAMPTZ,
  opened_at     TIMESTAMPTZ,
  clicked_at    TIMESTAMPTZ,
  error         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_emails_campaign_id ON campaign_emails(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_emails_contact_id ON campaign_emails(contact_id);
CREATE INDEX IF NOT EXISTS idx_campaign_emails_resend_id ON campaign_emails(resend_id);

-- ============================================================
-- FLOWS
-- ============================================================
CREATE TABLE IF NOT EXISTS flows (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  description         TEXT,
  trigger_type        TEXT CHECK (trigger_type IN ('checkout_abandoned', 'order_placed', 'customer_created', 'segment_entry', 'date_based')),
  trigger_config      JSONB,
  status              TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused')),
  steps               JSONB,
  total_entered       INTEGER DEFAULT 0,
  total_completed     INTEGER DEFAULT 0,
  total_converted     INTEGER DEFAULT 0,
  revenue_attributed  DECIMAL(12, 2) DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER flows_updated_at
  BEFORE UPDATE ON flows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- FLOW ENROLLMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS flow_enrollments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id       UUID REFERENCES flows(id) ON DELETE CASCADE,
  contact_id    UUID REFERENCES contacts(id) ON DELETE CASCADE,
  current_step  INTEGER DEFAULT 0,
  status        TEXT CHECK (status IN ('active', 'completed', 'exited')),
  entered_at    TIMESTAMPTZ DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

-- ============================================================
-- EMAIL EVENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS email_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_email_id   UUID REFERENCES campaign_emails(id) ON DELETE SET NULL,
  contact_id          UUID REFERENCES contacts(id) ON DELETE CASCADE,
  event_type          TEXT CHECK (event_type IN ('sent', 'delivered', 'opened', 'clicked', 'bounced', 'unsubscribed')),
  metadata            JSONB,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_events_contact_id ON email_events(contact_id);
CREATE INDEX IF NOT EXISTS idx_email_events_campaign_email_id ON email_events(campaign_email_id);

-- ============================================================
-- RLS POLICIES (permissive for now)
-- ============================================================

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_events ENABLE ROW LEVEL SECURITY;

-- Contacts
CREATE POLICY "Allow all contacts" ON contacts FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Orders
CREATE POLICY "Allow all orders" ON orders FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Campaigns
CREATE POLICY "Allow all campaigns" ON campaigns FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Campaign Emails
CREATE POLICY "Allow all campaign_emails" ON campaign_emails FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Flows
CREATE POLICY "Allow all flows" ON flows FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Flow Enrollments
CREATE POLICY "Allow all flow_enrollments" ON flow_enrollments FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Email Events
CREATE POLICY "Allow all email_events" ON email_events FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
