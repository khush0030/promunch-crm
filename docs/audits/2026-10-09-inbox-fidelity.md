# Inbox (Live chats) fidelity audit, 9 Oct 2026

Branch `redesign/app-v2`. Owner feedback: the Inbox, especially Live chats, still looked like the old UI. It felt cramped and scattered, wasted white space, had little colour, had no clear channel buttons, and never got the designed three-panel layout.

**Source of truth.** The prototype in `docs/plans/2026-10-07-app-redesign/`:

- `tickets.html#tk-chats`: Live chats.
- `#cust-peek`: customer quick profile.
- `#tk-ticket`: ticket detail side panel, with the customer card and "This order".
- `app.css`: `.ibx`, `.tk`, `.conv` (`grid-template-columns: minmax(0,1fr) 320px`), `.statline`, `.kv`, `.peek-ord`, `.pcard` and `.side-panel`.

**Code audited.**

- `src/app/dashboard/inbox/page.tsx` and `inbox.module.css`
- `src/components/inbox/*` (WaConversation, ConversationHeader, EmailPane)
- `src/components/pm/ListRow.tsx`
- the `pm2-inbox-*` rules in `globals.css`

## What the prototype shows vs what was built (before this pass)

| Area | Prototype | Built before | Gap |
|---|---|---|---|
| Layout | One card that fills the viewport (`.ibx`, height `100vh - header`). It has a list column, a conversation, and the customer beside the chat: the `.conv` side panel (320px) plus the `#cust-peek` profile. | Two columns (`340px / 1fr`) with negative margins and a hard-coded `100dvh - 75px` height. No customer column. | **Third panel missing.** The height was a guess, so the page scrolled and white space showed below. |
| Channel switching | "Channels" group in the views rail (WhatsApp, Instagram "off"). Owner now asks for clear All / WhatsApp / Email buttons. | A small native `<select>` ("All channels") next to search. | No visible channel buttons and no channel colour. |
| Views | Need a human / Mine / Bot handling / All, with counts and the active count in red. | Pill chips that wrapped onto 2 rows in a 340px column ("All" alone on row 2). | Scattered and wasted a row. |
| Rows | `.tk` rows: avatar, bold name and time, preview, then a meta line (status pill, window chip). The selected row has a red-soft fill and a 3px red bar. Unread shows a red dot. | `ListRow`: name + pill, preview, time + unread badge. The selected row was red-soft but had no bar. Channel showed only as a 15px letter badge on the avatar ("W"/"E"). | Email and WhatsApp were hard to tell apart. No assignee indicator. |
| Conversation header | `.chat-h`: who-button with name and facts, a window status strip, and Take over. | Compact header: everything on one wrapping flex row (pill, window chip, Take over, Share, Assign) that broke at random points. | Ragged wrapping and no channel colour. |
| Customer context | Avatar, name, city, "customer since" and tags. Call / Copy / Profile. Statline (orders · spent · tickets). Orders with state (COD confirmed on WhatsApp, delivered). WhatsApp / Email / Address. Tags. "This order". | One faint text line ("WhatsApp · 0 orders") and a "Profile →" link. COD only as "waiting" text. | **No history at all:** no orders list, no past WhatsApp or email threads, no tickets, no COD status, no tags. |
| Email in the pane | Not in the chat prototype. The owner wants an Email channel in Live chats. | Plain text block plus a "Current draft" box. | Read as unstyled. The draft was not visually distinct. |
| Colour | Brand red only for selection and urgent states. Good (green), info (teal) and warn (amber) as coloured text. Soft tints for avatars. | Mostly grey. Colour only in pills. | Lacked colour. |
| Phone (390) | List, then tap into the thread. The customer is a drawer. | List, then tap to the full page. The full page showed a short facts block only. | No customer history on phone. |

## What was built in this pass

**1. Three-panel shell** (`src/app/dashboard/inbox/page.tsx` and `inbox.module.css`)

- One card fills the viewport below the page header. Its height is measured at runtime, not guessed with a fixed calc. Each column scrolls on its own.
- Columns at ≥1280px: `340px · 1fr · 330px`.
- From 1024 to 1279px: list and conversation, with the customer panel as a slide-in drawer. A "Customer" button in the conversation header opens it.
- At ≤720px the page shows the list only. Tapping a row opens the full conversation page, as before.

**2. List column**

- A segmented channel switch: **All / WhatsApp / Email**. WhatsApp is green and Email is blue, each with an icon and a coloured underline when active.
- The views (Need a human / Mine / Bot / All) sit on one row as count-over-label tabs. The active tab is underlined in red.
- Search box.
- Dense rows: avatar with a channel badge, bold name and time, preview, then a meta line. The meta line shows the **channel tag** (icon + "WhatsApp" / "Email" in channel colour), the status as coloured text with a dot, the assignee ("You" or a name), and the unread count. A faint left rule in channel colour marks each row. The selected row gets a red-soft fill and a red bar.
- Paging footer. Instagram stays out of the switcher, as before.

**3. Conversation column**

- Reuses `WaConversation` / `IgConversation` (peek + compact) and the email pane.
- The compact header now has a channel-coloured top rule and a channel tag. The name and status sit on line 1, with actions on their own row.
- The email pane is restyled: one hairline sheet for the message, and the bot's draft under a sun-yellow rule.
- **No send logic, guards, dedup claims or POST payloads changed.** The only change to `WaConversation` is an `extraActions` prop for the drawer toggle.

**4. Customer panel**

- New read-only route `GET /api/inbox/context?key=wa-<id>|em-<id>`, covered by the existing `/api/inbox` → Inbox area mapping in `access.ts`.
- Pure builder `src/lib/inbox/context.ts`, with unit tests.
- Component `src/components/inbox/CustomerContext.tsx`. It shows:
  - Name, city and "customer since"
  - WhatsApp number (masked) and email
  - Copy number / Copy email / Profile
  - Statline: orders, spent and tickets. HYPD ₹0.01 seeds and cancelled orders are left out.
  - Tags: new or repeat customer, WhatsApp opt-in, no email, `rfm:*` and other tags
  - **Cash on delivery** status from the newest gated order
  - **Orders** from `shopify_orders` by phone or email, each with paid/COD and shipped/to ship/cancelled. Rows link to the Shopify admin.
  - **Tickets** (the WhatsApp thread's ticket)
  - The **WhatsApp** thread: status, plus the last 4 messages when you are reading an email
  - **Email** threads from `email_threads` by address, with the open one marked
- The full-page conversation (`/dashboard/inbox/wa-…`, also used by Tickets) shows the same panel in its side column. On phones it stacks under the thread.

**5. Channel colours** (`ChannelTag.tsx` and `channel.module.css`)

- WhatsApp `#1A8A50`, Email `#2F5FA8`, Instagram `#B4307A`.
- These are used for text and icons only, never as filled blocks. The avatar badge colours in `globals.css` now match.

## Not done / follow-ups

- **Instagram** has no customer panel. Its backend is still off, so the panel says so.
- **Tickets** come only from the WhatsApp thread's ticket fields. There is no ticket history table, so past solved tickets that were later reopened show as one ticket.
- The prototype's chat-status strip (window meter + "Bot handed over / Take over" bar), internal notes, saved replies and a per-customer team note need backend work or a WaConversation redesign. They are out of scope for this pass, and the composer was left untouched on purpose.
- Email ↔ WhatsApp linking is only as good as `customer-link.ts`: shopify id → email → last-10-digit phone. Many support emails come from vendors and have no WhatsApp or orders.
