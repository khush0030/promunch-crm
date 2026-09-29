-- ============================================================
-- EMAIL FLOW CONTENT v3 (2026-09-30). NOT A MIGRATION. For the owner to review,
-- then paste by hand in the Supabase dashboard SQL editor.
--
-- Generated from src/lib/email/flow-templates.ts (the gallery templates), so the
-- live rows and "Use template" stay identical. If you edit copy there, regenerate.
--
-- ORDER OF OPERATIONS (do not skip):
--   1. The engine changes from the same batch must be DEPLOYED first
--      (vercel --prod): format/plain layout, signature, from_name, unique
--      coupon minting (migration 20260930120000_email_flow_coupons applied),
--      subject/preview A/B, frequency cap, exit_on_order, segment enrolment.
--      On the OLD engine these rows still send, but: "plain" steps render in
--      the designed card, A/B variants are ignored, and {{coupon_code}} becomes
--      the static fallback (PROMUNCH10 / WELCOME10 / COMEBACK15), which does NOT
--      expire, so the "expires" lines would be untrue.
--   2. Section A (abandoned cart UPDATE) goes live immediately, since that flow
--      is status='active'. Take the snapshot in A.0 first.
--   3. Section B inserts Welcome, Post-purchase, Win-back and Browse
--      abandonment as status='draft'. Nothing sends until someone sets
--      status='active' in the dashboard.
--
-- Copy rules (AGENTS.md §5): PROMUNCH all caps, no em or en dashes, never
-- Oltaflock, "Your Munchy Pal" is in the designed header (layout.ts). Founder
-- emails sign as Parth, Founder, PROMUNCH (from name "Parth from PROMUNCH",
-- address unchanged: hello@promunch.in).
--
-- Reviews quoted are real, verbatim Judge.me reviews published on promunch.in
-- (Noodle Masala Soya Crunchies 270gm page): Sujay Thomas (5 stars, 2026-05-09)
-- and Naresh Saw (5 stars, 2024-12-10). REVIEW FLAG: the store also shows ~15
-- five-star reviews dated 2026-09-09..16 where the same few names (Ritika
-- Choudhary x5, Amrita Rathore x3, Sakshi x2, HONEY JADHAV x2) review many
-- products within minutes. They were deliberately NOT used. Confirm with the
-- owner whether those are genuine before quoting them anywhere.
-- ============================================================


-- ============================================================
-- A. ABANDONED CART: 4 touches in 24h -> 3 touches over 46h
--    +45 min  designed  cart items + 10% unique code up front (code lives 3 days)
--    +22h     plain     founder note from Parth, code reminder
--    +46h     designed  last chance, code "expires in about a day", real reviews
--    deadline_hours 30 -> 54 so email 3 can go out.
-- ============================================================

-- A.0 Snapshot the live row BEFORE running A.1 (save the output somewhere):
--   select id, name, status, trigger_config, steps, updated_at
--   from flows where trigger_type = 'checkout_abandoned';
-- Expect exactly ONE active row named 'Abandoned cart'. If there are more, stop.

-- A.1 The update.
UPDATE flows
SET
  description = 'Checkout started but not paid. 3 emails over 2 days: cart + 10% unique code, a founder note, then a last call before the code expires. Uses the Super Money Breeze recovery link.',
  trigger_config = $json${"coupon_code":"PROMUNCH10","deadline_hours":54}$json$::jsonb,
  steps = $json$
[
  {
    "type": "email",
    "format": "designed",
    "delay_hours": 0.75,
    "subject": "{{first_name}}, your cart is saved (plus 10% off)",
    "subject_variants": [
      "You left something behind. Here is 10% off it",
      "[Saved for you] Your PROMUNCH cart and a 10% code"
    ],
    "preview_text": "Your code {{coupon_code}} takes 10% off. Good for 3 days.",
    "preview_variants": [
      "Pick up right where you left off, 10% off is on us."
    ],
    "coupon": {
      "percent_off": 10,
      "expires_in_days": 3,
      "prefix": "CART"
    },
    "coupon_code": "PROMUNCH10",
    "body_html": "<p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;color:#1A1714;\">Hi {{first_name}},</p><p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;color:#1A1714;\">You were one step away from your snacks, so we saved your cart for you. Here is what is in it:</p>{{cart_items}}<div style=\"margin:20px 0;padding:16px;border:2px dashed #E0A24E;border-radius:12px;text-align:center;\"><div style=\"font-size:12px;color:#6E665A;letter-spacing:1px;\">10% OFF, JUST FOR YOU</div><div style=\"font-size:26px;font-weight:800;color:#1B2A20;letter-spacing:2px;margin-top:4px;\">{{coupon_code}}</div><div style=\"font-size:12px;color:#6E665A;margin-top:6px;\">One use. Enter it at checkout within 3 days.</div></div><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:22px 0;\"><tr><td style=\"background:#1B2A20;border-radius:10px;\"><a href=\"{{checkout_url}}\" style=\"display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:800;text-decoration:none;\">Finish my order</a></td></tr></table><p style=\"font-size:14px;line-height:1.6;color:#6E665A;margin:0 0 10px;\">Free shipping on orders over ₹599.</p><p style=\"font-size:14px;line-height:1.6;color:#6E665A;margin:0 0 10px;\">Stuck at checkout? Just reply to this email and a real person will help.</p>"
  },
  {
    "type": "email",
    "format": "plain",
    "from_name": "Parth from PROMUNCH",
    "signature": "Parth\nFounder, PROMUNCH",
    "delay_hours": 21.25,
    "subject": "A quick note from PROMUNCH's founder",
    "subject_variants": [
      "{{first_name}}, can I ask you something?",
      "Why I started PROMUNCH (30 second read)"
    ],
    "preview_text": "And your 10% code is still waiting for you.",
    "preview_variants": [
      "What stopped you? Honest answers welcome."
    ],
    "coupon": {
      "percent_off": 10,
      "expires_in_days": 3,
      "prefix": "CART"
    },
    "coupon_code": "PROMUNCH10",
    "body_html": "<p style=\"margin:0 0 14px;\">Hi {{first_name}},</p><p style=\"margin:0 0 14px;\">I'm Parth, I started PROMUNCH. I noticed your cart is still sitting there, so I wanted to write to you myself.</p><p style=\"margin:0 0 14px;\">We started PROMUNCH because a snack in India usually meant fried namkeen or chips with very little protein. We wanted something crunchy that actually fills you up. That is what is waiting in your cart: high-protein soya and edamame snacks.</p><p style=\"margin:0 0 14px;\">If something stopped you, a price question, a flavour doubt, a glitch at checkout, just hit reply and tell me. The team and I read every reply.</p><p style=\"margin:0 0 14px;\">Your 10% code still works: <b>{{coupon_code}}</b></p><p style=\"margin:0 0 14px;\"><a href=\"{{checkout_url}}\">Here is your cart</a> whenever you are ready.</p>"
  },
  {
    "type": "email",
    "format": "designed",
    "delay_hours": 24,
    "subject": "Last chance: your 10% code expires soon",
    "subject_variants": [
      "{{first_name}}, your 10% code runs out in about a day",
      "Final reminder about your PROMUNCH cart"
    ],
    "preview_text": "This is the last email we will send about your cart.",
    "preview_variants": [
      "After this, your code stops working."
    ],
    "coupon": {
      "percent_off": 10,
      "expires_in_days": 3,
      "prefix": "CART"
    },
    "coupon_code": "PROMUNCH10",
    "body_html": "<p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;color:#1A1714;\">Hi {{first_name}},</p><p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;color:#1A1714;\">This is the last email we will send about your cart. Your 10% code expires in about a day, and after that it will not work.</p><div style=\"margin:20px 0;padding:16px;border:2px dashed #E0A24E;border-radius:12px;text-align:center;\"><div style=\"font-size:12px;color:#6E665A;letter-spacing:1px;\">YOUR CODE, EXPIRING SOON</div><div style=\"font-size:26px;font-weight:800;color:#1B2A20;letter-spacing:2px;margin-top:4px;\">{{coupon_code}}</div><div style=\"font-size:12px;color:#6E665A;margin-top:6px;\">10% off. One use.</div></div>{{cart_items}}<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:22px 0;\"><tr><td style=\"background:#E0A24E;border-radius:10px;\"><a href=\"{{checkout_url}}\" style=\"display:inline-block;padding:14px 28px;color:#1B2A20;font-size:16px;font-weight:800;text-decoration:none;\">Grab my snacks</a></td></tr></table><p style=\"font-size:18px;font-weight:800;line-height:1.3;margin:22px 0 10px;color:#1B2A20;\">What snackers say</p><div style=\"margin:0 0 12px;padding:14px 16px;background:#F8F4EC;border-left:3px solid #E0A24E;border-radius:8px;\"><div style=\"font-size:13px;color:#E0A24E;letter-spacing:2px;\">★★★★★</div><div style=\"font-size:15px;line-height:1.6;color:#1A1714;margin:4px 0 6px;\">\"Wish this was mainstream. Excellent flavour, excellent crunch, excellent macros. What more do you want?\"</div><div style=\"font-size:13px;color:#6E665A;\">Sujay Thomas, on Noodle Masala Soya Crunchies</div></div><div style=\"margin:0 0 12px;padding:14px 16px;background:#F8F4EC;border-left:3px solid #E0A24E;border-radius:8px;\"><div style=\"font-size:13px;color:#E0A24E;letter-spacing:2px;\">★★★★★</div><div style=\"font-size:15px;line-height:1.6;color:#1A1714;margin:4px 0 6px;\">\"Glad that some companies are there who are selling protein snacks at affordable price and that also tastes good. Finding healthy option in snacks is really tiresome but you made it easy.\"</div><div style=\"font-size:13px;color:#6E665A;\">Naresh Saw, on Noodle Masala Soya Crunchies</div></div><p style=\"font-size:14px;line-height:1.6;color:#6E665A;margin:0 0 10px;\">Real reviews from promunch.in.</p><p style=\"font-size:14px;line-height:1.6;color:#6E665A;margin:0 0 10px;\">Free shipping on orders over ₹599. Questions? Reply and we will help.</p>"
  }
]
$json$::jsonb,
  updated_at = NOW()
WHERE name = 'Abandoned cart' AND trigger_type = 'checkout_abandoned' AND status = 'active';
-- Expect: UPDATE 1.

-- A.2 Verify:
--   select name, status, jsonb_array_length(steps) steps,
--          trigger_config->>'deadline_hours' deadline,
--          steps->0->'coupon' coupon
--   from flows where trigger_type = 'checkout_abandoned';
--   -> 3 steps, deadline 54, coupon {"prefix":"CART","percent_off":10,"expires_in_days":3}

-- A.3 ROLLBACK. Restores the sequence from supabase/migrations/013 (what the
-- live row should contain today; the live row could not be read from this
-- session, so prefer your A.0 snapshot if it differs). Enrolments already
-- mid-sequence keep their current_step index, so after a rollback a contact on
-- step 2 of 3 would get old step 3 of 4. Acceptable, no duplicate send.
/*
UPDATE flows
SET
  trigger_config = '{"coupon_code": "PROMUNCH10", "deadline_hours": 30}'::jsonb,
  description = 'Checkout started but not paid. Reminder, then coupon, then last call. Uses the Super Money Breeze recovery link.',
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
WHERE name = 'Abandoned cart' AND trigger_type = 'checkout_abandoned' AND status = 'active';

*/


-- ============================================================
-- B. NEW FLOWS, all status='draft'. Idempotent (skips if the name exists).
-- flows.status CHECK: draft | active | paused. trigger_type CHECK includes
-- customer_created, order_placed, segment_entry.
-- ============================================================

-- B.1 WELCOME (popup signup, customer_created). 10% unique code lives 9 days.
--   day 0  designed  welcome + code + promise + whitelist hello@promunch.in (bypasses freq cap)
--   day 2  plain     Parth founder welcome
--   day 4  designed  Best Sellers + "5 days left"
--   day 6  designed  free shipping over ₹599 + real reviews
--   day 8  designed  "expires tomorrow" + why people stick with PROMUNCH
-- exit_on_order: stops the moment they place an order.
-- Welcome series: 5 steps. Popup signup to first order: 5 emails over 8 days. 10% unique code, founder note, Best Sellers, free-shipping angle with reviews, final reminder. Stops the moment they order.
INSERT INTO flows (name, description, trigger_type, trigger_config, status, steps)
SELECT
  'Welcome series',
  'Popup signup to first order: 5 emails over 8 days. 10% unique code, founder note, Best Sellers, free-shipping angle with reviews, final reminder. Stops the moment they order.',
  'customer_created',
  $json${"coupon_code":"WELCOME10","exit_on_order":true}$json$::jsonb,
  'draft',
  $json$
[
  {
    "type": "email",
    "format": "designed",
    "delay_hours": 0,
    "bypass_freq_cap": true,
    "subject": "Welcome to PROMUNCH, here is 10% off",
    "subject_variants": [
      "Your 10% welcome code is inside",
      "{{first_name}}, welcome to the crunchy side"
    ],
    "preview_text": "Your code {{coupon_code}} is ready, plus our promise to you.",
    "preview_variants": [
      "10% off your first order, good for 9 days."
    ],
    "coupon": {
      "percent_off": 10,
      "expires_in_days": 9,
      "prefix": "WELCOME"
    },
    "coupon_code": "WELCOME10",
    "body_html": "<p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;color:#1A1714;\">Hi {{first_name}},</p><p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;color:#1A1714;\">Welcome to PROMUNCH. We make high-protein snacks for people who want their snack to actually do something for them. Here is your welcome gift:</p><div style=\"margin:20px 0;padding:16px;border:2px dashed #E0A24E;border-radius:12px;text-align:center;\"><div style=\"font-size:12px;color:#6E665A;letter-spacing:1px;\">10% OFF YOUR FIRST ORDER</div><div style=\"font-size:26px;font-weight:800;color:#1B2A20;letter-spacing:2px;margin-top:4px;\">{{coupon_code}}</div><div style=\"font-size:12px;color:#6E665A;margin-top:6px;\">One use. Valid for 9 days.</div></div><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:22px 0;\"><tr><td style=\"background:#1B2A20;border-radius:10px;\"><a href=\"https://promunch.in/collections/best-sellers?utm_source=email&utm_medium=flow&utm_campaign=welcome&utm_content=email_1\" style=\"display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:800;text-decoration:none;\">Shop Best Sellers</a></td></tr></table><p style=\"font-size:18px;font-weight:800;line-height:1.3;margin:22px 0 10px;color:#1B2A20;\">Our promise to you</p><ul style=\"font-size:16px;line-height:1.7;margin:0 0 16px;padding-left:20px;color:#1A1714;\"><li style=\"margin:0 0 6px;\"><b>Real protein.</b> Our Roasted Edamame has over 40g of protein per 100g.</li><li style=\"margin:0 0 6px;\"><b>Honest labels.</b> Our Soya Crunchies and Edamame are roasted. Our Sticks and Chips are fried, and we will always tell you which is which.</li><li style=\"margin:0 0 6px;\"><b>Big flavour.</b> Noodle Masala, Tangy Pudina, Peri Peri and Cheese &amp; Onion Crunchies, plus Edamame in Himalayan Rock Salt, Indori Chatka and Masala Mania.</li><li style=\"margin:0 0 6px;\"><b>Fair shipping.</b> Free on orders over ₹599.</li></ul><p style=\"font-size:14px;line-height:1.6;color:#6E665A;margin:0 0 10px;\">One small thing: add <b>hello@promunch.in</b> to your contacts so our emails, and your code, land in your inbox and not in spam.</p>"
  },
  {
    "type": "email",
    "format": "plain",
    "from_name": "Parth from PROMUNCH",
    "signature": "Parth\nFounder, PROMUNCH",
    "delay_hours": 48,
    "subject": "Hi {{first_name}}, it's Parth from PROMUNCH",
    "subject_variants": [
      "A quick hello from our founder",
      "Thanks for joining us, {{first_name}}"
    ],
    "preview_text": "Why we make PROMUNCH, in a few lines.",
    "preview_variants": [
      "Not sure what to try first? Ask me."
    ],
    "coupon": {
      "percent_off": 10,
      "expires_in_days": 9,
      "prefix": "WELCOME"
    },
    "coupon_code": "WELCOME10",
    "body_html": "<p style=\"margin:0 0 14px;\">Hi {{first_name}},</p><p style=\"margin:0 0 14px;\">I'm Parth, the founder of PROMUNCH. Thank you for joining us.</p><p style=\"margin:0 0 14px;\">Quick story. We started PROMUNCH because snacking in India mostly meant fried namkeen and chips. Tasty, but with very little protein. We wanted a crunchy snack you could reach for every day and feel good about.</p><p style=\"margin:0 0 14px;\">If you are not sure where to start, reply and tell me what you like, spicy, tangy or light and salty, and I will point you to the right pack.</p><p style=\"margin:0 0 14px;\">And if you just want to dive in, your 10% code <b>{{coupon_code}}</b> is still active. <a href=\"https://promunch.in/collections/best-sellers?utm_source=email&utm_medium=flow&utm_campaign=welcome&utm_content=email_2\">Here are our Best Sellers</a>.</p>"
  },
  {
    "type": "email",
    "format": "designed",
    "delay_hours": 48,
    "subject": "Your 10% code is still waiting (5 days left)",
    "subject_variants": [
      "The PROMUNCH packs people start with",
      "{{first_name}}, do not let your 10% go to waste"
    ],
    "preview_text": "Our Best Sellers, and your code {{coupon_code}}.",
    "preview_variants": [
      "5 days left on your welcome code."
    ],
    "coupon": {
      "percent_off": 10,
      "expires_in_days": 9,
      "prefix": "WELCOME"
    },
    "coupon_code": "WELCOME10",
    "body_html": "<p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;color:#1A1714;\">Hi {{first_name}},</p><p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;color:#1A1714;\">Not sure what to try first? Start with a pick from our Best Sellers. Your welcome code has 5 days left.</p><ul style=\"font-size:16px;line-height:1.7;margin:0 0 16px;padding-left:20px;color:#1A1714;\"><li style=\"margin:0 0 6px;\"><a href=\"https://promunch.in/products/promunch-roasted-edamame-beans-assorted-combo-42-45g-high-protein-snack?utm_source=email&utm_medium=flow&utm_campaign=welcome&utm_content=email_3\" style=\"color:#1B2A20;font-weight:700;\">Roasted Edamame Combo</a>: all three flavours, roasted in olive oil, over 40g protein per 100g</li><li style=\"margin:0 0 6px;\"><a href=\"https://promunch.in/products/promunch-roasted-soya-snack-high-protein-healthy-gluten-free-combo-of-3-packs-flavour-cheese-onion-tangy-pudina-and-peri-peri-150-g-each?utm_source=email&utm_medium=flow&utm_campaign=welcome&utm_content=email_3\" style=\"color:#1B2A20;font-weight:700;\">Assorted Flavored Pack, 150g x 4</a>: roasted Soya Crunchies in four flavours</li><li style=\"margin:0 0 6px;\"><a href=\"https://promunch.in/products/promunch-roasted-edamame-beans-mini-combo-pack-of-9-25g-x-9-all-3-flavours?utm_source=email&utm_medium=flow&utm_campaign=welcome&utm_content=email_3\" style=\"color:#1B2A20;font-weight:700;\">Edamame Travel Combo, pack of 9</a>: 25g packs made for your bag</li></ul><div style=\"margin:20px 0;padding:16px;border:2px dashed #E0A24E;border-radius:12px;text-align:center;\"><div style=\"font-size:12px;color:#6E665A;letter-spacing:1px;\">YOUR WELCOME CODE</div><div style=\"font-size:26px;font-weight:800;color:#1B2A20;letter-spacing:2px;margin-top:4px;\">{{coupon_code}}</div><div style=\"font-size:12px;color:#6E665A;margin-top:6px;\">10% off. 5 days left.</div></div><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:22px 0;\"><tr><td style=\"background:#E0A24E;border-radius:10px;\"><a href=\"https://promunch.in/collections/best-sellers?utm_source=email&utm_medium=flow&utm_campaign=welcome&utm_content=email_3\" style=\"display:inline-block;padding:14px 28px;color:#1B2A20;font-size:16px;font-weight:800;text-decoration:none;\">Shop Best Sellers</a></td></tr></table>"
  },
  {
    "type": "email",
    "format": "designed",
    "delay_hours": 48,
    "subject": "Free shipping on orders over ₹599",
    "subject_variants": [
      "{{first_name}}, here is how to get free shipping",
      "What PROMUNCH customers are saying"
    ],
    "preview_text": "Plus what real customers say about the crunch.",
    "preview_variants": [
      "A combo gets you there in one go."
    ],
    "coupon": {
      "percent_off": 10,
      "expires_in_days": 9,
      "prefix": "WELCOME"
    },
    "coupon_code": "WELCOME10",
    "body_html": "<p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;color:#1A1714;\">Hi {{first_name}},</p><p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;color:#1A1714;\">Every order over ₹599 ships free. The easiest way to get there is a combo, so you get to try more flavours in one go.</p><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:22px 0;\"><tr><td style=\"background:#1B2A20;border-radius:10px;\"><a href=\"https://promunch.in/collections/combos-and-gift-packs?utm_source=email&utm_medium=flow&utm_campaign=welcome&utm_content=email_4\" style=\"display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:800;text-decoration:none;\">See combos</a></td></tr></table><p style=\"font-size:18px;font-weight:800;line-height:1.3;margin:22px 0 10px;color:#1B2A20;\">What snackers say</p><div style=\"margin:0 0 12px;padding:14px 16px;background:#F8F4EC;border-left:3px solid #E0A24E;border-radius:8px;\"><div style=\"font-size:13px;color:#E0A24E;letter-spacing:2px;\">★★★★★</div><div style=\"font-size:15px;line-height:1.6;color:#1A1714;margin:4px 0 6px;\">\"Wish this was mainstream. Excellent flavour, excellent crunch, excellent macros. What more do you want?\"</div><div style=\"font-size:13px;color:#6E665A;\">Sujay Thomas, on Noodle Masala Soya Crunchies</div></div><div style=\"margin:0 0 12px;padding:14px 16px;background:#F8F4EC;border-left:3px solid #E0A24E;border-radius:8px;\"><div style=\"font-size:13px;color:#E0A24E;letter-spacing:2px;\">★★★★★</div><div style=\"font-size:15px;line-height:1.6;color:#1A1714;margin:4px 0 6px;\">\"Glad that some companies are there who are selling protein snacks at affordable price and that also tastes good. Finding healthy option in snacks is really tiresome but you made it easy.\"</div><div style=\"font-size:13px;color:#6E665A;\">Naresh Saw, on Noodle Masala Soya Crunchies</div></div><p style=\"font-size:14px;line-height:1.6;color:#6E665A;margin:0 0 10px;\">Real reviews from promunch.in.</p><p style=\"font-size:14px;line-height:1.6;color:#6E665A;margin:0 0 10px;\">Your welcome code <b>{{coupon_code}}</b> has 3 days left.</p>"
  },
  {
    "type": "email",
    "format": "designed",
    "delay_hours": 48,
    "subject": "Last chance: your 10% code expires tomorrow",
    "subject_variants": [
      "{{first_name}}, your welcome code ends tomorrow",
      "One last thing before your code expires"
    ],
    "preview_text": "After tomorrow it stops working. Here is why people stick with PROMUNCH.",
    "preview_variants": [
      "This is the last reminder about your code."
    ],
    "coupon": {
      "percent_off": 10,
      "expires_in_days": 9,
      "prefix": "WELCOME"
    },
    "coupon_code": "WELCOME10",
    "body_html": "<p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;color:#1A1714;\">Hi {{first_name}},</p><p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;color:#1A1714;\">Your 10% welcome code expires tomorrow. This is the last reminder we will send about it.</p><div style=\"margin:20px 0;padding:16px;border:2px dashed #E0A24E;border-radius:12px;text-align:center;\"><div style=\"font-size:12px;color:#6E665A;letter-spacing:1px;\">LAST DAY TOMORROW</div><div style=\"font-size:26px;font-weight:800;color:#1B2A20;letter-spacing:2px;margin-top:4px;\">{{coupon_code}}</div><div style=\"font-size:12px;color:#6E665A;margin-top:6px;\">10% off your first order. One use.</div></div><p style=\"font-size:18px;font-weight:800;line-height:1.3;margin:22px 0 10px;color:#1B2A20;\">Why people stick with PROMUNCH</p><ul style=\"font-size:16px;line-height:1.7;margin:0 0 16px;padding-left:20px;color:#1A1714;\"><li style=\"margin:0 0 6px;\">Over 40g of protein per 100g in our Roasted Edamame, roasted in olive oil.</li><li style=\"margin:0 0 6px;\">Ready to eat straight from the pack, at your desk, in the car or after a workout.</li><li style=\"margin:0 0 6px;\">Great on salads and soups, or tucked into wraps and sandwiches.</li><li style=\"margin:0 0 6px;\">Free shipping on every order over ₹599.</li></ul><p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;color:#1A1714;\">We started PROMUNCH to make a crunchy snack you can feel good about every day. We would love for you to try it.</p><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:22px 0;\"><tr><td style=\"background:#E0A24E;border-radius:10px;\"><a href=\"https://promunch.in/collections/all?utm_source=email&utm_medium=flow&utm_campaign=welcome&utm_content=email_5\" style=\"display:inline-block;padding:14px 28px;color:#1B2A20;font-size:16px;font-weight:800;text-decoration:none;\">Use my 10% now</a></td></tr></table><p style=\"font-size:14px;line-height:1.6;color:#6E665A;margin:0 0 10px;\">Parth and the PROMUNCH team</p>"
  }
]
$json$::jsonb
WHERE NOT EXISTS (SELECT 1 FROM flows WHERE name = 'Welcome series' AND trigger_type = 'customer_created');

-- B.2 POST-PURCHASE (order_placed, first order only). No coupons.
--   +15 min  plain     human thank-you, no order details (bypasses freq cap)
--   day 3    designed  how-to: storage, serving ideas, protein facts, FAQ link
--   day 10   designed  review ask -> /pages/review-submission, Instagram @promunch.snacks
--   day 14   plain     3-question reply survey (no survey tool exists)
-- Post-purchase: 4 steps. First order only. A human thank-you (no order details, Shopify and WhatsApp already confirm), a how-to guide, a review ask, then a 3-question reply survey.
INSERT INTO flows (name, description, trigger_type, trigger_config, status, steps)
SELECT
  'Post-purchase',
  'First order only. A human thank-you (no order details, Shopify and WhatsApp already confirm), a how-to guide, a review ask, then a 3-question reply survey.',
  'order_placed',
  $json${"first_order_only":true}$json$::jsonb,
  'draft',
  $json$
[
  {
    "type": "email",
    "format": "plain",
    "from_name": "Parth from PROMUNCH",
    "signature": "Parth\nFounder, PROMUNCH",
    "delay_hours": 0.25,
    "bypass_freq_cap": true,
    "subject": "Thank you, {{first_name}} (this is not a receipt)",
    "subject_variants": [
      "A quick thank you from a real human at PROMUNCH",
      "You just made our day, {{first_name}}"
    ],
    "preview_text": "No order details here, just a thank you.",
    "preview_variants": [
      "Parth here, founder of PROMUNCH."
    ],
    "body_html": "<p style=\"margin:0 0 14px;\">Hi {{first_name}},</p><p style=\"margin:0 0 14px;\">Parth here, I'm the founder of PROMUNCH. Your order confirmation is already with you, so this is not another receipt. I just wanted to say thank you.</p><p style=\"margin:0 0 14px;\">You picked a small Indian snack brand to try, and that genuinely means a lot to us. Somewhere in our office a small cheer just went up. (Okay, it was me.)</p><p style=\"margin:0 0 14px;\">One tip while you wait: once a pack is open, seal it tight so the crunch stays crunchy.</p><p style=\"margin:0 0 14px;\">If anything is not right with your order, just reply to this email and we will sort it out.</p>"
  },
  {
    "type": "email",
    "format": "designed",
    "delay_hours": 71.75,
    "subject": "How to get the most out of your PROMUNCH",
    "subject_variants": [
      "5 ways to enjoy your PROMUNCH snacks",
      "Your PROMUNCH questions, answered"
    ],
    "preview_text": "Storage, serving ideas and the protein facts.",
    "preview_variants": [
      "A 1 minute guide to your snacks."
    ],
    "body_html": "<p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;color:#1A1714;\">Hi {{first_name}},</p><p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;color:#1A1714;\">Your snacks are on their way or already open. Here is the short guide.</p><p style=\"font-size:18px;font-weight:800;line-height:1.3;margin:22px 0 10px;color:#1B2A20;\">Keep it crunchy</p><ul style=\"font-size:16px;line-height:1.7;margin:0 0 16px;padding-left:20px;color:#1A1714;\"><li style=\"margin:0 0 6px;\">Once a pack is open, seal it tight or tip it into an airtight jar.</li><li style=\"margin:0 0 6px;\">Keep it somewhere cool and dry, away from direct sunlight.</li></ul><p style=\"font-size:18px;font-weight:800;line-height:1.3;margin:22px 0 10px;color:#1B2A20;\">Ways to enjoy it</p><ul style=\"font-size:16px;line-height:1.7;margin:0 0 16px;padding-left:20px;color:#1A1714;\"><li style=\"margin:0 0 6px;\">Straight from the pack. It is ready to eat, no cooking needed.</li><li style=\"margin:0 0 6px;\">On a salad or a bowl of soup for extra crunch.</li><li style=\"margin:0 0 6px;\">Tucked into wraps and sandwiches.</li><li style=\"margin:0 0 6px;\">In your bag for travel, the office or after a workout.</li></ul><p style=\"font-size:18px;font-weight:800;line-height:1.3;margin:22px 0 10px;color:#1B2A20;\">The protein facts</p><ul style=\"font-size:16px;line-height:1.7;margin:0 0 16px;padding-left:20px;color:#1A1714;\"><li style=\"margin:0 0 6px;\"><b>Roasted Edamame:</b> over 40g of protein per 100g, roasted in olive oil.</li><li style=\"margin:0 0 6px;\"><b>Soya Crunchies:</b> roasted, not fried. Only Tangy Pudina is Jain friendly.</li><li style=\"margin:0 0 6px;\"><b>Soya Sticks and Chips:</b> fried, for when you want a classic chip crunch.</li></ul><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:22px 0;\"><tr><td style=\"background:#1B2A20;border-radius:10px;\"><a href=\"https://promunch.in/pages/faqs?utm_source=email&utm_medium=flow&utm_campaign=post_purchase&utm_content=email_2\" style=\"display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:800;text-decoration:none;\">Read our FAQs</a></td></tr></table><p style=\"font-size:14px;line-height:1.6;color:#6E665A;margin:0 0 10px;\">Anything else? Reply to this email and a real person will answer.</p>"
  },
  {
    "type": "email",
    "format": "designed",
    "delay_hours": 168,
    "subject": "{{first_name}}, how were your snacks?",
    "subject_variants": [
      "Got a minute? We would love your review",
      "Be honest: what did you think?"
    ],
    "preview_text": "Your review helps other snackers pick the right pack.",
    "preview_variants": [
      "Good or bad, we want to hear it."
    ],
    "body_html": "<p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;color:#1A1714;\">Hi {{first_name}},</p><p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;color:#1A1714;\">You have had your PROMUNCH for a little while now. How was it? A short review takes about a minute and helps other snackers pick the right pack.</p><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:22px 0;\"><tr><td style=\"background:#E0A24E;border-radius:10px;\"><a href=\"https://promunch.in/pages/review-submission?utm_source=email&utm_medium=flow&utm_campaign=post_purchase&utm_content=email_3\" style=\"display:inline-block;padding:14px 28px;color:#1B2A20;font-size:16px;font-weight:800;text-decoration:none;\">Leave a review</a></td></tr></table><p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;color:#1A1714;\">Got a photo of your snacks? Post it on Instagram and tag <b>@promunch.snacks</b>. We love seeing where PROMUNCH ends up.</p><p style=\"font-size:14px;line-height:1.6;color:#6E665A;margin:0 0 10px;\">Something not right? Reply to this email instead and we will fix it.</p>"
  },
  {
    "type": "email",
    "format": "plain",
    "from_name": "Parth from PROMUNCH",
    "signature": "Parth\nFounder, PROMUNCH",
    "delay_hours": 96,
    "subject": "3 quick questions (just hit reply)",
    "subject_variants": [
      "Can I ask you 3 things, {{first_name}}?",
      "Help us make PROMUNCH better"
    ],
    "preview_text": "A word or two for each is plenty.",
    "preview_variants": [
      "Parth here, 30 seconds of your time?"
    ],
    "body_html": "<p style=\"margin:0 0 14px;\">Hi {{first_name}},</p><p style=\"margin:0 0 14px;\">Parth again. Now that you have tried PROMUNCH, could you answer three quick questions? Just hit reply, a word or two each is plenty.</p><p style=\"margin:0 0 14px;\">1. How did you first hear about PROMUNCH?<br>2. What almost stopped you from ordering?<br>3. Which flavour or product should we make next?</p><p style=\"margin:0 0 14px;\">The team reads every reply, and your answers shape what we make next.</p><p style=\"margin:0 0 14px;\">Thank you.</p>"
  }
]
$json$::jsonb
WHERE NOT EXISTS (SELECT 1 FROM flows WHERE name = 'Post-purchase' AND trigger_type = 'order_placed');

-- B.3 WIN-BACK (segment_entry, segment=winback, 60 days since last order).
--   15% unique code lives 8 days.
--   day 0  designed  we miss you + 15% + what is new (Roasted Edamame)
--   day 3  plain     Parth: "did we do something wrong?"
--   day 7  designed  "ends tomorrow" + real reviews
-- Win-back: 3 steps. No order in 60 days. We-miss-you + 15% unique code and what is new, a founder follow-up, then a last call before the code expires. Stops on order.
INSERT INTO flows (name, description, trigger_type, trigger_config, status, steps)
SELECT
  'Win-back',
  'No order in 60 days. We-miss-you + 15% unique code and what is new, a founder follow-up, then a last call before the code expires. Stops on order.',
  'segment_entry',
  $json${"segment":"winback","days_since_last_order":60,"coupon_code":"COMEBACK15","exit_on_order":true}$json$::jsonb,
  'draft',
  $json$
[
  {
    "type": "email",
    "format": "designed",
    "delay_hours": 0,
    "subject": "We miss you, {{first_name}}. Here is 15% off",
    "subject_variants": [
      "It has been a while. 15% off to come back",
      "What is new at PROMUNCH (and 15% off)"
    ],
    "preview_text": "Your code {{coupon_code}} is good for 8 days.",
    "preview_variants": [
      "A comeback code, just for you."
    ],
    "coupon": {
      "percent_off": 15,
      "expires_in_days": 8,
      "prefix": "COMEBACK"
    },
    "coupon_code": "COMEBACK15",
    "body_html": "<p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;color:#1A1714;\">Hi {{first_name}},</p><p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;color:#1A1714;\">It has been a couple of months since your last PROMUNCH order, and we miss you. So here is a bigger thank you than usual:</p><div style=\"margin:20px 0;padding:16px;border:2px dashed #E0A24E;border-radius:12px;text-align:center;\"><div style=\"font-size:12px;color:#6E665A;letter-spacing:1px;\">15% OFF, WELCOME BACK</div><div style=\"font-size:26px;font-weight:800;color:#1B2A20;letter-spacing:2px;margin-top:4px;\">{{coupon_code}}</div><div style=\"font-size:12px;color:#6E665A;margin-top:6px;\">One use. Valid for 8 days.</div></div><p style=\"font-size:18px;font-weight:800;line-height:1.3;margin:22px 0 10px;color:#1B2A20;\">What is new</p><ul style=\"font-size:16px;line-height:1.7;margin:0 0 16px;padding-left:20px;color:#1A1714;\"><li style=\"margin:0 0 6px;\"><a href=\"https://promunch.in/collections/roasted-edamame-beans-high-protein-healthy-snacks-for-weight-loss?utm_source=email&utm_medium=flow&utm_campaign=winback&utm_content=email_1\" style=\"color:#1B2A20;font-weight:700;\">Roasted Edamame</a> in Himalayan Rock Salt, Indori Chatka and Masala Mania. Roasted in olive oil, over 40g of protein per 100g.</li><li style=\"margin:0 0 6px;\"><a href=\"https://promunch.in/products/promunch-roasted-edamame-beans-mini-combo-pack-of-9-25g-x-9-all-3-flavours?utm_source=email&utm_medium=flow&utm_campaign=winback&utm_content=email_1\" style=\"color:#1B2A20;font-weight:700;\">Edamame Travel Combo</a>: nine 25g packs across all three flavours, made for your bag.</li></ul><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:22px 0;\"><tr><td style=\"background:#1B2A20;border-radius:10px;\"><a href=\"https://promunch.in/collections/roasted-edamame-beans-high-protein-healthy-snacks-for-weight-loss?utm_source=email&utm_medium=flow&utm_campaign=winback&utm_content=email_1\" style=\"display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:800;text-decoration:none;\">See what is new</a></td></tr></table><p style=\"font-size:14px;line-height:1.6;color:#6E665A;margin:0 0 10px;\">Free shipping on orders over ₹599.</p>"
  },
  {
    "type": "email",
    "format": "plain",
    "from_name": "Parth from PROMUNCH",
    "signature": "Parth\nFounder, PROMUNCH",
    "delay_hours": 72,
    "subject": "Did we do something wrong, {{first_name}}?",
    "subject_variants": [
      "A quick question from PROMUNCH's founder",
      "{{first_name}}, can I ask why?"
    ],
    "preview_text": "Honest feedback welcome. Your 15% code is still active.",
    "preview_variants": [
      "One line is enough."
    ],
    "coupon": {
      "percent_off": 15,
      "expires_in_days": 8,
      "prefix": "COMEBACK"
    },
    "coupon_code": "COMEBACK15",
    "body_html": "<p style=\"margin:0 0 14px;\">Hi {{first_name}},</p><p style=\"margin:0 0 14px;\">Parth here, founder of PROMUNCH. You have not ordered in a while, and I would genuinely like to know why.</p><p style=\"margin:0 0 14px;\">Was it the taste, the price, the delivery, or did you just forget about us? Reply with one line. The team and I read every reply, and it helps us fix things.</p><p style=\"margin:0 0 14px;\">If you just forgot, your 15% code <b>{{coupon_code}}</b> is still active for a few more days. <a href=\"https://promunch.in/collections/all?utm_source=email&utm_medium=flow&utm_campaign=winback&utm_content=email_2\">Here is everything we make</a>.</p>"
  },
  {
    "type": "email",
    "format": "designed",
    "delay_hours": 96,
    "subject": "Last chance: your 15% off ends tomorrow",
    "subject_variants": [
      "{{first_name}}, your comeback code expires tomorrow",
      "Final reminder: 15% off PROMUNCH"
    ],
    "preview_text": "After tomorrow this code stops working.",
    "preview_variants": [
      "This is the last email about this offer."
    ],
    "coupon": {
      "percent_off": 15,
      "expires_in_days": 8,
      "prefix": "COMEBACK"
    },
    "coupon_code": "COMEBACK15",
    "body_html": "<p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;color:#1A1714;\">Hi {{first_name}},</p><p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;color:#1A1714;\">Your 15% comeback code expires tomorrow. This is the last email we will send about it.</p><div style=\"margin:20px 0;padding:16px;border:2px dashed #E0A24E;border-radius:12px;text-align:center;\"><div style=\"font-size:12px;color:#6E665A;letter-spacing:1px;\">LAST DAY TOMORROW</div><div style=\"font-size:26px;font-weight:800;color:#1B2A20;letter-spacing:2px;margin-top:4px;\">{{coupon_code}}</div><div style=\"font-size:12px;color:#6E665A;margin-top:6px;\">15% off. One use.</div></div><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:22px 0;\"><tr><td style=\"background:#E0A24E;border-radius:10px;\"><a href=\"https://promunch.in/collections/best-sellers?utm_source=email&utm_medium=flow&utm_campaign=winback&utm_content=email_3\" style=\"display:inline-block;padding:14px 28px;color:#1B2A20;font-size:16px;font-weight:800;text-decoration:none;\">Shop Best Sellers</a></td></tr></table><p style=\"font-size:18px;font-weight:800;line-height:1.3;margin:22px 0 10px;color:#1B2A20;\">What snackers say</p><div style=\"margin:0 0 12px;padding:14px 16px;background:#F8F4EC;border-left:3px solid #E0A24E;border-radius:8px;\"><div style=\"font-size:13px;color:#E0A24E;letter-spacing:2px;\">★★★★★</div><div style=\"font-size:15px;line-height:1.6;color:#1A1714;margin:4px 0 6px;\">\"Wish this was mainstream. Excellent flavour, excellent crunch, excellent macros. What more do you want?\"</div><div style=\"font-size:13px;color:#6E665A;\">Sujay Thomas, on Noodle Masala Soya Crunchies</div></div><div style=\"margin:0 0 12px;padding:14px 16px;background:#F8F4EC;border-left:3px solid #E0A24E;border-radius:8px;\"><div style=\"font-size:13px;color:#E0A24E;letter-spacing:2px;\">★★★★★</div><div style=\"font-size:15px;line-height:1.6;color:#1A1714;margin:4px 0 6px;\">\"Glad that some companies are there who are selling protein snacks at affordable price and that also tastes good. Finding healthy option in snacks is really tiresome but you made it easy.\"</div><div style=\"font-size:13px;color:#6E665A;\">Naresh Saw, on Noodle Masala Soya Crunchies</div></div><p style=\"font-size:14px;line-height:1.6;color:#6E665A;margin:0 0 10px;\">Real reviews from promunch.in.</p>"
  }
]
$json$::jsonb
WHERE NOT EXISTS (SELECT 1 FROM flows WHERE name = 'Win-back' AND trigger_type = 'segment_entry');

-- B.4 BROWSE ABANDONMENT (segment_entry, segment=browse_abandon). Needs the
--   storefront pixel (not deployed yet). 10% unique code lives 4 days.
--   +0h (tick waits >=1h after view)  designed  viewed product + code
--   +24h  plain     Parth: honest product facts
--   +72h  designed  last chance + Best Sellers + reviews
--   Engine must render {{product.title}}, {{product.url}} (fallback
--   https://promunch.in/collections/best-sellers) and {{product_image}}
--   (full <img> tag or empty string).
-- Browse abandonment: 3 steps. Viewed a product but did not buy. 3 emails: the product + 10% unique code, a founder note, then a last call with bestsellers.
INSERT INTO flows (name, description, trigger_type, trigger_config, status, steps)
SELECT
  'Browse abandonment',
  'Viewed a product but did not buy. 3 emails: the product + 10% unique code, a founder note, then a last call with bestsellers.',
  'segment_entry',
  $json${"segment":"browse_abandon","coupon_code":"PROMUNCH10"}$json$::jsonb,
  'draft',
  $json$
[
  {
    "type": "email",
    "format": "designed",
    "delay_hours": 0,
    "subject": "{{first_name}}, still thinking it over?",
    "subject_variants": [
      "You had your eye on this one",
      "A 10% code for the snack you were checking out"
    ],
    "preview_text": "{{product.title}}, now 10% off with your own code.",
    "preview_variants": [
      "Here it is again, with 10% off for the next 4 days."
    ],
    "coupon": {
      "percent_off": 10,
      "expires_in_days": 4,
      "prefix": "LOOK"
    },
    "coupon_code": "PROMUNCH10",
    "body_html": "<p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;color:#1A1714;\">Hi {{first_name}},</p><p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;color:#1A1714;\">You were checking out <b>{{product.title}}</b>. Here it is again, in case you want another look.</p>{{product_image}}<div style=\"margin:20px 0;padding:16px;border:2px dashed #E0A24E;border-radius:12px;text-align:center;\"><div style=\"font-size:12px;color:#6E665A;letter-spacing:1px;\">10% OFF, JUST FOR YOU</div><div style=\"font-size:26px;font-weight:800;color:#1B2A20;letter-spacing:2px;margin-top:4px;\">{{coupon_code}}</div><div style=\"font-size:12px;color:#6E665A;margin-top:6px;\">One use. Valid for 4 days.</div></div><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:22px 0;\"><tr><td style=\"background:#1B2A20;border-radius:10px;\"><a href=\"{{product.url}}\" style=\"display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:800;text-decoration:none;\">Take another look</a></td></tr></table><p style=\"font-size:14px;line-height:1.6;color:#6E665A;margin:0 0 10px;\">Free shipping on orders over ₹599.</p>"
  },
  {
    "type": "email",
    "format": "plain",
    "from_name": "Parth from PROMUNCH",
    "signature": "Parth\nFounder, PROMUNCH",
    "delay_hours": 24,
    "subject": "Why people pick PROMUNCH",
    "subject_variants": [
      "{{first_name}}, a quick note from our founder",
      "The honest version of what we make"
    ],
    "preview_text": "Roasted where it matters, and a lot of protein per bite.",
    "preview_variants": [
      "Your 10% code is still active."
    ],
    "coupon": {
      "percent_off": 10,
      "expires_in_days": 4,
      "prefix": "LOOK"
    },
    "coupon_code": "PROMUNCH10",
    "body_html": "<p style=\"margin:0 0 14px;\">Hi {{first_name}},</p><p style=\"margin:0 0 14px;\">Parth here, founder of PROMUNCH. I saw you looking at {{product.title}}, so here is the honest version of what we make.</p><p style=\"margin:0 0 14px;\">Our Roasted Edamame is roasted in olive oil and has over 40g of protein per 100g. Our Soya Crunchies are roasted too. Our Soya Sticks and Chips are fried, for when you want that classic chip crunch.</p><p style=\"margin:0 0 14px;\">All of it is ready to eat straight from the pack, and it works on salads and soups too.</p><p style=\"margin:0 0 14px;\">If you are unsure about a flavour, reply and tell me what you like, spicy, tangy or light and salty, and I will point you to the right pack.</p><p style=\"margin:0 0 14px;\">Your 10% code is still active: <b>{{coupon_code}}</b>. <a href=\"{{product.url}}\">Here is the product again</a>.</p>"
  },
  {
    "type": "email",
    "format": "designed",
    "delay_hours": 48,
    "subject": "Last chance: your 10% code expires soon",
    "subject_variants": [
      "{{first_name}}, your code runs out in about a day",
      "Before your 10% goes, see our Best Sellers"
    ],
    "preview_text": "After this, your code stops working.",
    "preview_variants": [
      "Plus the packs people keep coming back for."
    ],
    "coupon": {
      "percent_off": 10,
      "expires_in_days": 4,
      "prefix": "LOOK"
    },
    "coupon_code": "PROMUNCH10",
    "body_html": "<p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;color:#1A1714;\">Hi {{first_name}},</p><p style=\"font-size:16px;line-height:1.6;margin:0 0 14px;color:#1A1714;\">Your 10% code expires in about a day. This is the last email about it.</p><div style=\"margin:20px 0;padding:16px;border:2px dashed #E0A24E;border-radius:12px;text-align:center;\"><div style=\"font-size:12px;color:#6E665A;letter-spacing:1px;\">YOUR CODE, EXPIRING SOON</div><div style=\"font-size:26px;font-weight:800;color:#1B2A20;letter-spacing:2px;margin-top:4px;\">{{coupon_code}}</div><div style=\"font-size:12px;color:#6E665A;margin-top:6px;\">10% off. One use.</div></div><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:22px 0;\"><tr><td style=\"background:#E0A24E;border-radius:10px;\"><a href=\"{{product.url}}\" style=\"display:inline-block;padding:14px 28px;color:#1B2A20;font-size:16px;font-weight:800;text-decoration:none;\">Back to {{product.title}}</a></td></tr></table><p style=\"font-size:18px;font-weight:800;line-height:1.3;margin:22px 0 10px;color:#1B2A20;\">Or start with our Best Sellers</p><ul style=\"font-size:16px;line-height:1.7;margin:0 0 16px;padding-left:20px;color:#1A1714;\"><li style=\"margin:0 0 6px;\"><a href=\"https://promunch.in/products/promunch-roasted-edamame-beans-assorted-combo-42-45g-high-protein-snack?utm_source=email&utm_medium=flow&utm_campaign=browse_abandon&utm_content=email_3\" style=\"color:#1B2A20;font-weight:700;\">Roasted Edamame Combo</a>: all three flavours, roasted in olive oil</li><li style=\"margin:0 0 6px;\"><a href=\"https://promunch.in/products/promunch-roasted-soya-snack-high-protein-healthy-gluten-free-combo-of-3-packs-flavour-cheese-onion-tangy-pudina-and-peri-peri-150-g-each?utm_source=email&utm_medium=flow&utm_campaign=browse_abandon&utm_content=email_3\" style=\"color:#1B2A20;font-weight:700;\">Assorted Flavored Pack, 150g x 4</a>: roasted Soya Crunchies in four flavours</li></ul><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:22px 0;\"><tr><td style=\"background:#1B2A20;border-radius:10px;\"><a href=\"https://promunch.in/collections/best-sellers?utm_source=email&utm_medium=flow&utm_campaign=browse_abandon&utm_content=email_3\" style=\"display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:800;text-decoration:none;\">Shop Best Sellers</a></td></tr></table><p style=\"font-size:18px;font-weight:800;line-height:1.3;margin:22px 0 10px;color:#1B2A20;\">What snackers say</p><div style=\"margin:0 0 12px;padding:14px 16px;background:#F8F4EC;border-left:3px solid #E0A24E;border-radius:8px;\"><div style=\"font-size:13px;color:#E0A24E;letter-spacing:2px;\">★★★★★</div><div style=\"font-size:15px;line-height:1.6;color:#1A1714;margin:4px 0 6px;\">\"Wish this was mainstream. Excellent flavour, excellent crunch, excellent macros. What more do you want?\"</div><div style=\"font-size:13px;color:#6E665A;\">Sujay Thomas, on Noodle Masala Soya Crunchies</div></div><div style=\"margin:0 0 12px;padding:14px 16px;background:#F8F4EC;border-left:3px solid #E0A24E;border-radius:8px;\"><div style=\"font-size:13px;color:#E0A24E;letter-spacing:2px;\">★★★★★</div><div style=\"font-size:15px;line-height:1.6;color:#1A1714;margin:4px 0 6px;\">\"Glad that some companies are there who are selling protein snacks at affordable price and that also tastes good. Finding healthy option in snacks is really tiresome but you made it easy.\"</div><div style=\"font-size:13px;color:#6E665A;\">Naresh Saw, on Noodle Masala Soya Crunchies</div></div><p style=\"font-size:14px;line-height:1.6;color:#6E665A;margin:0 0 10px;\">Real reviews from promunch.in.</p>"
  }
]
$json$::jsonb
WHERE NOT EXISTS (SELECT 1 FROM flows WHERE name = 'Browse abandonment' AND trigger_type = 'segment_entry');

-- Verify:
--   select name, status, trigger_type, trigger_config, jsonb_array_length(steps) steps
--   from flows order by created_at;
