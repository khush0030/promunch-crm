# Brevo integration plan

**Date:** 2026-09-17
**Status:** All phases BUILT 2026-09-17 (build green, 472 tests). Not committed, not deployed, migration not applied. Go-live checklist at the bottom.
**Decision:** Brevo is the email marketing tool (Option A). The CRM covers Brevo's campaign, automation/event, webhook, coupon, account-health, SMS and reporting functions, so the team can work from the dashboard.

## Decisions (Khush, 2026-09-17)

| Question | Answer |
|---|---|
| Contacts hold | **Lifted, test list first.** Sync targets a Brevo list "PROMUNCH TEST" until the owner flips the target to the real audience |
| Other channels | **SMS fully built but switched off** until India DLT sender ID + templates are registered. **Brevo WhatsApp is report-only**, never sends (Meta stays the only WhatsApp sender) |
| Sending from the dashboard | **Full send with guards**: owner-only, test send required first, confirm dialog with recipient count, one-send claim per campaign |

## Live account probe (2026-09-17, read-only)

- Plan: Marketing Standard (paid), 8,868 send credits, period Aug 18 to Sep 18. Timezone Asia/Kolkata.
- Senders: `hello@promunch.in` (PROMUNCH), `admin@promunch.in`. Domain `promunch.in` authenticated + verified (GoDaddy DNS).
- Lists: "Rakhi Hamper Campaign" (582), "Your first list" (114). Folders: "Rathore", "Your first folder". Segment: "Rakhi".
- Campaigns: 7 email campaigns, all Rakhi Hamper (3 sent, 1 cancelled mid-send, 3 drafts). No SMS campaigns.
- Templates: 4 (incl. Brevo's default unsubscribe follow-up).
- Webhooks: none. Events: none. Transactional email last 30 days: 0.
- **Blocked at Brevo:** eCommerce section not activated (products, orders, revenue attribution fail with `permission_denied`); coupon collections return `Forbidden` (eCommerce/plan); WhatsApp campaigns "plan not eligible".

## Existing CRM email (must not collide)

- The in-house engine (Resend) is live for **abandoned-cart only** (`flows` "Abandoned cart", pg_cron `email-flow-tick` every 15 min, 101 sends Aug 17 to Sep 17). Nothing else in it sends.
- `suppressions` is the CRM do-not-email list checked by that engine.

## Who sends what (no-duplicate rule)

| Message | Sender | Notes |
|---|---|---|
| Email newsletters / broadcasts | Brevo | Created and sent from the dashboard or Brevo |
| Welcome, post-purchase, win-back email | Brevo automations | Triggered by CRM events |
| Abandoned-cart email | CRM (Resend), unchanged | No Brevo cart automation. Moving it means pausing the `flows` row first |
| Marketing SMS | Brevo | Off until DLT registration |
| WhatsApp (all) | Meta via CRM edge functions | Brevo WhatsApp report-only |
| Transactional email (invites, B2B outreach) | Resend, unchanged | |

## Pages (Marketing hub)

`/dashboard/marketing/email` becomes a Brevo hub with tabs:

| Tab | Contents |
|---|---|
| Campaigns | List (built), create/edit, test send, schedule, send, suspend/archive/delete |
| Campaign detail `/dashboard/marketing/email/[id]` | Headline stats, link clicks, devices, email domains, A/B result, recipients export, email the report |
| Reports | 90-day campaign trends, transactional email daily + aggregate, SMS daily + aggregate, WhatsApp event report (plan-gated notice), revenue attribution (after eCommerce) |
| Automations | Event catalogue + recent events, order/product sync status, transactional templates (list, preview, test send) |
| Audience | Lists, folders, segments, attributes, sync target (test vs real), import/export processes |
| Coupons | Collections, remaining codes, add codes |
| SMS | SMS campaigns (create/test/schedule/send, guarded), transactional SMS switch |
| Health | Plan + credits, senders, domains + DNS config, webhooks (registered vs expected, register button), background processes, activity log, blocked domains/contacts |

## Phases

### Phase 1: read-only foundations (safe, no writes to Brevo or customers)
1. Expand `src/lib/brevo.ts` into a typed client (GET/POST/PUT/DELETE, 429 backoff, typed errors that surface Brevo's `code`, including plan-gated errors as a distinct `BrevoPlanError`).
2. Health tab + `GET /api/brevo/health`: account plan/credits, senders, domains, webhooks, processes.
3. Campaign detail page + `GET /api/brevo/campaigns/[id]`: `globalStats`, `linksStats`, `statsByDevice`, `statsByDomain`, recipients lists, A/B result when `abTesting`.
4. Reports tab + `GET /api/brevo/reports`: campaign trend (from campaign list), `smtp/statistics/reports` + `aggregatedReport`, `transactionalSMS/statistics/*`, `whatsapp/statistics/events` (plan-gated notice).

### Phase 2: webhooks (Brevo to CRM)
1. Migration `brevo_events` ledger (message id, event, email, campaign id, payload, received_at; unique on provider event key so redelivery is idempotent).
2. `POST /api/webhooks/brevo?token=...`: constant-time check against `BREVO_WEBHOOK_SECRET`, fail closed, insert ledger row first.
3. `unsubscribed`, `spam`, `hardBounce`, `blocked` → upsert `suppressions` (reason `brevo_*`). Suppression only ever gets stricter, so this is safe before the contact sync.
4. Health tab "Register webhooks" button (owner-only): creates the marketing + transactional webhooks via `POST /webhooks` pointing at the route, shows registered vs expected.

### Phase 3: audience (test list first)
1. Lists/folders/segments/attributes read + create list, create attribute.
2. Migration `brevo_sync_state` (target `test` | `live`, test list id, cursor, last run, counts). Target flips only by owner.
3. Sync `contacts` (email not null, not anonymized, not suppressed) with attributes `FIRSTNAME`, `LASTNAME`, `ORDER_COUNT`, `TOTAL_SPENT`, `FIRST_ORDER_DATE`, `LAST_ORDER_DATE`, `RFM_SEGMENT`, `CITY`, `CHANNEL`; creator seeds excluded. No `SMS` attribute (Brevo rejects duplicate phones). In `test` mode only allowlisted test addresses sync.
4. CRM `suppressions` → Brevo `emailBlacklisted: true` mirror.
5. Daily Vercel cron `/api/cron/brevo-sync` + "Sync now" button. Import/export via `/contacts/import` + processes polling.

### Phase 4: email campaigns (create and send, guarded)
1. Create/update campaign (sender, subject, preview text, HTML or template, lists/segments, exclusion lists, UTM, scheduled time), delete draft, suspend/archive, image upload to gallery.
2. Test send (`sendTest`) to test addresses; records `test_sent_at` in `brevo_campaign_sends`.
3. Send now / schedule: owner-only; requires a test send after the last edit; confirm dialog shows recipient count from the list sizes; atomic insert into `brevo_campaign_sends` (unique campaign id) before calling `sendNow`. A second click or second tab gets a conflict, never a second send.
4. Export recipients, email the report.

### Phase 5: automations and events
1. **Changed during build:** events are NOT sent from `shopify-webhook` (editing the order/WhatsApp flow needs approval under AGENTS.md §4.2). Instead `/api/cron/brevo-events` (pg_cron every 10 min, `3-59/10`) reads `shopify_orders` from the last 3 days: `order_placed`, `order_fulfilled`, `order_cancelled`. Claim table `brevo_event_claims (order_id, event_name)` insert-first; failures are not retried. Email = order email, else the CRM contact with the same phone. Live mode needs marketing consent. Skip creator seeds and email-less orders. Never `cart_abandoned` (CRM owns cart). Off until `events_enabled`.
2. In test mode, events only post for test addresses.
3. Automations tab: event catalogue, recent events (`GET /events`), transactional templates (list, create/update, preview, send test).
4. **Needs Khush:** activate Brevo eCommerce (`POST /ecommerce/activate`) then sync Shopify products/categories (batch) + orders (batch) for product blocks and revenue attribution.

### Phase 6: coupons
1. Coupons tab: collections (create, update default code/expiry), remaining count, add codes.
2. Codes come from Shopify: generate unique single-use discount codes (needs `write_discounts` on the Admin token) then push to the collection.
3. **Blocked** until Brevo returns non-Forbidden for `/couponCollections` (eCommerce activation / plan).

### Phase 7: other channels
1. SMS campaigns: list, create/update, test SMS, schedule, send now with the same guard as email, recipients export, report. Transactional SMS behind `brevo_sms_enabled=false`.
2. Brevo WhatsApp: read campaigns/templates/events for reporting only; plan-gated notice today. No send routes exist.

## Out of scope unless Khush adds them

Brevo Sales CRM (companies/deals/tasks/notes/files: the CRM already has deals), Conversations (live chat), Loyalty, Payments, Wallet passes, Custom objects, Master/sub-accounts, user management, external feeds, inbound parsing, dedicated IPs.

## Secrets
- `app_secrets` / Vercel: `BREVO_API_KEY` (saved), `BREVO_WEBHOOK_SECRET`.
- Supabase function secrets: `BREVO_API_KEY` (Phase 5).

## Migrations (hand-applied)
`brevo_events`, `brevo_sync_state`, `brevo_campaign_sends`, `brevo_event_claims`.

## Live test per phase
1. Health shows plan/credits/domain; detail page matches Brevo UI for the Aug 20 Rakhi send; reports load.
2. Register webhook, unsubscribe a test address in Brevo, see `brevo_events` + `suppressions` rows; redeliver, no duplicate.
3. Sync in test mode puts only test addresses in "PROMUNCH TEST".
4. Draft to test list, test send to Khush, send to test list; double-click send returns conflict.
5. Test order with Khush's email shows `order_placed` in Brevo; redelivered webhook, no second event.
6. Coupon collection created and a code lands in a test campaign (after activation).
7. SMS test to Khush's number (after DLT).

## Built (2026-09-17)

| Area | Where |
|---|---|
| Client, errors, plan-gated sections | `src/lib/brevo.ts` |
| Health (plan, credits, senders, DNS, webhooks, jobs, blocklist) | `/api/brevo/health`, `/api/brevo/webhooks`, Health tab |
| Campaign detail (funnel, lists, links, devices, browsers, inbox providers, A/B) | `/api/brevo/campaigns/[id]`, `/dashboard/marketing/email/[id]` |
| Campaign create/edit/delete, test, send/schedule with guard + claim, suspend, archive, duplicate, export recipients, email report, release lock | `/api/brevo/campaigns`, `.../[id]/editor`, `.../[id]/actions`, `src/lib/brevo-campaign-actions.ts`, `src/lib/brevo-send-guard.ts` |
| Reports (campaign trend, transactional, SMS, WhatsApp report-only, orders from email, Brevo revenue attribution, webhook engagement) | `/api/brevo/reports`, Reports tab |
| Webhooks (ledger, suppression sync, register) | `/api/webhooks/brevo`, `/api/brevo/webhooks` |
| Audience (lists, folders, segments, attributes, consent-gated sync, blocklist mirror, dry run) | `/api/brevo/audience`, `.../sync`, `/api/cron/brevo-sync` (daily 02:30 IST), `src/lib/brevo-sync.ts`, `src/lib/brevo-audience.ts` |
| Automations (order events, dry run, templates CRUD + test) | `/api/cron/brevo-events`, `/api/brevo/automations`, `/api/brevo/templates` |
| Coupons (collections, add codes, eCommerce activation) | `/api/brevo/coupons` |
| SMS (campaign CRUD + same guard, transactional test, off switch) | `/api/brevo/sms`, `.../[id]`, `.../[id]/actions` |
| Settings (test/live target, test addresses, events, SMS) | `/api/brevo/settings` |

Live dry-run numbers (2026-09-17): live sync would send **625** consented contacts (669 skipped no consent, 25 unsubscribed, 8 suppressed); test sync 1 address. Order events over the last 3 days: 6 orders, 0 eligible (3 no email, 2 no consent).

## Go-live checklist (in order)

1. Apply `promunch-email-agent/supabase/migrations/20260917100000_brevo_integration.sql` (tables + `brevo-events` pg_cron).
2. Commit + `vercel --prod`.
3. Health tab → Register webhooks (owner). Unsubscribe a test address in Brevo → `brevo_events` + `suppressions` rows.
4. Audience → Preview test sync → Sync now (test). Check "PROMUNCH TEST" in Brevo.
5. New campaign to PROMUNCH TEST → Send test → Send now. Double-click Send: second attempt must be refused.
6. Automations → Dry run → turn events on (test mode) → place a test order with a test address → `order_placed` in Brevo.
7. Owner decides: Switch to live audience (Audience tab) → Sync now (live) → events on for live.
8. Coupons: Turn on eCommerce (owner) → create a collection → add codes that exist in Shopify.
9. SMS: only after DLT sender ID + templates + Brevo SMS credits → Turn SMS on.
