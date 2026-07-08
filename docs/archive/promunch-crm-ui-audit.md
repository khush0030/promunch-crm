# PROMUNCH CRM — UI Audit (codebase-level)

A code-grounded plan to make the CRM simpler for a mixed small team. This version is written against the actual `promunch-crm` repository — every recommendation points at a specific file so your dev team can act on it directly.

---

## What I found in the codebase

The repo already contains `PROMUNCH_CRM_Redesign_Spec.md` and `PROMUNCH_CRM_Redesign_Final.html` from 20 May, and **that redesign has been implemented**. The warm/editorial design system lives in `src/app/globals.css` (tokens, `.card`, `.kpi`, `.pill`, `.tbl`, `.chip`, `.empty`), and `src/components/Sidebar.tsx` already has the five collapsible groups (Overview / Inbox / Audience / Marketing / System) with `localStorage` persistence and count badges.

So this is **not a restyle**. The visual foundation is solid. What's left is a different kind of work: consistency gaps, redundant controls, one real data bug, and missing "what do I do next" signals. Your full page structure stays exactly as it is — nothing is removed.

Stack, for reference: Next.js 16 (App Router), React 19, Tailwind v4 + the CSS variables in `globals.css`, Supabase, Geist font.

---

## The one actual bug — fix this first

**WhatsApp shows "Not connected" on the Dashboard while the WhatsApp page says "Operational".**

In `src/app/dashboard/page.tsx`, `detectChannels()` (lines ~110–121) decides WhatsApp's status by counting rows in the `wa_contacts` table:

```
const { count: waCount } = await supabase.from("wa_contacts").select("id", {count:"exact", head:true});
ch.push(waCount && waCount > 0 ? {status:"ok", ...} : {status:"off", detail:"Not connected"});
```

But the WhatsApp inbox runs off `wa_threads` and the Cloud API health endpoint (`/api/whatsapp/health`, used by `StatusMeter` in `whatsapp/page.tsx`). So if `wa_contacts` is empty, the Dashboard's Channels card says "Not connected" even though WhatsApp is live and handling messages.

**Fix:** in `detectChannels()`, determine WhatsApp status from the same `/api/whatsapp/health` endpoint the StatusMeter already calls (or count `wa_threads`). One source of truth. Mismatched status like this makes the team distrust every other number on the Dashboard.

---

## Priority 1 — Quick wins

Small, isolated changes. No schema or routing work.

**Remove the duplicated controls in the WhatsApp conversation header.** In `whatsapp/page.tsx`, `ConversationPane`'s header renders the status / ticket / priority as **`Pill` components** (lines ~512–521) *and* repeats all three as **`<select>` dropdowns** (lines ~544–552+). The dropdowns are the actionable ones — keep them, delete the three pills from the open-conversation header. (The same pills on the conversation *list* rows, lines ~361–370, are fine — that list is read-only context.)

**Make "Outbound 24h — 5 failed" clickable.** In `StatusMeter` (`whatsapp/page.tsx` ~lines 164–174) the failed count renders in accent red but does nothing. Make it a button that filters `InboxView` to the failed-outbound messages, each with a Retry action. A red number you can't act on is just anxiety.

**Replace `alert()` with the existing Toast.** `whatsapp/page.tsx` uses raw `alert()` for errors and confirmations (lines ~468, 490, 979, 1365, 1381, 1515, 1672). The app already ships a toast system — `ToastProvider` is wired up in `dashboard/layout.tsx` and `src/components/ui/Toast.tsx` exists. Swap the `alert()` calls for toasts so feedback matches the rest of the UI.

**Use the standard empty state on Contacts.** `contacts/page.tsx` (lines ~408–418) hand-rolls its "No contacts yet" block with inline styles. `globals.css` already defines a nicer `.empty` component (dashed border, icon tile, title, sentence, button). Use it — consistency for free.

---

## Priority 2 — Dashboard (`src/app/dashboard/page.tsx`)

The Dashboard should answer one question on load: *what needs me right now?* Today it opens straight into KPI tiles.

**Add a "Needs attention" section above the KPI grid.** Right now the only attention signal is `<ConnectorBanner />` (rendered at line 346). Add a short action list above the `kpi-grid` that surfaces: failed WhatsApp sends (from `/api/whatsapp/health` → `failedOutbound24h`), degraded integrations (already in `/api/integrations`), and unresolved high-priority tickets (`email_threads` / `wa_threads`). Each row = one sentence + one button. The data sources already exist; this is a new presentational block.

**Turn `ConnectorBanner` rows into actions, not bullets.** `ConnectorBanner.tsx` renders broken integrations as a `<ul>` of bullet points (lines ~64–70) with a single shared "View details →" link. Give each integration its own row with its own Fix button — an empty state should always offer the next click.

**Show "connect to unlock" for dead KPIs.** The KPI grid (lines ~348–419) always renders all four tiles, so Revenue shows ₹0 and Email open rate shows "—" until Shopify is connected. When there are zero orders *ever* (not just zero in the selected range), render those tiles as a soft "Connect Shopify to see revenue →" card instead of a real-looking ₹0.

**Merge "List health" and "Channels" into one "Connections" panel.** They sit side by side in a `grid-2` (lines ~421–512) and both answer "is my data flowing?" One combined panel is calmer — though this is lower urgency than the items above.

---

## Priority 3 — WhatsApp (`src/app/dashboard/whatsapp/page.tsx`)

This is the strongest page already — the three-pane `InboxView` layout is right, and `tickets` is sensibly handled as `InboxView` with `ticketsOnly` rather than a duplicate screen. The fixes are about removing weight.

**Collapse the `StatusMeter` strip.** `StatusMeter` puts six monitoring stats (Cloud API, Uptime 24h, Uptime 7d, Last message, Outbound, AI replies) above the inbox the team uses all day. Collapse it to a single status pill ("WhatsApp · Operational") that expands on click for the detail. Uptime belongs on the Settings or Integrations page, not above the inbox.

**Consider Tickets as a filter, not a top tab.** `Tabs` offers inbox / tickets / templates / campaigns / kb. Since Tickets is already just `InboxView` filtered, it could become a filter chip inside the Inbox tab — one fewer tab. Templates, Campaigns, and Knowledge Base can stay as tabs. Low urgency; do it only if the tab bar feels heavy.

**Link the WhatsApp customer panel to CRM contacts.** The `CustomerPanel` can show a person's orders while still saying "No CRM contact matched this number yet" — the WhatsApp `wa_contacts`/`wa_threads` records and the CRM `contacts` table aren't joined. Match on phone number so the panel shows one unified person. See Priority 4 — this is the same underlying gap.

---

## Priority 4 — Contacts (`src/app/dashboard/contacts/page.tsx`)

**Make segments and lists into filters, not just row decoration.** The filter chips are status-only — `const filters = ["All","active","inactive","unsubscribed","bounced"]` (line 34). Klaviyo lists and segments appear *only* as static `.tag` chips inside each row (lines ~384–401), so the team can see "winback-no purchase in 60 days" but can't click it to filter. Add the common segments as filter chips alongside the status chips, wired to the existing `/api/contacts` query params.

**Collapse the two import buttons into one menu.** The header always shows "Import from Klaviyo" and "Import from Shopify" (lines ~176–193). Importing is a setup task, not a daily one. Make it a single "Import / Sync ▾" button; once a source is connected, show "Synced 2h ago" instead.

**Hide the all-zero columns until Shopify syncs.** Every row currently shows `0` orders and `₹0` LTV because order data isn't connected (the code already greys ₹0 via `text-3`, lines ~368–376 — good instinct). Go one step further: when no contact in the result set has any orders, hide the Orders / Lifetime value / Last order columns entirely until Shopify is linked. A table where every cell reads zero is just noise.

**Unify the customer record (the backend piece).** A person can exist as a CRM `contact` (email) and a WhatsApp `wa_contact` (phone) with nothing linking them — which is why the WhatsApp panel can't find them and why contact profiles look empty. Matching on email + phone so each customer is one record is the highest-value backend change; it unblocks both this page and the WhatsApp panel.

---

## Priority 5 — Connecting it all (`src/app/dashboard/flows/page.tsx`)

Your stated goal is WhatsApp marketing and order confirmations running on one backend. You're keeping **Flows** as its own page — so make Flows the home for this rather than adding a new page.

**Let Flows cover triggered automations, not just marketing flows.** Order confirmation, shipping update, abandoned checkout, winback — list them on the Flows page as on/off cards, each showing channel (WhatsApp/Email), trigger, and sends this week. These already fire (the WhatsApp inbox shows `[template:abandoned_checkout]` and order-confirmation sends) but there's no one screen to see or control them.

**One template library, reused everywhere.** WhatsApp templates currently live only in the WhatsApp `templates` tab (`/api/whatsapp/templates`). Campaigns, Flows, and WhatsApp quick-replies all need them. Expose one library, tagged by channel — write a template once, use it anywhere.

---

## Visual system — already done, just stay consistent

`globals.css` is a complete, well-built design system: one warm canvas, one accent (`--accent` crimson), status colours (`--green`/`--amber`/`--blue`), `.card`, `.kpi`, `.pill`, `.tbl`, `.chip`, `.empty`. No new tokens needed. The only visual debt is **drift from it** — e.g. `whatsapp/page.tsx` defines local colours (`BRAND_DARK`, `WA_GREEN`, raw `rgba()` in `priorityStyle`/`ticketStatusStyle`, lines ~67–107) and the contacts page hand-rolls an empty state. The rule going forward: reach for the `globals.css` class or variable before writing an inline style.

---

## Suggested sequence

1. **The WhatsApp "Not connected" bug** — `detectChannels()` in `dashboard/page.tsx`. Small, and it's actively misleading the team.
2. **Week 1 — Quick wins (Priority 1).** Duplicated header controls, clickable failed-count, `alert()` → Toast, standard empty state.
3. **Week 2 — Dashboard.** "Needs attention" block; `ConnectorBanner` rows become actions; "connect to unlock" KPI cards.
4. **Weeks 3–4 — Unified customer record.** The email/phone join. Unblocks Contacts and the WhatsApp panel.
5. **Week 5 — WhatsApp polish.** `StatusMeter` → status pill; Tickets-as-filter if wanted.
6. **Week 6 — Flows page + shared template library.**

Each step ships on its own — the team gets a simpler app at every stage.

---

## Companion file

`promunch-crm-redesign-mockup.html` (same folder) is a clickable visual target for the three priority screens — Dashboard with "Needs attention", WhatsApp with the collapsed status pill and de-duplicated header, and Contacts with segment filters. It reflects the recommendations above; open it alongside this document.
