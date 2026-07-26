-- ============================================================
-- 013 — ABANDONED-CART EMAIL SEQUENCE v2 (4 touches inside 24h)
--
-- Replaces the 3-step sequence seeded in 011. Email is now the load-bearing
-- recovery channel: it has no Meta frequency cap, and 100% of our abandoned
-- checkouts carry an email address (measured 40/40 over 30 days), versus ~20%
-- WhatsApp delivery to contacts who have never messaged us.
--
-- Cadence, measured from abandonment (delay_hours is relative to the PREVIOUS
-- step, and fractional values are allowed):
--
--   +15 min   helpful      "still saved" — assume a checkout hiccup, no discount
--   +2h       reassurance  answer the hesitation, still no discount
--   +6h       incentive    PROMUNCH10 introduced (first margin given away)
--   +22h      last call    final reminder, honest urgency
--
-- Discount is withheld until touch 3 on purpose: a large share of recovered
-- carts need only a reminder, and leading with a coupon trains customers to
-- abandon on purpose to farm one.
--
-- HONEST URGENCY. The last email says it is the last email and that we stop
-- holding the cart. It does NOT claim the coupon expires, because PROMUNCH10 is
-- a standing code and that would be a lie the customer can trivially disprove.
-- To get real deadline urgency, create a time-limited code in Shopify and swap
-- coupon_code here.
--
-- Copy rules (AGENTS.md §5): PROMUNCH all caps, NO em dashes, "Your Munchy Pal",
-- never mention Oltaflock. Product claims are deliberately limited to the
-- shipping/payment policy that lives in the Master KB. Do not add nutrition
-- claims here without checking kb_documents first (chips and sticks are FRIED;
-- only Crunchies are roasted).
--
-- Tokens rendered by src/lib/email/flow-engine.ts: {{first_name}},
-- {{checkout_url}} (auto UTM-stamped per step), {{cart_items}}, {{cart_total}}.
--
-- Apply by hand in the Supabase dashboard SQL editor (docs/runbooks/MIGRATIONS).
-- ============================================================

UPDATE flows
SET
  trigger_config = '{"coupon_code": "PROMUNCH10", "deadline_hours": 30}'::jsonb,
  steps = $json$
[
  {
    "type": "email",
    "delay_hours": 0.25,
    "subject": "{{first_name}}, your PROMUNCH cart is still saved",
    "preview_text": "Your {{cart_total}} order is one tap away.",
    "body_html": "<p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;\">Hi {{first_name}},</p><p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;\">You were one step away from your snacks. We saved your cart, so nothing is lost.</p>{{cart_items}}<p style=\"font-size:16px;line-height:1.6;margin:0 0 4px;\"><strong>Total: {{cart_total}}</strong></p><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:22px 0;\"><tr><td style=\"background:#1B2A20;border-radius:10px;\"><a href=\"{{checkout_url}}\" style=\"display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;\">Finish my order</a></td></tr></table><p style=\"font-size:15px;line-height:1.6;color:#6E665A;margin:0 0 10px;\">If something went wrong at checkout, just reply to this email and we will sort it out for you.</p><p style=\"font-size:15px;line-height:1.6;color:#6E665A;margin:0;\">Free shipping on orders over ₹599.</p>"
  },
  {
    "type": "email",
    "delay_hours": 1.75,
    "subject": "Still thinking it over, {{first_name}}?",
    "preview_text": "A few things worth knowing before you decide.",
    "body_html": "<p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;\">Hi {{first_name}},</p><p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;\">Your cart is still waiting. If something held you back, here is what usually helps.</p><ul style=\"font-size:16px;line-height:1.8;margin:0 0 16px;padding-left:20px;color:#1A1714;\"><li>High protein soya snacks, built for people who actually want a snack</li><li>Free shipping on orders over ₹599, otherwise ₹99</li><li>Pay online and save 5%</li><li>Prefer cash on delivery? That works too, for ₹50 extra</li></ul>{{cart_items}}<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:22px 0;\"><tr><td style=\"background:#1B2A20;border-radius:10px;\"><a href=\"{{checkout_url}}\" style=\"display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;\">Complete my order</a></td></tr></table><p style=\"font-size:15px;line-height:1.6;color:#6E665A;margin:0;\">Questions about a product? Reply here and a real person will answer.</p>"
  },
  {
    "type": "email",
    "delay_hours": 4,
    "subject": "Here is 10% off, {{first_name}}",
    "preview_text": "Use PROMUNCH10 on your saved cart.",
    "coupon_code": "PROMUNCH10",
    "body_html": "<p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;\">Hi {{first_name}},</p><p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;\">Your cart is still saved. Here is 10 percent off to help you finish it.</p><div style=\"margin:20px 0;padding:16px;border:2px dashed #E0A24E;border-radius:12px;text-align:center;\"><div style=\"font-size:12px;color:#6E665A;letter-spacing:1px;\">YOUR CODE</div><div style=\"font-size:26px;font-weight:800;color:#1B2A20;letter-spacing:2px;margin-top:4px;\">PROMUNCH10</div><div style=\"font-size:12px;color:#6E665A;margin-top:6px;\">10% off orders above ₹399</div></div>{{cart_items}}<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:22px 0;\"><tr><td style=\"background:#1B2A20;border-radius:10px;\"><a href=\"{{checkout_url}}\" style=\"display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;\">Apply my discount</a></td></tr></table><p style=\"font-size:15px;line-height:1.6;color:#6E665A;margin:0;\">Stack it with free shipping over ₹599 and 5% off when you pay online.</p>"
  },
  {
    "type": "email",
    "delay_hours": 16,
    "subject": "Last call for your cart, {{first_name}}",
    "preview_text": "This is the last email we will send about it.",
    "coupon_code": "PROMUNCH10",
    "body_html": "<p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;\">Hi {{first_name}},</p><p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;\">This is the last email we will send about this cart. We hold it a little longer, then we let it go.</p>{{cart_items}}<p style=\"font-size:16px;line-height:1.6;margin:0 0 4px;\"><strong>{{cart_total}}</strong>, and PROMUNCH10 still takes 10% off.</p><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:22px 0;\"><tr><td style=\"background:#E0A24E;border-radius:10px;\"><a href=\"{{checkout_url}}\" style=\"display:inline-block;padding:14px 28px;color:#1B2A20;font-size:16px;font-weight:800;text-decoration:none;\">Grab my snacks</a></td></tr></table><p style=\"font-size:15px;line-height:1.6;color:#6E665A;margin:0;\">Either way, thanks for stopping by.<br>Your Munchy Pal</p>"
  }
]
$json$::jsonb,
  updated_at = NOW()
WHERE trigger_type = 'checkout_abandoned' AND status = 'active';

-- Verify:
--   select name, status, jsonb_array_length(steps) steps,
--          trigger_config->>'deadline_hours' deadline
--   from flows where trigger_type = 'checkout_abandoned';
