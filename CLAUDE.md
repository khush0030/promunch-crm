# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Canonical behavioral rules for every agent live in @AGENTS.md and always win over this overview. Deeper maps: [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) (full system map) and [docs/architecture/AI_CHANGE_PLAYBOOK.md](docs/architecture/AI_CHANGE_PLAYBOOK.md) (change recipes). Working on edge functions? Read [promunch-email-agent/CLAUDE.md](promunch-email-agent/CLAUDE.md) first — its §0 (never message a customer twice) is a hard invariant.

## What this app is

Production CRM + marketing + customer-ops platform for **PROMUNCH** (high-protein roasted soya snacks, D2C India). It runs real customer traffic across WhatsApp (Meta Cloud API), email (Resend + Gmail), Shopify, Amazon SP-API, Instagram DMs, and B2B cold outreach. One Supabase Postgres database (~70 tables) is shared by two deployables:

| Deployable | Path | Deploy |
|---|---|---|
| Next.js 16 dashboard + 114 API routes | `src/` | `vercel --prod` (manual — git push ships NOTHING) |
| 56 Supabase Edge Functions (Deno) + `_shared/` | `promunch-email-agent/supabase/functions/` | `supabase functions deploy <name>` from `promunch-email-agent/` |

SQL migrations (both `supabase/migrations/` app-side and `promunch-email-agent/supabase/migrations/` edge-side) are pasted by hand into the Supabase dashboard SQL editor — the CLI path does not work. Always report "committed" and "deployed" separately.

## Commands

```bash
npm run dev          # local dashboard
npm run build        # production build — must pass before "done"
npm run test         # vitest run (config pins TZ; keep deterministic)
npx vitest run src/lib/rbac.test.ts   # single test file
npm run lint         # eslint
bash scripts/check-migrations.sh      # migration drift vs hand-applied history

# edge functions (from promunch-email-agent/)
deno check supabase/functions/<fn>/index.ts   # typecheck one function
supabase functions deploy <name>              # deploy one function
supabase functions logs <name>                # prod logs
```

## Backend architecture — the big picture

Three rules explain almost every design decision:

1. **Next.js app is the control plane.** Screens, CRUD, triggers. It never talks to Meta/Shopify/Gmail directly for sends — it invokes an edge function (e.g. `/api/whatsapp/campaigns/[id]/send` → edge `wa-campaign-send`). Preserve this split.
2. **Edge functions are the data plane.** Every customer-facing message (WhatsApp, email, IG) goes out through a send chokepoint (`wa-send`, `b2b-send`, `ig-send`) that takes an **atomic claim first** and writes a durable ledger (`wa_messages`, `ig_messages`). The claims tables ARE the never-message-twice invariant; never bypass them.
3. **pg_cron is the heartbeat.** Vercel Hobby allows only daily crons, so all sub-daily scheduling (campaign worker every 2 min, `wa-jobs-tick` every minute, journey ticks, pollers) runs as pg_cron jobs calling edge functions with a Vault-stored bearer. Canonical topology: `promunch-email-agent/supabase/migrations/20260705100000_cron_jobs_canonical.sql` + [docs/runbooks/CRON_TOPOLOGY.md](docs/runbooks/CRON_TOPOLOGY.md).

### API auth model (`src/middleware.ts`)

All `/api/*` require a Supabase session (email-domain allowlist) EXCEPT two fail-closed classes: webhooks (`/api/webhooks/*` — provider signature required) and cron routes (`/api/cron/*` — `CRON_SECRET` bearer required). A 401 there usually means a missing secret, not a bug. Extra layers: `requireAdmin` (`src/lib/rbac-server.ts`), `requireSecretsOwner` (`src/lib/secrets.ts`, owner-only API keys), `requireSession` (`src/lib/leads/auth.ts`), BotID guard on abuse-prone mutations. Public surface: `/login`, `/r/[code]` (WA short-link click tracking), `/api/public/*`.

### Edge function roles (grouped)

- **Webhook receivers** (public, signature-verified): `wa-webhook`, `shopify-webhook`/`shopify-wa`/`shopify-status`, `gmail-webhook` (Pub/Sub), `ig-webhook`, `slack-events`/`slack-interactivity`, `oauth-callback`, `voice-webhook` (Sarvam post-call callback, per-call token instead of a provider signature).
- **Send chokepoints** (internal-only via `_shared/require-internal.ts`): `wa-send`, `ig-send`, `b2b-send`, `voice-call-start`, `voice-tool-wa-link`.
- **AI workers** (all OpenAI — migrated off Anthropic): `wa-ai-reply` (KB-grounded WA bot), `ig-ai-reply`, `ig-analyze`, `deal-scan`, `kb-embed`/`kb-ingest`.
- **Cron workers**: `wa-jobs-tick`, `wa-journey-tick`, `wa-campaign-worker`, `wa-campaign-send` (self-chaining), `gmail-poll`, `amazon-poll`, `wa-rfm-tick`, `wa-health`, `nudge-pending`, `ig-jobs-tick`, `ig-discovery-tick`, `ig-followup-tick`, daily/weekly summaries.
- **Manual/backfill + read services**: `shopify-*-backfill`, `shopify-stats`, `wa-template-create`, `wa-meta-info`, `cod-gate-action`.

Cross-function logic lives in `_shared/` (whatsapp.ts, openai.ts, shopify*.ts, journeys.ts, order-confirmation.ts, cod-gate.ts, gmail.ts, slack.ts, require-internal.ts, …). New shared logic goes there, never copy-pasted into function folders.

### Data model essentials

- Real order data: **`shopify_orders`** (legacy `orders` table is dead). Channel map: `source_name` `web` → D2C site, `341128478721` → HYPD. ₹0.01 orders = HYPD creator seeds, excluded from revenue.
- Identity: `contacts` (CRM, **email nullable** — 93% of orders are phone-only; email audiences MUST filter `email IS NOT NULL`), `wa_contacts` (opt-in + `rfm:*` tags). WA revenue attribution joins `shopify_orders.customer_phone = wa_id` — there is no `contact_id` on shopify_orders.
- WhatsApp: `wa_messages` ledger (status `sent→delivered→read`; dedup queries must include all three), `wa_threads` (inbox orders by `last_activity_at`), `wa_campaigns`, `wa_journey_runs`, `wa_jobs` (job queue backstop), claim tables (`wa_confirmation_claims`, `wa_reply_claims`), `wa_flow_settings`/`wa_custom_flows` (journey timings are dashboard config, not code constants).
- Knowledge: `kb_documents`/`kb_chunks` (Master KB) is the ONLY source of truth for bot answers — WhatsApp, email drafts, and B2B drafts all ground here, never model knowledge.
- Secrets: Next.js reads rotatable provider keys via `getSecret()` (`app_secrets` table, owner-editable in Settings → API keys); edge functions read Supabase function secrets via `Deno.env`. Keep it that way per side.
- Dual-writer tables (app + edge both write — coordinate both sides): `shopify_orders`, `contacts`, `wa_contacts`, `wa_campaigns`, `wa_templates`, `wa_journey_runs`, `kb_documents`, `deals`, `ig_*`, `connector_events`.

### The three flows you must not break

1. **Shopify order → WA confirmation + journeys:** Shopify webhook (HMAC) → `shopify-webhook` upserts `shopify_orders`; `shopify-wa` takes atomic claim → `wa-send` → enrols journeys (review/replenishment/abandoned-cart/custom); COD orders hit the COD gate (fulfillment hold + Confirm/Cancel buttons). Backstop: `wa-confirmation-sweep`.
2. **WA inbound → AI reply:** Meta → `wa-webhook` (signature) → durable capture → bare `STOP` = unsubscribe (never reaches AI), `START` re-opts-in, "done #N" closes ops ticket → insert `wa_jobs` first, then fast-path `wa-ai-reply` (KB retrieval → OpenAI → atomic per-turn reply claim → `wa-send`). Backstop: `wa-jobs-tick` every minute.
3. **Campaign broadcast:** dashboard creates `wa_campaigns` → `wa-campaign-send` takes atomic send-lock, iterates opted-in contacts paced to min(Meta ~250/day marketing tier, `WA_DAILY_SEND_LIMIT`), self-chains batches. Heartbeat: `wa-campaign-worker` every 2 min. Meta error 131049 = marketing cap, not a bug.

Any change touching these paths triggers AGENTS.md §4.2: describe the customer-visible effect and get explicit user approval BEFORE editing or deploying.

### Debugging order

Sync pipelines going quiet (Shopify/Amazon/Gmail) are almost always **ops/config** — pg_cron job missing, Vault bearer stale, secret unset, migration unapplied — not code. Check `cron.job`, `cron.job_run_details`, and `connector_events` before reading code. A prod bug can also be a stale deploy (source fixed, function never redeployed).

## Frontend in one paragraph

App Router, all dashboard pages client components under `src/app/dashboard/` (one folder per module: whatsapp, contacts, campaigns, leads, deals, instagram, amazon, support-emails, assistant, …). Warm-editorial design system with `pm-` prefixed components in `src/components/pm/`; `design/` is the token source of truth, mirrored to `src/app/globals.css`. Data fetching is mid-migration to React Query — new pages use it, not ad-hoc `useEffect` flags.

## Non-negotiables (full list in AGENTS.md)

- Never message a customer twice; atomic claim before every send.
- WhatsApp reply-behavior changes need explicit user approval first.
- Commit straight to `main` (no branches/PRs), but nothing auto-deploys.
- Copy: PROMUNCH all caps, no em dashes in customer-facing copy, tagline "Your Munchy Pal", never mention Oltaflock. B2B outreach sends as Parth (parth@trypromunch.in).
- New docs go under `docs/` subfolders (update `docs/README.md`); superseded material moves to `docs/archive/`; nothing loose at repo root. Never commit `.env.local` or `PM-CRM_GKeys.json`.
- Live-test every rollout (real send/trigger) before calling it done, not just green checks.
