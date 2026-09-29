# WhatsApp marketing deliverability playbook

**Written:** 2026-09-29. **Data window:** last 60 days unless stated (read-only queries against production).
**Who this is for:** the owner (Meta-side actions), whoever builds the campaign screens, and the employee who runs WhatsApp marketing each week.
**Related docs:** [AUDIENCE_QUALITY.md](AUDIENCE_QUALITY.md) (engagement tiers), [MM_LITE_MIGRATION.md](MM_LITE_MIGRATION.md) (Marketing Messages API code path, flag OFF), [TEMPLATE_CATEGORY_AUDIT.md](TEMPLATE_CATEGORY_AUDIT.md) (which templates could be utility), [META_WHATSAPP_TEMPLATE_RULES.md](META_WHATSAPP_TEMPLATE_RULES.md).

---

## 1. What is happening, in plain English

Most of our marketing WhatsApp messages are not being delivered. Meta refuses them with error **#131049**, "This message was not delivered to maintain healthy ecosystem engagement".

This is **not** a ban, not a broken number and not a bug in our code. It is Meta's **per-person marketing budget**:

- Every WhatsApp user in India gets a limited number of marketing messages from *all* businesses combined. Meta decides the size of that budget per person, using "a dynamic view of an individual's recent marketing message read rate and how many messages they currently have in their inbox from friends, family, and businesses" ([Meta: per-user marketing limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/per-user-limits/)).
- When that person's budget is used up, our marketing template is dropped and we get #131049. Utility templates (order confirmation, shipping update) and normal chat replies inside the 24 hour window are **not** affected.
- Meta asks businesses to wait **at least 24 hours** before retrying the same person, and warns that retrying several times inside 24 hours can make that person undeliverable for up to another 24 hours (same page).
- Marketing messages sent within 24 hours after a user responds to a marketing message do not count toward the limit (same page). This is why replies are gold.

So the questions that matter are: *who* we send marketing to, *how often*, and *which pipe* we send it through. Our list is mostly phone numbers from Shopify orders who have never talked to us on WhatsApp, and until early September we were hitting some of them many times a week. That is the worst possible profile for this system.

The messaging tier (about 250 unique people per day) is **not** today's bottleneck. We are sending far fewer than 250 marketing messages a day. The per-person budget is.

---

## 2. The data

### 2.1 Where the failures come from

Outbound template sends, last 60 days: 2,379, of which 1,081 failed.

| Failure reason | Count |
|---|---|
| #131049 healthy ecosystem (per-person marketing cap) | **971** |
| Message undeliverable (number not on WhatsApp, etc.) | 93 |
| User's number is part of an experiment (Meta test cohort) | 19 |
| Media upload error | 5 |

By template category:

| Template | Category | Sends | #131049 | Delivered or read |
|---|---|---|---|---|
| replenishment_reminder | marketing | 473 | 314 | 134 |
| review_request | marketing | 348 | 178 | 144 |
| abandoned_cart_reminder | marketing | 314 | 260 | 26 |
| abandoned_cart_recovery | marketing | 271 | 218 | 26 |
| shipping_update | utility | 288 | 0 | 272 |
| ops_ticket_alert | utility | 278 | 0 | 278 |
| order_verify_v1 + reminder | utility | 263 | 0 | 250 |
| order_confirmation_v2 + repeat | utility | 142 | 0 | 129 |

- **Marketing templates: 1,406 sends, 970 blocked (69%), 330 delivered (23%).**
- **Utility templates: zero #131049 in 60 days.**
- **Free text inside the 24h window: 385 sent, 8 failed (2%).**
- **Every one of the 60-day blocks came from automatic journeys** (replenishment, review, cart). No broadcast campaign ran in this window. The only broadcast ever, "Edamame Launch v2" (June 27), has 3,081 message rows in the ledger: 2,564 blocked, 177 delivered.

### 2.2 It is getting better, because we stopped hammering people

| Window | Marketing sends | Blocked | Block rate | Most attempts to one person |
|---|---|---|---|---|
| 31 to 60 days ago | 1,092 | 788 | 72% | 82 |
| 15 to 30 days ago | 214 | 125 | 58% | 82 |
| Last 14 days | 101 | 57 | 56% | 3 |

The per-customer frequency governor (`_shared/marketing-governor.ts`, 1 marketing attempt per 24h, 3 per 7 days, suppress after 3 strikes) is doing its job. The remaining ~56% is the honest baseline for a cold list on the Cloud API.

### 2.3 Repeat blocks: a few people absorbed a huge share

386 different people got at least one #131049 in 60 days.

| Blocks per person | People | Blocks |
|---|---|---|
| 1 | 234 | 234 |
| 2 | 113 | 226 |
| 3 to 5 | 17 | 60 |
| 6 to 10 | 6 | 52 |
| 11 or more | **16** | **399** |

**16 people absorbed 399 blocks (41% of all blocks)**, all between Jul 31 and Sep 2, before the governor landed. 121 of the 386 did also receive at least one marketing message in the same window, so a block is "not now", not "never".

### 2.4 Frequency is the single biggest lever

Block rate by how many marketing attempts that person had already had in the 7 days before this one:

| Prior marketing attempts in 7 days | Sends | Block rate |
|---|---|---|
| 0 | 824 | **59%** |
| 1 | 89 | 75% |
| 2 | 42 | 64% |
| 3 or more | 452 | **86%** |

### 2.5 Engagement helps, but less than people expect

Measured **at the moment of each send** (not today's state):

| Who we sent to | No marketing in prior 7d | Had marketing in prior 7d |
|---|---|---|
| A. Messaged us in the previous 90 days | 45% blocked (53 sends) | 67% (9) |
| B. Never messaged, but **read** one of our messages in the previous 90 days | 58% blocked (505) | 86% (189) |
| C. Cold (neither) | 64% blocked (266) | 81% (385) |

Current-state cuts of the 1,529 opted-in contacts (block rate on their 60-day marketing sends):

| Segment | Contacts | Marketing sends | Block rate |
|---|---|---|---|
| Buyer (has a Shopify order on this phone) | 1,096 | 958 | 63% |
| Non-buyer | 433 | 439 | 81% |
| Ever messaged us | 139 | 74 | 53% |
| Never messaged us | 1,390 | 1,323 | 70% |
| rfm:loyal | 60 | 134 | 58% |
| rfm:one_time | 359 | 668 | 66% |
| rfm:vip | 10 | 31 | 77% (tiny sample) |
| no rfm tag | 608 | 536 | 75% |
| tier:suppressed | 55 | 568 | 90% |

Takeaways: people who talk to us, and people who buy, get through more often. Nobody is immune: even recent repliers are refused about 45% of the time, because Meta counts *every* business's marketing against the same person. In India this cap is simply tight.

### 2.6 List facts

- Opted-in contacts: **1,529**. Ever messaged us: **139**. Messaged us in last 90 days (not suppressed): **117**.
- Storefront popup opt-ins (`consent_verified_at` set): **0**. Every "opted-in" contact is an import.
- People who received at least one marketing template attempt in the last 30 days: **233** (315 attempts, 182 blocked, 58%).

---

## 3. Recommended default campaign audience: "Warm"

The current default preset is "Engaged only" (`tier:engaged`, about 112 people). It is the safest, but too small to move revenue. Recommended new default, one rung wider, based on the data above:

```
opted_in = true
AND NOT 'tier:suppressed' = ANY(tags)                  -- opt-outs and 3+ strike numbers
AND (
      inbound wa_messages in the last 90 days            -- talked to us
   OR any outbound wa_messages with status = 'read'
        in the last 90 days                              -- reads our messages (Meta's own signal)
   OR a paid shopify_orders row (total_price > 1)
        on customer_phone = wa_id in the last 60 days     -- recent buyer, excludes Rs 0.01 HYPD seeds
)
AND no marketing-category template attempt to them in the last 7 days
AND no #131049 on them in the last 14 days
```

**Size today: 514 people** (the same without the recent-buyer clause: 462; "Engaged only": 117).

Expected outcome, using measured rates for these groups (roughly 42% to 55% delivered): **about 200 to 250 delivered messages per broadcast**, versus roughly 177 delivered from 3,081 attempts on the Edamame blast. Because India marketing messages are billed **per delivered message** ([Meta pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)), a refused message costs no money, but it does cost quality signal and the person's goodwill, so a smaller, warmer list is strictly better.

Implementation note: the send engine resolves audiences only through `tags` overlap (see AUDIENCE_QUALITY.md), so this should become a new nightly tag, `tier:warm`, written by `recompute_wa_engagement_tags()` alongside the existing tiers, rather than new send-path logic. The 7-day and 14-day exclusions are already enforced per recipient at send time by the marketing governor; the preflight should simply show how many will be skipped.

---

## 4. Current Meta facts (verified 2026-09-29)

### 4.1 Marketing Messages API for WhatsApp (formerly "MM Lite")

- **What it is.** A separate endpoint for marketing templates with Meta-side delivery optimisation: `POST /<API_VERSION>/<PHONE_NUMBER_ID>/marketing_messages`. Same phone number, same approved templates, "similar technical schema and same billing model as Cloud API" ([overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/overview)).
- **Claimed uplift.** "Up to 9% higher marketing message deliveries over Cloud API for high engagement content" ([About the platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform)). Meta's A/B test was run in **India**, January 2025, on about 12 million messages, and reports more reads and clicks ([overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/overview)). Note the caveat "for high engagement content": it rewards good creative and warm audiences, it does not rescue a cold list.
- **Features not on Cloud API:** quality-based delivery; automated creative optimisations (for example image animation, filtering), on by default per template but **off by default at account level, you must opt in**; performance benchmarks versus similar templates in your region; conversion metrics (Add to Cart, Checkout Initiated, Purchase), which **need a Meta Pixel or Conversions API** connection; GIF support; and **TTL for marketing templates, which is exclusively available on the MM API** ([send marketing messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/send-marketing-messages/)).
- **Request extras:** optional `product_policy` (`CLOUD_API_FALLBACK` is the default, `STRICT` prevents fallback) and optional `message_activity_sharing` (share read activity with Meta for optimisation) (same page).
- **Eligibility and India.** Requires an active WABA in an eligible country, an approved marketing template, and a `messages` webhook subscription. India is eligible and is not on the limited-features list (EU/EEA, UK, Japan, South Korea, Nigeria, South Africa, Russia, Belarus) ([get started](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/get-started)). Works with existing Cloud API numbers.
- **Onboarding.** App Dashboard, WhatsApp, Quickstart, module "Improve ROI with marketing messages with optimizations", Get started, Continue to integration guide, accept the Terms of Service (same page). No separate business verification step is stated there.
- **Pricing.** Cloud API marketing rates apply to MM API messages (billed as `marketing_lite`, pricing model `PMP`). Meta's pricing page also describes a 2026 option to set a max price per marketing delivery on the MM API ([pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)).
- **Our status:** the code path is built (`WA_MM_LITE_ENABLED` flag in `_shared/whatsapp.ts`), but the secret is **not set** and Meta onboarding has not been done. See MM_LITE_MIGRATION.md.

### 4.2 India pricing (per message, since the July 1 2025 switch to per-message billing)

Rate card effective July 1 2026, as published by Indian BSPs quoting Meta's card: **marketing Rs 0.8631, utility and authentication Rs 0.1150, plus 18% GST** (marketing is about Rs 1.02 with GST) ([whautomate rate card](https://whautomate.com/whatsapp-business-api-pricing-india), [chatmaxima](https://chatmaxima.com/whatsapp-api-pricing/india/)). Meta's own rate cards are downloadable from the [pricing page](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing); confirm there before quoting to finance. India has monthly volume tiers for utility and authentication only; marketing has no volume discount. Utility templates delivered inside an open customer service window are **free**. Meta flags further rate changes for October 1 2026.

### 4.3 Messaging limits (the "250 a day" tier)

- Tiers: 250, 2,000, 10,000, 100,000, unlimited. Counted as unique people reached **outside** a customer service window in a moving 24 hours, and **set at business portfolio level**, shared by all numbers ([messaging limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits)).
- 250 to 2,000: verify the business with Meta, or partner-led verification, or deliver 2,000 messages to unique users in 30 days with high-quality templates.
- Above 2,000: automatic, one level within 6 hours, if quality is high and the portfolio used at least 50% of its limit in the past 7 days.
- **The old `messaging_limit_tier` field no longer works; read `whatsapp_business_manager_messaging_limit` instead** (same page). This explains why our quota code "never sees" the tier. `wa-meta-info` and `_shared/wa-quota.ts` still ask for the old field.
- Template quality: templates can drop to Medium and then **Paused** on negative feedback or low read rates ([template quality](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-quality)). Cold blasting hurts this.

### 4.4 Category rules (utility vs marketing)

- Utility must be non-promotional **and** tied to the user's own transaction or account. Abandoned cart and "renew / reorder" style messages are marketing. A review request can be utility only when it is specific to a prior transaction and carries no promotion ([template categorization](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization)).
- Meta re-categorises misfiled utility templates; after a misuse warning it does so with no notice, and repeat abuse escalates to utility rate limits and portfolio restrictions for 7 to 30 days (same page). Our own audit ([TEMPLATE_CATEGORY_AUDIT.md](TEMPLATE_CATEGORY_AUDIT.md)) concludes only `review_request` can honestly be rewritten as utility. Do **not** relabel cart or replenishment templates to dodge the cap: losing our utility templates would break order confirmations.

---

## 5. What we will change in the product (campaign UI and engine)

Proposed, not built. Items 5 to 8 touch send paths and need owner approval under AGENTS.md section 4.

1. **New default audience "Warm" (`tier:warm`)** as defined in section 3, added to the nightly tier recompute. Keep "Engaged only" as the top-quality option. Order presets: Warm (default), Engaged only, Everyone except suppressed, Everyone.
2. **Predicted-delivery preflight.** Before launch, show "About X of Y will arrive. Meta will likely hold back Z. Cost about Rs N (delivered only)", computed from each tier's measured 30-day block rate, not a constant.
3. **Budget collision warning.** Show how many people in the audience already had a journey marketing message (cart, review, replenishment) in the last 7 days, and that the governor will skip them. Journeys and campaigns share one per-person budget.
4. **Stronger guard on "Everyone".** If more than half the audience has never messaged or read us, show the danger warning and require the operator to type the audience size to confirm.
5. **Report #131049 as "Held back by Meta", not "Failed".** Separate it from real failures (undeliverable, template errors) in campaign reports and alerts, with the plain-language reason and "we will not retry for 24h". Stops the team treating it as an outage.
6. **Read the real messaging limit.** Switch `wa-meta-info` and `_shared/wa-quota.ts` to `whatsapp_business_manager_messaging_limit`, keep `WA_DAILY_SEND_LIMIT` as the operator ceiling.
7. **MM API readiness badge** on the Campaigns tab: flag on or off, and whether any recent status webhook came back as `marketing_lite`. Only then call a campaign "optimised".
8. **Engagement-first sequencing for launches.** Default a broadcast to go in two waves: wave 1 to Engaged only; wave 2 to the rest of Warm 24 to 48 hours later, only if wave 1's block rate is under a threshold (suggest 50%). Every reply opens a 24h window where marketing does not count against the cap.
9. **Journey audience filter.** Journeys still fire to cold imported numbers (AUDIENCE_QUALITY.md known gap 2). Add a dashboard toggle per journey: "only send the marketing template to Warm contacts; others get it only as free text if they open a chat window".
10. **Capture real opt-ins.** Zero popup opt-ins exist. Push the storefront popup and a "WhatsApp me updates" checkbox at checkout; those people land in `tier:subscribed`.

---

## 6. What the owner must do at Meta

1. **Onboard the Marketing Messages API** (about 10 minutes):
   1. Open <https://developers.facebook.com/apps>, pick the PROMUNCH WhatsApp app.
   2. WhatsApp, Quickstart, find "Improve ROI with marketing messages with optimizations", click Get started, then Continue to integration guide.
   3. Accept the Terms of Service.
   4. In WhatsApp Manager confirm the marketing templates are APPROVED and in the MARKETING category.
   5. Optional: in WhatsApp Manager, opt the account in to automated creative optimisations (off at account level by default).
   6. Tell the developer; they set `WA_MM_LITE_ENABLED=true`, redeploy `wa-send` and `wa-campaign-send`, and live-test one send to the owner's phone (runbook in MM_LITE_MIGRATION.md sections 5 and 6).
2. **Business verification.** In Meta Business Settings, Security Centre, confirm the business is verified. If not, verify it: this is the fast path from 250 to 2,000 unique people per day and a prerequisite for scaling.
3. **Connect the Meta Pixel / Conversions API** for the Shopify store to the same business portfolio, so the MM API can report Add to Cart, Checkout and Purchase from WhatsApp messages.
4. **Check quality weekly** in WhatsApp Manager: phone number quality (should be High / green) and each marketing template's quality. A Medium template should be rested or rewritten before Meta pauses it.
5. **Approve the `review_request` utility rewrite** proposed in TEMPLATE_CATEGORY_AUDIT.md (transaction-specific, zero promotion), and the product changes in section 5.

---

## 7. Weekly routine for the WhatsApp marketing employee

Every Monday, 20 minutes:

1. **Open WhatsApp, Campaigns, Audience quality panel.** Note: Warm count, Engaged count, 30-day marketing delivery rate, suppressed count. Write them in the weekly log. Warm growing week on week is the goal.
2. **Check WhatsApp Manager** (or ask the owner): number quality High, no template at Medium or Paused.
3. **Look at last week's "Held back by Meta" rate.** Under 50%: fine. Over 60%: the audience or frequency is too aggressive, do not add more sends this week.
4. **Plan at most one broadcast a week**, and never to the same person more than once in 7 days. Journeys (cart, review, restock) already use part of each person's budget.
5. **Start with Engaged only, then Warm.** Never pick "Everyone" without the owner's okay.
6. **Write for replies.** Ask a question or use a quick-reply button ("Want the new flavour? Reply YES"). A reply opens a free 24h window and tells Meta people want our messages. Keep copy short, PROMUNCH in caps, no em dashes, STOP footer on every marketing template.
7. **Send at good times**: late morning or early evening IST, not late night.
8. **Do not resend to people Meta held back** in the same week. The system will not retry within 24 hours by design; that is correct.
9. **Reply fast.** Any reply from a campaign should get a human or bot answer the same day. Conversations are what grow the Warm list.
10. **Report monthly to the owner:** delivered, read, replies, orders attributed, and cost (delivered marketing messages times about Rs 1.02 including GST).

---

## 8. How these numbers were produced

Read-only SQL against production via `supabase db query --linked`, 2026-09-29. Marketing templates are the rows in `wa_templates` with `category = 'marketing'`. A block is a `wa_messages` row whose `error` contains "healthy ecosystem". "Delivered" means status `delivered` or `read`. Buyers match `shopify_orders.customer_phone` to `wa_contacts.wa_id` on digits only. At-send-time segments look only at messages before each send. Re-run these before quoting the numbers again; they move weekly.
