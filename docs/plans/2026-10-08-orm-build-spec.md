# ORM build spec (v1, free tier)

Contract for the Reputation feature. Plan + rationale: [2026-10-08-orm-brand-monitoring.md](2026-10-08-orm-brand-monitoring.md). Schema: `supabase/migrations/20261008200000_orm.sql` (source of truth for every column name below).

Owner decisions (Oct 8 2026): free-tier version (no paid scraping beyond the Apify free credit), alerts go to the support alert list, no competitor tracking yet, every public reply is human-approved, posting replies from the CRM is a later phase (v1 = "copy reply and open").

## 1. Flow

```
pg_cron */15 → edge orm-tick
  1. COLLECT   every orm_sources row with enabled and next_run_at <= now:
               adapter(source) → upsert orm_mentions on (source, external_id) ignoreDuplicates
               → update the source row (cursor, last_*, next_run_at = now + every_minutes)
  2. ENRICH    up to 40 mentions with enriched_at is null and enrich_attempts < 3,
               batches of 20 per OpenAI call → write enrichment columns
  3. ALERT     (orm_settings.alerts_enabled) newly enriched relevant mentions that match a rule
               → claim orm_alert_log (mention_id, kind) → one WhatsApp per mention
POST orm-tick {source:"<key>"} (internal) = run COLLECT for that one source now + ENRICH, ignoring next_run_at.
```

Each step is wrapped so one failing source never stops the others (same `step()` pattern as influencer-tick). A source with no credentials sets `last_status='not_connected'` and is skipped, never an error alert.

## 2. Collectors (edge, `_shared/orm-sources.ts`)

Every adapter returns `MentionInput[]` (columns of orm_mentions minus enrichment/workflow) and a new cursor. Keep each pure where possible (`normalize*` functions unit-tested in `_shared/orm-sources_test.ts` with fixture JSON).

| key | Credentials (app_secrets via `_shared/app-secrets.ts`, env fallback) | Fetch | external_id | is_owned |
|---|---|---|---|---|
| judgeme | `JUDGEME_API_TOKEN`, `JUDGEME_SHOP_DOMAIN` (default `a1e4f4-2.myshopify.com`) | `GET https://judge.me/api/v1/reviews?api_token&shop_domain&per_page=100&page=N`, newest first, stop at cursor.last_id | review id | true |
| youtube | `YOUTUBE_API_KEY`; config.channel_id | (a) our videos: channel uploads playlist → last 20 videos → `commentThreads.list` per video (1 unit each); (b) mentions: `search.list q=PROMUNCH type=video order=date publishedAfter=cursor` once per run (100 units); also comments on those videos are NOT fetched in v1 | comment id / `video:<id>` | (a) true, (b) false |
| reddit | none required (public `https://www.reddit.com/search.json?q=promunch&sort=new&limit=50` with a descriptive User-Agent); if `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET` exist use OAuth app-only token instead | posts + `t1` comment search | fullname (t3_/t1_) | false |
| rss | none; config.feeds = Google Alerts RSS URLs (Atom) | fetch each feed, parse `<entry>` (title, link → unwrap google.com/url?url=, published, content) | sha1(link) | false |
| amazon | `APIFY_TOKEN`; settings.amazon_asins, amazon_reviews_per_asin | Apify actor (choose a maintained Amazon reviews actor; record id in code), country amazon.in, sort recent. **Budget guard**: before the run estimate cost from the actor's pricing (or a conservative $0.002/review); if `apify_spent_usd + estimate > apify_monthly_budget_usd` → `last_status='budget'`, skip. After the run add the run's real `usageTotalUsd` to `apify_spent_usd` (reset when `apify_month` ≠ current IST month) | review id | true |
| instagram | (phase 3, Meta app review) | not implemented in v1: the adapter returns `not_connected` | | |

Relevance pre-filter before insert: keep a mention if its title/body contains any `orm_settings.keywords` (case-insensitive) OR it is on an owned surface (judgeme, amazon, our YouTube videos). Store excluded-keyword hits with `relevant=false`.

Never store more than 4000 chars of body; strip HTML.

## 3. Enrichment (edge, `_shared/orm-enrich.ts`)

Model `gpt-4o-mini` (env `ORM_AI_MODEL` override), JSON schema output, one call per batch of ≤20, temperature 0. Input per item: source, rating, title, body (≤1500 chars), author followers. Output per item: `relevant` (bool), `sentiment` (-2..2), `summary` (≤140 chars, English), `topics` (subset of: taste, crunch, flavour, price, value, protein, ingredients, packaging, delivery, freshness, quality, foreign_object, allergy, availability, customer_service, competitor, other), `intent`, `urgency`, `product` (only PROMUNCH lines: Roasted Edamame + flavour, Soya Crunchies, Chips, Sticks, or null), `language`, `order_ref` (order number like #2083 if present). Pure prompt/parse helpers unit-tested.

Hard rule (code, not model): if body matches the food-safety regex (insect|worm|fungus|fungal|mould|mold|stale|rotten|smell|vomit|sick|food poisoning|allerg|hospital|plastic piece|hair in|keeda|kida|ganda) set urgency='critical' regardless of the model.

On failure: increment enrich_attempts, store enrich_error; after 3 attempts leave enriched_at null and stop retrying (feed shows it un-scored).

Customer match (best effort): if order_ref present, look up `shopify_orders` by order number/name and set contact_id from contacts by phone/email when found.

## 4. Alerts (edge)

Rules (only for relevant mentions, posted within the last 7 days, so a first backfill never floods):
- `critical`: urgency = critical
- `low_rating`: rating ≤ 2
- `negative`: sentiment = -2 and is_owned = false and author_followers ≥ 5000

Claim `orm_alert_log (mention_id, kind)` insert-first (23505 = already handled). One mention sends at most one WhatsApp even if it matches several rules (send for the first matching kind in the order above, log the others as `skipped`). Send via `wa-send` template `ops_ticket_alert` (same as support ticket pings; utility, approved) to each recipient: `orm_settings.alert_wa_ids` if non-empty else `SUPPORT_ALERT_WA_IDS` env. Vars: 1 = "Reputation alert", 2 = source label, 3 = rating/sentiment line, 4 = author, 5 = summary + " " + dashboard link `${SITE_APP_URL}/dashboard/reputation?m=<id>` (≤300 chars). `sent_by` = `orm_alert:<mention_id>:<wa_id>` (ledger marker; check `wa_messages` for it before sending, §0 never twice). Max 10 alerts per tick; the rest wait for the next tick.

## 5. Cron

`promunch-email-agent/supabase/migrations/20261008200100_orm_tick_cron.sql`: `orm-tick` every 15 min, same Vault `service_role_key` pattern as `20261007120100_influencer_tick_cron.sql`. Apply AFTER the function is deployed.

## 6. Next.js API (session-gated, mapped in `src/lib/access.ts` to a new `reputation` module)

| Route | Method | Body / query | Returns |
|---|---|---|---|
| `/api/orm/mentions` | GET | `status`, `source`, `sentiment` (neg/neu/pos), `urgency`, `q`, `owned`, `before` (cursor = posted_at), `limit` ≤100. Excludes `relevant=false` unless `include_irrelevant=1` | `{ mentions: OrmMention[], next_before }` |
| `/api/orm/mentions/[id]` | GET | | `{ mention, alerts: OrmAlert[] }` |
| `/api/orm/mentions/[id]` | PATCH | `status`, `assignee`, `note`, `reply_text` (setting status='replied' stamps replied_at/by) | `{ mention }` |
| `/api/orm/mentions/[id]/draft` | POST | | AI reply draft (Master KB via `getFullKnowledgeBase`, brand rules: PROMUNCH caps, no em dashes, no medical claims, apologise + move complaints to DM/WhatsApp `hello@promunch.in`, never argue, ≤ 400 chars, match the platform tone); saves `reply_draft`; `{ draft }` |
| `/api/orm/summary` | GET | `days` (7/30/90, default 30) | `{ total, new_count, unanswered_negative, by_source:[{key,label,count,avg_rating}], sentiment:{neg,neu,pos}, top_topics:[{topic,count}], trend:[{day,neg,neu,pos}], sources:[status rows] }` |
| `/api/orm/settings` | GET | | `{ settings, sources }` |
| `/api/orm/settings` | PATCH | admin only (`requireAdmin`): settings fields + `sources: {key: {enabled, config, every_minutes}}` | `{ settings, sources }` |
| `/api/orm/sources/[key]/run` | POST | admin only; invokes edge `orm-tick` `{source:key}` with the service key | edge result |

Secrets UI: add `JUDGEME_API_TOKEN`, `YOUTUBE_API_KEY`, `APIFY_TOKEN` (if not already), `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` to the owner Settings → API keys provider list (`src/lib/secrets.ts`).

## 7. Dashboard: `/dashboard/reputation`

New sidebar item **Reputation** under Marketing (`src/components/shell/nav.ts`), access module `reputation` (label "Reputation", hint "Reviews, comments and mentions across the web"). Current (pre-redesign) styling conventions of main: `pm-` components, CSS module, React Query. Calm UI rules: status = coloured text + small dot, no filled blocks, hairlines, readable subtext, check 390px.

Tabs:
1. **Feed** (default): filter bar (status chips New / Needs reply / All / Handled, source select, sentiment select, search). Rows: source label, author (+followers), stars if rating, 2-line text, AI summary on hover/second line, sentiment dot + topics as dot+text, urgency mark for critical/high, relative time. Click → drawer.
2. Drawer: full text, link "Open on <source>", product, customer match link, AI summary/topics, status actions (Mark seen, Ignore, Escalate → creates nothing yet, just status), Reply box: "Draft with AI" → editable text → "Copy and open" (copies, opens url, sets status replied with reply_text) . Note field.
3. **Overview**: KPIs on one hairline row (mentions, avg rating per owned source, % negative, unanswered negatives), sentiment trend (simple bars), top topics, by source.
4. **Settings** (admin): sources list with enable switch, last run status/time/count/error, "Run now"; per-source config (RSS feed URLs textarea with a "how to create a Google Alert RSS feed" hint; YouTube channel id; Amazon ASIN list prefilled suggestion = top 10 ASINs by units sold last 90 days from `amazon_order_items`); keywords + exclude keywords; alerts switch + recipients (empty = support alert list); Apify budget + spent this month.

Deep link `?m=<id>` opens the drawer (alert link).

## 8. Never-twice / safety

- Mentions dedup on (source, external_id).
- Alerts: insert-first claim per (mention_id, kind) + `wa_messages` ledger check on `sent_by`.
- No public posting in v1.
- Collectors fail soft; Apify hard budget cap; every source ships disabled, alerts ship off.
