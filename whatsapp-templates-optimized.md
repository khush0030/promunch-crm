# PROMUNCH — WhatsApp Templates v3 (Optimized Copy + Image Headers)

> Rewritten 2026-06-10 in the "Your Munchy Pal" voice — warm India-English with light Hinglish.
> Every template keeps its variable contract, category, and footer. All 7 now get an **image header**.

---

## 0. Shipping checklist (read first)

**Adding image headers — what changes on Meta:**

- Each template must be **re-submitted** with header type **Image** (Media). You upload a *sample* image at submission; the **actual image is sent per-message via the API** (`header` component, `image.link` or media ID) — so you can rotate creatives later **without re-approval**, as long as the image stays appropriate to the template.
- **Spec:** JPG/PNG, ≤5MB, recommended **1125×600 px (1.91:1)**. Keep the subject centered with ~10% safe margin — WhatsApp crops edges on some devices.
- **No text rendered inside the images** (matches brand DNA, and keeps one creative reusable even if offers change). The discount lives in the copy, never baked into the image.
- UTILITY templates can carry image headers — the image just must not be promotional (pack/parcel shots are fine; "SALE" visuals are not).
- Copy length: body well under 1024 chars everywhere; footers unchanged and ≤60 chars.

**Two flags found during this pass:**

1. **Website cart drawer still advertises PROTEIN15** (15% off ₹499+) on promunch.in — brief says discontinued. Remove it from the Shopify cart drawer or customers will try a dead code.
2. **`abandoned_cart_recovery` stored button sample still says PROTEIN15/`PROTEIN15`-era sample** — refresh the sample to PROMUNCH10 when re-submitting with the image header (you're re-submitting anyway).

---

## 1. `order_confirmation_v2` — UTILITY

**Variables:** `{{1}}` name · `{{2}}` order ref · **Footer:** `PROMUNCH — snack smart`

### Primary (optimized)
```
{{1}}, you're in! 🎉

Order {{2}} is confirmed and our team is already packing your protein. We'll ping you the second it ships.

Welcome to the PROMUNCH family — happy munching!
```

### Variant A — short & energetic
```
Yay {{1}}! Order {{2}} is locked in ✅

Your snacks are being packed as we speak — shipping update coming your way soon.

Thanks for choosing PROMUNCH!
```

### Variant B — warm family welcome
```
Welcome to the family, {{1}}! 💚

Order {{2}} is confirmed — munchies officially sorted. We'll message you the moment it's on its way.
```

**Rationale:** Leads with the customer's win ("you're in!") instead of brand-first "Welcome to PROMUNCH"; adds motion ("already packing your protein") to build anticipation. Stays purely transactional.

**Image header:** open kraft shipping box with PROMUNCH pouches nestled inside — "your order, packed with love."

> Reference image: your 2–3 hero SKU pack renders
```
Premium CPG product photograph, photorealistic, shot on a full-frame camera, 50mm. Studio packaging-hero shot on a seamless two-tone sunny-yellow and cyan sweep, lit by one hard directional source that throws a long, crisp shadow used as a graphic element; saturated, colour-blocked and pack-forward. An open kraft shipping box sits centered, two PROMUNCH stand-up pouches nestled upright inside on shredded paper fill, a third pouch leaning against the box, a tidy scatter of loose roasted soya snacks in front; maroon, cyan blue, sunny yellow and orange brand colour story. Wide 16:9 banner composition, subject centered with generous margin on all sides, product razor-sharp. No text, words, captions, headings, watermarks, logos, signage or typography anywhere in the image except the text already printed on the product packaging (from the reference). Any other props are blank with no legible lettering. Clean, photographic, text-free scene.
```
*Swap:* a cropped Indian hand placing the last pouch into the box for a human touch.

---

## 2. `order_confirmation` (fallback, 3-var) — UTILITY

**Variables:** `{{1}}` name · `{{2}}` order ref · `{{3}}` order total · **Footer:** `PROMUNCH — snack smart`

### Primary (optimized — aligned with v2)
```
{{1}}, you're in! 🎉

Order {{2}} is confirmed — total {{3}}. Our team is already packing your protein, and we'll ping you the second it ships.

Welcome to the PROMUNCH family — happy munching!
```

### Variant A
```
Yay {{1}}! Order {{2}} is locked in ✅

Order total: {{3}}

Snacks are being packed as we speak — shipping update coming soon. Thanks for choosing PROMUNCH!
```

### Variant B
```
Welcome to the family, {{1}}! 💚

Order {{2}} ({{3}}) is confirmed — munchies officially sorted. We'll message you the moment it ships.
```

**Rationale:** Now reads as the same brand moment as v2 (same hook, same rhythm) with the total woven in — customers who hit the fallback path get an identical experience.

**Image header:** same creative as template 1 — one approval sample, shared asset.

---

## 3. `shipping_update` — UTILITY

**Variables:** `{{1}}` name · `{{2}}` order ref · `{{3}}` tracking link · **Footer:** `PROMUNCH — snack smart`

### Primary (optimized)
```
It's on the way, {{1}}! 🚚

Order {{2}} is packed, sealed and moving. Track it live:
{{3}}

Get the bowls ready — munch time soon!
```

### Variant A — playful countdown
```
Packed. Sealed. Shipped! 📦

{{1}}, your order {{2}} just started its journey to you. Follow along:
{{3}}

Snacks incoming!
```

### Variant B — classic, warm
```
Good news {{1}} — order {{2}} is out the door and headed your way 🚚

Track it anytime:
{{3}}

Almost munch o'clock!
```

**Rationale:** "Get the bowls ready" / "snacks incoming" converts a logistics ping into anticipation. Keeps `{{3}}` in the body exactly per the existing contract.

**Image header:** parcel-in-motion story — kraft box, pouches peeking out, travel cues.

> Reference image: hero SKU pack render
```
Premium CPG product photograph, photorealistic, shot on a full-frame camera, 50mm. Studio packaging-hero shot on a seamless two-tone orange and cyan-blue sweep, one hard directional light throwing a long crisp shadow as a graphic element; saturated, colour-blocked, pack-forward. A sealed kraft parcel box centered at a slight dynamic tilt as if mid-journey, one PROMUNCH stand-up pouch standing beside it and a few loose roasted soya snacks scattered in a clean rhythm; small brown-paper void fill and natural jute twine as the only props; maroon, cyan, sunny yellow, orange colour story. Wide 16:9 banner composition, centered, generous negative space, crisp focus. No text, words, captions, headings, watermarks, logos, signage or typography anywhere in the image except the text already printed on the product packaging (from the reference). Any other props are blank with no legible lettering. Clean, photographic, text-free scene.
```
*Swap:* cropped courier hands handing the box over for a doorstep-delivery feel.

---

## 4. `abandoned_cart_reminder` — MARKETING (touch 1, +1h, no discount)

**Variables:** `{{1}}` name · **Button:** `Complete Order` · **Footer:** `Reply STOP to opt out`

### Primary (optimized)
```
{{1}}, you forgot something tasty 👀

Your PROMUNCH picks are still sitting in the cart, waiting for you. Tap below to finish in seconds — right where you left off.

— Your Munchy Pal 💚
```

### Variant A — playful, cart-misses-you
```
Psst {{1}}... your cart misses you 🛒

Those crunchy picks won't munch themselves. One tap below and they're on their way to your door.

— Your Munchy Pal 💚
```

### Variant B — benefit-led (protein angle)
```
Hi {{1}}! Your protein-packed picks are still in the cart 💪

Smart snacking is one tap away — pick up exactly where you left off.

— Your Munchy Pal 💚
```

**Rationale:** Replaces the generic "you left goodies" + false-scarcity "before they sell out" with curiosity ("forgot something tasty") and effort-reduction ("finish in seconds"). Honest urgency beats fake urgency for a never-spammy brand.

**Image header:** pure craving trigger — abundant snack bowl + hand mid-grab. No discount energy (this touch sells at full price).

> Reference image: hero SKU pack render
```
Premium CPG product photograph, photorealistic, shot on a full-frame camera, 50mm. Bright high-key summer daylight with hard direct sun and crisp, well-defined shadows; saturated good-vibes palette of sunny yellow, aqua blue, coral and fresh green. A PROMUNCH stand-up pouch as hero on a clean light surface, a ceramic bowl overflowing with roasted soya snacks beside it, a cropped Indian hand reaching in mid-grab, a few snacks scattered mid-tumble; maroon, cyan, sunny yellow and orange brand colour story leading. Wide 16:9 banner composition, low three-quarter angle, shallow depth of field, product razor-sharp, appetising and abundant. No text, words, captions, headings, watermarks, logos, signage or typography anywhere in the image except the text already printed on the product packaging (from the reference). Any other props are blank with no legible lettering. Clean, photographic, text-free scene.
```
*Swap:* top-down flat-lay with the open pouch tipping snacks toward the camera.

---

## 5. `abandoned_cart_recovery` — MARKETING (touch 2, +6h, discount)

**Variables:** `{{1}}` name · **Button:** `Checkout Now` (applies PROMUNCH10) · **Footer:** `Reply STOP to opt out`

### Primary (optimized — generic value, re-approval-proof)
```
Still thinking it over, {{1}}? Let's make it easy 😉

We've unlocked a special discount on your cart — already applied, no code needed. Just tap below and it's done.

— Your Munchy Pal 💚
```

### Variant A — names the value (test for CTR lift)
```
{{1}}, your cart just got cheaper! 🎉

We've applied 10% off to everything you picked — it's waiting at checkout. Tap below to grab it.

— Your Munchy Pal 💚
```

### Variant B — light Hinglish, chatpata
```
Arre {{1}}, those munchies are still waiting! 🛒

So we sweetened the deal — your discount is already applied at checkout. One tap, done, snacks sorted.

— Your Munchy Pal 💚
```

**Rationale:** Fixes the two weaknesses of the current copy: it was identical to touch 1's opener (felt like a repeat) and never sold the "no code needed" friction-killer. Primary stays %-agnostic so the offer can change without re-approval; Variant A names "10% off" to test whether explicit value lifts clicks.

**Image header:** same craving family as touch 1 but warmer/sweeter — feels like an upgrade, not a re-send. (No "10% OFF" rendered in the image — keeps the asset offer-proof.)

> Reference image: hero SKU pack render
```
Premium CPG product photograph, photorealistic, shot on a full-frame camera, 50mm. Flat bold colour fields and simple geometric shapes, strong graphic composition, crisp hard shadows, poster-like flatness with high saturation; playful, punchy, pop-art. A PROMUNCH stand-up pouch centered as hero on a bold sunny-yellow field with a maroon geometric circle behind it, roasted soya snacks tumbling around the pouch mid-air in a celebratory burst, one small cyan and one orange paper shape as accents; high-chroma brand colour story. Wide 16:9 banner composition, centered with safe margins, pack razor-sharp, festive gift-like energy. No text, words, captions, headings, watermarks, logos, signage or typography anywhere in the image except the text already printed on the product packaging (from the reference). Any other props are blank with no legible lettering. Clean, photographic, text-free scene.
```
*Swap:* add a thin ribbon loosely draped near the pouch for a subtle "deal unwrapped" cue.

---

## 6. `review_request` — MARKETING (+7d)

**Variables:** `{{1}}` name · `{{2}}` review link · **Footer:** `Reply STOP to opt out`

### Primary (optimized)
```
{{1}}! Have the snacks hit the spot yet? 😋

If PROMUNCH made your munch-time better, a quick review would make our day — 30 seconds, promise:
{{2}}

— Your Munchy Pal 💚
```

### Variant A — question hook
```
Hi {{1}}, quick one — taste test verdict? 🤔

Loved it? Tell the world (and us!). Your 30-second review helps other smart snackers find their new favourite:
{{2}}

Thanks a ton! — Your Munchy Pal 💚
```

### Variant B — appreciation-led
```
{{1}}, your opinion = gold to us ✨

How were the snacks? Drop a quick rating and help us keep the crunch coming:
{{2}}

— Your Munchy Pal 💚
```

**Rationale:** Opens with a question about *their* experience (invites a reply — which also opens the free 24h window for your smart-delivery path) and de-risks the ask with "30 seconds, promise." Current copy asked before engaging.

**Image header:** happy-human social proof — Creator Candid, real person enjoying the snack.

> Reference image: hero SKU pack render
```
Premium CPG product photograph, photorealistic, shot on a full-frame camera, 50mm. Real person enjoying the snack with genuine, playful energy as the heart of the shot — a natural-looking adult Indian creator, mid-20s, expressive smiling face in focus, mid-bite reaction, holding the open PROMUNCH pouch toward camera; against a bold flat sunny-yellow seamless backdrop, clean bright studio light; bright, high-chroma, relatable creator mood with maroon, cyan and orange accents in styling. Wide 16:9 banner composition, person and pouch centered, snack clearly visible, realistic face, never uncanny. No text, words, captions, headings, watermarks, logos, signage or typography anywhere in the image except the text already printed on the product packaging (from the reference). Any other props are blank with no legible lettering. Clean, photographic, text-free scene.
```
*Swap:* two friends sharing the pouch and laughing for a social, shareable feel.

---

## 7. `replenishment_reminder` — MARKETING (+30d)

**Variables:** `{{1}}` name · `{{2}}` restock link · **Footer:** `Reply STOP to opt out`

### Primary (optimized)
```
Snack check, {{1}} — running low? 👀

It's been about a month since your last PROMUNCH haul. Restock before the jar hits empty:
{{2}}

— Your Munchy Pal 💚
```

### Variant A — playful "we did the math"
```
{{1}}, we did the math 🧮

Your stash should be nearly done by now. Refill in one tap and never face a snack-less evening:
{{2}}

— Your Munchy Pal 💚
```

### Variant B — favourites-led
```
Munchies running low, {{1}}? Time for a top-up 🛒

Your favourites are one tap away — restock now and keep the crunch going:
{{2}}

— Your Munchy Pal 💚
```

**Rationale:** "Snack check" / "we did the math" gives the 30-day timing a *reason* (feels observant, not automated), and "snack-less evening" paints the small pain of not acting. Current copy was fine but flat.

**Image header:** the "almost empty" story — last few snacks in the bowl, hand grabbing the final scoop.

> Reference image: hero SKU pack render
```
Premium CPG product photograph, photorealistic, shot on a full-frame camera, 50mm. Soft diffused daylight through a window with gentle shadows, natural materials — light wood table, ceramic bowl, linen napkin — warm earthy-but-fresh palette with subtle organic imperfection; authentic, wholesome, calm. A nearly empty ceramic bowl with just a few roasted soya snacks left at the bottom, a cropped Indian hand picking up one of the last pieces, the almost-flat PROMUNCH pouch lying gently crumpled beside the bowl; a small cyan-blue cup and an orange-toned cloth as quiet brand-colour accents. Wide 16:9 banner composition, low three-quarter angle, shallow depth of field, the story of "time to restock" told purely visually. No text, words, captions, headings, watermarks, logos, signage or typography anywhere in the image except the text already printed on the product packaging (from the reference). Any other props are blank with no legible lettering. Clean, photographic, text-free scene.
```
*Swap:* office-desk version (laptop edge, coffee cup) targeting the 4pm-snack habit.

---

## 8. Rollout plan

1. **Generate images** from the prompts above (feed the relevant pack render as reference image #1; output at 1125×600 or generate 16:9 and crop to 1.91:1).
2. **Re-submit all 7 templates** with Image headers + new Primary copy (and refresh the recovery button sample to PROMUNCH10). Submit Variants A/B as separate template names (e.g. `abandoned_cart_reminder_b`) so you can A/B at the send layer.
3. **A/B method:** alternate Primary vs Variant per send for 2–3 weeks; judge cart templates on button CTR → conversion, review/replenishment on link clicks. One winner per template, then retire the loser.
4. **Measure against current copy** — keep the old templates approved (don't delete) so you have a fallback if a new submission is rejected.
5. The AI chatbot's free-text review/restock asks should echo the new hooks ("taste test verdict?", "snack check") so template and free-text paths feel like one voice.
