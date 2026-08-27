# PROMUNCH CRM — System Architecture

> The single high-level map of the whole platform. If you are an AI agent (or human) about to change anything, read this first, then follow [AI_CHANGE_PLAYBOOK.md](AI_CHANGE_PLAYBOOK.md) for the how-to recipes. Canonical behavioral rules live in [AGENTS.md](../../AGENTS.md) and must always win over this doc.
>
> Last full audit: 2026-07-18 (see [docs/audits/2026-07-18-production-hardening-audit.md](../audits/2026-07-18-production-hardening-audit.md)).

## 1. The 30-second picture

PROMUNCH CRM is **two deployables sharing one Supabase database**:

```
                    ┌─────────────────────────────────────────────┐
                    │                 Supabase                    │
                    │  Postgres (~70 tables) + Auth + pg_cron     │
                    │  + Vault (cron bearer) + Storage (WA media) │
                    └───────▲──────────────────────────▲──────────┘
                            │                          │
        ┌───────────────────┴────────┐   ┌─────────────┴──────────────────┐
        │  Next.js 16 dashboard      │   │  56 Supabase Edge Functions    │
        │  src/  (Vercel)            │──▶│  promunch-email-agent/ (Deno)  │
        │  17 dashboard modules      │   │  all customer-facing sends,    │
        │  114 API route files       │   │  webhooks, cron workers        │
        │  deploy: vercel --prod     │   │  deploy: supabase functions    │
        └────────────────────────────┘   │          deploy <name>         │
                                         └───────▲────────────────────────┘
                                                 │ webhooks
     Meta WhatsApp ── Shopify ── Amazon SP-API ──┘── Gmail/PubSub ── Slack
     Resend ── OpenAI ── Google Places ── Instagram Graph
```

Rule of thumb that explains almost every design decision:

- **The Next.js app is the control plane** — screens, CRUD, triggers. It never talks to Meta/Shopify/Gmail directly for sends.
- **Edge functions are the data plane** — every customer-facing message (WhatsApp, email, IG) goes out through an edge function that takes an **atomic claim first** (never message a customer twice, `promunch-email-agent/CLAUDE.md` §0).
- **pg_cron is the heartbeat** — Vercel Hobby only allows daily crons, so all sub-daily scheduling (campaign workers, journey ticks, pollers) runs as pg_cron jobs calling edge functions with a Vault-stored bearer.

## 2. Deployables and how they ship

| Deployable | Path | Deploy command | Auto-deploy? |
|---|---|---|---|
| Next.js dashboard + API | `src/` | `vercel --prod` | **NO** — committing to main ships nothing |
| Edge functions | `promunch-email-agent/supabase/functions/` | `supabase functions deploy <name>` (from `promunch-email-agent/`) | NO |
| App-side SQL | `supabase/migrations/` (001–007) | paste into Supabase dashboard SQL editor by hand | NO |
| Edge-side SQL | `promunch-email-agent/supabase/migrations/` | same manual paste | NO |

Verify migration drift with `bash scripts/check-migrations.sh`. Full sequence: [docs/runbooks/DEPLOY_GUIDE.md](../runbooks/DEPLOY_GUIDE.md).

**Consequence:** "committed" ≠ "live". Any change report must state both. A prod bug can be caused by a stale deploy (source fixed, function never redeployed) — check deploy state before debugging code.

## 3. Dashboard modules (`src/app/dashboard/`)

All pages are client components (`"use client"`) except thin server wrappers for `integrations/` and `team/`. Auth is enforced globally by `src/middleware.ts` (Supabase session + email-domain allowlist).

| Module | What it is | Main data sources |
|---|---|---|
| `page.tsx` (home) | Command center: revenue, needs-attention, WA health, order confirmations | `/api/needs-attention`, `/api/shopify/stats`, `/api/whatsapp/health` + direct Supabase |
| `whatsapp/` | Flagship: inbox, campaigns, KB, templates, flows, analytics (tabs live in `src/components/whatsapp/`) | `/api/whatsapp/*` |
| `contacts/` (+`[id]`) | CRM list + customer-360 (orders, WA, email history) | `/api/contacts/*` |
| `campaigns/` | Email marketing campaigns (Resend) | `/api/campaigns/*` |
| `support-emails/` (+`[id]`) | Gmail-sourced support inbox with AI drafts | `/api/support-emails/*` |
| `deals/` | B2B deal pipeline Kanban from hello@ mailbox scan | `/api/deals/*` |
| `leads/` | B2B lead-gen: discovery, lists, sequences, templates, analytics | `/api/leads/*` |
| `instagram/` | IG DM inbox + collab pipeline (built, gated on Meta review) | `/api/instagram/*` |
| `amazon/` | Amazon financials / inventory / settlements / SKU economics | `/api/amazon`, `/api/amazon/costs` |
| `order-confirmations/` | WA confirmation coverage + COD-gate needs-call queue | `/api/whatsapp/confirmations`, `/api/whatsapp/cod-gate` |
| `analytics/`, `shopify-attribution/`, `audit-log/`, `flows/`, `assistant/` (Maya), `settings/`, `team/`, `integrations/` | Supporting screens | various |

Public (non-dashboard) surface: `/login`, `/r/[code]` (WA short-link redirect + click tracking).

## 4. API routes (`src/app/api/`) — auth model

`src/middleware.ts` gates **all** `/api/*` with a Supabase session **except** two fail-closed classes:

1. **Webhooks** (`/api/webhooks/shopify|resend|resend-inbound`) — provider signature required (`SHOPIFY_WEBHOOK_SECRET`, `RESEND_WEBHOOK_SECRET`). Missing secret ⇒ 401 by design, not a bug.
2. **Cron routes** (`/api/cron/*`) — `CRON_SECRET` bearer required, 401 without it.

Extra layers on top of session auth:

- `requireAdmin` (`src/lib/rbac-server.ts`) — admin-gated mutations (campaign delete, GDPR erasure, WA custom flows, COD gate, integrations poll).
- `requireSecretsOwner` (`src/lib/secrets.ts`) — Settings → API keys, locked to the owner account.
- `requireSession` (`src/lib/leads/auth.ts`) — used by leads/deals/instagram route groups.
- BotID guard (`src/lib/botid-guard.ts`) on abuse-prone mutations (anonymize, team).

Route groups: `whatsapp/` (~30 routes), `leads/` (~25), `contacts/`, `campaigns/`, `support-emails/`, `deals/`, `instagram/`, `amazon/`, `assistant/`, `settings/`, `team/`, `integrations/`, `import/`, `flows/`, `email/`, `shopify/`, `audit/`, `needs-attention/`, `webhooks/`, `cron/`.

Pattern to preserve: dashboard **triggers** heavy work by invoking an edge function (e.g. `/api/whatsapp/campaigns/[id]/send` → edge `wa-campaign-send`); it does not do the work inline.

## 5. Edge functions (`promunch-email-agent/supabase/functions/`) — 56 + `_shared/`

Grouped by role (full per-function table in the audit doc):

- **Webhook receivers** (public, signature-verified): `wa-webhook` (Meta sig), `shopify-webhook` / `shopify-wa` / `shopify-status` (Shopify HMAC), `gmail-webhook` (Pub/Sub), `ig-webhook` (Meta sig), `slack-events` / `slack-interactivity` / `shopify-slash` (Slack sig), `oauth-callback`, `voice-webhook` (Sarvam post-call callback; no provider signature exists, so authenticity is a per-call random token + attempt id checked against `voice_calls`, see `_shared/voice-webhook-verify.ts`).
- **Send chokepoints** (internal-only via `_shared/require-internal.ts`): `wa-send` (ALL WhatsApp sends), `ig-send`, `b2b-send`, `voice-call-start` (places the Sarvam outbound call), `voice-tool-wa-link` (Sarvam HTTPS tool target; sends the cart link mid-call). Every send takes an atomic claim + writes the durable ledger (`wa_messages`, `ig_messages`, `voice_calls`).
- **AI workers**: `wa-ai-reply` (KB-grounded WA support bot), `ig-ai-reply`, `ig-analyze`, `deal-scan`, `kb-embed` / `kb-ingest`.
- **Cron workers** (see §8): `wa-jobs-tick`, `wa-journey-tick`, `wa-campaign-worker`, `wa-campaign-send` (self-chaining), `gmail-poll`, `nudge-pending`, `amazon-poll`, `wa-rfm-tick`, `wa-health`, `wa-ticket-watchdog`, `shopify-daily-summary`, `shopify-catalog-sync`, `wa-weekly-summary`, `gmail-watch-renew`, `ig-jobs-tick`.
- **Manual/backfill**: `shopify-orders-backfill`, `shopify-contacts-backfill`, `shopify-creator-backfill`, `shopify-relink`, `shopify-consent-set`, `backfill-brand`, `wa-register`, `wa-meta-info`.
- **Read services for the app**: `shopify-stats`, `wa-template-create`, `cod-gate-action`.

`_shared/` (37 modules) holds all cross-function logic: `whatsapp.ts`, `openai.ts`, `shopify*.ts`, `journeys.ts`, `order-confirmation.ts`, `cod-gate.ts`, `gmail.ts`, `slack.ts`, `connector-log.ts`, `require-internal.ts`, etc. **New shared logic goes here, never copy-pasted into function folders.**

## 6. Database — where data actually lives

~70 tables across two migration sets (both hand-applied). The ones that matter most:

| Domain | Tables | Gotchas |
|---|---|---|
| Orders | **`shopify_orders`** (authoritative, incl. UTM attribution, `is_creator`), `orders` (LEGACY — do not use for real data), `amazon_*` (10 tables) | Channel map: `source_name` `web`→D2C, `341128478721`→HYPD. ₹0.01 orders = HYPD creator seeds, excluded from revenue. |
| Identity | `contacts` (CRM; **email nullable** since 007 — 93% of orders are phone-only), `wa_contacts` (WA channel + opt-in + `rfm:*` tags) | Email audiences MUST filter `email IS NOT NULL`. Identity stitching: `src/lib/customer-link.ts`. WA revenue attribution joins `shopify_orders.customer_phone = wa_id` (there is **no contact_id** on shopify_orders). |
| WhatsApp | `wa_messages` (durable ledger, status `sent→delivered→read` — dedup must include all three), `wa_threads`, `wa_templates`, `wa_campaigns`, `wa_journey_runs`, `wa_jobs` (job queue), `wa_confirmation_claims` + `wa_reply_claims` (atomic claims), `wa_flow_settings` + `wa_custom_flows` (dashboard-editable journey config), `wa_catalog_items`, `wa_short_links`/`wa_link_clicks`, `wa_customer_rfm` (view) | The claims tables ARE the never-message-twice invariant. Never bypass them. |
| Support email | `email_threads`, `draft_revisions`, `sent_replies`, `gmail_watch`, `oauth_tokens` | Gmail-sourced via poll + Pub/Sub push. |
| B2B | `leads`, `lead_contacts`, `lead_lists`(+members), `outreach_drafts/events/replies`, `outreach_settings` (sender = Parth), `suppressions`, `email_templates`, `email_sequences`(+steps), `sequence_enrollments`, `deals`, `deal_emails`, `deal_scan_state` | Cold email always from parth@trypromunch.in. |
| Email marketing | `campaigns`, `campaign_emails`, `flows`, `flow_enrollments`, `email_events` | Resend, `hello@trypromunch.in`, 100/day free-tier cap. |
| Instagram | `ig_threads`, `ig_messages`, `ig_jobs`, `ig_settings`, `ig_reply_claims` | Built, gated on Meta app review. |
| Platform | `kb_documents`/`kb_chunks` (Master KB — the ONLY source of truth for bot answers), `connector_events` (health/event log), `audit_log`, `app_secrets` (owner-managed keys → `getSecret()`), `assistant_conversations/messages`, `brand_knowledge` | Bot must answer from Master KB, never model knowledge. |

**Dual-writer tables** (both Next app and edge functions write — coordinate changes on both sides): `shopify_orders`, `contacts`, `wa_contacts`, `wa_campaigns`, `wa_templates`, `wa_journey_runs`, `wa_custom_flows`/`wa_flow_settings`, `kb_documents`, `deals`, `ig_*`, `connector_events`, `email_threads`, `amazon_sku_costs`. (`wa_messages`/`wa_threads` are edge-write, app-read.)

## 7. External services

| Service | Client code | Key source |
|---|---|---|
| Meta WhatsApp Cloud API | edge `_shared/whatsapp.ts` + `wa-*` | Supabase function secrets (`WHATSAPP_*`); system-user token — if auth dies (code 1/190) it expired, rotate at Meta with expiry Never |
| Shopify Admin + webhooks | edge `_shared/shopify*.ts`; Next `src/lib/shopify.ts` (scaffold) | edge env `SHOPIFY_*`; Next `getSecret('SHOPIFY_ACCESS_TOKEN')` |
| Amazon SP-API | edge `_shared/amazon.ts` + `amazon-poll` | edge env; India = EU endpoint, no SigV4 |
| Resend (email out + inbound) | Next `src/lib/resend.ts` | `getSecret('RESEND_API_KEY')`; webhooks use `RESEND_WEBHOOK_SECRET` |
| OpenAI (ALL AI — migrated off Anthropic) | Next `src/lib/assistant/*`, `src/lib/leads/*`; edge `_shared/openai.ts` | Next `getSecret('OPENAI_API_KEY')`; edge env |
| Gmail + Pub/Sub | edge `_shared/gmail.ts`, `gmail-*` | edge env (`GOOGLE_*`, `GMAIL_PUBSUB_TOPIC`) |
| Slack (alerts + support triage) | edge `_shared/slack.ts`; Next health alerts | edge env; single app "Maya" |
| Instagram Graph | edge `_shared/instagram.ts`, `ig-*` | edge env |
| Google Places (B2B discovery) | Next `src/lib/leads/places.ts` | `getSecret('GOOGLE_PLACES_API_KEY')` |
| Klaviyo (legacy import) | Next `src/lib/klaviyo.ts` | `getSecret('KLAVIYO_API_KEY')` |
| Sentry (app errors) | `sentry.*.config.ts` | DSN-gated (off until `NEXT_PUBLIC_SENTRY_DSN` set) |

Key-sourcing rule: **Next.js app** reads rotatable provider keys through `getSecret()` (`app_secrets` table with env fallback, 60s cache, owner-editable in Settings → API keys). **Edge functions** read Supabase function secrets via `Deno.env`. Keep it that way per side.

## 8. Cron topology (who wakes what up)

Canonical source: `promunch-email-agent/supabase/migrations/20260705100000_cron_jobs_canonical.sql` + [docs/runbooks/CRON_TOPOLOGY.md](../runbooks/CRON_TOPOLOGY.md).

**Vercel** (daily only — Hobby plan): `/api/cron/leads-tick` 04:30, `/api/cron/wa-campaign-tick` 06:00.

**pg_cron → edge functions** (bearer from Vault): every minute `wa-jobs-tick`; every 2 min `gmail-poll`, `wa-campaign-worker`; every 10 min `wa-health`; every 15 min `amazon-poll`, `nudge-pending`, `wa-journey-tick`, `wa-ticket-watchdog` (reping), and `wa-campaign-tick` → the Next route; nightly `wa-rfm-tick` 01:30, `wa-ticket-watchdog` digest 03:30, `amazon-settlements` 05:00, `gmail-watch-renew` 06:00, `shopify-daily-summary` 18:29, `shopify-catalog-sync` 19:30; weekly `shopify-weekly-recap`, `wa-weekly-summary`; monthly `shopify-monthly-recap`. `ig-jobs-tick` is scheduled ad hoc (not yet in the canonical file).

**If a pipeline "goes quiet", it is almost always ops/config** (pg_cron job missing, Vault bearer stale, secret unset, migration unapplied), not code. Check `cron.job` / `connector_events` before reading code.

## 9. The three flows you must not break

**(a) Shopify order → confirmation + journeys**

```
Shopify webhook (orders/create, fulfilled, checkouts/*)
 ├─ shopify-webhook [HMAC] → upsert shopify_orders → Slack
 └─ shopify-wa      [HMAC] → order-confirmation.ts:
      atomic claim (wa_confirmation_claims) → wa-send (ledger wa_messages)
      → enrol wa_journey_runs (review / replenishment / abandoned-cart)
      → enrol custom flows; COD orders → COD gate (hold fulfillment + confirm buttons)
 later: wa-journey-tick (*/15) delivers due journey messages
 backstop: wa-confirmation-sweep reconciles missed confirmations
```

**(b) WhatsApp inbound → AI reply**

```
Meta → wa-webhook [x-hub-signature-256]
  1. logConnector first (durable capture)
  2. upsert wa_contacts/wa_threads/wa_messages
  3. bare STOP → unsubscribe (never reaches AI); START → re-opt-in; "done #N" closes ops ticket
  4. bot threads: INSERT wa_jobs(ai_reply) FIRST (safety net), then fast-path invoke wa-ai-reply
wa-ai-reply [internal]: burst-collapse → KB retrieval (kb_chunks → kb_documents fallback)
  → OpenAI → reply/draft/handoff → wa-send (atomic per-turn reply claim)
backstop: wa-jobs-tick (every minute) drains missed jobs
```

**(c) Campaign broadcast**

```
Dashboard → create wa_campaigns → immediate send OR scheduled
  → wa-campaign-send [internal]: atomic send-lock on the campaign row
  → iterate opted-in wa_contacts (segment filter, Meta ~250/day tier aware)
  → per recipient: claim → send → wa_messages; self-chains batches
heartbeat: wa-campaign-worker (*/2) kicks stalled campaigns
report: wa-campaign-report → Slack; ROI joins shopify_orders.customer_phone = wa_id
```

Changing anything in these paths triggers the approval rule in AGENTS.md §4.2 (describe customer-visible effect, get explicit user OK first).

## 10. Design system & frontend conventions

- Warm-editorial redesign, `pm-` prefixed components in `src/components/pm/`; tokens in `design/promunch-design-tokens.css` mirrored to `src/app/globals.css`. `design/` is the source of truth.
- Data fetching is mid-migration to React Query (`@tanstack/react-query`); new pages should use it (with rendered error states), not ad-hoc `useEffect` + `loaded` flags.
- Copy rules apply to ALL UI text: PROMUNCH in caps, no em dashes in customer-facing copy, tagline "Your Munchy Pal", never "Oltaflock".

## 11. Where to look when something breaks

| Symptom | First place to look |
|---|---|
| Dashboard page blank/broken | Browser console; was it a 401 (expired session)? Then `src/app/dashboard/error.tsx` boundary + the page's data fetches |
| WhatsApp not replying | `connector_events`, `wa_jobs` backlog, `wa-health` output; then edge function logs (`supabase functions logs wa-ai-reply`) |
| Campaign stuck | `wa_campaigns.status`, `wa-campaign-worker` cron run history (`cron.job_run_details`), Meta 131049 cap (not a bug) |
| Sync gone quiet (Shopify/Amazon/Gmail) | pg_cron job exists + succeeded? secret set? migration applied? — config first, code second (AGENTS §3) |
| Email sends failing | Resend dashboard, 100/day cap, `RESEND_API_KEY` in app_secrets |
| Edge fn throws provider auth error | Probably a stale deploy (e.g. pre-OpenAI-migration) — redeploy the function |
| 401 on webhook/cron route | Missing secret env — fail-closed by design |

Full incident recipes: [AI_CHANGE_PLAYBOOK.md](AI_CHANGE_PLAYBOOK.md) §6.
