# WhatsApp template category audit

**Date:** 26 August 2026
**Scope:** all 15 rows in `wa_templates`, audited against Meta's **current** template
category guidelines.
**Status:** analysis only. Nothing was submitted to Meta and no `wa_templates`
row was changed.

Related: [META_WHATSAPP_TEMPLATE_RULES.md](META_WHATSAPP_TEMPLATE_RULES.md)
(component/format rules), [MM_LITE_MIGRATION.md](MM_LITE_MIGRATION.md)
(the `/marketing_messages` endpoint), [AUDIENCE_QUALITY.md](AUDIENCE_QUALITY.md).

---

## 0. Why this audit exists

84% of PROMUNCH's marketing template sends are rejected by Meta with **#131049**.
Utility templates and free-form in-window text are fine. Measured on
`wa_messages`, August 2026 (outbound templates):

| Template | Category | Attempts | Failed | of which #131049 |
|---|---|---:|---:|---:|
| `review_request` | marketing | 209 | 117 (56%) | 110 |
| `abandoned_cart_reminder` | marketing | 170 | 156 (92%) | 141 |
| `replenishment_reminder` | marketing | 167 | 121 (72%) | 117 |
| `abandoned_cart_recovery` | marketing | 141 | 124 (88%) | 109 |
| `shipping_update` | utility | 111 | 8 (7%) | **0** |
| `ops_ticket_alert` | utility | 73 | 0 | **0** |
| `order_confirmation_v2` | utility | 50 | 4 (8%) | **0** |
| `order_verify_v1` | utility | 39 | 2 (5%) | **0** |
| `order_verify_reminder_v1` | utility | 32 | 2 (6%) | **0** |
| `order_confirmation_repeat_v1` | utility | 8 | 0 | **0** |

Zero utility sends have ever hit #131049. The category **is** the delivery
problem. So the question this audit answers is: *which of our marketing
templates could legitimately be utility, and which could not?*

The answer is: **one of four**, and only after a rewrite.

---

## 1. What Meta's rules actually say (verified August 2026)

Everything in this section was read from Meta's live documentation on
26 Aug 2026. Meta moved these pages from `/docs/whatsapp/...` to
`/documentation/business-messaging/whatsapp/...`; the old
template-categorization URL now 404s.

**Primary source:**
[Template categorization](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization)

### 1.1 There are three categories, not four

> "Each template must be categorized as **authentication**, **marketing**, or **utility**."
> — [Template fundamentals](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview)

"Service message" is a **pricing/message type** (non-template messages inside the
customer service window), not a template category. Do not look for a SERVICE
category; there isn't one.

### 1.2 The utility test is two-part, and both parts must pass

> "Utility templates are typically triggered by a user action or request. For a
> template to be categorized as utility, it needs to meet **both** criteria below:
> - *Must* be **non-promotional**, not containing any promotional or persuasive intent.
> - *Must* ALSO be either **specific to or requested by the user** (clearly related
>   to their order, account, services, or transactions) OR **essential or critical**
>   to the user."

Meta's utility "Order Management" and "Account Alerts" rows both carry the same
hard exclusion, verbatim:

> "These messages should **not promote, recommend, upsell, or cross-sell products;
> include offers; or attempt to secure renewals**."

### 1.3 Marketing has a catch-all that swallows near-misses

> "The following templates are **also** considered marketing:
> - Templates with mixed content (for example, both utility and marketing, such as
>   an order update with a promo **or a feedback survey with promotional content**).
> - Templates where contents are unclear (for example, where contents are only
>   "{{1}}" or "Congratulations!")."

And the Retargeting objective closes the "but the customer asked for it" door:

> "Promote or recommend offers, products, or services; attempt to renew
> subscriptions; or other calls to action to users who might have visited your
> website, used your app or engaged with you. **These are marketing even if
> requested by users.**"

### 1.4 Meta decides the category, not us

> "**Effective April 9, 2025** — If you selected `UTILITY` as the template's
> category and WhatsApp determined it should be `MARKETING`, **the template is
> approved as `MARKETING`**. […] You can request a review up to 60 days from the
> date the category was updated."

> "**Effective April 9, 2025** — The `allow_category_change` property […]
> **This is now the default behavior.**"

So a mis-declared template is not rejected. It is **silently approved in the
wrong category**, and you find out from the delivery numbers.

Approved templates are also swept continuously:

> "**July 1, 2024** — […] WhatsApp introduced a **recurring process to identify and
> update approved templates** that should be of a different category."

Detect a pending flip via the Business Management API (a read, safe to run):

```
GET /<WABA_ID>/message_templates?fields=name,category,correct_category
```

> "If they mismatch and the `correct_category` is not an empty string or null
> […] the template's category will be updated on the first day of the next month."

Webhook: `template_category_update` (`previous_category`, `new_category`,
`correct_category`).

### 1.5 Mis-declaring is punished at the ACCOUNT level

This is the part that decides the verdicts below. Meta now publishes an
escalating enforcement ladder for businesses that submit marketing as utility:

> "If a business is detected to be consistently misclassifying marketing templates
> as utility, WhatsApp may apply escalating restrictions."

| Level | Effect (verbatim) | Duration |
|---|---|---|
| Warning | "After a warning, utility-to-marketing category changes become instant with no advance notice." | Ongoing |
| Rate limiting | "**Utility message volume on the WABA is capped** within a 24-hour rolling window. Messages exceeding the cap are rejected." | Min 7 days |
| Utility restriction | "**All approved utility templates on the WABA are recategorized to `MARKETING`.** New utility template creation and category reviews are disabled." | 7 days (30 for repeats) |
| Portfolio restriction | Same, "**across all WABAs**" under the Business Suite. | 30 days |

Notification arrives by email to WABA admins and by the `account_update` webhook
(`violation_type: UTILITY_TEMPLATE_ABUSE`).

**Read that third row against our own numbers.** Order confirmations, COD verify,
shipping updates and ops alerts are ~98% of what PROMUNCH actually gets
*delivered*. A utility restriction would recategorise every one of them to
marketing and drop them into the same 84% rejection pit. Gambling the
transactional channel to rescue a replenishment nudge is a catastrophically bad
trade. That is the governing constraint on every verdict below.

### 1.6 #131049 is an adaptive per-user marketing limit, and retrying makes it worse

> "This message was not delivered to maintain healthy ecosystem engagement."
> — [Cloud API error codes](https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/)

> "WhatsApp may limit the number of marketing template messages a WhatsApp user
> receives from any business in a given period of time when they are less likely
> to be receptive […] based on […] an individual's recent marketing message read
> rate and how many messages they currently have in their inbox."
> — [Per-user marketing template message limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/per-user-limits)

> "**Each marketing template message delivered counts towards the per-user
> marketing limit.** If a WhatsApp user responds to a marketing message, it starts
> a 24-hour customer service window. **Marketing messages sent within this window
> do not count towards the limit.**"

> "WhatsApp enforces limits on **excessive retry attempts** […] If your WABA
> attempts to resend marketing messages multiple times within a 24-hour period to
> users who have already reached their messaging limit, **further delivery attempts
> to these users may be unavailable for up to 24 hours**."

Three things follow directly, and all three are already implemented:

1. The in-window free-text path is not a loophole, it is Meta's own documented
   exemption. Keep leaning on it.
2. `WA_MARKETING_PER_24H = 1` is Meta's own advice ("wait at least 24 hours
   before resending"), not a guess.
3. Retrying into #131049 is explicitly self-harming. That is what
   `_shared/marketing-governor.ts` exists to stop.

Per-user limits are **live in India** (the exclusions are EEA, UK, Japan, South
Korea, and US recipient numbers).

**#131050 is a different thing and must never be treated as a cap:**

> "This recipient has chosen to stop receiving marketing messages on WhatsApp from
> your business." … "**Do not retry** sending messages to this user as they will
> not be received."

That is a permanent opt-out, not a retry-tomorrow verdict.

### 1.7 Things we could NOT verify

State these as unknown, not as fact:

- **No published number for the per-user cap.** The widely-quoted "2 marketing
  messages per user per 24h" appears only on BSP blogs. Meta calls the limit
  adaptive and publishes no figure.
- **No sentence anywhere saying utility/authentication are exempt** from
  frequency capping. The exemption is implied by the doc's scope (it only ever
  discusses marketing templates) and corroborated by our own 0-of-313 utility
  #131049 rate, but Meta never states it affirmatively.
- **No billing-consequence sentence** on the categorization page. That a
  utility→marketing flip means marketing rates follows from the pricing page, but
  Meta does not say it in one place.
- **MM Lite GA status.** Meta labels it neither "beta" nor "generally available",
  and its docs say **nothing** about #131049 or per-user limits. Claims that MM
  Lite raises or bypasses the cap are BSP marketing, not Meta documentation.
- Meta never uses the words "abandoned cart", "replenishment", "restock" or
  "reorder" anywhere in the categorization docs. The cart verdict below rests on
  a verbatim *example*, not on those words.

### 1.8 One dated finding that affects strategy, not category

> "**Effective October 1, 2026**, Meta will charge on a per-message basis for
> utility messages sent in response to users within an open 24-hour customer
> service window." … "Any non-template message is charged as of October 1, 2026."
> — [Upcoming pricing updates for non-template messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages)

Today, "Utility templates delivered within an open customer service window are
free" and "All non-template messages are free". From 1 Oct 2026 they are not.

This is a **cost** change, not a deliverability change: in-window messages still
do not count toward the per-user marketing limit. PROMUNCH's window-asks strategy
stays correct, it just stops being free in about five weeks. Budget for it; do
not change the strategy over it.

---

## 2. Per-template verdicts

### 2.1 The four live marketing templates

---

#### `abandoned_cart_reminder` — **KEEP MARKETING.** Not re-scopeable.

*92% blocked in August (141 of 170 to #131049).*

Current body:
> Hi {{1}}, you left some PROMUNCH goodies in your cart 🛒
> Complete your order before they sell out, tap below to pick up right where you left off!

**Evidence.** Meta lists this message almost word for word as its own example of a
**Marketing / Retargeting** template:

> "You left {{items}} in your cart! Don't worry, we saved them. Checkout now below."
> — [Template categorization](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization), Marketing → Retargeting

There is **no carve-out**. It fails the utility test twice over:

- An abandoned cart is not an order or transaction, so there is nothing for the
  "Order Management" objective to confirm, update or cancel.
- "before they sell out" is textbook persuasive intent.

And Retargeting explicitly pre-empts the obvious counter-argument: *"These are
marketing even if requested by users."*

**Verdict: keep marketing. Do not attempt a utility rewrite.** There is no
version of "come back and buy the thing in your cart" that is non-promotional,
because the promotion is the entire message. Submitting it as utility is exactly
the misclassification pattern in §1.5.

The only legitimate non-marketing route for cart recovery is **not to use a
template at all**: free-form text inside an open 24h window. That path already
exists (`_shared/window-asks.ts` + the `tpl_stood_down` logic in
`wa-journey-tick`), and it is where cart recovery should live.

---

#### `abandoned_cart_recovery` — **KEEP MARKETING.** Disqualified twice.

*88% blocked in August (109 of 141 to #131049).*

Current body:
> Hi {{1}}, you left some PROMUNCH goodies in your cart 🛒
> We've applied a special **discount** for you — tap below to grab them before they sell out!

Everything in `abandoned_cart_reminder` applies, **plus** it contains a discount.
Meta's utility exclusion is verbatim: *"should not […] include offers"*. A
discount offer cannot be utility under any reading.

**Verdict: keep marketing.** Not borderline, not arguable.

Two side notes:
- The body contains an **em dash**, which violates AGENTS.md §5 (banned in all
  customer-facing copy). Fixing that needs a `{edit}` push via
  `wa-template-create`, independent of any category question.
- `abandoned_cart_reminder` (step 1) and `abandoned_cart_recovery` (step 2) are
  the two live steps of the cart sequence in `shopify-wa/index.ts`.

---

#### `replenishment_reminder` — **KEEP MARKETING.** Genuinely borderline; the answer is still no.

*72% blocked in August (117 of 167 to #131049).*

Current body:
> Running low, {{1}}? 🥜
> Restock your PROMUNCH favourites in a tap: {{2}}
> Happy munching — your Munchy Pal! 💚

This deserves the most analysis, because Meta *does* have a utility home for
recurring messages. It does not fit ours.

**Where the line falls (all verbatim from the same page):**

| Message | Category | Meta's own example |
|---|---|---|
| Factual recurring-billing notice for a service the user already subscribes to | **UTILITY** (Account Alerts) | "Reminder: Your monthly payment for {{service}} will be billed on {{date}} to the {{card}} you have saved on file." |
| Asking the user to renew | **MARKETING** (Retargeting) | "Your subscription will expire on {{date}}! Renew today to save {{discount}}." |
| Prompting a repeat purchase | **MARKETING** (Sales / Retargeting) | "As a thank you for your last order, please enjoy {{15}}% off your next order." |

The dividing rule is the Account Alerts exclusion: a utility message must not
*"promote, recommend, upsell […] or attempt to secure renewals."*

**Why PROMUNCH lands on the marketing side:**

1. **There is no subscription.** PROMUNCH sells one-off D2C orders. There is no
   recurring charge to notify anyone about, so the one utility shape that could
   have carried this does not exist for us.
2. **Nothing triggers it.** Utility is "typically triggered by a user action or
   request". This fires on a timer after a past order. "You might be running low"
   is our inference, not the customer's action.
3. **Its purpose is a repeat purchase.** "Restock […] in a tap: {{link}}" is a
   call to action to buy. Meta's Retargeting definition covers it word for word,
   *even if requested by users*.

**Could it be rewritten into utility?** Only by removing the reorder ask, and the
reorder ask *is* the message. A version like "your order {{n}} was delivered on
{{date}}" with no link is a delivery notification we already send via
`shipping_update`, and it would recover nothing. There is no honest utility
rewrite here, only a laundered one, and §1.5 prices that gamble in
order-confirmation deliverability.

**Verdict: keep marketing.** The fix for replenishment is delivery strategy, not
category:
- the in-window free-text path (already built) which Meta explicitly exempts from
  the per-user limit,
- the frequency governor spending the recipient's single 24h marketing slot on
  whatever is worth most (a live cart beats a speculative restock),
- and, honestly, accepting that a speculative nudge is the *correct* thing for
  Meta to throttle. Consider moving replenishment to email, where it costs
  nothing and nobody caps it.

---

#### `review_request` — **RE-SCOPEABLE TO UTILITY, after a rewrite.** The one real win.

*56% blocked in August (110 of 209 to #131049).*

Current body:
> Hi {{1}}, hope you're loving your PROMUNCH snacks! 💚
> Mind leaving a quick review? It really helps us: {{2}}
> Thanks a ton, your Munchy Pal, Team PROMUNCH 💚
>
> *Footer:* Reply STOP to opt out

**Evidence that feedback CAN be utility.** "Feedback Surveys" is a named utility
objective on Meta's current list:

> "Collect feedback on previous orders, transactions, or engagements with
> customers. **Specificity of the order or interaction to which these relate is
> necessary. A general/generic survey or request for feedback will not be approved
> as utility.**"
> — [Template categorization](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization), Utility → Feedback Surveys

Meta's own utility examples:

> "We have delivered your order {{order_number}}! Please let us know if there was
> any issue by reaching out below."
> "You chatted with us {{online}} recently about order {{order_number}}. How was
> your experience? Click below to fill out a short survey."

Corroborated by the [Template Library](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-library),
which ships a pre-categorized `FEEDBACK_SURVEY` use case and states that library
templates "have already been categorized as utility or authentication".

**Why the CURRENT copy would not pass.** It names no order and no interaction.
"hope you're loving your PROMUNCH snacks" is a generic brand pleasantry attached
to a generic review ask, which is precisely what Meta says "will not be approved
as utility". The `Reply STOP to opt out` footer is a marketing-consent artefact
and reinforces the wrong signal.

**Also note the trap.** From the marketing catch-all: *"a feedback survey with
promotional content"* is marketing. So the utility version must carry **no**
discount, no "shop again", no product link. A review link only.

**Proposed `review_request_v2` (category: UTILITY):**

```
Body:
Hi {{1}}, your PROMUNCH order {{2}} was delivered.

If anything was not right, just reply here and we will sort it out.
If it was good, a quick review of that order helps us a lot:
{{3}}

Footer:
Your Munchy Pal
```

Variables: `{{1}}` first name, `{{2}}` Shopify order number (e.g. `#2107`),
`{{3}}` review URL.

Why this version passes both halves of the utility test:

- **Non-promotional:** no offer, no discount, no product, no "shop again", no
  next-order CTA. The only link is the review page.
- **Specific to the user:** it names the order, which is the exact specificity
  Meta demands, and mirrors Meta's own examples nearly line for line.
- The "reply here if anything was wrong" line is a support offer, which
  strengthens the utility framing rather than weakening it.
- Brand rules hold: PROMUNCH in caps, no em dashes, "Your Munchy Pal" retained as
  the footer. That footer is **already approved under utility** on
  `order_verify_v1` and `order_verify_reminder_v1`, so it is empirically safe.
- The `Reply STOP to opt out` footer is dropped. Utility templates do not carry
  marketing opt-out language, and keeping it invites a marketing classification.

**Expected impact.** If it lands as utility, this template moves from a 56%
block rate to the ~2% our utility templates actually see. On August volume that
is roughly **115 of 117 blocked review asks recovered per month**, and every one
of those recovered asks stops consuming the recipient's marketing slot, which
frees that slot for cart recovery.

**Prerequisite in code (file I do not own).** The review journey currently enrols
with two variables only:

`promunch-email-agent/supabase/functions/_shared/order-confirmation.ts:249`
```ts
enrolments.push(["review_request", { "1": name, "2": REVIEW_URL }, flows.review_delay_days * 24]);
```

`review_request_v2` needs three: `{ "1": name, "2": orderNumber, "3": REVIEW_URL }`.
The order number is in scope at that call site. `_shared/journeys.ts` also needs
the `review_request` entry pointed at the new template name, and
`wa-template-create/index.ts` needs the new template definition. None of those
three files are mine; see §5.

---

### 2.2 The two dormant marketing templates

| Template | Verdict | Reasoning |
|---|---|---|
| `edamame_launch` | **Keep marketing.** | A product-launch broadcast with a video header and an "Order Now" button. Marketing → Awareness/Sales, textbook. Not a candidate for anything. |
| `abandoned_checkout` | **Keep marketing.** Retire it. | Same class as the two cart templates, and its `{{2}}` variable is literally a coupon slot ("Here's {{2}} to finish your order"). No code path sends it any more; the live cart sequence uses `abandoned_cart_reminder` then `abandoned_cart_recovery`. Leaving a third near-identical cart template around is a duplicate-send hazard. |

### 2.3 The nine utility templates — all correctly categorised

Audited against the utility two-part test. No re-categorisation needed on any of
them. What matters here is not improving them but **not losing them** (§1.5).

| Template | Utility objective it maps to | Notes |
|---|---|---|
| `order_confirmation` | Order Management ("confirm […] an order […] using specific order or transaction details") | Names order + total. Clean. |
| `order_confirmation_v2` | Order Management | "Welcome to the PROMUNCH family" is a greeting, not an offer, and the message is anchored to order `{{2}}`. Approved and safe. Contains an em dash (brand-rule fix, not a category fix). |
| `order_confirmation_repeat_v1` | Order Management | Clean. |
| `order_verify_v1` | Order Management (confirm/cancel a transaction) | COD confirmation gate. The strongest utility template we have: the customer's own tap is the trigger. |
| `order_verify_reminder_v1` | Order Management | Same. |
| `shipping_update` | Order Management (order update) | Clean, and our best-delivering template. |
| `ops_ticket_alert` | Account Alerts | Goes to **PROMUNCH staff numbers**, not customers. Correct as utility, and worth knowing it is an internal-notification use of a customer-messaging category. |
| `order_cancel_ops` | Account Alerts | Same, internal. |
| `hello_world` | n/a | Meta's stock sample template. Unused. Recommend removing it from `wa_templates` so it stops appearing in pickers and audits. |

**Standing recommendation:** run the `correct_category` check in §1.4 monthly.
It is the only way to see a pending utility→marketing flip *before* it lands, and
after a single categorisation warning Meta stops giving the 24h notice at all.

---

## 3. Summary table

| Template | Current | Verdict | Action |
|---|---|---|---|
| `review_request` | marketing | **Re-scopeable to utility** | Submit `review_request_v2` as UTILITY with the §2.1 copy |
| `abandoned_cart_reminder` | marketing | Keep marketing | Fix delivery via in-window free text, not category |
| `abandoned_cart_recovery` | marketing | Keep marketing | Same. Also strip the em dash |
| `replenishment_reminder` | marketing | Keep marketing | Same. Consider moving to email |
| `abandoned_checkout` | marketing | Keep marketing | Retire, superseded, duplicate-send hazard |
| `edamame_launch` | marketing | Keep marketing | No action |
| 9 utility templates | utility | Correct | Monitor `correct_category` monthly |

**One template out of six is legitimately re-scopeable.** That is the honest
answer. The other five are marketing because their purpose is to sell, and Meta's
rules are written specifically to catch exactly that.

---

## 4. Submission order

Do these in order. Do not batch them.

1. **Before submitting anything, check we are not already flagged.**
   `GET /<WABA_ID>/message_templates?fields=name,category,correct_category`.
   If any utility template has a non-empty `correct_category`, or if a
   `UTILITY_TEMPLATE_ABUSE` `account_update` webhook has ever fired, **stop** and
   deal with that first. Submitting a new utility template while under a
   categorisation warning is the worst possible timing.

2. **Submit `review_request_v2` as UTILITY.** One template, on its own, so the
   outcome is unambiguous.

3. **Verify what Meta actually approved, not what we asked for.** Per §1.4 a
   mis-declared template is approved in the *corrected* category, silently. Read
   the category back:
   `GET /<WABA_ID>/message_templates?fields=name,status,category`.
   If it comes back `MARKETING`, the rewrite failed. Do not resubmit a variant,
   and do not appeal more than once. Accept the verdict and leave review asks on
   the in-window free-text path.

4. **Only after it is confirmed APPROVED + UTILITY**, wire the code: add the
   template to `wa-template-create`, point `_shared/journeys.ts` at
   `review_request_v2`, and pass the order number as `{{2}}` from
   `_shared/order-confirmation.ts`. Live-test with a real send to Khush's number
   before enabling it for the journey (AGENTS.md §9).

5. **Watch for 30 days.** Compare `review_request_v2` block rate against the 56%
   baseline. If it is not near the ~2% utility rate, something in the copy is
   still reading as promotional.

6. **Do not submit cart or replenishment rewrites.** Not now, not later. The
   downside (§1.5: every utility template on the WABA recategorised to marketing)
   dwarfs the upside.

---

## 5. Changes this audit implies in files outside its scope

Recorded here rather than made, because other work owns these files:

| File | Change | Blocked on |
|---|---|---|
| `_shared/order-confirmation.ts:249` | Pass the order number: `{ "1": name, "2": orderNumber, "3": REVIEW_URL }` | Step 4 above |
| `_shared/journeys.ts:20` | Point `review_request` at `review_request_v2` | Step 4 above |
| `wa-template-create/index.ts` | Add the `review_request_v2` definition (category UTILITY, 3 vars) and the header comment's var map | Step 4 above |
| `_shared/marketing-governor.ts` | Add `review_request_v2` to `FALLBACK_UTILITY` (and remove `review_request` from `FALLBACK_MARKETING` once retired) | Step 4 above |
| `wa-template-create/index.ts` | Strip em dashes from `abandoned_cart_recovery`, `replenishment_reminder`, `order_confirmation`, `order_confirmation_v2` via `{edit}` mode | Independent, AGENTS.md §5 |
| `wa_templates` rows | Delete `hello_world`; mark `abandoned_checkout` retired | Independent, manual |

---

## 6. Sources

All read 26 August 2026.

- [Template categorization](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization) — the category definitions, the utility two-part test, the use-case tables, auto-categorization, the recurring recategorization sweep, the appeal flow, and the enforcement ladder
- [Template fundamentals](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview) — the three categories
- [Per-user marketing template message limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/per-user-limits) — #131049 mechanics, the in-window exemption, the retry penalty, geographic scope
- [Cloud API error codes](https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/) — #131049 and #131050 wording
- [Pricing on the WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) — per-message billing, utility-free-in-window
- [Upcoming pricing updates for non-template messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages) — the 1 Oct 2026 change
- [Template Library](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-library) — pre-categorized `FEEDBACK_SURVEY`
- [Marketing Messages API overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/overview) and [get started](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/get-started) — MM Lite scope
- [Legacy mirror of the categorization guidelines](https://developers.facebook.com/docs/whatsapp/updates-to-pricing/new-template-guidelines/) — still resolves, same current content
