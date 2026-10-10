# AI visibility phase 2: outreach kit

Written 10 Oct 2026. **Status: research and drafts only. Nothing has been sent, no forms submitted, nothing committed.**

Why: the 10 Oct 2026 audit asked AI assistants "best protein snacks in India", "best healthy snacks in India" and "best protein snacks under ₹499". They answered from listicles and press, and named PROMUNCH in none of them. Phase 1 fixes our own site and feeds. This kit is how PROMUNCH earns a place in the third-party pages those answers are built from.

| File | What it is |
|---|---|
| `targets.csv` | 37 targets: 16 listicles and roundups (a), 14 press and newsletter targets (b), 7 creators (c). Priority 1 to 3, URL, the contact route only where the site itself publishes one, the angle, research notes, and a blank `status` column. |
| `pitches.md` | Fact list, three group templates, five personalised listicle pitches, the day-5 follow-up, press kit checklist and founder bio drafts. All from Parth Mutha, parth@trypromunch.in. |

## What the research found (10 Oct 2026)

- **Four of the five pages the audit saw AI drawing on are brand-owned blogs** that rank their own products: The Gourmet Stories (nuts), Sheer MADness (protein bars), Healthy Master (snacks), Proptimal (hemp bars). Only the Times of India piece is independent. Brand blogs rarely name a competitor, so expect little from them. Pitch each once, politely, with useful label data, and put the real effort into independent lists.
- **Independent lists exist and name brands:** The Lab Mag, ClickPost, Foodsure, Health Shots. These are the best listicle bets.
- **Health Shots and Hindustan Times product boxes are picked from Amazon** (ratings, reviews, availability). A strong Amazon listing with GTINs and an accurate title is a precondition for that kind of inclusion (phase 1 task 1 helps).
- **Verification:** 18 of 37 rows were opened and read on 10 Oct 2026 (notes say "verified live"). 14 were confirmed from search results only (notes say "Verified via search", "Search snippet only", or "URL found"). 5 are unverified starting points with no checked URL or contact (ET Retail, Mint Lounge, Business Standard, the regional MP papers, The Vegan Indians). Re-check any row before you pitch it.
- **Public contact routes verified on the publisher's own site:** The Better India (editorial@thebetterindia.com), Inc42 (editor@inc42.com), StartupTalky (story@startuptalky.com), YourStory ("Pitch To Us" form), Entrackr ("Tell Your Tale"), Mridul and Aditya (business email in their video description), Sheer MADness (footer email). Everything else says "Not captured". **Never guess an email address.**
- **Two [CONFIRM] items from phase 1 can now be resolved:** Forbes profile URL `https://www.forbes.com/profile/parth-mutha` (item 18) and Global Indian article `https://www.globalindian.com/youth/from-kitchen-to-amazon-the-journey-of-parth-muthas-promunch-protein-snacks` (item 19). Owner should confirm before publishing them.

## Blockers to clear before the first pitch

Journalists, editors and label critics will click through to promunch.in and the Amazon listing. Today some of what they would find contradicts the verified facts. Fix these first (owner decision; this folder does not change them):

1. **Homepage claims.** promunch.in's homepage title includes "India's Best High Protein Snack" (a superlative), and the ticker says "BAKED NOT FRIED", "NO PALM OIL", "NO MAIDA". Soya Sticks and Soya Chips are fried, Edamame is roasted in olive oil (not baked), and palm oil and maida are not confirmed for every line. A reviewer like FoodPharmer would flag this.
2. **About page and marketplace titles.** promunch.in/pages/about-us says the snacks are "vegan, gluten-free, and non-GMO". Amazon.com and HyugaLife listings are titled "PROMUNCH Roasted Soya Snack | Vegan | Gluten Free". All unconfirmed (phase 1 [CONFIRM] item 10). Align them with the pack labels.
3. **Publish `/pages/about-promunch`** (phase 1 task 4) so there is one page with the facts to point people to.
4. **Resolve these [CONFIRM] items** (numbers refer to `phase1/brand-facts/README.md`): 4 and 7 (protein for Crunchies, Sticks, Chips), 8 and 9 (prices and the under-₹499 claim), 10 and 12 (diet claims, ingredients), 17 (a press mailbox a human reads), 20 (The Vegan Indians URL). Pack storage instructions for "needs no fridge" in pitch 4.5.
5. **Build the press kit** (checklist at the end of `pitches.md`) and set aside sample stock: about 30 boxes for the first month.

## How to work the list

### Order

1. **Week 1 (prep, then 10 pitches):** priority 1 listicles first (Times of India, The Lab Mag, ClickPost, Foodsure, Health Shots, Healthy Master), then The Better India, YourStory and the regional MP papers. Use the personalised pitches in `pitches.md` section 4 where one exists.
2. **Week 2 (about 10):** priority 1 creators (Sachin Anand, Mridul and Aditya, Amita Gadre), then priority 2 listicles and press (Proptimal, The Gourmet Stories, Hindustan Times, Inc42, StartupTalky, Forbes India, ET Retail, Mint Lounge), plus the Global Indian refresh.
3. **Week 3 onward (about 10 a week):** the rest of priority 2, then priority 3. Hold FoodPharmer until blockers 1 and 2 are fixed.
4. Add new targets as you find them (search the three audit queries monthly). Keep the same columns.

### Weekly cadence (about 10 pitches)

- **Monday:** pick 10 rows. Open each URL, re-read the piece, find the current byline and a published contact route. Fill the template. Run the copy check in `pitches.md`.
- **Tuesday and Wednesday morning (IST):** send, one by one, from parth@trypromunch.in by hand. Do not use the CRM's automated B2B outreach sequences for these: each pitch is personal and gets exactly one follow-up.
- **Day 5 after each send:** send the follow-up in the same thread, once.
- **Day 12:** no reply means `no-reply`. Do not pitch the same outlet again for 90 days unless there is real news.
- **Friday:** update statuses, ship samples promised that week, and note any new article that names PROMUNCH.

### Tracking

Use the `status` column in `targets.csv` (or a copy in Google Sheets). Values, in order:

`drafted` → `sent YYYY-MM-DD` → `followed-up YYYY-MM-DD` → `replied` → `yes` / `samples-sent YYYY-MM-DD` → `published <URL>`, or `declined` / `no-reply`.

Or track in the CRM: Deals module, one hand-made deal per target that replies. Kind **Creator** for creators, **Partnership** for editors and journalists (there is no press kind). Stages map as New (pitched), Talking (replied), Samples (samples asked for or sent), Won (published), Lost (declined), On hold (later). Put the article URL and the contact route in the deal notes. Do not create deals for people who have not replied.

### When someone says yes

- **Listicle editor:** send within 24 hours: the nutrition sheet, label photos (front and back), the Short brand description from `brand-descriptions.md`, the about page link, product shots, and samples to a shipping address they give you. Let them write it; do not ask for copy approval. If they get a fact wrong, send one polite correction with the label photo.
- **Journalist:** founder bio, headshot, fact sheet, product shots, a phone slot within 48 hours, and samples. Answer only from the verified facts. If you do not know a number, say you will check, then check.
- **Creator:** samples of all four lines, the nutrition sheet and ingredient list per flavour, and the ask to disclose the gift. No script, no approval of the video, no request to delete criticism.
- **After it is published:** add the URL to `status`, thank them once, and add the link to the about page "Press" section if it is substantial. Re-run the three audit queries about four weeks later.

## Earned coverage only: the honest rules

This is earned coverage. It works only if it stays honest, and both Indian advertising rules and the platforms punish the alternatives.

- **No paid placements disguised as editorial.** If a publisher or listicle asks for a fee, that is advertising. Either decline, or buy it as an ad that the page labels "sponsored" or "advertisement". Never pay for a "best of" ranking.
- **Creators disclose.** Gifted products are a material connection under ASCI's influencer guidelines. Ask every creator to disclose, and never ask anyone to hide it. A paid collaboration is a separate, clearly labelled conversation.
- **No fake reviews.** No reviews from staff, family, friends or agencies posing as customers; no Reddit, Quora or comment posts from accounts that hide their link to PROMUNCH; no free product in exchange for Amazon reviews (Amazon forbids incentivised reviews). If Parth joins a discussion, he says he is the founder.
- **Accuracy over inclusion.** Never let an article call the whole range roasted, baked or "not fried". If a draft overstates our protein or diet claims, correct it, even if the correction makes us look less impressive.
- **One follow-up, then stop.** Silence is an answer.

## Docs index

Per `docs/README.md` rules this folder should be listed in the docs index. This task was limited to writing in this folder, so the index entry is left for whoever commits the phase 2 work.
