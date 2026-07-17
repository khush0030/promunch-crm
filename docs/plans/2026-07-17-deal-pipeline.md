# Deal pipeline — AI-scanned deal tracker over hello@promunch.in

**Date:** 2026-07-17 · **Status:** DEPLOYED (migrations applied via `supabase db query --linked`, deal-scan + gmail-webhook + gmail-poll deployed, `vercel --prod` shipped; backfill running)

Post-launch amendments (same day):
- **HoReCa is the priority segment**: kind `hotel_hospitality` = HoReCa (hotels, resorts, restaurants, cafes, caterers, cloud kitchens, institutional food service); UI label "HoReCa", first KPI, sorted to top of board columns and needs-action list. Influencers tracked, secondary.
- **Event-driven sync**: gmail-webhook (Pub/Sub push) and gmail-poll nudge deal-scan via `_shared/deal-scan-trigger.ts` whenever new mail is processed, so the pipeline syncs on arrival; the 30-min cron remains as sweep + follow-up ager. deal-scan takes a 3-min soft lock (`deal_scan_state.running_since`, migration 20260717160000) so concurrent nudges cannot double-create deals.
- **Prompt lesson**: gpt-4o-mini initially returned `is_deal=false` for real deals while filling every other field correctly — it read "deal" as "agreement reached". Fixed by defining is_deal bluntly at the top of the field list ("conversation worth tracking, NOT agreement reached"). If extraction quality regresses, look there first.

## What it is

A `/dashboard/deals` page that tracks every commercial conversation flowing through
`hello@promunch.in` — B2B supply (hotels, corporates, retail/q-commerce, distributors),
influencer collaborations, brand partnerships, and expo participation — as a stage
pipeline with automatic follow-up flags.

Grounded in a real scan of the mailbox (2026-07-17, 258 inbound emails since 20 May):
hotel chains (Oberoi, Leela, St Regis, Novotel/Accor), corporate pantry (Brookfield,
CBRE K Raheja, Sodexo, Greams Pantry), q-commerce (Instamart, FirstClub, Snackit,
Gofig), influencer collabs (FITREAK, KnoxFit, Harjus Singh), HYPD ops, Gifts World
Expo, plus a heavy tail of vendor pitches (stall fabricators, agencies, SaaS).

Preview mock shown to the owner: claude.ai artifact "Deals — PROMUNCH CRM preview".

## Architecture

```
pg_cron (*/30) ──► deal-scan edge fn ──► Gmail API (threads.list / threads.get, READ-ONLY)
                        │                     reuses _shared/gmail.ts OAuth
                        ├──► OpenAI (gpt-4o-mini, _shared/deal-extract.ts) per new thread
                        └──► deals / deal_emails / deal_scan_state
                                   ▲
/dashboard/deals ◄── /api/deals* ──┘   (Next.js, service role, middleware-gated)
```

- **deal-scan** (`promunch-email-agent/supabase/functions/deal-scan/`): backfill mode
  pages through the last 365d of threads (12 threads/run, cursor in
  `deal_scan_state.backfill_page_token`); incremental mode picks up threads newer than
  the watermark with a 6h overlap. Sends nothing — §0 not in play.
- **Idempotency:** every scanned message is recorded in `deal_emails`
  (unique `gmail_message_id`); `deal_id null` = judged not-a-deal. Rescans no-op.
- **Pure logic** in `_shared/deal-pipeline.ts` (stage ratchet, noise filter, follow-up
  rules, dormancy) — tested by `_shared/deal-pipeline_test.ts` (15 tests, no secrets).
- **Stage ratchet:** forward-only merges; AI may close (won/lost); any signal revives
  dormant; a human stage edit sets `manual_stage_override` and the scanner never moves
  stage again.
- **Follow-up rules** (priority order): inbound waiting ≥2d → samples sent ≥7d silent →
  outbound unanswered ≥5d → AI flag. Deals silent 45d+ auto-park as dormant.
- **Kinds:** hotel_hospitality, corporate_pantry_gifting, retail_qcommerce,
  distribution_wholesale, influencer_collab, brand_partnership, events_expo,
  vendor_pitch (kept off the default board), other.

## Ops checklist (in order)

1. **Migration** (Supabase dashboard SQL editor, manual):
   `promunch-email-agent/supabase/migrations/20260717130000_deal_pipeline.sql`
   — creates tables + schedules `deal-scan-every-30min` (uses Vault `service_role_key`).
2. **Deploy the function:** `cd promunch-email-agent && supabase functions deploy deal-scan`
3. **Optional secrets** (defaults are fine): `DEAL_SCAN_MODEL`, `DEAL_SCAN_BACKFILL_DAYS`,
   `DEAL_SCAN_MAX_THREADS`. Uses existing `OPENAI_API_KEY`, Gmail OAuth, `MAILBOX_EMAIL`.
4. **Deploy the app:** `vercel --prod`
5. First runs backfill ~12 threads each; a year of mail finishes in a day of cron ticks.
   "Scan inbox now" on the page forces a run.

## Monitoring

- Scan errors: `deal_scan_state.last_error`, `connector_events` (connector `deal_scan`,
  Slack ping on error, 60-min throttle).
- Progress: `select backfill_done, threads_scanned, last_run_at from deal_scan_state;`
