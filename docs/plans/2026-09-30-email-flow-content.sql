-- ============================================================
-- EMAIL FLOW CONTENT v4 (2026-09-30). NOT A MIGRATION. For the owner to review,
-- then paste by hand in the Supabase dashboard SQL editor.
--
-- GENERATED from src/lib/email/flow-templates.ts (the gallery templates), so the
-- live rows and "Use template" stay identical. If you edit copy there, regenerate
-- (the generator lives outside the repo; the mapping is 1:1: name, description,
-- trigger_type, trigger_config, steps).
--
-- WHAT CHANGED vs v3: offers lead with 15% and escalate to 20% in the last-chance
-- email (cart, welcome, browse); win-back is 20%; replenishment and anniversary
-- 15%. Every offer is a unique single-use Shopify code per enrolment
-- (idempotent per (enrolment, percent), so the 15% and 20% codes differ).
-- coupon_code is "" on every coupon step: no static 15%/20% code exists in
-- Shopify, so the engine must DEFER the step and retry when minting fails,
-- never send a missing or wrong code. Bodies are rebuilt on brand-blocks.ts
-- (one black-and-white style, one main button in the first screen).
-- New flows: Review request, Replenishment, Cross-sell, VIP thank-you,
-- Sunset unengaged, First-order anniversary. Post-purchase is now thank-you +
-- how-to only (the review ask moved to its own flow).
--
-- ORDER OF OPERATIONS (do not skip):
--   1. DEPLOY the engine from the same batch first (vercel --prod): brand
--      layout, plain layout, unique coupon minting (migration
--      20260930120000_email_flow_coupons applied), defer-on-mint-failure for
--      steps with an empty coupon_code, skip_if_wa_journey, subject/preview
--      A/B, frequency cap, exit_on_order, segment + browse enrolment.
--      On the OLD engine these rows would render {{coupon_code}} as EMPTY
--      (there is no static fallback any more). Do not run section A before
--      the new engine is live.
--   2. Section A (abandoned cart UPDATE) goes live immediately, since that flow
--      is status='active'. Take the snapshot in A.0 first.
--   3. Section B inserts the other 10 flows as status='draft'. Nothing sends
--      until someone sets status='active' in the dashboard. Each insert is
--      skipped when a flow with the same name + trigger already exists: if you
--      ran v3 of this file, run B.0 first to drop those v3 drafts.
--
-- Copy rules (AGENTS.md §5): PROMUNCH all caps, no em or en dashes, never
-- Oltaflock, "Your Munchy Pal" is in the designed header (layout.ts). Founder
-- emails sign as Parth, Founder, PROMUNCH (from name "Parth from PROMUNCH",
-- address unchanged: hello@promunch.in). Truthful expiry: every code lives
-- about a day longer than the copy says.
--
-- Reviews quoted are real, verbatim Judge.me reviews published on promunch.in
-- (Noodle Masala Soya Crunchies 270gm page): Sujay Thomas (5 stars, 2026-05-09)
-- and Naresh Saw (5 stars, 2024-12-10). REVIEW FLAG: the store also shows ~15
-- five-star reviews dated 2026-09-09..16 where the same few names (Ritika
-- Choudhary x5, Amrita Rathore x3, Sakshi x2, HONEY JADHAV x2) review many
-- products within minutes. They were deliberately NOT used. Confirm with the
-- owner whether those are genuine before quoting them anywhere.
-- Every link and product image was checked with curl -sI (HTTP 200) on 2026-09-30.
-- ============================================================


-- ============================================================
-- A. ABANDONED CART (live row UPDATE): 3 emails over ~46h
--   +45 min   designed 15% unique (CART15, lives 3d)          "{{first_name}}, your cart is saved (plus 15% off)"
--   +22h      plain    15% unique (CART15, lives 3d)          "A quick note from PROMUNCH's founder"
--   day 1.9   designed 20% unique (CART20, lives 3d)          "Last chance: 20% off your cart"
--    deadline_hours 54 so email 3 can go out.
-- ============================================================

-- A.0 Snapshot the live row BEFORE running A.1 (save the output somewhere):
--   select id, name, status, trigger_config, steps, updated_at
--   from flows where trigger_type = 'checkout_abandoned';
-- Expect exactly ONE active row named 'Abandoned cart'. If there are more, stop.

-- A.1 The update.
UPDATE flows
SET
  description = 'Checkout started but not paid. 3 emails over 2 days: cart + 15% unique code, a founder note, then a last call at 20%. Uses the Super Money Breeze recovery link.',
  trigger_config = $json${"deadline_hours":54}$json$::jsonb,
  steps = $json$
[
  {
    "type": "email",
    "format": "designed",
    "delay_hours": 0.75,
    "subject": "{{first_name}}, your cart is saved (plus 15% off)",
    "subject_variants": [
      "You left something behind. Here is 15% off it",
      "[Saved for you] Your PROMUNCH cart and a 15% code"
    ],
    "preview_text": "Your code {{coupon_code}} takes 15% off. Good for 2 days.",
    "preview_variants": [
      "Pick up right where you left off, with 15% off."
    ],
    "coupon": {
      "percent_off": 15,
      "expires_in_days": 3,
      "prefix": "CART15"
    },
    "coupon_code": "",
    "body_html": "<h1 style=\"margin:0 0 16px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:28px;line-height:1.2;font-weight:400;color:#1A1714;\">Your cart is saved</h1><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Hi {{first_name}}, you were one step away from your snacks, so we kept everything for you.</p><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#F4F1EA\" style=\"background:#F4F1EA;border:2px dashed #AF272F;border-radius:14px;padding:20px;text-align:center;\"><div style=\"font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:18px;line-height:1.3;font-weight:400;color:#1A1714;\">15% off your cart</div><div style=\"margin:10px 0 6px;font-family:'Courier New',Courier,monospace;font-size:26px;line-height:1.2;font-weight:700;letter-spacing:3px;color:#AF272F;\">{{coupon_code}}</div><div style=\"font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#4A453F;\">One use. Enter it at checkout within 2 days.</div></td></tr></table><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#AF272F\" style=\"background:#AF272F;border:2px solid #AF272F;border-radius:14px;\"><a href=\"{{checkout_url}}\" style=\"display:inline-block;padding:15px 28px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.2;font-weight:400;letter-spacing:1px;text-transform:uppercase;color:#FFFFFF;text-decoration:none;border-radius:14px;\">Finish my order</a></td></tr></table>{{cart_items}}<p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Free shipping on orders over ₹599. Stuck at checkout? Reply to this email and a real person will help.</p>"
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
    "preview_text": "And your 15% code is still waiting for you.",
    "preview_variants": [
      "What stopped you? Honest answers welcome."
    ],
    "coupon": {
      "percent_off": 15,
      "expires_in_days": 3,
      "prefix": "CART15"
    },
    "coupon_code": "",
    "body_html": "<p style=\"margin:0 0 14px;\">Hi {{first_name}},</p><p style=\"margin:0 0 14px;\">I'm Parth, I started PROMUNCH. I noticed your cart is still sitting there, so I wanted to write to you myself.</p><p style=\"margin:0 0 14px;\">We started PROMUNCH because a snack in India usually meant fried namkeen or chips with very little protein. We wanted something crunchy that actually fills you up. That is what is waiting in your cart.</p><p style=\"margin:0 0 14px;\">If something stopped you, a price question, a flavour doubt, a glitch at checkout, just hit reply and tell me. The team and I read every reply.</p><p style=\"margin:0 0 14px;\">Your 15% code still works: <b>{{coupon_code}}</b></p><p style=\"margin:0 0 14px;\"><a href=\"{{checkout_url}}\">Here is your cart</a> whenever you are ready.</p>"
  },
  {
    "type": "email",
    "format": "designed",
    "delay_hours": 24,
    "subject": "Last chance: 20% off your cart",
    "subject_variants": [
      "{{first_name}}, we made it 20% off. Last call",
      "Final reminder: your PROMUNCH cart, now 20% off"
    ],
    "preview_text": "Our best offer, good for the next 48 hours.",
    "preview_variants": [
      "This is the last email we will send about your cart."
    ],
    "coupon": {
      "percent_off": 20,
      "expires_in_days": 3,
      "prefix": "CART20"
    },
    "coupon_code": "",
    "body_html": "<h1 style=\"margin:0 0 16px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:28px;line-height:1.2;font-weight:400;color:#1A1714;\">Last call: 20% off your cart</h1><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Hi {{first_name}}, this is the last email we will send about your cart. We bumped your discount to 20%, our best offer, and it is good for the next 48 hours.</p><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#F4F1EA\" style=\"background:#F4F1EA;border:2px dashed #AF272F;border-radius:14px;padding:20px;text-align:center;\"><div style=\"font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:18px;line-height:1.3;font-weight:400;color:#1A1714;\">20% off your cart</div><div style=\"margin:10px 0 6px;font-family:'Courier New',Courier,monospace;font-size:26px;line-height:1.2;font-weight:700;letter-spacing:3px;color:#AF272F;\">{{coupon_code}}</div><div style=\"font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#4A453F;\">One use. Valid for 48 hours.</div></td></tr></table><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#AF272F\" style=\"background:#AF272F;border:2px solid #AF272F;border-radius:14px;\"><a href=\"{{checkout_url}}\" style=\"display:inline-block;padding:15px 28px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.2;font-weight:400;letter-spacing:1px;text-transform:uppercase;color:#FFFFFF;text-decoration:none;border-radius:14px;\">Grab my snacks</a></td></tr></table>{{cart_items}}<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td style=\"border-left:3px solid #AF272F;padding:4px 0 4px 16px;\"><div style=\"margin:0 0 8px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:18px;line-height:1;letter-spacing:2px;color:#AF272F;\">&#9733;&#9733;&#9733;&#9733;&#9733;</div><div style=\"font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;font-style:italic;color:#1A1714;\">&ldquo;Wish this was mainstream. Excellent flavour, excellent crunch, excellent macros. What more do you want?&rdquo;</div><div style=\"margin-top:6px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.4;color:#4A453F;\">Sujay Thomas, on Noodle Masala Soya Crunchies</div></td></tr></table><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td style=\"border-left:3px solid #AF272F;padding:4px 0 4px 16px;\"><div style=\"margin:0 0 8px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:18px;line-height:1;letter-spacing:2px;color:#AF272F;\">&#9733;&#9733;&#9733;&#9733;&#9733;</div><div style=\"font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;font-style:italic;color:#1A1714;\">&ldquo;Glad that some companies are there who are selling protein snacks at affordable price and that also tastes good. Finding healthy option in snacks is really tiresome but you made it easy.&rdquo;</div><div style=\"margin-top:6px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.4;color:#4A453F;\">Naresh Saw, on Noodle Masala Soya Crunchies</div></td></tr></table><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Free shipping on orders over ₹599. Questions? Reply and we will help.</p>"
  }
]
$json$::jsonb,
  updated_at = NOW()
WHERE name = 'Abandoned cart' AND trigger_type = 'checkout_abandoned' AND status = 'active';
-- Expect: UPDATE 1.

-- A.2 Verify:
--   select name, status, jsonb_array_length(steps) steps,
--          trigger_config->>'deadline_hours' deadline,
--          steps->0->'coupon' c1, steps->2->'coupon' c3
--   from flows where trigger_type = 'checkout_abandoned';
--   -> 3 steps, deadline 54, c1 {"prefix":"CART15","percent_off":15,...},
--      c3 {"prefix":"CART20","percent_off":20,...}

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
-- B. OTHER FLOWS, all status='draft'. Idempotent (skips if name + trigger exist).
-- flows.status CHECK: draft | active | paused. trigger_type CHECK includes
-- customer_created, order_placed, segment_entry, date_based.
-- ============================================================

-- B.0 ONLY if you already ran v3 of this file: drop its never-activated drafts
-- so the v4 inserts below are not skipped. Guarded to status='draft'.
/*
DELETE FROM flows
WHERE status = 'draft'
  AND (name, trigger_type) IN (
    ('Welcome series', 'customer_created'),
    ('Post-purchase', 'order_placed'),
    ('Win-back', 'segment_entry'),
    ('Browse abandonment', 'segment_entry')
  );
*/

-- B.1 WELCOME SERIES (customer_created, {"exit_on_order":true})
--   exit_on_order; exit_on_checkout defaults on for customer_created (cart flow takes over).
--   +0 min    designed 15% unique (WELCOME15, lives 8d)       "Welcome to PROMUNCH, here is 15% off"  [bypasses freq cap]
--   day 2     plain    15% unique (WELCOME15, lives 8d)       "Hi {{first_name}}, it's Parth from PROMUNCH"
--   day 4     designed 15% unique (WELCOME15, lives 8d)       "Not sure what to try first?"
--   day 6     designed 15% unique (WELCOME15, lives 8d)       "Free shipping on orders over ₹599"
--   day 8     designed 20% unique (WELCOME20, lives 3d)       "Last chance: we made it 20% off"
INSERT INTO flows (name, description, trigger_type, trigger_config, status, steps)
SELECT
  'Welcome series',
  'Popup signup to first order: 5 emails over 8 days. 15% unique code, founder note, first picks, free shipping + reviews, then a final 20% offer. Stops the moment they order.',
  'customer_created',
  $json${"exit_on_order":true}$json$::jsonb,
  'draft',
  $json$
[
  {
    "type": "email",
    "format": "designed",
    "delay_hours": 0,
    "bypass_freq_cap": true,
    "subject": "Welcome to PROMUNCH, here is 15% off",
    "subject_variants": [
      "Your 15% welcome code is inside",
      "{{first_name}}, welcome to the crunchy side"
    ],
    "preview_text": "Your code {{coupon_code}} is ready. Good for 7 days.",
    "preview_variants": [
      "15% off your first order, plus our promise to you."
    ],
    "coupon": {
      "percent_off": 15,
      "expires_in_days": 8,
      "prefix": "WELCOME15"
    },
    "coupon_code": "",
    "body_html": "<h1 style=\"margin:0 0 16px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:28px;line-height:1.2;font-weight:400;color:#1A1714;\">Welcome to PROMUNCH</h1><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Hi {{first_name}}, we make high-protein snacks for people who want their snack to actually do something for them. Here is 15% off your first order.</p><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#F4F1EA\" style=\"background:#F4F1EA;border:2px dashed #AF272F;border-radius:14px;padding:20px;text-align:center;\"><div style=\"font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:18px;line-height:1.3;font-weight:400;color:#1A1714;\">15% off your first order</div><div style=\"margin:10px 0 6px;font-family:'Courier New',Courier,monospace;font-size:26px;line-height:1.2;font-weight:700;letter-spacing:3px;color:#AF272F;\">{{coupon_code}}</div><div style=\"font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#4A453F;\">One use. Valid for 7 days.</div></td></tr></table><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#AF272F\" style=\"background:#AF272F;border:2px solid #AF272F;border-radius:14px;\"><a href=\"https://promunch.in/collections/best-sellers?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=welcome&amp;utm_content=email_1\" style=\"display:inline-block;padding:15px 28px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.2;font-weight:400;letter-spacing:1px;text-transform:uppercase;color:#FFFFFF;text-decoration:none;border-radius:14px;\">Shop Best Sellers</a></td></tr></table><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\"><strong>Our promise:</strong> real protein (our Roasted Edamame has over 40g per 100g), honest labels (our Soya Crunchies and Edamame are roasted, our Sticks and Chips are fried, and we always tell you which is which), and free shipping on orders over ₹599.</p><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">One small thing: add <strong>hello@promunch.in</strong> to your contacts so our emails, and your code, land in your inbox and not in spam.</p>"
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
      "percent_off": 15,
      "expires_in_days": 8,
      "prefix": "WELCOME15"
    },
    "coupon_code": "",
    "body_html": "<p style=\"margin:0 0 14px;\">Hi {{first_name}},</p><p style=\"margin:0 0 14px;\">I'm Parth, the founder of PROMUNCH. Thank you for joining us.</p><p style=\"margin:0 0 14px;\">Quick story. We started PROMUNCH because snacking in India mostly meant fried namkeen and chips. Tasty, but with very little protein. We wanted a crunchy snack you could reach for every day and feel good about.</p><p style=\"margin:0 0 14px;\">If you are not sure where to start, reply and tell me what you like, spicy, tangy or light and salty, and I will point you to the right pack.</p><p style=\"margin:0 0 14px;\">And if you just want to dive in, your 15% code <b>{{coupon_code}}</b> is still active. <a href=\"https://promunch.in/collections/best-sellers?utm_source=email&utm_medium=flow&utm_campaign=welcome&utm_content=email_2\">Here are our Best Sellers</a>.</p>"
  },
  {
    "type": "email",
    "format": "designed",
    "delay_hours": 48,
    "subject": "Not sure what to try first?",
    "subject_variants": [
      "The PROMUNCH packs people start with",
      "{{first_name}}, your 15% code has 3 days left"
    ],
    "preview_text": "Three easy first picks, and your code {{coupon_code}}.",
    "preview_variants": [
      "3 days left on your welcome code."
    ],
    "coupon": {
      "percent_off": 15,
      "expires_in_days": 8,
      "prefix": "WELCOME15"
    },
    "coupon_code": "",
    "body_html": "<h1 style=\"margin:0 0 16px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:28px;line-height:1.2;font-weight:400;color:#1A1714;\">Three easy first picks</h1><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Hi {{first_name}}, not sure where to start? These are a good first order. Your 15% code has 3 days left.</p><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#AF272F\" style=\"background:#AF272F;border:2px solid #AF272F;border-radius:14px;\"><a href=\"https://promunch.in/collections/best-sellers?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=welcome&amp;utm_content=email_3\" style=\"display:inline-block;padding:15px 28px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.2;font-weight:400;letter-spacing:1px;text-transform:uppercase;color:#FFFFFF;text-decoration:none;border-radius:14px;\">Shop Best Sellers</a></td></tr></table><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 8px;\"><tr><td style=\"font-size:0;line-height:0;text-align:left;\"><div style=\"display:inline-block;width:100%;max-width:170px;vertical-align:top;margin:0 16px 16px 0;text-align:left;\"><a href=\"https://promunch.in/products/promunch-roasted-edamame-beans-assorted-combo-42-45g-high-protein-snack?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=welcome&amp;utm_content=email_3\" style=\"text-decoration:none;\"><img src=\"https://cdn.shopify.com/s/files/1/0794/6731/5501/files/AssortedCombo1.png?v=1781094598\" alt=\"Roasted Edamame Combo\" width=\"170\" style=\"display:block;width:100%;max-width:170px;height:auto;border:1px solid #E5E0D6;border-radius:14px;\"></a><div style=\"margin-top:10px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.4;font-weight:700;\"><a href=\"https://promunch.in/products/promunch-roasted-edamame-beans-assorted-combo-42-45g-high-protein-snack?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=welcome&amp;utm_content=email_3\" style=\"color:#1A1714;text-decoration:underline;\">Roasted Edamame Combo</a></div></div><div style=\"display:inline-block;width:100%;max-width:170px;vertical-align:top;margin:0 16px 16px 0;text-align:left;\"><a href=\"https://promunch.in/products/promunch-roasted-soya-snack-high-protein-healthy-gluten-free-combo-of-3-packs-flavour-cheese-onion-tangy-pudina-and-peri-peri-150-g-each?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=welcome&amp;utm_content=email_3\" style=\"text-decoration:none;\"><img src=\"https://cdn.shopify.com/s/files/1/0794/6731/5501/files/Image_4_jpg.jpg?v=1773731385\" alt=\"Soya Crunchies, 4 flavours\" width=\"170\" style=\"display:block;width:100%;max-width:170px;height:auto;border:1px solid #E5E0D6;border-radius:14px;\"></a><div style=\"margin-top:10px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.4;font-weight:700;\"><a href=\"https://promunch.in/products/promunch-roasted-soya-snack-high-protein-healthy-gluten-free-combo-of-3-packs-flavour-cheese-onion-tangy-pudina-and-peri-peri-150-g-each?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=welcome&amp;utm_content=email_3\" style=\"color:#1A1714;text-decoration:underline;\">Soya Crunchies, 4 flavours</a></div></div><div style=\"display:inline-block;width:100%;max-width:170px;vertical-align:top;margin:0 0px 16px 0;text-align:left;\"><a href=\"https://promunch.in/products/promunch-roasted-edamame-beans-mini-combo-pack-of-9-25g-x-9-all-3-flavours?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=welcome&amp;utm_content=email_3\" style=\"text-decoration:none;\"><img src=\"https://cdn.shopify.com/s/files/1/0794/6731/5501/files/ChatGPTImageJun16_2026_04_48_28PM_1.png?v=1788435089\" alt=\"Edamame Travel Combo, 9 x 25g\" width=\"170\" style=\"display:block;width:100%;max-width:170px;height:auto;border:1px solid #E5E0D6;border-radius:14px;\"></a><div style=\"margin-top:10px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.4;font-weight:700;\"><a href=\"https://promunch.in/products/promunch-roasted-edamame-beans-mini-combo-pack-of-9-25g-x-9-all-3-flavours?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=welcome&amp;utm_content=email_3\" style=\"color:#1A1714;text-decoration:underline;\">Edamame Travel Combo, 9 x 25g</a></div></div></td></tr></table><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#F4F1EA\" style=\"background:#F4F1EA;border:2px dashed #AF272F;border-radius:14px;padding:20px;text-align:center;\"><div style=\"font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:18px;line-height:1.3;font-weight:400;color:#1A1714;\">Your welcome code</div><div style=\"margin:10px 0 6px;font-family:'Courier New',Courier,monospace;font-size:26px;line-height:1.2;font-weight:700;letter-spacing:3px;color:#AF272F;\">{{coupon_code}}</div><div style=\"font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#4A453F;\">15% off. 3 days left.</div></td></tr></table>"
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
      "percent_off": 15,
      "expires_in_days": 8,
      "prefix": "WELCOME15"
    },
    "coupon_code": "",
    "body_html": "<h1 style=\"margin:0 0 16px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:28px;line-height:1.2;font-weight:400;color:#1A1714;\">Free shipping over ₹599</h1><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Hi {{first_name}}, every order over ₹599 ships free. A combo is the easiest way to get there, and you get to try more flavours in one go.</p><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#AF272F\" style=\"background:#AF272F;border:2px solid #AF272F;border-radius:14px;\"><a href=\"https://promunch.in/collections/combos-and-gift-packs?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=welcome&amp;utm_content=email_4\" style=\"display:inline-block;padding:15px 28px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.2;font-weight:400;letter-spacing:1px;text-transform:uppercase;color:#FFFFFF;text-decoration:none;border-radius:14px;\">See combos</a></td></tr></table><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td style=\"border-left:3px solid #AF272F;padding:4px 0 4px 16px;\"><div style=\"margin:0 0 8px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:18px;line-height:1;letter-spacing:2px;color:#AF272F;\">&#9733;&#9733;&#9733;&#9733;&#9733;</div><div style=\"font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;font-style:italic;color:#1A1714;\">&ldquo;Wish this was mainstream. Excellent flavour, excellent crunch, excellent macros. What more do you want?&rdquo;</div><div style=\"margin-top:6px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.4;color:#4A453F;\">Sujay Thomas, on Noodle Masala Soya Crunchies</div></td></tr></table><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td style=\"border-left:3px solid #AF272F;padding:4px 0 4px 16px;\"><div style=\"margin:0 0 8px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:18px;line-height:1;letter-spacing:2px;color:#AF272F;\">&#9733;&#9733;&#9733;&#9733;&#9733;</div><div style=\"font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;font-style:italic;color:#1A1714;\">&ldquo;Glad that some companies are there who are selling protein snacks at affordable price and that also tastes good. Finding healthy option in snacks is really tiresome but you made it easy.&rdquo;</div><div style=\"margin-top:6px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.4;color:#4A453F;\">Naresh Saw, on Noodle Masala Soya Crunchies</div></td></tr></table><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Your 15% welcome code <strong>{{coupon_code}}</strong> is still active for about a day.</p>"
  },
  {
    "type": "email",
    "format": "designed",
    "delay_hours": 48,
    "subject": "Last chance: we made it 20% off",
    "subject_variants": [
      "{{first_name}}, one last welcome gift: 20% off",
      "Your final welcome offer: 20% off"
    ],
    "preview_text": "Our best welcome offer, good for 48 hours.",
    "preview_variants": [
      "This is the last reminder about your welcome offer."
    ],
    "coupon": {
      "percent_off": 20,
      "expires_in_days": 3,
      "prefix": "WELCOME20"
    },
    "coupon_code": "",
    "body_html": "<h1 style=\"margin:0 0 16px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:28px;line-height:1.2;font-weight:400;color:#1A1714;\">One last welcome gift: 20% off</h1><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Hi {{first_name}}, your welcome offer is ending, so here is our best one: 20% off your first order, good for the next 48 hours. This is the last reminder we will send about it.</p><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#F4F1EA\" style=\"background:#F4F1EA;border:2px dashed #AF272F;border-radius:14px;padding:20px;text-align:center;\"><div style=\"font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:18px;line-height:1.3;font-weight:400;color:#1A1714;\">20% off your first order</div><div style=\"margin:10px 0 6px;font-family:'Courier New',Courier,monospace;font-size:26px;line-height:1.2;font-weight:700;letter-spacing:3px;color:#AF272F;\">{{coupon_code}}</div><div style=\"font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#4A453F;\">One use. Valid for 48 hours.</div></td></tr></table><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#AF272F\" style=\"background:#AF272F;border:2px solid #AF272F;border-radius:14px;\"><a href=\"https://promunch.in/collections/all?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=welcome&amp;utm_content=email_5\" style=\"display:inline-block;padding:15px 28px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.2;font-weight:400;letter-spacing:1px;text-transform:uppercase;color:#FFFFFF;text-decoration:none;border-radius:14px;\">Use my 20% now</a></td></tr></table><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Why people stick with PROMUNCH: over 40g of protein per 100g in our Roasted Edamame, ready to eat straight from the pack, and great on salads and soups too.</p>"
  }
]
$json$::jsonb
WHERE NOT EXISTS (SELECT 1 FROM flows WHERE name = 'Welcome series' AND trigger_type = 'customer_created');

-- B.2 BROWSE ABANDONMENT (segment_entry, {"segment":"browse_abandon","exit_on_order":true})
--   needsSetup: only enrols once the storefront pixel is live (email-browse-tick).
--   +0 min    designed 15% unique (LOOK15, lives 4d)          "{{first_name}}, still thinking it over?"
--   day 1     plain    15% unique (LOOK15, lives 4d)          "Why people pick PROMUNCH"
--   day 3     designed 20% unique (LOOK20, lives 3d)          "Last chance: we made it 20% off"
INSERT INTO flows (name, description, trigger_type, trigger_config, status, steps)
SELECT
  'Browse abandonment',
  'Viewed a product but did not buy. 3 emails: the product + 15% unique code, a founder note, then a last call at 20%. Needs the storefront pixel.',
  'segment_entry',
  $json${"segment":"browse_abandon","exit_on_order":true}$json$::jsonb,
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
      "15% off the snack you were checking out"
    ],
    "preview_text": "{{product.title}}, now 15% off with your own code.",
    "preview_variants": [
      "Here it is again, with 15% off for the next 3 days."
    ],
    "coupon": {
      "percent_off": 15,
      "expires_in_days": 4,
      "prefix": "LOOK15"
    },
    "coupon_code": "",
    "body_html": "<h1 style=\"margin:0 0 16px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:28px;line-height:1.2;font-weight:400;color:#1A1714;\">Still thinking it over?</h1><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Hi {{first_name}}, you were checking out <strong>{{product.title}}</strong>. Here it is again, with 15% off if you want it.</p><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#F4F1EA\" style=\"background:#F4F1EA;border:2px dashed #AF272F;border-radius:14px;padding:20px;text-align:center;\"><div style=\"font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:18px;line-height:1.3;font-weight:400;color:#1A1714;\">15% off, just for you</div><div style=\"margin:10px 0 6px;font-family:'Courier New',Courier,monospace;font-size:26px;line-height:1.2;font-weight:700;letter-spacing:3px;color:#AF272F;\">{{coupon_code}}</div><div style=\"font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#4A453F;\">One use. Valid for 3 days.</div></td></tr></table><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#AF272F\" style=\"background:#AF272F;border:2px solid #AF272F;border-radius:14px;\"><a href=\"{{product.url}}\" style=\"display:inline-block;padding:15px 28px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.2;font-weight:400;letter-spacing:1px;text-transform:uppercase;color:#FFFFFF;text-decoration:none;border-radius:14px;\">Take another look</a></td></tr></table>{{product_image}}<p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Free shipping on orders over ₹599.</p>"
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
      "Your 15% code is still active."
    ],
    "coupon": {
      "percent_off": 15,
      "expires_in_days": 4,
      "prefix": "LOOK15"
    },
    "coupon_code": "",
    "body_html": "<p style=\"margin:0 0 14px;\">Hi {{first_name}},</p><p style=\"margin:0 0 14px;\">Parth here, founder of PROMUNCH. I saw you looking at {{product.title}}, so here is the honest version of what we make.</p><p style=\"margin:0 0 14px;\">Our Roasted Edamame is roasted in olive oil and has over 40g of protein per 100g. Our Soya Crunchies are roasted too. Our Soya Sticks and Chips are fried, for when you want that classic chip crunch.</p><p style=\"margin:0 0 14px;\">If you are unsure about a flavour, reply and tell me what you like, spicy, tangy or light and salty, and I will point you to the right pack.</p><p style=\"margin:0 0 14px;\">Your 15% code is still active: <b>{{coupon_code}}</b>. <a href=\"{{product.url}}\">Here is the product again</a>.</p>"
  },
  {
    "type": "email",
    "format": "designed",
    "delay_hours": 48,
    "subject": "Last chance: we made it 20% off",
    "subject_variants": [
      "{{first_name}}, 20% off for the next 48 hours",
      "Our best offer on {{product.title}}"
    ],
    "preview_text": "Our best offer, good for 48 hours. This is the last email about it.",
    "preview_variants": [
      "20% off, then this offer is gone."
    ],
    "coupon": {
      "percent_off": 20,
      "expires_in_days": 3,
      "prefix": "LOOK20"
    },
    "coupon_code": "",
    "body_html": "<h1 style=\"margin:0 0 16px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:28px;line-height:1.2;font-weight:400;color:#1A1714;\">We made it 20% off</h1><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Hi {{first_name}}, this is the last email about {{product.title}}. Here is our best offer: 20% off your order, good for the next 48 hours.</p><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#F4F1EA\" style=\"background:#F4F1EA;border:2px dashed #AF272F;border-radius:14px;padding:20px;text-align:center;\"><div style=\"font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:18px;line-height:1.3;font-weight:400;color:#1A1714;\">20% off your order</div><div style=\"margin:10px 0 6px;font-family:'Courier New',Courier,monospace;font-size:26px;line-height:1.2;font-weight:700;letter-spacing:3px;color:#AF272F;\">{{coupon_code}}</div><div style=\"font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#4A453F;\">One use. Valid for 48 hours.</div></td></tr></table><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#AF272F\" style=\"background:#AF272F;border:2px solid #AF272F;border-radius:14px;\"><a href=\"{{product.url}}\" style=\"display:inline-block;padding:15px 28px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.2;font-weight:400;letter-spacing:1px;text-transform:uppercase;color:#FFFFFF;text-decoration:none;border-radius:14px;\">Take me back</a></td></tr></table><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td style=\"border-left:3px solid #AF272F;padding:4px 0 4px 16px;\"><div style=\"margin:0 0 8px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:18px;line-height:1;letter-spacing:2px;color:#AF272F;\">&#9733;&#9733;&#9733;&#9733;&#9733;</div><div style=\"font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;font-style:italic;color:#1A1714;\">&ldquo;Wish this was mainstream. Excellent flavour, excellent crunch, excellent macros. What more do you want?&rdquo;</div><div style=\"margin-top:6px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.4;color:#4A453F;\">Sujay Thomas, on Noodle Masala Soya Crunchies</div></td></tr></table><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td style=\"border-left:3px solid #AF272F;padding:4px 0 4px 16px;\"><div style=\"margin:0 0 8px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:18px;line-height:1;letter-spacing:2px;color:#AF272F;\">&#9733;&#9733;&#9733;&#9733;&#9733;</div><div style=\"font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;font-style:italic;color:#1A1714;\">&ldquo;Glad that some companies are there who are selling protein snacks at affordable price and that also tastes good. Finding healthy option in snacks is really tiresome but you made it easy.&rdquo;</div><div style=\"margin-top:6px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.4;color:#4A453F;\">Naresh Saw, on Noodle Masala Soya Crunchies</div></td></tr></table><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Not quite right? <a href=\"https://promunch.in/collections/best-sellers?utm_source=email&utm_medium=flow&utm_campaign=browse_abandon&utm_content=email_3\" style=\"color:#AF272F;text-decoration:underline;\">See our Best Sellers</a>.</p>"
  }
]
$json$::jsonb
WHERE NOT EXISTS (SELECT 1 FROM flows WHERE name = 'Browse abandonment' AND trigger_type = 'segment_entry');

-- B.3 POST-PURCHASE (order_placed, {"first_order_only":true})
--   +15 min   plain    no code                                "Thank you, {{first_name}} (this is not a receipt)"  [bypasses freq cap]
--   day 3     designed no code                                "How to get the most out of your PROMUNCH"
INSERT INTO flows (name, description, trigger_type, trigger_config, status, steps)
SELECT
  'Post-purchase',
  'First order only. A human thank-you (no order details, Shopify and WhatsApp already confirm), then a how-to guide with the FAQ. Reviews have their own flow.',
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
    "body_html": "<p style=\"margin:0 0 14px;\">Hi {{first_name}},</p><p style=\"margin:0 0 14px;\">Parth here, I'm the founder of PROMUNCH. Your order confirmation is already with you, so this is not another receipt. I just wanted to say thank you.</p><p style=\"margin:0 0 14px;\">You picked a small Indian snack brand to try, and that genuinely means a lot to us.</p><p style=\"margin:0 0 14px;\">One tip while you wait: once a pack is open, seal it tight so the crunch stays crunchy.</p><p style=\"margin:0 0 14px;\">If anything is not right with your order, just reply to this email and we will sort it out.</p>"
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
    "body_html": "<h1 style=\"margin:0 0 16px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:28px;line-height:1.2;font-weight:400;color:#1A1714;\">Your 1 minute snack guide</h1><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Hi {{first_name}}, here is how to get the most out of your PROMUNCH.</p><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#AF272F\" style=\"background:#AF272F;border:2px solid #AF272F;border-radius:14px;\"><a href=\"https://promunch.in/pages/faqs?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=post_purchase&amp;utm_content=email_2\" style=\"display:inline-block;padding:15px 28px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.2;font-weight:400;letter-spacing:1px;text-transform:uppercase;color:#FFFFFF;text-decoration:none;border-radius:14px;\">Read our FAQs</a></td></tr></table><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\"><strong>Keep it crunchy.</strong> Once a pack is open, seal it tight or tip it into an airtight jar, and keep it somewhere cool and dry.</p><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\"><strong>Ways to enjoy it.</strong> Straight from the pack, on a salad or a bowl of soup, tucked into wraps and sandwiches, or in your bag for the office and after a workout.</p><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\"><strong>What is in the pack.</strong> Roasted Edamame: over 40g of protein per 100g, roasted in olive oil. Soya Crunchies: roasted, not fried. Soya Sticks and Chips: fried, for a classic chip crunch.</p><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Anything else? Reply to this email and a real person will answer.</p>"
  }
]
$json$::jsonb
WHERE NOT EXISTS (SELECT 1 FROM flows WHERE name = 'Post-purchase' AND trigger_type = 'order_placed');

-- B.4 REVIEW REQUEST (order_placed, {"exit_on_order":true})
--   Every order; WhatsApp review_request fires at day 7, so email is the fallback
--   for customers WhatsApp did not reach. A new order exits the pending ask.
--   day 8     designed no code                                "{{first_name}}, how were your snacks?"  [skip_if_wa_journey=review]
--   day 12    plain    no code                                "One small favour, {{first_name}}?"  [skip_if_wa_journey=review]
INSERT INTO flows (name, description, trigger_type, trigger_config, status, steps)
SELECT
  'Review request',
  'Every order. Around day 8, ask for a review on promunch.in, with one reminder on day 12. Skipped when WhatsApp already sent the review ask.',
  'order_placed',
  $json${"exit_on_order":true}$json$::jsonb,
  'draft',
  $json$
[
  {
    "type": "email",
    "format": "designed",
    "delay_hours": 192,
    "skip_if_wa_journey": "review",
    "subject": "{{first_name}}, how were your snacks?",
    "subject_variants": [
      "Got a minute? We would love your review",
      "Be honest: what did you think?"
    ],
    "preview_text": "A short review takes about a minute.",
    "preview_variants": [
      "Good or bad, we want to hear it."
    ],
    "body_html": "<h1 style=\"margin:0 0 16px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:28px;line-height:1.2;font-weight:400;color:#1A1714;\">How were your snacks?</h1><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Hi {{first_name}}, your PROMUNCH should be with you by now. How was it? A short review takes about a minute and helps other snackers pick the right pack.</p><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#AF272F\" style=\"background:#AF272F;border:2px solid #AF272F;border-radius:14px;\"><a href=\"https://promunch.in/pages/review-submission?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=review_request&amp;utm_content=email_1\" style=\"display:inline-block;padding:15px 28px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.2;font-weight:400;letter-spacing:1px;text-transform:uppercase;color:#FFFFFF;text-decoration:none;border-radius:14px;\">Leave a review</a></td></tr></table><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Something not right? Reply to this email instead and we will fix it.</p>"
  },
  {
    "type": "email",
    "format": "plain",
    "from_name": "Parth from PROMUNCH",
    "signature": "Parth\nFounder, PROMUNCH",
    "delay_hours": 96,
    "skip_if_wa_journey": "review",
    "subject": "One small favour, {{first_name}}?",
    "subject_variants": [
      "Would you rate your PROMUNCH?",
      "A minute of your time?"
    ],
    "preview_text": "A quick review helps a small brand a lot.",
    "preview_variants": [
      "Parth here, one quick ask."
    ],
    "body_html": "<p style=\"margin:0 0 14px;\">Hi {{first_name}},</p><p style=\"margin:0 0 14px;\">Parth here, founder of PROMUNCH. If you have a minute, would you leave a quick review of your order? Reviews are how new snackers find us, and they help us a lot.</p><p style=\"margin:0 0 14px;\"><a href=\"https://promunch.in/pages/review-submission?utm_source=email&utm_medium=flow&utm_campaign=review_request&utm_content=email_2\">Leave a review here</a>.</p><p style=\"margin:0 0 14px;\">Already did it? Thank you, you can ignore this email.</p>"
  }
]
$json$::jsonb
WHERE NOT EXISTS (SELECT 1 FROM flows WHERE name = 'Review request' AND trigger_type = 'order_placed');

-- B.5 REPLENISHMENT (order_placed, {"exit_on_order":true})
--   Every order; a new order exits the running reminder and enrols a fresh one.
--   NOTE: WhatsApp replenishment_reminder fires at day 30, AFTER email 1 (day 25),
--   so email 1 is never skipped by it; email 2 (day 32) is skipped once WA sent.
--   day 25    designed 15% unique (REFILL15, lives 9d)        "Running low on PROMUNCH?"  [skip_if_wa_journey=replenishment]
--   day 32    designed 15% unique (REFILL15, lives 9d)        "Your 15% refill code ends tomorrow"  [skip_if_wa_journey=replenishment]
INSERT INTO flows (name, description, trigger_type, trigger_config, status, steps)
SELECT
  'Replenishment',
  'Every order. Around day 25, a running-low reminder with Best Sellers and a 15% unique code, then one reminder on day 32. Skipped when WhatsApp already sent the refill reminder.',
  'order_placed',
  $json${"exit_on_order":true}$json$::jsonb,
  'draft',
  $json$
[
  {
    "type": "email",
    "format": "designed",
    "delay_hours": 600,
    "skip_if_wa_journey": "replenishment",
    "subject": "Running low on PROMUNCH?",
    "subject_variants": [
      "{{first_name}}, time for a refill?",
      "Restock before you run out (15% off)"
    ],
    "preview_text": "15% off your refill with code {{coupon_code}}. Good for 7 days.",
    "preview_variants": [
      "Your favourites, 15% off this week."
    ],
    "coupon": {
      "percent_off": 15,
      "expires_in_days": 9,
      "prefix": "REFILL15"
    },
    "coupon_code": "",
    "body_html": "<h1 style=\"margin:0 0 16px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:28px;line-height:1.2;font-weight:400;color:#1A1714;\">Running low?</h1><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Hi {{first_name}}, it has been a few weeks since your order, so your stash might be getting light. Here is 15% off your refill.</p><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#F4F1EA\" style=\"background:#F4F1EA;border:2px dashed #AF272F;border-radius:14px;padding:20px;text-align:center;\"><div style=\"font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:18px;line-height:1.3;font-weight:400;color:#1A1714;\">15% off your refill</div><div style=\"margin:10px 0 6px;font-family:'Courier New',Courier,monospace;font-size:26px;line-height:1.2;font-weight:700;letter-spacing:3px;color:#AF272F;\">{{coupon_code}}</div><div style=\"font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#4A453F;\">One use. Valid for 7 days.</div></td></tr></table><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#AF272F\" style=\"background:#AF272F;border:2px solid #AF272F;border-radius:14px;\"><a href=\"https://promunch.in/collections/best-sellers?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=replenishment&amp;utm_content=email_1\" style=\"display:inline-block;padding:15px 28px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.2;font-weight:400;letter-spacing:1px;text-transform:uppercase;color:#FFFFFF;text-decoration:none;border-radius:14px;\">Restock now</a></td></tr></table><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\"><strong>From our Best Sellers</strong></p><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 8px;\"><tr><td style=\"font-size:0;line-height:0;text-align:left;\"><div style=\"display:inline-block;width:100%;max-width:170px;vertical-align:top;margin:0 16px 16px 0;text-align:left;\"><a href=\"https://promunch.in/products/promunch-roasted-edamame-beans-himalayan-rock-salt-45g-high-protein-snack-no-added-sugar-rich-in-fiber-roasted-in-olive-oil-gluten-free?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=replenishment&amp;utm_content=email_1\" style=\"text-decoration:none;\"><img src=\"https://cdn.shopify.com/s/files/1/0794/6731/5501/files/HRS_Pack_of_3.jpg?v=1781850238\" alt=\"Himalayan Rock Salt Roasted Edamame\" width=\"170\" style=\"display:block;width:100%;max-width:170px;height:auto;border:1px solid #E5E0D6;border-radius:14px;\"></a><div style=\"margin-top:10px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.4;font-weight:700;\"><a href=\"https://promunch.in/products/promunch-roasted-edamame-beans-himalayan-rock-salt-45g-high-protein-snack-no-added-sugar-rich-in-fiber-roasted-in-olive-oil-gluten-free?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=replenishment&amp;utm_content=email_1\" style=\"color:#1A1714;text-decoration:underline;\">Himalayan Rock Salt Roasted Edamame</a></div></div><div style=\"display:inline-block;width:100%;max-width:170px;vertical-align:top;margin:0 16px 16px 0;text-align:left;\"><a href=\"https://promunch.in/products/promunch-roasted-soya-snack-high-protein-healthy-gluten-free-combo-of-3-packs-flavour-cheese-onion-tangy-pudina-and-peri-peri-150-g-each?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=replenishment&amp;utm_content=email_1\" style=\"text-decoration:none;\"><img src=\"https://cdn.shopify.com/s/files/1/0794/6731/5501/files/Image_4_jpg.jpg?v=1773731385\" alt=\"Soya Crunchies, 4 flavours\" width=\"170\" style=\"display:block;width:100%;max-width:170px;height:auto;border:1px solid #E5E0D6;border-radius:14px;\"></a><div style=\"margin-top:10px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.4;font-weight:700;\"><a href=\"https://promunch.in/products/promunch-roasted-soya-snack-high-protein-healthy-gluten-free-combo-of-3-packs-flavour-cheese-onion-tangy-pudina-and-peri-peri-150-g-each?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=replenishment&amp;utm_content=email_1\" style=\"color:#1A1714;text-decoration:underline;\">Soya Crunchies, 4 flavours</a></div></div><div style=\"display:inline-block;width:100%;max-width:170px;vertical-align:top;margin:0 0px 16px 0;text-align:left;\"><a href=\"https://promunch.in/products/promunch-combo-pack-soya-sticks-soya-chips-80gm-assorted-flavored-soya-snack-150-gm-pack-of-7?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=replenishment&amp;utm_content=email_1\" style=\"text-decoration:none;\"><img src=\"https://cdn.shopify.com/s/files/1/0794/6731/5501/files/Image_46_jpg.jpg?v=1773731284\" alt=\"Big Bite Munch Combo\" width=\"170\" style=\"display:block;width:100%;max-width:170px;height:auto;border:1px solid #E5E0D6;border-radius:14px;\"></a><div style=\"margin-top:10px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.4;font-weight:700;\"><a href=\"https://promunch.in/products/promunch-combo-pack-soya-sticks-soya-chips-80gm-assorted-flavored-soya-snack-150-gm-pack-of-7?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=replenishment&amp;utm_content=email_1\" style=\"color:#1A1714;text-decoration:underline;\">Big Bite Munch Combo</a></div></div></td></tr></table><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Free shipping on orders over ₹599.</p>"
  },
  {
    "type": "email",
    "format": "designed",
    "delay_hours": 168,
    "skip_if_wa_journey": "replenishment",
    "subject": "Your 15% refill code ends tomorrow",
    "subject_variants": [
      "{{first_name}}, last day tomorrow for 15% off",
      "A quick reminder about your refill code"
    ],
    "preview_text": "Code {{coupon_code}} stops working after tomorrow.",
    "preview_variants": [
      "This is the last reminder about it."
    ],
    "coupon": {
      "percent_off": 15,
      "expires_in_days": 9,
      "prefix": "REFILL15"
    },
    "coupon_code": "",
    "body_html": "<h1 style=\"margin:0 0 16px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:28px;line-height:1.2;font-weight:400;color:#1A1714;\">Your refill code ends tomorrow</h1><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Hi {{first_name}}, just a heads up: your 15% code stops working after tomorrow. This is the last reminder about it.</p><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#F4F1EA\" style=\"background:#F4F1EA;border:2px dashed #AF272F;border-radius:14px;padding:20px;text-align:center;\"><div style=\"font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:18px;line-height:1.3;font-weight:400;color:#1A1714;\">15% off your refill</div><div style=\"margin:10px 0 6px;font-family:'Courier New',Courier,monospace;font-size:26px;line-height:1.2;font-weight:700;letter-spacing:3px;color:#AF272F;\">{{coupon_code}}</div><div style=\"font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#4A453F;\">One use. Ends tomorrow.</div></td></tr></table><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#AF272F\" style=\"background:#AF272F;border:2px solid #AF272F;border-radius:14px;\"><a href=\"https://promunch.in/collections/best-sellers?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=replenishment&amp;utm_content=email_2\" style=\"display:inline-block;padding:15px 28px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.2;font-weight:400;letter-spacing:1px;text-transform:uppercase;color:#FFFFFF;text-decoration:none;border-radius:14px;\">Restock now</a></td></tr></table><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Free shipping on orders over ₹599.</p>"
  }
]
$json$::jsonb
WHERE NOT EXISTS (SELECT 1 FROM flows WHERE name = 'Replenishment' AND trigger_type = 'order_placed');

-- B.6 CROSS-SELL (order_placed, {"first_order_only":true,"exit_on_order":true})
--   day 18    designed no code                                "Ready to try another flavour?"
INSERT INTO flows (name, description, trigger_type, trigger_config, status, steps)
SELECT
  'Cross-sell',
  'First order only. Around day 18, suggest another kind of PROMUNCH to try. No discount. Stops if they order again first.',
  'order_placed',
  $json${"first_order_only":true,"exit_on_order":true}$json$::jsonb,
  'draft',
  $json$
[
  {
    "type": "email",
    "format": "designed",
    "delay_hours": 432,
    "subject": "Ready to try another flavour?",
    "subject_variants": [
      "{{first_name}}, your next favourite might be here",
      "Three PROMUNCH snacks worth a try"
    ],
    "preview_text": "Roasted edamame, roasted crunchies, or fried sticks and chips.",
    "preview_variants": [
      "Three different ways to crunch."
    ],
    "body_html": "<h1 style=\"margin:0 0 16px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:28px;line-height:1.2;font-weight:400;color:#1A1714;\">Try something new next time</h1><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Hi {{first_name}}, thanks again for your first PROMUNCH order. If you liked it, here are three different ways to crunch.</p><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#AF272F\" style=\"background:#AF272F;border:2px solid #AF272F;border-radius:14px;\"><a href=\"https://promunch.in/collections/all?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=cross_sell&amp;utm_content=email_1\" style=\"display:inline-block;padding:15px 28px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.2;font-weight:400;letter-spacing:1px;text-transform:uppercase;color:#FFFFFF;text-decoration:none;border-radius:14px;\">Shop all snacks</a></td></tr></table><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 8px;\"><tr><td style=\"font-size:0;line-height:0;text-align:left;\"><div style=\"display:inline-block;width:100%;max-width:170px;vertical-align:top;margin:0 16px 16px 0;text-align:left;\"><a href=\"https://promunch.in/products/promunch-roasted-edamame-beans-assorted-combo-42-45g-high-protein-snack?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=cross_sell&amp;utm_content=email_1\" style=\"text-decoration:none;\"><img src=\"https://cdn.shopify.com/s/files/1/0794/6731/5501/files/AssortedCombo1.png?v=1781094598\" alt=\"Roasted Edamame Combo\" width=\"170\" style=\"display:block;width:100%;max-width:170px;height:auto;border:1px solid #E5E0D6;border-radius:14px;\"></a><div style=\"margin-top:10px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.4;font-weight:700;\"><a href=\"https://promunch.in/products/promunch-roasted-edamame-beans-assorted-combo-42-45g-high-protein-snack?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=cross_sell&amp;utm_content=email_1\" style=\"color:#1A1714;text-decoration:underline;\">Roasted Edamame Combo</a></div></div><div style=\"display:inline-block;width:100%;max-width:170px;vertical-align:top;margin:0 16px 16px 0;text-align:left;\"><a href=\"https://promunch.in/products/promunch-roasted-soya-snack-high-protein-healthy-gluten-free-combo-of-3-packs-flavour-cheese-onion-tangy-pudina-and-peri-peri-150-g-each?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=cross_sell&amp;utm_content=email_1\" style=\"text-decoration:none;\"><img src=\"https://cdn.shopify.com/s/files/1/0794/6731/5501/files/Image_4_jpg.jpg?v=1773731385\" alt=\"Soya Crunchies, 4 flavours\" width=\"170\" style=\"display:block;width:100%;max-width:170px;height:auto;border:1px solid #E5E0D6;border-radius:14px;\"></a><div style=\"margin-top:10px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.4;font-weight:700;\"><a href=\"https://promunch.in/products/promunch-roasted-soya-snack-high-protein-healthy-gluten-free-combo-of-3-packs-flavour-cheese-onion-tangy-pudina-and-peri-peri-150-g-each?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=cross_sell&amp;utm_content=email_1\" style=\"color:#1A1714;text-decoration:underline;\">Soya Crunchies, 4 flavours</a></div></div><div style=\"display:inline-block;width:100%;max-width:170px;vertical-align:top;margin:0 0px 16px 0;text-align:left;\"><a href=\"https://promunch.in/products/promunch-combo-pack-soya-sticks-chatpata-masala-cream-onion-soya-chips-peri-peri-pack-of-3-80g-each?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=cross_sell&amp;utm_content=email_1\" style=\"text-decoration:none;\"><img src=\"https://cdn.shopify.com/s/files/1/0794/6731/5501/files/Image_36_jpg.jpg?v=1773731324\" alt=\"Soya Sticks + Chips Combo\" width=\"170\" style=\"display:block;width:100%;max-width:170px;height:auto;border:1px solid #E5E0D6;border-radius:14px;\"></a><div style=\"margin-top:10px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.4;font-weight:700;\"><a href=\"https://promunch.in/products/promunch-combo-pack-soya-sticks-chatpata-masala-cream-onion-soya-chips-peri-peri-pack-of-3-80g-each?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=cross_sell&amp;utm_content=email_1\" style=\"color:#1A1714;text-decoration:underline;\">Soya Sticks + Chips Combo</a></div></div></td></tr></table><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\"><strong>Roasted Edamame:</strong> over 40g of protein per 100g, roasted in olive oil. <strong>Soya Crunchies:</strong> roasted, in Tangy Pudina, Peri Peri, Cheese &amp; Onion and Noodle Masala. <strong>Soya Sticks and Chips:</strong> fried, for a classic chip crunch.</p><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Free shipping on orders over ₹599.</p>"
  }
]
$json$::jsonb
WHERE NOT EXISTS (SELECT 1 FROM flows WHERE name = 'Cross-sell' AND trigger_type = 'order_placed');

-- B.7 WIN-BACK (segment_entry, {"segment":"winback","days_since_last_order":60,"exit_on_order":true})
--   +0 min    designed 20% unique (COMEBACK20, lives 9d)      "We miss you, {{first_name}}. Here is 20% off"
--   day 3     plain    20% unique (COMEBACK20, lives 9d)      "Did we do something wrong, {{first_name}}?"
--   day 7     designed 20% unique (COMEBACK20, lives 9d)      "Last chance: your 20% off ends tomorrow"
INSERT INTO flows (name, description, trigger_type, trigger_config, status, steps)
SELECT
  'Win-back',
  'No order in 60 days. We-miss-you + 20% unique code, a founder follow-up, then a last call before the code expires. Stops on order.',
  'segment_entry',
  $json${"segment":"winback","days_since_last_order":60,"exit_on_order":true}$json$::jsonb,
  'draft',
  $json$
[
  {
    "type": "email",
    "format": "designed",
    "delay_hours": 0,
    "subject": "We miss you, {{first_name}}. Here is 20% off",
    "subject_variants": [
      "It has been a while. 20% off to come back",
      "Come back to PROMUNCH (20% off inside)"
    ],
    "preview_text": "Your code {{coupon_code}} is good for 7 days.",
    "preview_variants": [
      "A comeback code, just for you."
    ],
    "coupon": {
      "percent_off": 20,
      "expires_in_days": 9,
      "prefix": "COMEBACK20"
    },
    "coupon_code": "",
    "body_html": "<h1 style=\"margin:0 0 16px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:28px;line-height:1.2;font-weight:400;color:#1A1714;\">We miss you</h1><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Hi {{first_name}}, it has been a couple of months since your last PROMUNCH order. Come back for 20% off, on us.</p><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#F4F1EA\" style=\"background:#F4F1EA;border:2px dashed #AF272F;border-radius:14px;padding:20px;text-align:center;\"><div style=\"font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:18px;line-height:1.3;font-weight:400;color:#1A1714;\">20% off, welcome back</div><div style=\"margin:10px 0 6px;font-family:'Courier New',Courier,monospace;font-size:26px;line-height:1.2;font-weight:700;letter-spacing:3px;color:#AF272F;\">{{coupon_code}}</div><div style=\"font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#4A453F;\">One use. Valid for 7 days.</div></td></tr></table><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#AF272F\" style=\"background:#AF272F;border:2px solid #AF272F;border-radius:14px;\"><a href=\"https://promunch.in/collections/best-sellers?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=winback&amp;utm_content=email_1\" style=\"display:inline-block;padding:15px 28px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.2;font-weight:400;letter-spacing:1px;text-transform:uppercase;color:#FFFFFF;text-decoration:none;border-radius:14px;\">Shop Best Sellers</a></td></tr></table><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Have you tried our <a href=\"https://promunch.in/collections/roasted-edamame-beans-high-protein-healthy-snacks-for-weight-loss?utm_source=email&utm_medium=flow&utm_campaign=winback&utm_content=email_1\" style=\"color:#AF272F;text-decoration:underline;\">Roasted Edamame</a>? Himalayan Rock Salt, Indori Chatka and Masala Mania, roasted in olive oil, with over 40g of protein per 100g.</p><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Free shipping on orders over ₹599.</p>"
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
    "preview_text": "Honest feedback welcome. Your 20% code is still active.",
    "preview_variants": [
      "One line is enough."
    ],
    "coupon": {
      "percent_off": 20,
      "expires_in_days": 9,
      "prefix": "COMEBACK20"
    },
    "coupon_code": "",
    "body_html": "<p style=\"margin:0 0 14px;\">Hi {{first_name}},</p><p style=\"margin:0 0 14px;\">Parth here, founder of PROMUNCH. You have not ordered in a while, and I would genuinely like to know why.</p><p style=\"margin:0 0 14px;\">Was it the taste, the price, the delivery, or did you just forget about us? Reply with one line. The team and I read every reply, and it helps us fix things.</p><p style=\"margin:0 0 14px;\">If you just forgot, your 20% code <b>{{coupon_code}}</b> is still active for a few more days. <a href=\"https://promunch.in/collections/all?utm_source=email&utm_medium=flow&utm_campaign=winback&utm_content=email_2\">Here is everything we make</a>.</p>"
  },
  {
    "type": "email",
    "format": "designed",
    "delay_hours": 96,
    "subject": "Last chance: your 20% off ends tomorrow",
    "subject_variants": [
      "{{first_name}}, your comeback code expires tomorrow",
      "Final reminder: 20% off PROMUNCH"
    ],
    "preview_text": "After tomorrow this code stops working.",
    "preview_variants": [
      "This is the last email about this offer."
    ],
    "coupon": {
      "percent_off": 20,
      "expires_in_days": 9,
      "prefix": "COMEBACK20"
    },
    "coupon_code": "",
    "body_html": "<h1 style=\"margin:0 0 16px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:28px;line-height:1.2;font-weight:400;color:#1A1714;\">Your 20% off ends tomorrow</h1><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Hi {{first_name}}, your comeback code stops working after tomorrow. This is the last email we will send about it.</p><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#F4F1EA\" style=\"background:#F4F1EA;border:2px dashed #AF272F;border-radius:14px;padding:20px;text-align:center;\"><div style=\"font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:18px;line-height:1.3;font-weight:400;color:#1A1714;\">20% off, last day tomorrow</div><div style=\"margin:10px 0 6px;font-family:'Courier New',Courier,monospace;font-size:26px;line-height:1.2;font-weight:700;letter-spacing:3px;color:#AF272F;\">{{coupon_code}}</div><div style=\"font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#4A453F;\">One use.</div></td></tr></table><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#AF272F\" style=\"background:#AF272F;border:2px solid #AF272F;border-radius:14px;\"><a href=\"https://promunch.in/collections/best-sellers?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=winback&amp;utm_content=email_3\" style=\"display:inline-block;padding:15px 28px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.2;font-weight:400;letter-spacing:1px;text-transform:uppercase;color:#FFFFFF;text-decoration:none;border-radius:14px;\">Shop Best Sellers</a></td></tr></table><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td style=\"border-left:3px solid #AF272F;padding:4px 0 4px 16px;\"><div style=\"margin:0 0 8px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:18px;line-height:1;letter-spacing:2px;color:#AF272F;\">&#9733;&#9733;&#9733;&#9733;&#9733;</div><div style=\"font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;font-style:italic;color:#1A1714;\">&ldquo;Wish this was mainstream. Excellent flavour, excellent crunch, excellent macros. What more do you want?&rdquo;</div><div style=\"margin-top:6px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.4;color:#4A453F;\">Sujay Thomas, on Noodle Masala Soya Crunchies</div></td></tr></table><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td style=\"border-left:3px solid #AF272F;padding:4px 0 4px 16px;\"><div style=\"margin:0 0 8px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:18px;line-height:1;letter-spacing:2px;color:#AF272F;\">&#9733;&#9733;&#9733;&#9733;&#9733;</div><div style=\"font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;font-style:italic;color:#1A1714;\">&ldquo;Glad that some companies are there who are selling protein snacks at affordable price and that also tastes good. Finding healthy option in snacks is really tiresome but you made it easy.&rdquo;</div><div style=\"margin-top:6px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.4;color:#4A453F;\">Naresh Saw, on Noodle Masala Soya Crunchies</div></td></tr></table>"
  }
]
$json$::jsonb
WHERE NOT EXISTS (SELECT 1 FROM flows WHERE name = 'Win-back' AND trigger_type = 'segment_entry');

-- B.8 VIP THANK-YOU (segment_entry, {"segment":"vip","min_spend":2000,"min_orders":3,"exit_on_order":false})
--   Selector is spend >= 2000 OR orders >= 3. Once ever per contact. No discount.
--   +0 min    plain    no code                                "Thank you, {{first_name}}. Really."
--   day 7     designed no code                                "For our regulars: the full PROMUNCH range"
INSERT INTO flows (name, description, trigger_type, trigger_config, status, steps)
SELECT
  'VIP thank-you',
  'Customers with ₹2,000+ lifetime spend or 3+ orders. A founder thank-you, then the full range and an invite to shape the next flavour. No discount. Keeps running if they order.',
  'segment_entry',
  $json${"segment":"vip","min_spend":2000,"min_orders":3,"exit_on_order":false}$json$::jsonb,
  'draft',
  $json$
[
  {
    "type": "email",
    "format": "plain",
    "from_name": "Parth from PROMUNCH",
    "signature": "Parth\nFounder, PROMUNCH",
    "delay_hours": 0,
    "subject": "Thank you, {{first_name}}. Really.",
    "subject_variants": [
      "You are one of our regulars",
      "A thank you from PROMUNCH's founder"
    ],
    "preview_text": "No sale, no code. Just a thank you.",
    "preview_variants": [
      "Parth here, founder of PROMUNCH."
    ],
    "body_html": "<p style=\"margin:0 0 14px;\">Hi {{first_name}},</p><p style=\"margin:0 0 14px;\">Parth here, founder of PROMUNCH. You are one of the people who keeps coming back to PROMUNCH, and I wanted to say thank you personally.</p><p style=\"margin:0 0 14px;\">A small brand like ours lives on regulars like you. Every reorder tells us we are getting something right.</p><p style=\"margin:0 0 14px;\">Since you know our snacks better than most, I would love your take: which flavour should we make next, and what would you change? Just hit reply. The team and I read every reply, and it shapes what we make next.</p>"
  },
  {
    "type": "email",
    "format": "designed",
    "delay_hours": 168,
    "subject": "For our regulars: the full PROMUNCH range",
    "subject_variants": [
      "{{first_name}}, have you tried the whole range?",
      "Your next favourite, from PROMUNCH"
    ],
    "preview_text": "Edamame, Crunchies, Sticks and Chips, all in one place.",
    "preview_variants": [
      "And a chance to pick our next flavour."
    ],
    "body_html": "<h1 style=\"margin:0 0 16px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:28px;line-height:1.2;font-weight:400;color:#1A1714;\">Have you tried the whole range?</h1><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Hi {{first_name}}, as one of our regulars, here is everything PROMUNCH makes, in one place.</p><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#AF272F\" style=\"background:#AF272F;border:2px solid #AF272F;border-radius:14px;\"><a href=\"https://promunch.in/collections/all?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=vip&amp;utm_content=email_2\" style=\"display:inline-block;padding:15px 28px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.2;font-weight:400;letter-spacing:1px;text-transform:uppercase;color:#FFFFFF;text-decoration:none;border-radius:14px;\">See the full range</a></td></tr></table><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 8px;\"><tr><td style=\"font-size:0;line-height:0;text-align:left;\"><div style=\"display:inline-block;width:100%;max-width:170px;vertical-align:top;margin:0 16px 16px 0;text-align:left;\"><a href=\"https://promunch.in/products/promunch-roasted-edamame-beans-assorted-combo-42-45g-high-protein-snack?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=vip&amp;utm_content=email_2\" style=\"text-decoration:none;\"><img src=\"https://cdn.shopify.com/s/files/1/0794/6731/5501/files/AssortedCombo1.png?v=1781094598\" alt=\"Roasted Edamame Combo\" width=\"170\" style=\"display:block;width:100%;max-width:170px;height:auto;border:1px solid #E5E0D6;border-radius:14px;\"></a><div style=\"margin-top:10px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.4;font-weight:700;\"><a href=\"https://promunch.in/products/promunch-roasted-edamame-beans-assorted-combo-42-45g-high-protein-snack?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=vip&amp;utm_content=email_2\" style=\"color:#1A1714;text-decoration:underline;\">Roasted Edamame Combo</a></div></div><div style=\"display:inline-block;width:100%;max-width:170px;vertical-align:top;margin:0 16px 16px 0;text-align:left;\"><a href=\"https://promunch.in/products/promunch-roasted-soya-snack-high-protein-healthy-gluten-free-combo-of-3-packs-flavour-cheese-onion-tangy-pudina-and-peri-peri-150-g-each?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=vip&amp;utm_content=email_2\" style=\"text-decoration:none;\"><img src=\"https://cdn.shopify.com/s/files/1/0794/6731/5501/files/Image_4_jpg.jpg?v=1773731385\" alt=\"Soya Crunchies, 4 flavours\" width=\"170\" style=\"display:block;width:100%;max-width:170px;height:auto;border:1px solid #E5E0D6;border-radius:14px;\"></a><div style=\"margin-top:10px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.4;font-weight:700;\"><a href=\"https://promunch.in/products/promunch-roasted-soya-snack-high-protein-healthy-gluten-free-combo-of-3-packs-flavour-cheese-onion-tangy-pudina-and-peri-peri-150-g-each?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=vip&amp;utm_content=email_2\" style=\"color:#1A1714;text-decoration:underline;\">Soya Crunchies, 4 flavours</a></div></div><div style=\"display:inline-block;width:100%;max-width:170px;vertical-align:top;margin:0 0px 16px 0;text-align:left;\"><a href=\"https://promunch.in/products/promunch-combo-pack-soya-sticks-chatpata-masala-cream-onion-soya-chips-peri-peri-pack-of-3-80g-each?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=vip&amp;utm_content=email_2\" style=\"text-decoration:none;\"><img src=\"https://cdn.shopify.com/s/files/1/0794/6731/5501/files/Image_36_jpg.jpg?v=1773731324\" alt=\"Soya Sticks + Chips Combo\" width=\"170\" style=\"display:block;width:100%;max-width:170px;height:auto;border:1px solid #E5E0D6;border-radius:14px;\"></a><div style=\"margin-top:10px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.4;font-weight:700;\"><a href=\"https://promunch.in/products/promunch-combo-pack-soya-sticks-chatpata-masala-cream-onion-soya-chips-peri-peri-pack-of-3-80g-each?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=vip&amp;utm_content=email_2\" style=\"color:#1A1714;text-decoration:underline;\">Soya Sticks + Chips Combo</a></div></div></td></tr></table><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Got a flavour idea? Reply to this email and tell us. Ideas from our regulars go straight to the team.</p>"
  }
]
$json$::jsonb
WHERE NOT EXISTS (SELECT 1 FROM flows WHERE name = 'VIP thank-you' AND trigger_type = 'segment_entry');

-- B.9 SUNSET UNENGAGED (segment_entry, {"segment":"sunset","min_sends":5,"lookback_days":90})
--   A click on "keep me subscribed" counts as engagement. Auto-suppression of
--   non-responders is NOT wired (shouldSuppressAfterSunset), copy promises nothing.
--   +0 min    designed no code                                "Should we stop emailing you, {{first_name}}?"
INSERT INTO flows (name, description, trigger_type, trigger_config, status, steps)
SELECT
  'Sunset unengaged',
  '5+ marketing emails in 90 days and no open or click. One email: keep me subscribed, or unsubscribe. No discount. Protects sender reputation.',
  'segment_entry',
  $json${"segment":"sunset","min_sends":5,"lookback_days":90}$json$::jsonb,
  'draft',
  $json$
[
  {
    "type": "email",
    "format": "designed",
    "delay_hours": 0,
    "subject": "Should we stop emailing you, {{first_name}}?",
    "subject_variants": [
      "Do you still want to hear from PROMUNCH?",
      "Quick question about your inbox"
    ],
    "preview_text": "One tap to stay. Or unsubscribe, no hard feelings.",
    "preview_variants": [
      "We only want to be in your inbox if you want us there."
    ],
    "body_html": "<h1 style=\"margin:0 0 16px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:28px;line-height:1.2;font-weight:400;color:#1A1714;\">Should we stop emailing you?</h1><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Hi {{first_name}}, we noticed you have not opened our emails in a while. We only want to be in your inbox if you want us there.</p><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#AF272F\" style=\"background:#AF272F;border:2px solid #AF272F;border-radius:14px;\"><a href=\"https://promunch.in/collections/all?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=sunset&amp;utm_content=email_1\" style=\"display:inline-block;padding:15px 28px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.2;font-weight:400;letter-spacing:1px;text-transform:uppercase;color:#FFFFFF;text-decoration:none;border-radius:14px;\">Yes, keep me subscribed</a></td></tr></table><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Tap the button and you stay on the list. It opens our store, no need to buy anything.</p><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Not for you anymore? Use the unsubscribe link at the bottom of this email. One tap and you are off the list, no hard feelings.</p>"
  }
]
$json$::jsonb
WHERE NOT EXISTS (SELECT 1 FROM flows WHERE name = 'Sunset unengaged' AND trigger_type = 'segment_entry');

-- B.10 FIRST-ORDER ANNIVERSARY (date_based, {"kind":"first_order_anniversary"})
--   +0 min    designed 15% unique (ANNIV15, lives 8d)         "Happy PROMUNCH anniversary, {{first_name}}"
INSERT INTO flows (name, description, trigger_type, trigger_config, status, steps)
SELECT
  'First-order anniversary',
  'On the anniversary of a customer''s first order, a thank-you with a 15% unique code.',
  'date_based',
  $json${"kind":"first_order_anniversary"}$json$::jsonb,
  'draft',
  $json$
[
  {
    "type": "email",
    "format": "designed",
    "delay_hours": 0,
    "subject": "Happy PROMUNCH anniversary, {{first_name}}",
    "subject_variants": [
      "On this day, you placed your first PROMUNCH order",
      "{{first_name}}, it is our anniversary (15% off inside)"
    ],
    "preview_text": "15% off to celebrate. Good for 7 days.",
    "preview_variants": [
      "A thank you, and a code to celebrate."
    ],
    "coupon": {
      "percent_off": 15,
      "expires_in_days": 8,
      "prefix": "ANNIV15"
    },
    "coupon_code": "",
    "body_html": "<h1 style=\"margin:0 0 16px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:28px;line-height:1.2;font-weight:400;color:#1A1714;\">Happy PROMUNCH anniversary</h1><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Hi {{first_name}}, on this day you placed your first PROMUNCH order. Thank you for snacking with us. Here is 15% off to celebrate.</p><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#F4F1EA\" style=\"background:#F4F1EA;border:2px dashed #AF272F;border-radius:14px;padding:20px;text-align:center;\"><div style=\"font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:18px;line-height:1.3;font-weight:400;color:#1A1714;\">15% off, to celebrate</div><div style=\"margin:10px 0 6px;font-family:'Courier New',Courier,monospace;font-size:26px;line-height:1.2;font-weight:700;letter-spacing:3px;color:#AF272F;\">{{coupon_code}}</div><div style=\"font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#4A453F;\">One use. Valid for 7 days.</div></td></tr></table><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 24px;\"><tr><td bgcolor=\"#AF272F\" style=\"background:#AF272F;border:2px solid #AF272F;border-radius:14px;\"><a href=\"https://promunch.in/collections/best-sellers?utm_source=email&amp;utm_medium=flow&amp;utm_campaign=anniversary&amp;utm_content=email_1\" style=\"display:inline-block;padding:15px 28px;font-family:'Archivo Black','Arial Black',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.2;font-weight:400;letter-spacing:1px;text-transform:uppercase;color:#FFFFFF;text-decoration:none;border-radius:14px;\">Treat myself</a></td></tr></table><p style=\"margin:0 0 16px;font-family:Assistant,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1714;\">Free shipping on orders over ₹599.</p>"
  }
]
$json$::jsonb
WHERE NOT EXISTS (SELECT 1 FROM flows WHERE name = 'First-order anniversary' AND trigger_type = 'date_based');

-- Verify:
--   select name, status, trigger_type, trigger_config, jsonb_array_length(steps) steps
--   from flows order by created_at;
-- Expect 11 flows from this file: Abandoned cart (active) + 10 drafts.
