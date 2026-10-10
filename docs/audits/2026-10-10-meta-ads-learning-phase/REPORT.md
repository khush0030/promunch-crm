# Meta ads: why we are still in "Learning", and when ROAS can turn

Date: 10 Oct 2026. Source: the Meta Ads connector, read-only. Nothing in the ad account was changed.

## Scope and data limits

- **Account analysed:** `Vippy Soya` (act 900085050581114, INR). This is the account where the new manager built the current sales campaign.
- **Not analysed:** the `PROMUNCH Protein Snacks` account (act 1645067910041298). Meta has not enabled connector access for it yet ("gradually being rolled out"). Any spend in that account is missing from this report.
- **Shopify cross-check not done:** comparing Meta-reported purchases with real `shopify_orders` revenue was blocked by the session's production-read permission. Every ROAS figure below is **Meta-attributed** (7-day click, 1-day view). Real ROAS could be somewhat higher; see section 5.
- Window: 16 Sep 2026 (the day the new manager's campaign started) to 10 Oct 2026 (partial day).

## 1. Current status in one table

| Campaign / ad set | Status | Optimising for | Budget | Spend | Purchases | Cost per purchase | ROAS | Learning |
|---|---|---|---|---|---|---|---|---|
| TOF \| Broad targeting \| ABO / **Edamame TOF** | Active | Purchase | ₹1,850/day | ₹38,447 | 22 | ₹1,748 | **0.37** | LEARNING, 1 conversion since last reset (6 Oct) |
| TOF \| Broad targeting \| ABO / **Promunch x first club** (created 9 Oct) | Active | **Add to cart** | ₹300/day | ₹138 | 0 | n/a | n/a | LEARNING, 0 conversions |
| *Previous setup:* Helium / Helium OPEN (12 Aug to 10 Sep) | Paused 10 Sep | Purchase | ₹500/day | ₹14,114 | 14 | ₹1,008 | **0.67** | n/a |

The other "Active" campaigns in the account are old Instagram post boosts with lifetime budgets already spent. They are not delivering.

Implied average order value from Meta's numbers: ~₹648 (Edamame TOF) and ~₹679 (Helium).

### Week by week (Edamame TOF)

| Week | Spend | Purchases | Cost per purchase | ROAS |
|---|---|---|---|---|
| 16 to 22 Sep | ₹7,663 | 6 | ₹1,277 | 0.47 |
| 23 to 29 Sep | ₹12,179 | 7 | ₹1,740 | 0.38 |
| 30 Sep to 6 Oct | ₹12,506 | 8 | ₹1,563 | 0.43 |
| 7 to 10 Oct (4 days) | ₹6,730 | 1 | ₹6,730 | 0.11 |

Spend went up 60% after week 1, but purchases did not rise with it. The last 4 days are the weakest so far.

## 2. Why it is still in Learning

Meta leaves the learning phase when an ad set gets about **50 optimisation events (here: purchases) in the 7 days after its last significant edit**. Two things stop that.

### 2a. The budget cannot buy 50 purchases a week (structural, true for any manager)

- Current pace is 22 purchases in 25 days, about **6 a week**. Learning needs 50, about **8x more**.
- At today's ₹1,748 per purchase, 50 a week costs about **₹87,000 a week (₹12,500/day)**. Even at Helium's ₹1,008, it is about ₹7,200/day. The budget is ₹1,850/day.
- So at this budget, a purchase-optimised ad set will **never** fully exit learning. It will show "Learning" or "Learning limited". **That label is not the problem by itself.** Plenty of small D2C accounts run profitably while "Learning limited". The real problem is the cost per purchase.

### 2b. The ad set keeps getting reset (management, fixable)

Every significant edit (targeting change, a big budget jump, a creative swap, adding or pausing ads) restarts the 7-day count. From Meta's change log, the Edamame TOF ad set had these resets:

| Date | Change |
|---|---|
| 16 Sep | Ad set created; creative swapped the same afternoon |
| 21 Sep | Targeting changed + budget ₹1,000 → ₹1,500 (+50%) |
| 23 Sep | New ad added (comparison video); its creative swapped the same night |
| 25 Sep | Targeting changed (age range) + budget → ₹1,650 |
| 26 Sep | Creative swapped on the main "Edamame" ad + budget → ₹1,850 |
| 29 Sep / 1 Oct | Diwali Hamper ad added, then its creative swapped |
| 3 Oct | Influencer ad added |
| 5 Oct | Targeting changed; comparison video paused |
| 6 Oct | Targeting changed again (city list). **The main converting ad "Edamame" was switched off** until 8 Oct |
| 7 to 8 Oct | Diwali Hamper and influencer ads paused/unpaused |

That is **about 9 resets in 25 days**. The longest quiet stretch was about 5 days, so the ad set **never once had a clean 7-day window**. Meta's own learning record for it shows 1 conversion since the last significant edit (6 Oct, 2:15 PM).

### 2c. Targeting is narrower than the campaign name says

The campaign is called "Broad targeting", but the Edamame TOF ad set has:
- Advantage+ audience **off** (Meta's automatic audience expansion)
- only 8 metro cities (25 mile radius), age 18 to 55
- Instagram engagers from the last 60 days excluded

The previous Helium ad set was all-India with Advantage+ audience **on**, and it beat the new setup on every efficiency number: CTR 2.31% vs 0.97%, landing-page-view to add-to-cart 13.6% vs 7.7%, cost per purchase ₹1,008 vs ₹1,748. Meta's own recommendation on this ad set is to turn on Advantage+ audience (estimated 7.2% lower cost per result). Caveat: Helium's sample is small (14 purchases) and it used different creatives, so this points in a direction rather than proving it.

### 2d. The new "first club" ad set is set up so it cannot learn

₹300/day, optimising for add to cart, limited to about 20 one-mile pins around Bangalore, and **restricted to iOS devices only**. Add to cart currently costs about ₹750 on this account, so this is under one event a day. It will stay in Learning indefinitely. If it is a local test for a partner (First Club), that is fine, but it should be labelled as a test and not judged on ROAS.

## 3. Is it because of the new manager?

**Partly.** Plainly:

- **Not their fault:** a small budget optimising for purchases at an AOV around ₹650 would sit in learning for anyone. The account also had weak ROAS before they joined (Helium: 0.67).
- **Their part:** the edit pattern above (about 9 resets in 25 days), the narrowing of a "broad" campaign, creatives swapped inside the live ad set instead of tested separately, the best ad switched off for two days, and a ₹300/day iOS-only add-to-cart ad set. On the numbers, their setup is so far doing **worse** than the one it replaced (ROAS 0.37 vs 0.67).
- **Fair caveat:** 25 days and ₹38k is a small sample, the festive season is pushing CPMs up (₹229 average here), and they have only been on the account for 3.5 weeks.

Questions worth asking them directly:
1. Why is Advantage+ audience off in a campaign named "Broad targeting"?
2. Why the "first club" ad set is iOS-only and optimising for add to cart.
3. What cost per purchase and ROAS they are aiming for, and by when.
4. Will they commit to no significant edits on the main ad set for 7 days at a time, and do creative testing in a separate ad set?

## 4. When can we expect good ROAS?

**Not on the current setup.** Getting out of learning usually improves cost per purchase by something like 20 to 40%. Our gap is much bigger than that: at ~₹650 AOV, breaking even on the first order probably needs ROAS around 1.7 to 2.0 (depends on our gross margin, which this report does not have). We are at 0.37, roughly 5x short. Learning alone will not close that.

A realistic timeline **if the fixes below are made this week**:

| By | What to judge |
|---|---|
| ~17 Oct | First clean 7 days with no resets. Check: is cost per purchase trending back toward ₹1,000? |
| Late Oct / early Nov (Diwali window) | 2 to 3 stable weeks. Target: cost per purchase under ~₹1,000 (ROAS ~0.65+, Helium level) on prospecting; retargeting ROAS should be clearly above 1 |
| Mid to late Nov | Enough data to decide whether prospecting can get near break-even once AOV and tracking fixes are live. If cost per purchase is still above ₹1,200 after 4 stable weeks, the creative/offer is the problem, not learning |

There is no honest way to promise a date for ROAS above 2 at this budget. The levers that move it most are below.

## 5. What would actually move ROAS (in order)

1. **Stop resetting.** No targeting, creative, or budget edits on Edamame TOF for 7 full days. Budget changes at most ±20%, at most once every 3 to 4 days. Test new creatives in a separate small ad set and move only the winners in.
2. **Make "broad" actually broad.** Test Advantage+ audience on (all-India) as its own ad set against the current 8-city one. Helium's numbers suggest this wins.
3. **Add a retargeting ad set.** Audiences already exist (created 5 Oct): `Web | ATC + Checkout | 30d`, `Web | All visitors | 30d`, excluding `Web | Purchasers | 60d`. **No ad set uses them.** Edamame TOF alone produced 45 checkouts started but only 22 purchases. A ₹300 to 500/day retargeting ad set is usually the highest-ROAS spend for a brand our size.
4. **Raise AOV.** Implied AOV (~₹650) sits just above the ₹599 free-shipping line. Bundles or combo packs that push carts to ₹900+ raise ROAS directly, with no change to the ads.
5. **Fix purchase tracking.** In the pixel's quality report the Purchase event **has no match-quality score**, and Meta flags that Purchase is sent **without the click ID (fbc)**. It recommends connecting the Conversions API (similar advertisers saw a 100%+ median increase in additional conversions reported). The pixel logged about 59 Purchase events site-wide from 13 Sep to 10 Oct, while ads were credited with 22. Some of that gap is organic or WhatsApp traffic, but some is probably ad-driven sales Meta cannot match. That **understates reported ROAS and starves learning of signal**. Also worth checking: whether COD orders fire a Purchase event at all.
6. **Decide on "first club".** Either label it a local partner test with its own success metric, or fold it into the main structure. Drop the iOS-only restriction unless there is a reason for it.

## 6. Account health signals from Meta

- Opportunity score: **88/100**. Open recommendations: send fbc on Purchase (+4 points), Conversions API coverage (+3), Advantage+ audience on Edamame TOF (+2), campaign set to maximise number of conversions (+1).
- No delivery-blocking errors on the active campaign.
- Pixel `246305644844825` match quality: PageView/ViewContent 5.5, AddToCart 6.9, InitiateCheckout 6.7, AddPaymentInfo 9.3, Purchase **not reported**. Email coverage on PageView is 3.6%.

## Follow-ups that need access

- Get Meta to enable connector access for the `PROMUNCH Protein Snacks` ad account, or confirm no spend runs there.
- Allow a read-only `shopify_orders` comparison (web orders and revenue per day vs Meta spend, 16 Sep to 10 Oct) to get the **real** blended ROAS, not just Meta-attributed ROAS.
- Gross margin per order, to set a real break-even ROAS and target cost per purchase for the manager.
