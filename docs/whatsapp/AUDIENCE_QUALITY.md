# WhatsApp audience quality — engagement tiers + consent trail

**Status:** built 2026-08-26. Committed only. Needs migration `supabase/migrations/014_wa_engagement_tiers_and_consent.sql` applied by hand, then `vercel --prod`.

## The problem, in production numbers

| Measured 2026-08-26 | Value |
|---|---|
| `wa_contacts` rows | 1,413 |
| Flagged `opted_in = true` | 1,410 |
| People who have EVER sent us an inbound WhatsApp message | 82 |
| Total inbound messages, all time | 347 |
| Marketing template sends, last 30 days | 1,151 |
| ...of which Meta refused (#131049) | 890 (77%) |

`opted_in = true` is meaningless as a marketing signal. The list was bulk imported
from Shopify order phones. Meta hands every WhatsApp user a personal marketing
cap across all businesses and spends it on people it predicts will engage, so a
cold list gets refused at the door. A blocked send still counts against our
number's quality rating, so blasting the whole list is actively harmful.

## Engagement tiers

Every `wa_contacts` row carries exactly one `tier:*` tag. First match wins:

| Tier | Definition | Count on 2026-08-26 |
|---|---|---|
| `tier:engaged` | Sent us an inbound message in the last 90 days | **73** (5.2%) |
| `tier:reachable` | Has messaged us at some point, but not in 90 days | **6** (0.4%) |
| `tier:subscribed` | Explicit opt-in through the storefront popup (`consent_verified_at` set), has not messaged us yet | **0** (0.0%) |
| `tier:imported` | Phone from a Shopify order or CRM/CSV import, never messaged us | **998** (70.6%) |
| `tier:suppressed` | Opted out (`opted_in = false`), or Meta refused 3+ marketing sends in 90 days and they never replied | **336** (23.8%) |

Thresholds were picked from the real distribution, not by feel:

- **90 days for `engaged`.** 82 contacts have ever replied; 76 of those replied
  within 90 days, 63 within 60, 42 within 30. The 90-day line keeps the cohort
  usable while still meaning "recently alive". (73 rather than 76 land in
  `engaged` because 3 of the recent repliers are the 3 opt-outs — they typed
  STOP, so `suppressed` wins.)
- **3 blocks in 90 days for `suppressed`.** Contacts with 2+ ecosystem blocks:
  578. With 3+: 345. With 5+: 231. Three is where a pattern stops being noise;
  12 of those 345 had replied to us at some point, so they stay `reachable` and
  never get auto-suppressed.
- The Meta-block check deliberately sits **above** `subscribed`. Somebody who
  opted in but whose last three marketing messages were all refused is not
  reachable today, and calling them "subscribed" would flatter the number. Their
  consent record is untouched, so they climb out the moment they reply.

### Why a tag and not a column

`wa-campaign-send` (edge function) resolves a campaign audience **only** through
`audience_filter.tags` → `wa_contacts.tags` overlap. Persisting the tier as a tag
in the existing `tags` array (same namespace convention as `rfm:*`) makes
engagement targetable with **zero change to the send path**. Tag overlap is a
union, which is exactly what a tier ladder wants: `["tier:engaged",
"tier:reachable"]` means "either".

`recompute_wa_engagement_tags()` strips the old `tier:*` tag, keeps every other
tag, appends the fresh one — same shape as `recompute_wa_rfm_tags()`.

## Moving parts

| Piece | Where |
|---|---|
| Tier definitions, presets, warning copy | `src/lib/wa-engagement.ts` |
| Live classification view | `wa_contact_engagement` (migration 014) |
| Tag writer | `recompute_wa_engagement_tags()` (migration 014) |
| Scoreboard query | `wa_audience_health()` (migration 014) |
| Health API | `GET /api/whatsapp/engagement` |
| Manual refresh | `POST /api/whatsapp/engagement/refresh` |
| Nightly refresh | `GET /api/cron/wa-engagement-tiers` (Vercel cron, 20:30 UTC daily) |
| Audience sizing + makeup | `GET /api/whatsapp/audience?tags=…` → `{ count, byTier }` |
| Health panel | `src/components/whatsapp/AudienceHealthPanel.tsx`, rendered at the top of the Campaigns tab |
| Audience picker | `CampaignModal` in `src/components/whatsapp/CampaignsView.tsx` |

Every route degrades honestly if migration 014 has not been applied: the panel
says the tiering is not switched on and names the migration file, rather than
showing a fabricated number.

## What staff see

The Campaigns tab opens with an **Audience quality** panel: total contacts,
genuinely engaged, 30-day marketing delivery rate, suppressed count, a stacked
tier bar, and the two numbers that justify the whole exercise side by side —
delivery rate to people who have replied to us versus people who never have.

In the campaign builder, **By engagement** is the first audience mode and
**Engaged only** is the default for every new marketing campaign. Presets:

1. Engaged only (default)
2. Engaged + consented (`engaged` ∪ `reachable` ∪ `subscribed`)
3. Everyone except suppressed (adds `imported`)
4. Everyone opted-in (no tag filter)

Picking an audience with a cold share raises a plain-language warning built from
real counts, for example: *"1,331 of these 1,410 contacts have never messaged us.
Meta blocked 9 in 10 marketing messages to contacts like these over the last 30
days. 333 are suppressed."* The "9 in 10" is measured from `wa_messages` over the
last 30 days; when there are no recent sends to measure, that sentence is left
out rather than invented.

## Consent capture

The storefront popup (`WhatsApp → Growth`, served by `/api/public/wa-embed`) is
the only path that produces a genuine opt-in. It now records a full audit trail:

- `wa_contacts.consent_source` — `website_popup` or `website_widget`
- `wa_contacts.consent_verified_at` — timestamp
- `wa_contacts.consent_text` — **new**, the exact wording the person agreed to
- `wa_consent_events` — **new**, append-only: wa_id, contact, action, source,
  wording, page URL, user agent, salted IP hash, timestamp

The wording lives in one place (`POPUP_CONSENT_TEXT` in `src/lib/wa-engagement.ts`),
is rendered into the popup markup and posted back with the submission, so the
stored record is the sentence that visitor actually read. The compact popup
layout previously rendered no consent line at all; it does now. Opt-ins are
tagged `tier:subscribed` at capture time so they are targetable before the
nightly refresh runs.

`import-contacts` and `import-csv` now stamp `tier:imported` at insert, so an
uploaded phone list can never be mistaken for an engaged audience.

## Known gaps (need work outside `src/`)

1. **The send engine does not exclude suppressed contacts.** `wa-campaign-send`
   filters on `opted_in = true` plus tag overlap, and suppressed contacts are
   still `opted_in = true` in the database. An "Everyone opted-in" campaign
   still reaches them. A one-line change in the edge function
   (`.not("tags", "cs", '{"tier:suppressed"}')`) would make suppression binding
   rather than advisory.
2. **Journeys are unfiltered.** Review, replenishment and abandoned-cart asks
   fire from `wa-journey-tick` regardless of tier. Most of the 890 refused sends
   in the last 30 days are journey sends, not campaigns.
3. **Tier refresh runs on the Vercel daily cron**, which is fine for tiering but
   means a contact who replies today is not marked engaged until tomorrow. A
   pg_cron entry alongside `wa-rfm-tick` would be the tidier home.
