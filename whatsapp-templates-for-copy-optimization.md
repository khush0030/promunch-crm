# PROMUNCH — WhatsApp Templates for Copy Optimization

> **Brief for the optimizer (Claude):** Below are every WhatsApp message template PROMUNCH
> sends to customers. Rewrite the **copy** of each for higher engagement / conversion while
> staying within the hard constraints in §3. For each template, return: (a) an improved
> primary version, and (b) 1–2 alternate variants we can A/B test. **Do not change the
> variable contract** (`{{1}}`, `{{2}}`, … must stay in the same meaning/order) and **keep
> the required footers**. Preserve placeholders exactly.

---

## 1. About the brand (context for tone)

- **PROMUNCH** — India's high-protein, plant-based snack brand (roasted/fried soya snacks).
  Parent: Vippy Industries Limited. Tagline / persona: **"Your Munchy Pal"** — warm, friendly,
  upbeat, India-English. Instagram: @promunch.snacks. Store: promunch.in (Shopify).
- **Audience:** Indian D2C snack buyers, value-conscious, mobile-first, mix of English and
  Hinglish speakers. **Copy language: English by default**, simple and clear.
- **Voice rules:**
  - Warm + a little playful (emojis OK, don't overdo). Never pushy, never spammy.
  - The sign-off **"— Your Munchy Pal 💚"** is the brand tagline. Keep it where it already
    appears; don't add it to utility (transactional) templates.
  - Short. WhatsApp = glanceable. Lead with the value.

## 2. Brand facts the copy may reference (all current as of 2026-06-10)

- **Shipping:** FREE on orders **₹599+**. Below ₹599 = flat **₹99** delivery.
- **COD:** available, **+₹50** handling charge.
- **Prepaid** (UPI/card/netbanking): **5% off** — cheaper than COD.
- **Discount code:** **PROMUNCH10** = 10% off on orders ₹399+ (promunch.in only, one code per
  order). *(PROTEIN15 is discontinued — never reference it.)*
- Delivery: 4–5 working days, India only.

## 3. Hard constraints (WhatsApp / Meta — must not be violated)

- **Variables** are positional `{{1}}`, `{{2}}`, … — keep the same count, order and meaning
  per the "Variable contract" on each template. No new variables unless noted.
- **No URLs/phone numbers in the BODY** of a template (Meta rejects). Links go in the **URL
  button** only (already configured where present — don't move them into the body).
- **MARKETING templates must keep an opt-out path** — keep the `Reply STOP to opt out` footer.
- **Footer ≤ 60 chars. Body ≤ 1024 chars** (we're well under; keep it short anyway).
- **Category is fixed** per template (UTILITY vs MARKETING) — don't change it. UTILITY =
  transactional (order/shipping), no promotional language. MARKETING = nudges/offers.
- Emojis are fine. No markdown (`*bold*` works on WhatsApp but use sparingly).

## 4. Anti-spam (product rule)

A customer must never feel spammed. The abandoned-cart flow is now **2 touches** (reminder
+1h, recovery +6h) — do not propose adding more touches. Optimize the *words*, not the cadence.

---

## 5. ACTIVE TEMPLATES (currently sent to customers)

Each block: **when it fires · category · variable contract · current copy**. Optimize the copy.

### 5.1 `order_confirmation_v2`  — UTILITY  *(PRIMARY order confirmation — this is the one actually sent)*
- **When:** immediately after a Shopify order is placed.
- **Variables:** `{{1}}` = customer first name · `{{2}}` = order ref (e.g. `#PM1042`)
- **Current copy:**
```
Welcome to the PROMUNCH family, {{1}}! 🥳

Your order {{2}} is confirmed — we're already getting it ready and we'll message you the moment it ships.

Thanks for snacking smart with us!
```
- **Footer:** `PROMUNCH — snack smart`

### 5.2 `order_confirmation`  — UTILITY  *(fallback path via job queue; older 3-variable version)*
- **When:** order-confirmation fallback (wa-jobs-tick retry path). Includes the order total.
- **Variables:** `{{1}}` = name · `{{2}}` = order ref · `{{3}}` = order total (e.g. `₹598`)
- **Current copy:**
```
Hi {{1}}, your PROMUNCH order {{2}} is confirmed! 🎉

Order total: {{3}}

We'll message you the moment it ships. Thanks for snacking smart with PROMUNCH!
```
- **Footer:** `PROMUNCH — snack smart`
- *Note: keep `{{3}}` (total). If you can, align its tone with v2 so the two confirmations feel like one brand.*

### 5.3 `shipping_update`  — UTILITY
- **When:** when the Shopify order is marked fulfilled (shipped).
- **Variables:** `{{1}}` = name · `{{2}}` = order ref · `{{3}}` = tracking link
  *(tracking link currently = the Shopify order-status page)*
- **Current copy:**
```
Good news {{1}}! Your PROMUNCH order {{2}} has shipped 🚚

Track it here:
{{3}}

Thanks for snacking smart with PROMUNCH!
```
- **Footer:** `PROMUNCH — snack smart`

### 5.4 `abandoned_cart_reminder`  — MARKETING  *(abandoned-cart touch 1, +1h, NO discount)*
- **When:** ~1 hour after a checkout is abandoned. Just a gentle nudge back to the cart.
- **Variables:** `{{1}}` = name
- **URL button:** text `Complete Order` → dynamic link straight to the customer's recovery checkout.
- **Current copy:**
```
Hi {{1}}, you left some PROMUNCH goodies in your cart 🛒

Complete your order before they sell out — tap below to pick up right where you left off!

— Your Munchy Pal 💚
```
- **Footer:** `Reply STOP to opt out`

### 5.5 `abandoned_cart_recovery`  — MARKETING  *(abandoned-cart touch 2, +6h, WITH discount)*
- **When:** ~6 hours after abandonment, only if they still haven't ordered. Carries a discount.
- **Variables:** `{{1}}` = name
- **URL button:** text `Checkout Now` → dynamic Shopify discount link that applies **PROMUNCH10**
  and drops them on their cart.  ⚠️ *The stored button example still says `PROTEIN15` — that's a
  stale sample only; live sends use PROMUNCH10. (Worth refreshing the sample.)*
- **Current copy:**
```
Hi {{1}}, you left some PROMUNCH goodies in your cart 🛒

We've applied a special discount for you — tap below to grab them before they sell out!

— Your Munchy Pal 💚
```
- **Footer:** `Reply STOP to opt out`
- *Optimization idea: the body never names the discount. Consider stating the value (e.g. "10% off")
  to lift click-through — but keep it generic enough that the code can change without a re-approval.*

### 5.6 `review_request`  — MARKETING
- **When:** ~7 days after purchase (delivery takes ~4–6d, so it lands after they've tried it).
  *(Often sent as free-text inside an open 24h chat window, but this is the template version.)*
- **Variables:** `{{1}}` = name · `{{2}}` = review link
- **Current copy:**
```
Hi {{1}}, hope you're loving your PROMUNCH snacks! 💚

Mind leaving a quick review? It really helps us:
{{2}}

Thanks a ton — your Munchy Pal, Team PROMUNCH 💚
```
- **Footer:** `Reply STOP to opt out`

### 5.7 `replenishment_reminder`  — MARKETING
- **When:** ~30 days after purchase — "you're probably running low" restock nudge.
- **Variables:** `{{1}}` = name · `{{2}}` = store/restock link
- **Current copy:**
```
Running low, {{1}}? 🥜

Restock your PROMUNCH favourites in a tap:
{{2}}

Happy munching — your Munchy Pal! 💚
```
- **Footer:** `Reply STOP to opt out`

---

## 6. LEGACY / NOT SENT (included for completeness — do NOT optimize unless we revive them)

### `abandoned_checkout`  — MARKETING  *(superseded by reminder + recovery; the `abandoned_checkout`
journey now sends those two instead. This template name is no longer used in any send path.)*
- **Variables:** `{{1}}` = name · `{{2}}` = coupon · `{{3}}` = cart link
- **Current copy:**
```
Hi {{1}}, you left some PROMUNCH goodies in your cart 🛒

Here's {{2}} to finish your order before they're gone:
{{3}}

Tap the link above to complete your order.
```
- **Footer:** `Reply STOP to opt out`

### `hello_world`  — UTILITY  *(Meta's default sample template. Not ours, never sent. Ignore.)*

---

## 7. What to return

For each ACTIVE template (§5.1–5.7):
1. **Primary (optimized)** — improved body, same variables/footer/category.
2. **Variant A / Variant B** — alternates for A/B testing (different angle, hook, or length).
3. **One-line rationale** — what you changed and why it should perform better.

Keep every `{{n}}` placeholder, keep required footers, respect the §3 constraints, and write in
the "Your Munchy Pal" voice (warm, India-English, never spammy). UTILITY templates stay
transactional (no promo language); MARKETING templates can sell, gently.
