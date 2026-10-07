# PROMUNCH CRM redesign prototype (7 Oct 2026)

A clickable design prototype for the full CRM redesign: every screen on laptop and phone, including pop-ups, drawers, toasts and empty states. **Design only.** No app code was changed, nothing was deployed, and all names and numbers are illustrative (product names are real PROMUNCH products).

**Direction in one line:** bold outside, calm inside. promunch.in's own fonts (Archivo Black, Assistant, JetBrains Mono) and colours (PROMUNCH red #AF272F on warm paper #F4F1EA, ink #1A1714, sun #FEBD11 for Maya only), with far fewer, bigger, quieter elements than today.

## How to view
- Open `index.html` in a browser (works from the file system; internet needed only for Google Fonts and the Lucide icon script). Or serve the folder: `python3 -m http.server` and open `http://localhost:8000/index.html`.
- The thin dark strip at the top is review chrome, not part of the app: **All screens** lists every screen and pop-up across all files; **Phone frames** shows key screens at 390px; **Design system** opens the component sheet.
- Every page is responsive. Make the window narrow (or open on a phone) to see the phone layout: bottom tabs, bottom sheets, tables as cards.
- Deep links: `file.html#screen` opens a screen, `file.html#screen/popup` opens it with a pop-up showing, e.g. `whatsapp.html#wa-new/launch`.
- Shortcuts: ⌘K search, ⌘J Ask Maya, Esc closes pop-ups. Buttons that would change data show a toast instead.

## Files
| File | What's in it |
|---|---|
| `01-brand.md` | Brand extraction from live promunch.in: fonts, palette with roles, type scale, radius, shadows, icons, voice, copy rules |
| `02-prior-work.md` | Prior redesigns reviewed, what we keep, measured causes of today's congestion |
| `03-screen-inventory.md` | Every current route, tab and modal → its new home and prototype anchor |
| `04-ia.md` | Sidebar (8 items, 3 groups), phone nav, search, notifications, old → new URL map |
| `system.html` | Design system: colour, type, buttons, status, inputs, cards, KPI tiles, tables, charts, toasts, empty states, modal, drawer, navigation, rules |
| `index.html` | Home: Today, Needs you, all-clear empty state, snooze, first-run welcome |
| `tickets.html` | Inbox helpdesk: ticket queue with views and SLA, ticket detail (reply vs internal note, properties, customer + order sidebar), saved replies, merge, escalate, solve + CSAT, rules (SLA, auto-close, survey), live WhatsApp chats, AI email drafts, bot knowledge, reports |
| `whatsapp.html` | WhatsApp: overview, campaigns (+ empty), 4-step campaign wizard with phone preview, test send, launch, report, follow-up drawer, templates, guided template creator, automations, automation detail, results |
| `email.html` | Email: overview, campaigns, 4-step builder with block editor and admin approval, report, automations, automation detail with click-to-edit, templates, template editor, results |
| `analytics.html` | Insights: sales by channel (D2C / Amazon / HYPD), website, repeat & cohorts (retention heatmap, time to 2nd order, RFM groups), what people buy (mix, bundles, AOV, first product → repeat), Amazon (stock days left, profit, payouts, product drawer, shipment plan) |
| `maya.html` | Ask Maya: suggested questions, answer card with chart + table + sources, save / pin, thinking + can't-answer states, saved answers |
| `cod-voice.html` | Orders & COD: confirm COD list, voice-agent tracker (outcomes, trend, RTO saved), call drawer with recording, transcript and retries, all orders + order drawer, call rules |
| `b2b.html` | B2B: Find → Review → Send → Track overview, find, one-at-a-time review, batch send as Parth, sent & replies, deals board + drawer, setup |
| `influencers.html` | Creators desk: board with health chips, collab page (draft review, brief, box, timeline, reminders), add collab, ship kit, approve / request changes, brief builder, library + creator profile, kits, settings with WhatsApp nudge and owner digest previews |
| `portal.html` | Public creator portal `/c/[code]`: brief + agree, box arrived, submit draft, approved checklist, request a change |
| `other.html` | Customers (list, profile, GDPR delete, import, segments + builder, sign-up popup), Settings (connections, team & access, invite, API keys, brand & email, security), no-access, error / stale / loading patterns, retired pages |
| `public.html` | Login, set password, unsubscribe, short-link fallback, 404 |
| `mobile.html` | 31 key screens and pop-ups in 390px phone frames |
| `app.css`, `app.js`, `manifest.js`, `assets/` | Shared styles (all colours as tokens), shell + interactions + tiny SVG chart renderer, screen list, PROMUNCH logo from the live site |
| `screenshots/` | Playwright captures at 1440 (`d-*`) and 390 (`m-*`) used for the review pass |

## Coverage
- Current app: **55 page routes** (50 dashboard, 5 public/auth) plus 3 tab-level modules and 1 route handler. **All mapped**, none left out (see `03-screen-inventory.md`).
- Prototype: **73 designed screens + 60 pop-ups, drawers and sheets**, every one responsive (laptop 1440 and phone 390), plus the design system and phone-frames pages.
- Retired rather than redrawn (their old URLs redirect): Brevo email hub (7 tabs), legacy email campaigns / flows, Instagram page (backend not live). Shown once in `other.html#retired`.
- Checked with Playwright on every screen and pop-up at 1440 and 390: no horizontal page scroll, no missing icons, no script errors.

## What changed, in short
- Sidebar from 6 hubs / ~26 entries to **8 items in 3 groups**, light, collapsible; Ask Maya pinned in yellow; phone tabs Home · Inbox · Maya · Orders · More.
- **Max 5 tabs** per page (WhatsApp 8 → 5, Amazon 5 tabs → 1 page, Leads 6 tabs + 9 modals → a 4-step flow).
- Body text 13.5px → **16px**, rows 40 → 60px, KPI tiles max 3 to 4, one red accent per view, one primary button per page.
- Each page opens with one plain sentence holding the key number.
- Shared things live once: segments in Customers (used by WhatsApp and Email), bot knowledge in Inbox, voice in Orders.

## Open questions for the owner
1. **Sidebar wording**: "Creators" or "Influencers"? "Insights" or "Reports"? "Orders & COD" or just "Orders"?
2. **Marketing as one item** with WhatsApp / Email inside, or two top-level items (9 total)?
3. **Ticket statuses and SLA**: OK with New · Open · Waiting on customer · On hold · Solved · Closed, and first reply in 1h urgent / 4h normal, 9 am to 9 pm IST every day? Should Sundays pause the clock?
4. **Who gets escalations**: keep order issues → Narendra, everything else → Khush?
5. **CSAT survey** on WhatsApp 2 hours after solving: OK to send (it's a utility message, one per ticket)?
6. **B2B**: daily send cap for Parth's mailbox (prototype shows 40), and should replies auto-create deals or wait for a click?
7. **Instagram**: retire the page now and bring DMs back inside Inbox once Meta approves?
8. **Brevo**: confirm the hub can be retired (Email Studio is live).
9. **Amazon profit**: which costs to include (making + packing only, or also inbound freight and ads)?
10. **Dark mode**: wanted, or light only (the storefront is light)?
11. **Login domains**: confirm which email domains may sign in (prototype says promunch.in, trypromunch.in, vippysoya.com).
12. **Footer postal address** for emails: please supply the exact one (left as a placeholder).
