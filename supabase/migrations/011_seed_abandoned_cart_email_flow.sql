-- ============================================================
-- 011 — SEED THE ABANDONED-CART EMAIL FLOW (and switch it on)
--
-- WHY: 93% of Shopify orders are phone-only, but the inverse is also true —
-- a large share of abandoned checkouts carry an EMAIL and no usable phone.
-- Those carts had zero recovery coverage: shopify-wa's WhatsApp path bails at
-- `if (!waId) return`, and the email path called enrolEmailFlow() against a
-- table set that did not exist (migration 009 was never applied) and, even
-- after 009, against no ACTIVE flow — so it enrolled nobody.
--
-- enrolEmailFlow() picks the OLDEST active flow for the trigger, so there must
-- be exactly one active checkout_abandoned flow. This seeds it idempotently.
--
-- Delays are relative to the PREVIOUS step (see FlowStep.delay_hours), so the
-- sequence lands at +1h, +6h, +24h from abandonment, inside the 72h deadline.
-- Step 1 carries no coupon (protect margin — most recovered carts need only a
-- reminder). Step 2 introduces PROMUNCH10. Step 3 is a final call.
--
-- Copy rules (AGENTS.md §5): PROMUNCH all caps, no em dashes, "Your Munchy Pal",
-- never mention Oltaflock.
--
-- Apply by hand in the Supabase dashboard SQL editor (docs/runbooks/MIGRATIONS).
-- ============================================================

-- Guard: if a checkout_abandoned flow is already active, do nothing. Two active
-- flows on one trigger would be ambiguous (enrolEmailFlow takes the oldest).
INSERT INTO flows (name, description, trigger_type, trigger_config, status, steps)
SELECT
  'Abandoned cart',
  'Checkout started but not paid. Reminder, then coupon, then last call. Uses the Super Money Breeze recovery link.',
  'checkout_abandoned',
  '{"coupon_code": "PROMUNCH10", "deadline_hours": 72}'::jsonb,
  'active',
  '[
    {
      "type": "email",
      "delay_hours": 1,
      "subject": "Your PROMUNCH cart is waiting",
      "body_html": "<p>Hi {{first_name}},</p><p>You left some munchies behind. Your cart is still saved, so you can pick up right where you left off.</p><p><a href=\"{{checkout_url}}\">Finish your order</a></p><p>Free shipping over ₹599. Your Munchy Pal is holding your snacks.</p>"
    },
    {
      "type": "email",
      "delay_hours": 5,
      "subject": "A little something to finish your order",
      "coupon_code": "PROMUNCH10",
      "body_html": "<p>Hi {{first_name}},</p><p>Still thinking it over? Here is 10% off to seal the deal. Use code <b>PROMUNCH10</b> at checkout on orders above ₹399.</p><p><a href=\"{{checkout_url}}\">Complete my order</a></p><p>Free shipping over ₹599, and 5% off when you pay online.</p>"
    },
    {
      "type": "email",
      "delay_hours": 18,
      "subject": "Last call for your cart",
      "coupon_code": "PROMUNCH10",
      "body_html": "<p>Hi {{first_name}},</p><p>This is the last nudge, promise. Your cart is still saved and PROMUNCH10 still works for 10% off.</p><p><a href=\"{{checkout_url}}\">Grab my snacks</a></p><p>High protein roasted soya, made to actually taste good. Your Munchy Pal.</p>"
    }
  ]'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM flows WHERE trigger_type = 'checkout_abandoned' AND status = 'active'
);

-- Verify:
--   select id, name, status, jsonb_array_length(steps) steps from flows
--   where trigger_type = 'checkout_abandoned';
