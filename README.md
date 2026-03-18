# PROMUNCH CRM — Custom Email Marketing & Automation Platform

**Live:** https://promunch-crm.vercel.app
**GitHub:** https://github.com/khush0030/promunch-crm

A purpose-built CRM and email marketing platform replacing Klaviyo for PROMUNCH — India's high-protein roasted soya snack brand. Integrates with Shopify for real-time customer data, automated email flows, campaign management, and revenue analytics.

---

## 🎯 Why This Exists

Klaviyo charges ₹5-6K+/month at 1,000+ contacts and scales aggressively. PROMUNCH CRM gives you:
- **Full ownership** of customer data and platform
- **₹0/month** platform cost (just hosting + email sending)
- **Custom flows** built specifically for D2C snack brand needs
- **Shopify-native** — every order, cart, and customer synced in real time

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    PROMUNCH CRM Frontend                 │
│              Next.js 15 + React 19 + TypeScript          │
│                                                           │
│  Dashboard │ Contacts │ Campaigns │ Flows │ Analytics    │
└──────────────────────┬────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│                    Backend API (Phase 2)                  │
│                   Node.js + Express                       │
│                                                           │
│  Shopify Sync │ Flow Engine │ Email Sender │ Segments    │
└──────┬────────────┬──────────────┬────────────────────────┘
       │            │              │
       ▼            ▼              ▼
┌──────────┐  ┌───────────┐  ┌──────────────┐
│ Shopify  │  │PostgreSQL │  │ SendGrid/SES │
│  API +   │  │ (Supabase)│  │  Email       │
│ Webhooks │  │           │  │  Delivery    │
└──────────┘  └───────────┘  └──────────────┘
```

---

## 📂 Project Structure

```
promunch-crm/
├── src/
│   ├── app/
│   │   ├── page.tsx                          # Landing / redirect
│   │   ├── layout.tsx                        # Root layout
│   │   └── dashboard/
│   │       ├── layout.tsx                    # Dashboard shell (sidebar + responsive)
│   │       ├── page.tsx                      # Home — stats, revenue, recent campaigns
│   │       ├── contacts/
│   │       │   ├── page.tsx                  # Customer list (search, filter, LTV)
│   │       │   └── [id]/page.tsx             # Customer profile (orders, emails, tags)
│   │       ├── campaigns/
│   │       │   ├── page.tsx                  # Campaign list with metrics
│   │       │   ├── [id]/page.tsx             # Campaign detail + performance funnel
│   │       │   └── new/page.tsx              # 4-step campaign builder
│   │       ├── flows/
│   │       │   ├── page.tsx                  # All automation flows
│   │       │   └── [id]/page.tsx             # Flow detail with step timeline
│   │       ├── analytics/page.tsx            # Revenue, email health, growth
│   │       └── settings/page.tsx             # Shopify, SendGrid, team, API keys
│   └── components/
│       └── Sidebar.tsx                       # Responsive sidebar + mobile header
├── public/
├── package.json
├── next.config.ts
├── tsconfig.json
└── postcss.config.mjs
```

---

## 🔧 Tech Stack

| Layer | Technology | Status |
|-------|-----------|--------|
| **Frontend** | Next.js 15, React 19, TypeScript | ✅ Phase 1 Complete |
| **Styling** | Inline styles (dark theme, PROMUNCH brand colors) | ✅ Done |
| **Icons** | Lucide React | ✅ Done |
| **Deployment** | Vercel | ✅ Live |
| **Database** | PostgreSQL (Supabase) | 🔲 Phase 2 |
| **Auth** | NextAuth.js / Supabase Auth | 🔲 Phase 2 |
| **Shopify** | Shopify Admin API + Webhooks | 🔲 Phase 2 |
| **Email Sending** | SendGrid or AWS SES | 🔲 Phase 2 |
| **Queue** | Redis + Bull (flow engine) | 🔲 Phase 3 |
| **AI** | OpenAI (send time optimization) | 🔲 Phase 4 |

---

## 🎨 Brand Colors

| Color | Hex | Usage |
|-------|-----|-------|
| **Maroon** (Primary) | `#B91C4A` | Buttons, active states, brand elements |
| **Dark Maroon** | `#8B1539` | Gradients, hover states |
| **Golden Yellow** | `#F5B731` | Revenue/money metrics |
| **Teal** | `#00B4D8` | Subscriber/engagement metrics |
| **Orange** | `#E87339` | Flow/automation metrics |
| **Background** | `#09090b` | Page background |
| **Card** | `#18181b` | Card surfaces |
| **Border** | `#27272a` | Borders and dividers |

---

## 🚀 Development Phases

### Phase 1 — Frontend MVP ✅ COMPLETE
- [x] Dashboard with revenue, subscriber, and campaign stats
- [x] Contact management (list, search, filter, profiles)
- [x] Campaign list, detail, and 4-step creation wizard
- [x] 10 automation flow cards with detail views
- [x] Analytics page (revenue, email health, growth)
- [x] Settings (Shopify, SendGrid, team, API keys)
- [x] Mobile responsive sidebar
- [x] PROMUNCH branding (maroon, ₹ currency, all caps)

### Phase 2 — Backend Integration 🔄 IN PROGRESS
- [ ] Supabase database schema (contacts, orders, campaigns, flows, emails)
- [ ] Shopify OAuth connection + webhook receivers
- [ ] Customer sync (import existing Shopify customers)
- [ ] Campaign creation API (CRUD)
- [ ] Email sending via SendGrid/SES
- [ ] Basic segmentation (filters on customer properties)
- [ ] Auth (team login)

### Phase 3 — Flow Automation Engine
- [ ] Visual flow builder (drag-and-drop)
- [ ] Trigger types: Shopify events, segment entry, date-based
- [ ] Time delays and conditional splits (IF/THEN)
- [ ] Abandoned Cart Recovery flow (Priority #1)
- [ ] Welcome Series, Post-Purchase, Win-Back flows
- [ ] Flow analytics with per-step conversion funnel

### Phase 4 — Advanced Features
- [ ] Drag-and-drop email editor (block-based)
- [ ] A/B testing on subject lines
- [ ] Send time optimization (AI)
- [ ] Predictive segments (high LTV, churn risk)
- [ ] Browse abandonment tracking
- [ ] Forms & pop-up builder
- [ ] Deliverability monitoring

---

## 📊 Core Modules

### 1. Dashboard & Analytics
Real-time overview of email-attributed revenue, subscriber growth, campaign performance, and flow ROI.

### 2. Contact Management
Unified customer profiles aggregating Shopify data (orders, LTV, AOV), email engagement (opens, clicks), tags, and flow history. Dynamic segmentation with filters on purchase behavior, engagement, and profile data.

### 3. Email Campaigns
Broadcast email tool with personalization tokens (`{{first_name}}`, `{{product_name}}`), audience selection from segments, scheduling, and A/B testing.

### 4. Flow Automation
Trigger-based automated email sequences:
- **Abandoned Cart Recovery** — 3 emails (1hr, 24hr, 72hr after abandonment)
- **Welcome Series** — 4 emails over 10 days for new subscribers
- **Post-Purchase** — Thank you + review request
- **Win-Back** — 3 emails for lapsed customers (90+ days)
- **Birthday, VIP, Upsell, Browse Abandonment** flows

### 5. Shopify Integration
Real-time webhooks for orders, customers, checkouts, fulfillments, refunds. Full product catalog sync for dynamic email content.

---

## 🛠️ Local Development

```bash
npm install
npm run dev
```

Open http://localhost:3000

### Build
```bash
npm run build
```

### Deploy
```bash
npx vercel --prod
```

---

## 📝 License

Proprietary — PROMUNCH / Oltaflock AI

---

## 👤 Author

**Khush Mutha**
PROMUNCH — High-Protein Roasted Soya Snacks
📧 khush@promunch.in

---

_Own your customer relationships. Own your data. Own your growth._
