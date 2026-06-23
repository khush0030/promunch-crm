# PROMUNCH CRM — Multi-Channel Customer Platform

**Live:** https://promunch-crm.vercel.app
**GitHub:** https://github.com/khush0030/promunch-crm

A custom-built CRM, marketing, and customer-operations platform for **PROMUNCH** — India's high-protein roasted soya snack brand. Replaces Klaviyo (email), a WhatsApp BSP, and a chunk of manual ops with one owned system. Deeply integrated with Shopify and Amazon for real-time order data, an AI WhatsApp chatbot for support + ordering, email + WhatsApp marketing, and a B2B cold-outreach pipeline.

> **Status (Jun 2026): live in production.** The original 4-phase "frontend → backend → flows" plan is complete and superseded. The platform now runs real customer traffic across WhatsApp, email, Shopify, and Amazon. See [Module Status](#-module-status) for the per-feature picture.

---

## 🎯 Why This Exists

Klaviyo and a managed WhatsApp BSP charge ₹5–6K+/month each and scale aggressively. PROMUNCH CRM gives:
- **Full ownership** of customer data, conversations, and channels
- **Near-₹0 platform cost** — just hosting (Vercel) + per-message sending (Resend, Meta WhatsApp)
- **Custom automations** purpose-built for a D2C snack brand
- **Shopify- and Amazon-native** — orders, customers, catalog, and fulfillment synced in real time
- **One AI brain** — a shared Master Knowledge Base grounds the WhatsApp chatbot, email drafts, and B2B outreach

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                  PROMUNCH CRM — Next.js 16 App                 │
│          React 19 · TypeScript · Tailwind v4 · Supabase Auth   │
│                                                                │
│  Dashboard │ Contacts │ WhatsApp │ Campaigns │ Leads │ Amazon  │
│  Support Inbox │ Order Confirmations │ Attribution │ Analytics │
└───────────────┬───────────────────────────────┬────────────────┘
                │ Next.js API routes             │ reads/writes
                ▼                                 ▼
┌───────────────────────────────┐   ┌────────────────────────────┐
│  Supabase Edge Functions (Deno)│   │   PostgreSQL (Supabase)     │
│  — promunch-email-agent/       │   │  contacts · orders · wa_*   │
│                                │   │  campaigns · kb_documents   │
│  WhatsApp  Shopify  Amazon     │   │  leads · embeddings (pgvec) │
│  Gmail/KB  Slack(Maya)  B2B    │   └────────────────────────────┘
└───┬──────────┬─────────┬───────┘
    ▼          ▼         ▼
┌────────┐ ┌────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ Meta   │ │Shopify │ │ Amazon   │ │  Resend  │ │  Slack   │
│ WA     │ │Admin + │ │ SP-API   │ │  Email   │ │  alerts  │
│ Cloud  │ │webhooks│ │ (EU/IN)  │ │ delivery │ │  (Maya)  │
│ API    │ │        │ │          │ │          │ │          │
└────────┘ └────────┘ └──────────┘ └──────────┘ └──────────┘
```

Two deployables live in this repo:
- **`/` (Next.js app)** — dashboard + API routes, deployed on **Vercel**.
- **`promunch-email-agent/`** — Supabase **edge functions** (Deno) + SQL migrations, deployed via the Supabase CLI. This holds all webhook handlers, cron ticks, the WhatsApp AI agent, and channel integrations.

---

## 🔧 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Next.js 16 (App Router), React 19, TypeScript |
| **Styling** | Tailwind v4 + `pm-` warm-editorial design system, Lucide icons |
| **Auth** | Supabase Auth — email-domain allowlist + branded team invites (Resend) |
| **Database** | PostgreSQL (Supabase) + pgvector for KB embeddings |
| **Edge compute** | Supabase Edge Functions (Deno) |
| **Email** | Resend (`trypromunch.in` verified) — marketing + transactional + B2B |
| **WhatsApp** | Meta WhatsApp Cloud API (chatbot, templates, campaigns) |
| **Commerce** | Shopify Admin API + webhooks; Amazon SP-API (India/EU) |
| **AI** | OpenAI — chatbot replies, email/B2B drafts, KB semantic retrieval |
| **Ops/alerts** | Slack app "Maya" (orders, finance, failures, inbound calls) |
| **Hosting** | Vercel (app) + Supabase (functions, DB, cron) |

---

## 📦 Module Status

Legend: ✅ live · 🟡 partial / config pending · 🔲 not started

### WhatsApp — ✅ live (flagship channel)
- ✅ **AI chatbot** (`wa-ai-reply`) — OpenAI-backed support + ordering, semantic KB retrieval (pgvector), business-hours awareness, robust JSON parsing, anti-spam per-turn reply claim
- ✅ **In-chat ordering** — Meta catalog → cart → Shopify checkout link (catalog config pending live IDs)
- ✅ **Order confirmations** — instant send + sweep cron + dashboard, deduped on `wa_messages`
- ✅ **Journey templates** — 5 approved at Meta; review / restock / shipping asks sent as in-window personalized text to dodge marketing caps
- ✅ **Campaigns + templates** — dashboard template builder, image headers, segment picker, send pipeline
- ✅ **RFM segmentation** — Shopify order history → `rfm:*` tags via nightly `wa-rfm-tick`
- ✅ **Failure alerting** — every send/delivery failure Slack-pinged with the Meta reason code
- 🟡 Meta product catalog IDs + a few migrations need manual apply (see memory notes)

### Shopify — ✅ live
- ✅ Real-time webhooks (orders, customers, checkouts, fulfillments)
- ✅ Customer sync / upsert (guest-order customers backfilled into Shopify)
- ✅ Order attribution (UTM / customer-journey → `shopify_orders`) + dashboard
- ✅ Catalog sync, daily summary, HYPD creator tagging, abandoned-cart recovery links
- ✅ Shipping/tracking links resolve to the Shopify order-status page

### Amazon — ✅ live
- ✅ `amazon-poll` edge fn — orders, inventory, finances, settlement reconciliation (India = EU endpoint, no SigV4)
- ✅ `#amazon-orders` / `#amazon-finance` Slack channels; manual "Sync now" trigger

### Email Marketing — ✅ live
- ✅ Campaign send via Resend (`hello@trypromunch.in`), free-tier 100/day cap
- ✅ AI drafts grounded in the shared Master KB (`kb_documents`)
- ✅ Resend delivery + bounce webhook handling
- 🔲 Visual flows/automation engine for email not yet built (WhatsApp journeys cover the live automation needs)

### B2B Lead-Gen — ✅ live
- ✅ Pipeline: Google Places → scrape → MX-verify → AI cold-email draft → approval → send
- ✅ Sends via Resend from a dedicated outreach domain; bounce suppression wired
- ✅ Drafts grounded in Master KB (correct product facts)
- 🟡 Replies inbox still TODO; needs `GOOGLE_PLACES_API_KEY` / `OPENAI_API_KEY` in prod

### Support Inbox — ✅ live
- ✅ Gmail-polled support emails surfaced in dashboard with AI draft replies, reading the same Master KB

### Contacts & Analytics — ✅ live
- ✅ Unified customer profiles (orders, LTV, tags, WhatsApp thread, faceted search)
- ✅ Dashboard: revenue, channel stats, needs-attention queue, Shopify attribution

### Platform / Team — ✅ live
- ✅ Supabase Auth with email-domain allowlist (`trypromunch.in` etc.)
- ✅ Branded PROMUNCH team-invite emails (Resend) + accept-invite flow
- ✅ First-run onboarding tour (`Onboarding.tsx`) + in-app guides
- ✅ API middleware gates all `/api/*`; webhooks/cron fail-closed on secrets

---

## 📂 Project Structure

```
promunch-crm/
├── src/
│   ├── app/
│   │   ├── dashboard/                 # all authenticated screens
│   │   │   ├── page.tsx               # home — revenue, channel stats, needs-attention
│   │   │   ├── contacts/              # customer list + profile ([id])
│   │   │   ├── whatsapp/              # inbox, campaigns, templates, KB
│   │   │   ├── campaigns/             # email campaign list + builder
│   │   │   ├── leads/                 # B2B outreach pipeline
│   │   │   ├── amazon/                # Amazon orders/finance
│   │   │   ├── support-emails/        # Gmail support inbox + AI drafts
│   │   │   ├── order-confirmations/   # WA order-confirmation monitor
│   │   │   ├── shopify-attribution/   # UTM / journey attribution
│   │   │   ├── analytics/  integrations/  team/  settings/
│   │   ├── api/                       # Next.js route handlers (see list below)
│   │   └── auth/                      # callback, set-password, signout
│   ├── components/                    # Sidebar, Onboarding, NeedsAttention, pm/, ui/
│   └── lib/                           # supabase clients, shopify, resend, auth-domains, emails/, leads/
├── promunch-email-agent/             # Supabase edge functions (Deno) + SQL migrations
│   └── supabase/functions/           # wa-*, shopify-*, amazon-poll, kb-*, gmail-*, slack-*, b2b-*
├── shopify-app/                      # Shopify app scaffolding
├── public/  scripts/  supabase/
├── vercel.json                       # cron: leads-tick
└── package.json
```

**Key edge functions** (`promunch-email-agent/supabase/functions/`):
`wa-ai-reply` · `wa-send` · `wa-webhook` · `wa-campaign-send` · `wa-confirmation-sweep` · `wa-journey-tick` · `wa-rfm-tick` · `wa-template-create` · `wa-watchdog` · `shopify-webhook` · `shopify-catalog-sync` · `shopify-stats` · `amazon-poll` · `kb-ingest` · `kb-embed` · `gmail-poll` · `slack-events` · `slack-interactivity` · `b2b-send`

---

## 🛠️ Local Development

**Next.js app:**
```bash
npm install
npm run dev          # http://localhost:3000
npm run build
npx vercel --prod    # deploy app
```

**Edge functions** (`promunch-email-agent/`):
```bash
supabase functions deploy <name>     # deploy a function
# Migrations: apply via the Supabase dashboard SQL editor
#   (CLI function deploys work; SQL migrations go through the dashboard)
```

---

## 📝 License

Proprietary — PROMUNCH

---

## 👤 Author

**Khush Mutha** — PROMUNCH, High-Protein Roasted Soya Snacks
📧 khush@trypromunch.in

_Own your customer relationships. Own your data. Own your channels._
