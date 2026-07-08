# PROMUNCH CRM — Multi-Channel Customer Platform

**Live:** https://promunch-crm.vercel.app
**GitHub:** https://github.com/khush0030/promunch-crm

A custom-built CRM, marketing, and customer-operations platform for **PROMUNCH** — India's high-protein roasted soya snack brand ("Your Munchy Pal"). Replaces Klaviyo (email), a WhatsApp BSP, and a chunk of manual ops with one owned system. Deeply integrated with Shopify and Amazon for real-time order data, an AI WhatsApp chatbot for support + ordering, email + WhatsApp marketing, a B2B cold-outreach pipeline, and an in-dashboard AI assistant (Maya) over all business data.

> **Status (Jul 2026): live in production**, running real customer traffic across WhatsApp, email, Shopify, and Amazon. See [Module Status](#-module-status).

**Working in this repo?** Start with [AGENTS.md](AGENTS.md) — deploy rules, hard product invariants, brand rules, data-model gotchas. AI agents also read [CLAUDE.md](CLAUDE.md). All documentation is indexed at [docs/README.md](docs/README.md).

---

## 🎯 Why This Exists

Klaviyo and a managed WhatsApp BSP charge ₹5–6K+/month each and scale aggressively. PROMUNCH CRM gives:
- **Full ownership** of customer data, conversations, and channels
- **Near-₹0 platform cost** — just hosting (Vercel) + per-message sending (Resend, Meta WhatsApp)
- **Custom automations** purpose-built for a D2C snack brand
- **Shopify- and Amazon-native** — orders, customers, catalog, and fulfillment synced in real time
- **One AI brain** — a shared Master Knowledge Base (`kb_documents`) grounds the WhatsApp chatbot, email drafts, B2B outreach, and the Maya assistant

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                  PROMUNCH CRM — Next.js 16 App                 │
│          React 19 · TypeScript · Tailwind v4 · Supabase Auth   │
│                                                                │
│  Dashboard │ Contacts │ WhatsApp │ Campaigns │ Leads │ Amazon  │
│  Support Inbox │ Order Confirmations │ Attribution │ Analytics │
│  Maya AI Assistant │ Flows │ Instagram │ Audit Log │ Settings  │
└───────────────┬───────────────────────────────┬────────────────┘
                │ Next.js API routes             │ reads/writes
                ▼                                 ▼
┌───────────────────────────────┐   ┌────────────────────────────┐
│  Supabase Edge Functions (Deno)│   │   PostgreSQL (Supabase)     │
│  — promunch-email-agent/       │   │  contacts · shopify_orders  │
│                                │   │  wa_* · campaigns · leads   │
│  WhatsApp  Shopify  Amazon     │   │  kb_documents · app_secrets │
│  Gmail/KB  Slack(Maya)  B2B  IG│   │  embeddings (pgvector)      │
└───┬──────────┬─────────┬───────┘   └────────────────────────────┘
    ▼          ▼         ▼
┌────────┐ ┌────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ Meta   │ │Shopify │ │ Amazon   │ │  Resend  │ │  Slack   │
│ WA     │ │Admin + │ │ SP-API   │ │  Email   │ │  alerts  │
│ Cloud  │ │webhooks│ │ (EU/IN)  │ │ delivery │ │  (Maya)  │
│ API    │ │        │ │          │ │          │ │          │
└────────┘ └────────┘ └──────────┘ └──────────┘ └──────────┘
```

Two deployables live in this repo:
- **`/` (Next.js app)** — dashboard + API routes, deployed on **Vercel** (manual `vercel --prod`; no git auto-deploy).
- **`promunch-email-agent/`** — Supabase **edge functions** (Deno) + SQL migrations, deployed via the Supabase CLI. This holds all webhook handlers, cron ticks, the WhatsApp AI agent, and channel integrations.

---

## 🔧 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Next.js 16 (App Router), React 19, TypeScript |
| **Styling** | Tailwind v4 + `pm-` warm-editorial design system (`design/`), Lucide icons |
| **Auth** | Supabase Auth — email-domain allowlist + branded team invites (Resend) |
| **Database** | PostgreSQL (Supabase) + pgvector for KB embeddings; pg_cron for scheduling |
| **Edge compute** | Supabase Edge Functions (Deno) |
| **Email** | Resend (`trypromunch.in` verified) — marketing + transactional + B2B |
| **WhatsApp** | Meta WhatsApp Cloud API (chatbot, templates, campaigns, catalog ordering) |
| **Commerce** | Shopify Admin API + webhooks; Amazon SP-API (India/EU) |
| **AI** | OpenAI — chatbot replies, Maya assistant, email/B2B drafts, KB retrieval |
| **Ops/alerts** | Slack app "Maya" (orders, finance, failures, inbound calls); Sentry |
| **Hosting** | Vercel (app) + Supabase (functions, DB, cron) |

---

## 📦 Module Status

Legend: ✅ live · 🟡 partial / config pending · 🔲 not started

### WhatsApp — ✅ live (flagship channel)
- ✅ **AI chatbot** (`wa-ai-reply`) — OpenAI-backed support + ordering, semantic KB retrieval (pgvector), business-hours awareness, anti-spam per-turn reply claim
- ✅ **In-chat ordering** — Meta catalog → cart → Shopify checkout link (catalog config pending live IDs)
- ✅ **Order confirmations** — instant send + sweep cron + dashboard, deduped on `wa_messages` with atomic claims
- ✅ **Journeys + Flows tab** — 5 Meta-approved templates; journey timings dashboard-editable (`wa_flow_settings`); review/restock asks sent as in-window free text to dodge marketing caps
- ✅ **Campaigns + template builder** — guided builder with live preview, media headers, segment picker; durable send engine (atomic lock, pg_cron worker, circuit breaker)
- ✅ **Analytics tab** — employee-readable funnel, campaign report cards, live feed, weekly Slack recap
- ✅ **RFM segmentation** — Shopify order history → `rfm:*` tags via nightly `wa-rfm-tick`
- ✅ **Two-number escalation** — order issues → ops WhatsApp (Narendra), rest → owner; "done #N" closes
- ✅ **Cart recovery** — at-least-once delivery guarantee, cap-aware template backoff, 72h deadline
- ✅ **Failure alerting** — every send/delivery failure alerted with the Meta reason code

### Shopify — ✅ live
- ✅ Real-time webhooks (orders, customers, checkouts, fulfillments) → CRM contacts (email **or phone-only** since migration 007)
- ✅ Customer sync / upsert (guest orders backfilled into Shopify Customers, address-degrade on bad data)
- ✅ Order attribution (UTM / customer-journey → `shopify_orders`) + dashboard
- ✅ Catalog sync, daily summary, HYPD creator tagging (₹0.01 seeds excluded from revenue), abandoned-cart recovery links

### Amazon — ✅ live
- ✅ `amazon-poll` edge fn — orders, inventory, finances, settlement reconciliation (India = EU endpoint, no SigV4)
- ✅ Per-SKU economics dashboard — margins, FBA stockout ₹/day, refund repair
- ✅ `#amazon-orders` / `#amazon-finance` Slack channels; manual "Sync now" trigger

### Maya AI Assistant — ✅ live
- ✅ `/dashboard/assistant` — chat over all data sources (orders, contacts, WhatsApp, campaigns, leads) with live data cards

### Email Marketing — ✅ live
- ✅ Campaign send via Resend (`hello@trypromunch.in`), free-tier 100/day cap
- ✅ AI drafts grounded in the shared Master KB; audiences filter `email IS NOT NULL`
- 🔲 Visual email flows engine (WhatsApp journeys cover live automation needs)

### B2B Lead-Gen — ✅ live (v2)
- ✅ Lists + sequences + templates + analytics; hourly follow-ups via cron
- ✅ Pipeline: Google Places → scrape → MX-verify → AI KB-grounded draft → approval → send
- ✅ Sends as Parth (founder, `parth@trypromunch.in`) via Resend; bounce suppression wired
- 🟡 Replies inbox still TODO

### Instagram — 🟡 built, not deployed
- 🟡 DM/comment automation ports the WA stack (`ig-webhook` → `ig-ai-reply` → `ig-send`); gated on Meta app review + secrets

### Support Inbox — ✅ live
- ✅ Gmail-polled support emails with AI draft replies from the same Master KB

### Contacts & Analytics — ✅ live
- ✅ Unified profiles (email or phone-only), orders, LTV, tags, WhatsApp thread, CSV export
- ✅ Dashboard: revenue, channel health, needs-attention queue, Shopify attribution

### Platform / Team — ✅ live
- ✅ Supabase Auth allowlist, branded invites, first-run onboarding tour
- ✅ Owner-only API key management (`app_secrets` + live rotation)
- ✅ API middleware gates all `/api/*`; webhooks/cron fail-closed on secrets
- ✅ Audit log, Sentry, gitleaks CI

---

## 📂 Project Structure

```
promunch-crm/
├── README.md · AGENTS.md · CLAUDE.md    # start here
├── src/                                 # Next.js app
│   ├── app/dashboard/                   # one folder per module (contacts, whatsapp, leads, amazon, assistant, …)
│   ├── app/api/                         # route handlers (middleware-gated)
│   ├── components/                      # Sidebar, pm/ design system, whatsapp/, ui/
│   └── lib/                             # supabase clients, shopify, resend, rbac, secrets, gdpr
├── promunch-email-agent/                # Supabase project — 39 edge functions + migrations
│   ├── CLAUDE.md                        # deep handoff (no-duplicate-message invariant lives here)
│   ├── supabase/functions/              # wa-* shopify-* amazon-poll ig-* kb-* gmail-* slack-* b2b-*
│   └── scripts/                         # deploy.sh, verify.sh, cron SQL
├── supabase/migrations/                 # app-side SQL migrations (001–007)
├── docs/                                # ALL documentation → docs/README.md is the index
│   ├── runbooks/  whatsapp/  instagram/  integrations/  plans/  audits/  archive/
├── design/                              # active warm-editorial design source (tokens, prototype)
├── scripts/                             # local ops scripts (check-migrations.sh, backfills)
├── shopify-app/                         # Shopify app scaffolding
└── vercel.json                          # Vercel crons (daily only — sub-daily runs on pg_cron)
```

---

## 🛠️ Local Development

**Next.js app:**
```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # must pass before shipping
npm run test         # vitest
npx vercel --prod    # deploy app (there is NO git auto-deploy)
```

**Edge functions** (`promunch-email-agent/`):
```bash
supabase functions deploy <name>     # deploy a function
# Migrations: apply via the Supabase dashboard SQL editor
#   (CLI function deploys work; SQL migrations go through the dashboard)
bash scripts/check-migrations.sh     # verify migration drift
```

Full deploy sequence: [docs/runbooks/DEPLOY_GUIDE.md](docs/runbooks/DEPLOY_GUIDE.md) · Cron map: [docs/runbooks/CRON_TOPOLOGY.md](docs/runbooks/CRON_TOPOLOGY.md)

---

## 📝 License

Proprietary — PROMUNCH

---

## 👤 Author

**Khush Mutha** — PROMUNCH, High-Protein Roasted Soya Snacks
📧 khush@trypromunch.in

_Own your customer relationships. Own your data. Own your channels._
