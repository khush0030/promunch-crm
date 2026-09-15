# PROMUNCH CRM Redesign — Phase 0 + Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retheme the CRM to the approved PROMUNCH brand system, replace the 17-item sidebar with the 6-hub shell (laptop sidebar + phone tab bar + ⌘K), add one shared sales-metrics service, and ship the Today and Sales hubs (Home, Needs attention, Sales overview, Web store, Amazon ×5 tabs, Orders & COD).

**Architecture:** Visual spec is the approved prototype at `docs/plans/2026-09-15-crm-redesign/` (`index.html` = tokens + CSS, `screens.js` = every screen's markup; open the artifact https://claude.ai/artifact/Wej9SQVrLomK5jGNp84PSZ for the rendered version). All 34 screens were approved by the owner on 15 Sep 2026; the 20 unchanged ones and the 14 revised ones are both final. Existing routes stay valid (old URLs redirect to new ones) so shared links and bookmarks keep working. Old-theme CSS classes are aliased to the new tokens so untouched modules retheme without edits.

**Tech Stack:** Next.js 16 App Router (client dashboard pages), React 19, TanStack Query v5, Supabase (service-role via API routes), vitest (node env, `src/**/*.test.ts`), `next/font/google`, lucide-react.

## Global Constraints

- Brand name **PROMUNCH** in all caps in copy. **No em dashes** in any user-facing copy. Tagline "Your Munchy Pal". Never mention Oltaflock.
- Business words, never engineering words, in UI text: "days of stock left" not "days cover"; "Number not on WhatsApp" not "#131026"; "paid to you" not "net kept".
- Every number obeys the page's period picker, and every headline number shows change vs the previous period of equal length. No decorative sparklines. A chart draws only recorded values.
- Phones (≤ 720px): tables become cards, two-column grids stack, boards swipe. No page scrolls sideways.
- Fonts: Archivo Black (titles only), Archivo (text), IBM Plex Mono (labels, periods, sources). Loaded with `next/font/google`.
- Colours (light): crimson `#AF272F` (brand + primary button), cyan `#0A9CB8`, sun `#FFC905`, orange `#E86A24`, ink `#1D1517`, ground `#F2F1EF`, surface `#FFFFFF`. Status: good `#1E7F55`, warn `#A95C00`, critical `#BF311C`. Series: web `#AF272F`, amazon `#C98A00`, hypd `#6E4FB0`, whatsapp `#0A9CB8`. Full token set incl. dark mode: `index.html` `:root` block.
- **Do not touch** anything under `promunch-email-agent/` (edge functions), any `/api/whatsapp/**` send path, `wa-*` behaviour, or the STOP/START handling. This phase is dashboard + read-only API routes only.
- Commit straight to `main` after each task. Nothing auto-deploys: `vercel --prod` is a separate, explicit step at the end, after a live check on the preview.
- `npm run build`, `npm run test`, `npm run lint` must pass before any commit.
- Revenue definition (used everywhere from now on): sum of `shopify_orders.total_price` where `financial_status` not in (`voided`,`refunded`) and `is_creator = false` (₹0.01 HYPD seeds excluded). Channel: `is_creator` → HYPD Creator (excluded); `source_name = '341128478721'` or matches /hypd/i → HYPD; `source_name = 'web'` → Web store; other numeric → Other marketplace; else first_utm_source/first_source. Amazon revenue comes from `amazon_finance_events` (gross, net) and is a separate channel.

---

## File map

**Create**
- `src/app/fonts.ts` — next/font/google exports (Archivo, Archivo Black, IBM Plex Mono) as CSS variables.
- `src/lib/metrics/period.ts` — `parsePeriod`, `previousWindow`, `pctChange`. Pure, tested.
- `src/lib/metrics/channel.ts` — `channelOf(order)` (the single channel rule), `isRevenueOrder`. Pure, tested.
- `src/lib/metrics/money.ts` — `formatINR`, `formatLakh` (₹9.4L), tested.
- `src/app/api/metrics/sales/route.ts` — `GET ?period=7d|30d|90d|12m` → totals by channel with previous-period comparison, daily series, top products, new vs returning.
- `src/app/api/metrics/attention/route.ts` — `GET` → the "Needs attention" list with ₹ at stake.
- `src/components/shell/nav.ts` — NAV hubs/items/badges definition.
- `src/components/shell/Sidebar.tsx` — 6-hub accordion sidebar (laptop).
- `src/components/shell/TabBar.tsx` — phone bottom tab bar.
- `src/components/shell/TopBar.tsx` — phone top bar (logo, hub name, search, bell).
- `src/components/shell/CommandPalette.tsx` — ⌘K search & jump.
- `src/components/shell/useMediaPhone.ts` — matchMedia hook (≤720px), no flash.
- `src/components/pm/Kpi.tsx` — new KPI strip (`KpiStrip` + `Kpi`), delta pill, no sparkline.
- `src/components/pm/Delta.tsx` — `▲ 18%` / `▼ 6%` pill from a number.
- `src/components/pm/Pill.tsx` — status pill with shape + word (good/warn/crit/info/neu/brand).
- `src/components/pm/HBars.tsx` — horizontal bar list (phone: label above bar).
- `src/components/pm/StackBar.tsx` — single stacked share bar + legend.
- `src/components/pm/LineChart.tsx` — SVG line with previous period dashed, direct end labels, hover tooltip.
- `src/components/pm/BarChart.tsx` — SVG grouped/stacked bars.
- `src/components/pm/Funnel.tsx` — horizontal funnel with % of previous.
- `src/components/pm/Table.tsx` — table that renders cards ≤720px (`cards` renderer prop).
- `src/components/pm/AttentionList.tsx` — attention rows (icon, title, one-line context, ₹, button).
- `src/components/pm/PeriodPicker.tsx` — segmented 7d/30d/90d(+12m) with "vs previous …" caption; syncs to `?period=`.
- `src/components/pm/Callout.tsx` — crit/sun/plain callouts.
- `src/app/dashboard/attention/page.tsx` — Needs attention.
- `src/app/dashboard/sales/page.tsx` — Sales overview.
- `src/app/dashboard/sales/web/page.tsx` — Web store (moved from shopify-attribution).
- `src/app/dashboard/sales/amazon/page.tsx` + `AmazonTabs.tsx`, `tabs/Overview.tsx`, `tabs/Stock.tsx`, `tabs/Profit.tsx`, `tabs/Payouts.tsx`, `tabs/Orders.tsx`.
- `src/app/dashboard/sales/orders/page.tsx` — Orders & COD (moved from order-confirmations).

**Modify**
- `src/app/layout.tsx` — swap Geist for the three brand fonts.
- `src/app/globals.css` — replace the `--pm-*` token block (line ~423-444) with brand tokens; alias old tokens (`--canvas`, `--card-bg`, `--border`, `--accent` …) to `--pm-*`; add the shell + new component CSS ported from `index.html`; add `@media (max-width:720px)` rules ported from the `@container app` block.
- `src/app/dashboard/layout.tsx` — use new shell (Sidebar / TopBar / TabBar / CommandPalette), badge counts from `/api/metrics/attention`.
- `src/app/dashboard/page.tsx` — rewrite as the approved Home.
- `next.config.*` — redirects: `/dashboard/shopify-attribution → /dashboard/sales/web`, `/dashboard/order-confirmations → /dashboard/sales/orders`, `/dashboard/amazon → /dashboard/sales/amazon`.
- `src/app/api/amazon/route.ts` — add `period` param honoured by every block; add `asin` and `lostProfitPerDay` to SKU rows; add `deposit_date`, `recon_note` to settlements.
- `docs/README.md` — index the plan; `docs/archive/` gets the 12 Sep refinement proposal (superseded).

**Delete (after their replacements ship)**
- `src/components/pm/KpiCard.tsx` (decorative sparkline), `src/components/Sidebar.tsx`, `src/app/dashboard/shopify-attribution/`, `src/app/dashboard/order-confirmations/`, `src/app/dashboard/amazon/` (replaced by redirects).

---

## Phase 0 — Foundations

### Task 0.1: Brand fonts and tokens

**Files:**
- Create: `src/app/fonts.ts`
- Modify: `src/app/layout.tsx`, `src/app/globals.css:423-444`

**Interfaces:**
- Produces CSS vars `--font-sans`, `--font-display`, `--font-mono` on `<html>`; `--pm-*` tokens as listed below; old token aliases.

- [ ] **Step 1: fonts.ts**

```ts
// src/app/fonts.ts
import { Archivo, Archivo_Black, IBM_Plex_Mono } from "next/font/google";

export const archivo = Archivo({ subsets: ["latin"], variable: "--font-sans", axes: ["wdth"], display: "swap" });
export const archivoBlack = Archivo_Black({ subsets: ["latin"], weight: "400", variable: "--font-display", display: "swap" });
export const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });
```

- [ ] **Step 2: layout.tsx** replaces Geist:

```tsx
import { archivo, archivoBlack, plexMono } from "./fonts";
// ...
<html lang="en" className={`${archivo.variable} ${archivoBlack.variable} ${plexMono.variable}`}>
```
Set `metadata.title` to `"PROMUNCH CRM"`, description `"Sales, customers and marketing for PROMUNCH"`.

- [ ] **Step 3: tokens.** Replace the `:root { --pm-app… --pm-font… }` block in `globals.css` with the values from `docs/plans/2026-09-15-crm-redesign/index.html` `:root` (light) plus the two dark blocks, renamed with the `--pm-` prefix and keeping every existing `--pm-*` name that components already read (`--pm-app`→`#F2F1EF`, `--pm-card`→`#FFFFFF`, `--pm-card2`→`#F8F7F6`, `--pm-border`→`#E4DFDD`, `--pm-line`→`#EFECEA`, `--pm-ink`→`#1D1517`, `--pm-muted`→`#5C5155`, `--pm-hint`→`#8A7F83`, `--pm-green`→`#1E7F55`, `--pm-green-soft`→`#E0F2E9`, `--pm-gold`→`#A95C00`, `--pm-gold-soft`→`#FCEBD6`, `--pm-terra`→`#BF311C`, `--pm-terra-soft`→`#FBE2DC`, `--pm-blue`→`#0A9CB8`, `--pm-blue-soft`→`#DDF1F5`, `--pm-side`→`#1D1517`, `--pm-side-text`→`#CFC5C8`, `--pm-side-accent`→`#FFC905`, `--pm-font`→`var(--font-sans),system-ui,sans-serif`). Add new: `--pm-brand:#AF272F`, `--pm-brand-ink:#FFFFFF`, `--pm-brand-soft:#F6E3E4`, `--pm-brand-line:#E9C2C5`, `--pm-cyan`, `--pm-cyan-soft`, `--pm-sun`, `--pm-sun-soft`, `--pm-orange`, `--pm-orange-soft`, `--pm-s-web`, `--pm-s-amz`, `--pm-s-hypd`, `--pm-s-wa`, `--pm-display:var(--font-display),"Arial Black",sans-serif`, `--pm-mono:var(--font-mono),ui-monospace,monospace`, `--pm-r:12px`, `--pm-r2:8px`, `--pm-shadow`.
- [ ] **Step 4: alias the old theme.** In the first `:root` block (line 2) set every old token to a pm token so old-styled modules retheme: `--canvas:var(--pm-app)`, `--card-bg:var(--pm-card)`, `--border:var(--pm-border)`, `--text:var(--pm-ink)`, `--muted:var(--pm-muted)`, `--accent:var(--pm-brand)`, `--green:var(--pm-green)`, `--gold:var(--pm-gold)`, `--blue:var(--pm-blue)` (map every old token that exists in that block; do not delete any). Body `font-family: var(--pm-font)`; base size 15px; `h1.pm-h1 { font-family: var(--pm-display) }`.
- [ ] **Step 5:** `npm run build && npm run lint`. Open `/dashboard` locally: page renders in crimson/ink with Archivo. Commit: `feat(ui): PROMUNCH brand tokens and fonts`.

### Task 0.2: Pure metric helpers (TDD)

**Files:** Create `src/lib/metrics/period.ts`, `channel.ts`, `money.ts` and `src/lib/metrics/metrics.test.ts`.

**Interfaces (produces):**
```ts
export type PeriodKey = "7d" | "30d" | "90d" | "12m";
export function parsePeriod(raw: string | null | undefined): PeriodKey;   // default "30d"
export function periodWindow(key: PeriodKey, now?: Date): { from: Date; to: Date };
export function previousWindow(w: { from: Date; to: Date }): { from: Date; to: Date }; // same length, ending at w.from
export function pctChange(current: number, previous: number): number | null; // null when previous is 0
export type ChannelKey = "web" | "hypd" | "amazon" | "other" | "creator";
export function channelOf(o: { is_creator?: boolean | null; source_name?: string | null; first_utm_source?: string | null }): ChannelKey;
export function isRevenueOrder(o: { financial_status?: string | null; is_creator?: boolean | null }): boolean;
export function formatINR(n: number): string;   // "₹1,42,300"
export function formatLakh(n: number): string;  // "₹9.4L", "₹86k", "₹980"
```

- [ ] **Step 1:** write `metrics.test.ts` covering: `parsePeriod("x")==="30d"`; `previousWindow` length equals and `to` equals original `from`; `pctChange(118,100)===18`, `pctChange(5,0)===null`; `channelOf({source_name:"web"})==="web"`, `{source_name:"341128478721"}→"hypd"`, `{is_creator:true}→"creator"`, `{source_name:"12345"}→"other"`; `isRevenueOrder({financial_status:"refunded"})===false`, `({is_creator:true})===false`; `formatLakh(940000)==="₹9.4L"`, `formatLakh(86000)==="₹86k"`, `formatINR(142300)==="₹1,42,300"`.
- [ ] **Step 2:** run `npx vitest run src/lib/metrics` → fails (module missing).
- [ ] **Step 3:** implement. `formatINR` uses `toLocaleString("en-IN", {maximumFractionDigits:0})`. `formatLakh`: ≥1e5 → one decimal L (strip `.0`), ≥1e3 → k with one decimal (strip `.0`), else whole rupees.
- [ ] **Step 4:** tests pass. Commit: `feat(metrics): shared period, channel and money helpers`.

### Task 0.3: `/api/metrics/sales`

**Files:** Create `src/app/api/metrics/sales/route.ts`. Uses `supabaseAdmin`.

**Interfaces (produces):**
```ts
type SalesMetrics = {
  period: PeriodKey; window: { from: string; to: string }; previous: { from: string; to: string };
  total: { revenue: number; orders: number; prevRevenue: number; prevOrders: number };
  channels: { key: ChannelKey; label: string; revenue: number; orders: number; prevRevenue: number; aov: number }[]; // web, hypd, amazon, other
  amazon: { gross: number; net: number; prevGross: number; prevNet: number; orders: number } | null;
  daily: { date: string; revenue: number; prevRevenue: number }[]; // web+hypd gross + amazon gross, aligned by day index
  repeat: { orders: number; pct: number; prevPct: number };       // customer_order_index > 1
  newCustomers: { count: number; prevCount: number };             // customer_order_index === 1
  topProducts: { title: string; units: number; revenue: number; share: number }[]; // from line_items, top 5
};
```

- [ ] **Step 1:** query `shopify_orders` for `shopify_created_at >= previous.from` selecting `total_price, shopify_created_at, financial_status, source_name, first_utm_source, is_creator, customer_order_index, line_items` in pages of 1000 (`.range()`), filter with `isRevenueOrder`, bucket by `channelOf` and by window (current vs previous). Amazon from `amazon_finance_events` (`posted_date, gross, net, event_type`) same two windows; orders count from `amazon_orders` (`purchase_date`).
- [ ] **Step 2:** `export const dynamic = "force-dynamic"`; cache response for 60s in memory keyed by period (module-level Map with timestamp) so Home polling doesn't hammer the DB.
- [ ] **Step 3:** curl locally with a session cookie (see memory: magic-link cookie trick) for `?period=30d` and `?period=7d`; totals must match the current `/api/shopify/stats` `d30.revenue` for web within rounding once creator seeds are excluded. Commit: `feat(api): shared sales metrics with previous-period comparison`.

### Task 0.4: `/api/metrics/attention`

**Files:** Create `src/app/api/metrics/attention/route.ts`.

**Interfaces (produces):**
```ts
type AttentionItem = { id: string; group: "money" | "customers" | "marketing"; severity: "crit" | "warn" | "info";
  title: string; context: string; amount?: number; amountLabel?: string; href: string; cta: string; count?: number };
type Attention = { items: AttentionItem[]; counts: { open: number; byHub: Record<"Today"|"Sales"|"Inbox"|"Marketing"|"Partners"|"System", number> } };
```
Sources (all existing tables/routes, read-only): Amazon stock-outs and lost profit/day (reuse the SKU logic in `src/app/api/amazon/route.ts`: extract `computeSkuEconomics` into `src/lib/amazon/economics.ts` and import from both); COD gate needs-call orders (`/api/whatsapp/cod-gate` logic, `sum(total_price)`); tickets open > 4h (`wa_threads.ticket_status in (open,pending)` and `ticket_opened_at < now-4h`; if that column is missing use `last_activity_at`); pending email drafts (`email_threads.status='pending'`); campaign paused by Meta cap (`wa_campaigns.status='paused'` with `last_error` containing `131049`); abandoned carts unreachable (`wa_journey_runs` kind abandoned_cart, status failed, last 7d, sum cart value if available). Sort by `amount desc, then age`.

- [ ] Implement, curl, commit: `feat(api): needs-attention feed with rupees at stake`.

### Task 0.5: Presentation components

**Files:** Create the `src/components/pm/*` files listed in the file map; extend `src/components/pm/index.ts`; port CSS from `index.html` (classes `.kpis .kpi .dl .pill .hb .stack .legend .chart .funnel .tbl .cards .rowc .att .callout .seg .chips .chip .panel .p-head .p-body .p-foot .btn` and the phone block) into `globals.css` under a `/* pm v2 */` banner, replacing `@container app (max-width:720px)` with `@media (max-width:720px)`.

**Interfaces (produces):**
```tsx
<KpiStrip cols={4|3}> <Kpi label value delta={number|null} sub tip /> </KpiStrip>
<Delta value={number|null} tip? />
<Pill tone="good|warn|crit|info|neu|brand" plain?>text</Pill>
<HBars items={{label,value,text,sub?,color?,tip?}[]} max? />
<StackBar parts={{label,value,text,color}[]} />
<LineChart series={{name,color,values:number[],dash?}[]} labels={string[]} fmt? aria />
<BarChart cats={string[]} series={{name,color,values}[]} fmt? labels? />
<Funnel steps={{label,value,text,color?}[]} />
<Table<T> cols={{h,key|render,num?}[]} rows={T[]} card={(row)=>({title,value,meta})} />
<AttentionList items={AttentionItem[]} />
<PeriodPicker options={["7d","30d","90d"]} value onChange caption />
<Callout tone="crit|sun|plain" title body action? />
<Panel title basis? right? foot?>…</Panel>  // update existing Panel to accept basis/right/foot
```
Rules: no decorative sparklines; charts label the last point directly; `Table` renders `<div class="cards">` under 720px using `card()`; every component is a plain function component reading `--pm-*` tokens only.

- [ ] Build each; render them all on a temporary `/dashboard/_kit` page to eyeball at 1280 and 390 wide (delete the page before commit). `npm run build && npm run lint`. Commit: `feat(ui): pm v2 components (kpi strip, pills, charts, phone-aware table)`.

### Task 0.6: Shell — sidebar, tab bar, top bar, ⌘K

**Files:** Create `src/components/shell/*`; modify `src/app/dashboard/layout.tsx`; delete `src/components/Sidebar.tsx` once nothing imports it.

**nav.ts (produces):**
```ts
export type Hub = "Today" | "Sales" | "Inbox" | "Marketing" | "Partners" | "System";
export const NAV: { hub: Hub; color: string; icon: LucideIcon; items: { label: string; href: string; badge?: keyof AttentionCounts }[] }[] = [
  { hub:"Today", color:"#1D1517", items:[{label:"Home",href:"/dashboard"},{label:"Needs attention",href:"/dashboard/attention",badge:"open"},{label:"Ask Maya",href:"/dashboard/assistant"}] },
  { hub:"Sales", color:"#AF272F", items:[{label:"Overview",href:"/dashboard/sales"},{label:"Web store",href:"/dashboard/sales/web"},{label:"Amazon",href:"/dashboard/sales/amazon"},{label:"Orders & COD",href:"/dashboard/sales/orders",badge:"orders"}] },
  { hub:"Inbox", color:"#0A9CB8", items:[{label:"Conversations",href:"/dashboard/whatsapp",badge:"inbox"},{label:"Tickets",href:"/dashboard/whatsapp?tab=tickets"},{label:"Email drafts",href:"/dashboard/support-emails"},{label:"Instagram",href:"/dashboard/instagram"}] },
  { hub:"Marketing", color:"#FFC905", items:[{label:"Campaigns",href:"/dashboard/whatsapp?tab=campaigns"},{label:"Email campaigns",href:"/dashboard/campaigns"},{label:"Automations",href:"/dashboard/whatsapp?tab=flows"},{label:"Email automations",href:"/dashboard/flows"},{label:"Audience",href:"/dashboard/contacts"},{label:"Templates",href:"/dashboard/whatsapp?tab=templates"},{label:"Sign-up popup",href:"/dashboard/whatsapp?tab=growth"}] },
  { hub:"Partners", color:"#E86A24", items:[{label:"B2B leads",href:"/dashboard/leads"},{label:"Deals",href:"/dashboard/deals"},{label:"Creators",href:"/dashboard/instagram?tab=discovery"}] },
  { hub:"System", color:"#8A7F83", items:[{label:"Bot knowledge",href:"/dashboard/whatsapp?tab=kb"},{label:"Health",href:"/dashboard/settings#connections"},{label:"Settings",href:"/dashboard/settings"},{label:"Activity",href:"/dashboard/audit-log"}] },
];
```
(Phase 2–4 replace the `?tab=` hrefs with real pages; the hub structure is final now.)

- [ ] **Sidebar.tsx:** 228px, `--pm-side` ground, logo `/pm-logo-64.png` + PROMUNCH wordmark in `--pm-display`, search row that opens the palette (`⌘K`), hub accordion: active hub expanded (by pathname), other hubs show as a single row with item count; active item white pill. Footer: initials avatar (sun), name, role, sign-out (reuse the Supabase logic from the old Sidebar). Keep `data-tour` attributes for `dashboard`, `whatsapp`, `contacts`, `settings` so `Onboarding.tsx` still works.
- [ ] **TabBar.tsx:** fixed bottom, 5 tabs Today / Sales / Inbox / Marketing / More, badges from attention counts; "More" opens a sheet listing Partners + System items.
- [ ] **TopBar.tsx:** phone only: logo, hub name, search icon (palette), bell (→ `/dashboard/attention`).
- [ ] **CommandPalette.tsx:** opens on ⌘K / Ctrl-K / search taps. Searches nav items locally; after 2+ chars fetches `/api/contacts?q=` and `/api/whatsapp/threads?q=` (both exist) and lists Customers, Conversations, Pages, Actions ("Message X on WhatsApp"). Arrow keys + Enter; Esc closes. Full-screen on phone.
- [ ] **useMediaPhone.ts:** `useSyncExternalStore` over `matchMedia("(max-width:720px)")` with server snapshot `false`; layout renders both shells with CSS `display` toggles so there's no flash.
- [ ] **layout.tsx:** replace Sidebar/MobileHeader with `<Sidebar/>`, `<TopBar/>`, `<TabBar/>`, `<CommandPalette/>`; badge counts from `/api/metrics/attention` via React Query, `refetchInterval: 60_000`.
- [ ] Build, lint, test. Check at 1280 and 390 (Playwright in `.playwright-mcp/`): no sideways scroll, active hub expands, ⌘K opens. Commit: `feat(shell): six-hub navigation, phone tab bar and command palette`.

### Task 0.7: Redirects + docs

- [ ] `next.config`: `redirects()` for the three moved routes (permanent: false until Phase 1 pages exist, then true).
- [ ] Move `docs/audits/2026-09-12-dashboard-refinement-*` and `docs/plans/2026-09-12-dashboard-refinement-review.md` into `docs/archive/2026-09-12-dashboard-refinement/`; add this plan and the prototype folder to `docs/README.md`. Commit: `docs: archive 12 Sep refinement, index 15 Sep redesign plan`.

---

## Phase 1 — Today + Sales hubs

Each page: client component, React Query, `PeriodPicker` writes `?period=` to the URL and every query on the page keys on it. Markup and copy follow `screens.js` for that screen id exactly (including tooltip text on numbers). Loading state: `KpiStrip` with `—` values and panels with a 120px skeleton; error state: a `Callout tone="crit"` with a Retry button.

### Task 1.1: Home (`screens.js` id `home`)
- Modify `src/app/dashboard/page.tsx` (rewrite). Data: `/api/metrics/sales?period=`, `/api/metrics/attention`, `/api/whatsapp/health` (for "chats today / by bot / human reply" using `checks24h`, inbound/outbound counts). Delete `distribute()`, all `KpiCard` usage, the hardcoded "AI drafts ready" and email SPF pill. Title = weekday + date in `--pm-display`; crumb "Today · Good morning/afternoon/evening, {first name}".
- Test: `npm run build`; visual at 1280/390 matches prototype 01.

### Task 1.2: Needs attention (`attention`)
- Create `src/app/dashboard/attention/page.tsx`. Chips Open / Snoozed / Done today. Snooze stores `{id, until}` in `localStorage` `pm-attention-snooze` (per-viewer convenience only). Groups: Money at risk (sum of amounts in the heading), Customers waiting, Marketing.

### Task 1.3: Sales overview (`sales`)
- Create `src/app/dashboard/sales/page.tsx`. KPIs total/AOV/new customers/returning revenue; `BarChart` weekly by channel (group `daily` into ISO weeks, last 4–13 weeks depending on period); channel scorecard `Table` with `Delta`; top products `Table`.

### Task 1.4: Web store (`web`)
- Create `src/app/dashboard/sales/web/page.tsx`; move the attribution aggregation out of `shopify-attribution/page.tsx` into `src/app/api/metrics/web/route.ts` (server-side, paged, honours `period`, excludes creators by default with `?creators=include`). Sources named: Instagram ads (utm_source instagram/ig), WhatsApp (utm_source whatsapp or medium whatsapp), Direct, Google, Creators (HYPD), Email, Not tracked. Delete `shopify-attribution/`.

### Task 1.5: Amazon ×5 tabs (`amazon`, `amz-stock`, `amz-profit`, `amz-payouts`, plus Orders)
- Extend `src/app/api/amazon/route.ts`: `period` applies to **every** block; SKU rows gain `asin`, `lostProfitPerDay`, `daysLeft` (null when no 30-day sales; `"untracked"` for MFN); settlements gain `deposit_date`, `recon_note`, `matched: boolean` (|variance| ≤ 50). Extract `src/lib/amazon/economics.ts` (shared with attention feed).
- Create `src/app/dashboard/sales/amazon/page.tsx` with `?tab=overview|stock|profit|payouts|orders`. Overview: crit callout only when a SKU is out; 4 KPIs (customers paid / paid to you / your profit / margin); "Where the money went" 5-row money bars; 3 small facts. Stock: stripe rows, big days-left number, `amazon.in/dp/{asin}` + Seller Central links, Restock button (links to Seller Central inbound shipment page). Profit: per-product 3-segment bar (Amazon keeps / product cost / you keep) + inline cost-price editor (existing `POST /api/amazon/costs`). Payouts: bar chart of deposits + table with Matched / "₹X short" pill (tooltip explains reserve). Orders: last 50 as `Table` with cards on phone. Delete `src/app/dashboard/amazon/`.

### Task 1.6: Orders & COD (`orders`)
- Create `src/app/dashboard/sales/orders/page.tsx`; tabs Needs a call / All orders / Coverage. Call list first with `tel:` links and Confirm / Cancel (existing `POST /api/whatsapp/cod-gate`, Cancel behind an in-app confirm dialog, not `window.confirm`). "Resend N missing" opens a confirm sheet stating the number of people who will receive a WhatsApp message before calling the existing POST. COD gate window follows the page period (extend `/api/whatsapp/cod-gate` GET with `?hours=`). Money without paise. Delete `order-confirmations/`.

### Task 1.7: Verification and ship
- `npm run build && npm run test && npm run lint`.
- Playwright pass: every Phase 1 route at 1280 and 390, `document.body.scrollWidth <= innerWidth`, no console errors.
- Live check: numbers on Home vs Shopify admin for the same 30 days (within refunds), Amazon "Paid to you" vs Seller Central last payout.
- `vercel --prod`. Update memory file. Report committed vs deployed explicitly.

---

## Later phases (own plans, written when Phase 1 is live)
- **Phase 2 Inbox:** unified conversations (WhatsApp + Instagram + email), tickets board, email drafts queue. Visual only; no send-path changes.
- **Phase 3 Marketing:** campaigns list with revenue and grade across channels, campaign report, 4-step wizard, automations recipes + flowchart, audience segments, templates, sign-up popup results.
- **Phase 4 Partners + System:** B2B pipeline, sequences timeline, deals with ₹ value (needs `deals.value` column), creators pipeline, bot knowledge + gaps (needs bot-fallback logging in `wa-ai-reply`, which is a WhatsApp change and needs explicit approval), real health checks, settings with real connection tests, activity log in sentences.
