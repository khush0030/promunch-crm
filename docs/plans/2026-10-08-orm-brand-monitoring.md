# Online Reputation Management (ORM): plan

Status: **PLAN, not built.** Owner request Oct 8 2026: track PROMUNCH brand activity across the internet and social media, see every comment, review and mention in one place, and respond fast.

## 1. Goal

One **Reputation** screen in the CRM where the team sees, in near real time, everything people say about PROMUNCH:

- every comment, review, mention and tag, from every channel, in one feed
- each item scored automatically: sentiment, topic, urgency, which product, whether it is a real customer with an order
- the bad ones (food safety, damaged pack, angry 1-star) reach the team on WhatsApp within minutes
- an AI draft reply grounded in the Master KB, a human approves, and it posts from the CRM where the platform allows it
- trends: sentiment over time, ratings per marketplace, top complaints, response time, share of voice vs competitors

Not in scope: buying fake reviews, mass auto-replies, anything that posts publicly without a human approving it (v1).

## 2. Where PROMUNCH is talked about, and how we can read it

| Source | What we get | How | Can we reply from the CRM? | Blocker / cost |
|---|---|---|---|---|
| **Website reviews (Judge.me)** | Every product review + rating | Judge.me API (we already use Judge.me) | Yes (Judge.me reply API) | API token from Judge.me |
| **Instagram, our posts** | Comments on posts and reels | Meta Graph API + `ig-webhook` (already parses comments) | Yes | **Meta app review** (same one pending for DMs) |
| **Instagram, mentions and tags** | @promunch.snacks in captions/comments, photo tags, story mentions | Graph API mentions + webhook | Yes for comments; story mentions via DM | Meta app review |
| **Instagram, untagged talk** | Posts using #promunch etc. without tagging us | Apify hashtag scraper (already wired for Discovery) | No (open on Instagram) | Apify credits |
| **Facebook page** | Comments, page reviews | Graph API | Yes | Meta app review |
| **YouTube** | Comments on our videos; videos mentioning PROMUNCH | YouTube Data API v3 | Yes on our channel | Free (10k units/day) |
| **Amazon** | Product reviews + star ratings per ASIN | Apify Amazon reviews scraper (SP-API does not expose reviews) | No (open Amazon) | Apify credits |
| **Google Business Profile** | Google reviews + rating | Business Profile API | Yes | Google API access application (can take weeks) |
| **Reddit** | Posts/comments naming PROMUNCH | Reddit API search | No (open Reddit) | Free tier |
| **X (Twitter)** | Tweets naming PROMUNCH | Apify scraper (official API is $200+/month) | No | Apify credits |
| **News and blogs** | Articles, listicles, blogs | Google Alerts RSS + a news API | No | Free |
| **Quick commerce + marketplaces** | Ratings/reviews on Flipkart, Blinkit, Zepto, Swiggy Instamart, BigBasket | Apify scrapers, daily | No | Apify credits; later phase |
| **Our own WhatsApp + email** | Complaints already in the CRM | Existing `wa_messages` / tickets | Already handled | None; feeds analytics only |

Rule of thumb: **owned channels** (our posts, our listings) are read and replied to through official APIs. **Public web** is read-only (low-volume scraping, same policy as Discovery) and the team replies on the platform via a deep link.

## 3. How it works

```
 collectors (one edge fn per source, pg_cron)          ┐
   judgeme · youtube · reddit · news · apify (amazon,   │  upsert, unique (source, external_id)
   x, ig hashtags, marketplaces) · ig-webhook (live)    ┘
                         │
                         ▼
                  orm_mentions  ──►  orm-enrich (AI)
                                       sentiment -2..+2, topics, intent,
                                       urgency, language (incl. Hinglish),
                                       product, order/contact match
                         │
          ┌──────────────┼──────────────────────┐
          ▼              ▼                      ▼
     ALERT rules    Reputation feed       Routing
     WhatsApp ping  (dashboard)           complaint → support ticket
     to team                              collab ask → Influencers
                                          great UGC → creator prospect
                         │
                         ▼
          AI reply draft (Master KB) → human approves →
          post via API (owned channels, atomic claim) or "Open and reply"
```

**Enrichment (AI, one call per mention, gpt-4.1-mini class):**
- sentiment (-2 to +2) and a one-line "what they are saying"
- topic tags: taste, crunch, price, protein claims, packaging, delivery, stale/quality, foreign object, allergy, availability, customer service, competitor comparison
- intent: complaint, question, praise, suggestion, collab ask, spam
- urgency: critical / high / normal / low. **Critical** = food safety words (insect, fungus, stale, smell, sick, allergic reaction), legal threats, or a negative post from a big account
- product: Roasted Edamame (which flavour), Crunchies, Chips, Sticks
- customer match: order number or phone in the text → `shopify_orders` / `contacts`, so the team sees "real customer, order #2083, delivered Oct 2"

**Alerts (reuse the support alert fan-out):**
- Critical: WhatsApp to the team immediately (same numbers as support alerts)
- New 1 or 2 star review anywhere: WhatsApp within 15 minutes
- Spike: 3+ negatives on the same topic in 24h (e.g. "stale" on one batch)
- Daily 9am digest line: new mentions, sentiment, anything unanswered
- Weekly reputation summary: ratings per channel, top 3 complaints, best UGC

**Replies:**
- AI drafts from the Master KB only, brand rules enforced (PROMUNCH caps, no em dashes, no medical claims, no arguing in public). Complaints get "sorry + we will fix it, DM/WhatsApp us" and open a support ticket.
- A human approves every public reply in v1. Never reply twice: per-mention reply claim, same pattern as `wa_reply_claims`.
- Where we cannot post via API, the button is "Copy reply and open" (Amazon, Reddit, X, marketplaces).

## 4. Data model (new)

- `orm_sources`: one row per source: enabled, schedule, cursor/last seen id, last run status, daily budget (Apify)
- `orm_keywords`: brand terms (PROMUNCH, promunch.snacks, product names, common misspellings like "pro munch", "promanch"), competitor terms, exclusions
- `orm_mentions`: source, external_id (unique with source), url, author, author_followers, text, rating, posted_at, is_owned_channel, parent_id (thread), media; enrichment columns (sentiment, topics[], intent, urgency, product, language, summary); links (contact_id, shopify_order_id, ticket_id, influencer_id); workflow (status new/seen/replied/ignored/escalated, assignee, reply_text, replied_at, replied_by)
- `orm_reply_claims`: atomic one-reply-per-mention claim
- `orm_alert_rules` + `orm_alert_log`: what pinged whom, exactly once
- `orm_daily_stats`: nightly rollup per source (count, avg rating, sentiment mix) so charts stay fast

## 5. Screens (Reputation area, redesign style)

1. **Feed**: every mention, newest first. Filters: source, sentiment, urgency, status, product, date. Row = source icon, author, text, sentiment dot, rating, time. Phone: two-line rows.
2. **Mention drawer**: full text + thread, author info (followers, past mentions), customer match, AI summary, reply box with AI draft, actions (reply, open, ticket, mark handled, assign, send to Influencers).
3. **Overview**: rating per channel (Amazon, website, Google), sentiment trend, volume by source, top topics, unanswered count, median response time, share of voice vs chosen competitors.
4. **Settings**: sources on/off + connect, keywords, alert rules and recipients, Apify daily budget.

Access: new area in `src/lib/access.ts` so agents can be given Reputation only.

## 6. Build phases

| Phase | What | Needs from owner | Effort |
|---|---|---|---|
| **1. Foundation + easy sources** | tables, enrichment, Feed + drawer, Judge.me, YouTube, Reddit, news/Google Alerts, Amazon reviews (Apify) | Judge.me API token, YouTube channel access, Apify key | ~1.5 weeks |
| **2. Alerts + replies** | WhatsApp alerts, spike detection, digest line, AI reply drafts, posting to Judge.me + YouTube, ticket + Influencers routing | Alert recipients | ~1 week |
| **3. Instagram + Facebook** | comments, mentions, tags, story mentions via the existing `ig-webhook`, replies via API, hashtag listening via Apify | **Meta app review** (shared with IG DMs) | ~1 week after approval |
| **4. Wider web** | Google Business reviews, X, Flipkart/Blinkit/Zepto/Instamart/BigBasket ratings, competitor share of voice | Google Business API approval, competitor list | ~1 week |
| **5. Overview + reports** | trend charts, weekly summary, response-time tracking | none | ~4 days |

Phase 1 + 2 work **before** Meta approval and already cover website, Amazon, YouTube, Reddit and news.

## 7. Monthly running cost (estimate)

- Apify (Amazon reviews daily, X + hashtags + marketplaces): roughly $20 to $50, capped by a daily budget in Settings
- OpenAI enrichment + reply drafts: a few hundred mentions a month, under $10
- YouTube, Reddit, Google Alerts, Judge.me, Meta, Google Business APIs: free

## 8. Risks

- **Meta app review** gates all Instagram/Facebook comment features (same blocker as IG DMs; submit once for both).
- **Scrapers break** when sites change; collectors must fail soft and show "source paused" in Settings, not crash.
- **False alarms** from "stale" in an unrelated sense or Hinglish sarcasm: start alerts conservative, tune keywords from real data.
- **Public reply mistakes are permanent**: human approval on every reply in v1, KB-grounded drafts, no auto-posting.
- **Google Business API access** can take weeks; apply early.
- **Brand name collisions** ("pro munch" used generically): exclusion keywords + AI relevance check before a mention enters the feed.

## 9. Decisions needed from the owner

1. Which sources first (recommended: Judge.me, Amazon, YouTube, Reddit, news, then Instagram as soon as Meta approves).
2. Who gets reputation alerts on WhatsApp (same as support alerts, or a different list).
3. Competitors to track for share of voice (or none for now).
4. Monthly Apify budget cap.
5. Ever allow auto-replies to simple praise ("thank you!") later, or always human-approved.
