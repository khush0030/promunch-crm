# PROMUNCH CRM Redesign — Phase 2 (Inbox) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three separate inboxes (WhatsApp inbox tab, Instagram page inbox, Support emails table) with the approved Inbox hub: one Conversations list across WhatsApp, Instagram and email; a Conversation view; a Tickets board; and an Email drafts queue that can actually approve, edit, rewrite and skip replies from the CRM.

**Architecture:** Visual spec = approved prototype screens `inbox`, `thread`, `tickets`, `drafts` in `docs/plans/2026-09-15-crm-redesign/screens.js` (lines ~267-333) with CSS in `index.html`. All data reads go through new read-only aggregators in `src/lib/inbox/` (pure, tested) behind `/api/inbox/*` routes. Every WhatsApp and Instagram action reuses the **existing** routes unchanged (`/api/whatsapp/send`, `/api/whatsapp/threads/[id]` PATCH, `/api/instagram/threads/[id]/reply`, `/api/whatsapp/cod-gate`). The one new send trigger is email draft approval (owner-approved 17 Sep 2026): a new internal edge function `email-draft-action` that calls the same `_shared/approve.ts` pipeline Slack already uses, with its atomic `status='sending'` claim.

**Tech Stack:** Next.js 16 App Router (client pages), React 19, TanStack Query v5, Supabase service-role in API routes, Deno edge functions (`promunch-email-agent/`), vitest (node env, `src/**/*.test.ts`, TZ Asia/Kolkata).

## Global Constraints

- Everything in the Phase 0-1 plan's Global Constraints still applies (brand, copy, no em dashes, PROMUNCH caps, business words, phone ≤720px: tables become cards, no sideways page scroll, fonts, colours, `npm run build/test/lint` before every commit, commit straight to `main`, nothing auto-deploys).
- **Never message a customer twice.** No task may change how `wa-send`, `ig-send`, `wa-ai-reply`, `wa-webhook` or the 90s manual-send claim (`supabase/migrations/010_wa_manual_send_claims.sql`) behave. The new composer calls `POST /api/whatsapp/send` with the exact body shape InboxView sends today.
- **No WhatsApp reply-behaviour changes.** The bot keeps replying exactly as now. Do not add "bot pauses while you type" (the prototype hint is untrue today; the approved copy is replaced with a truthful one, see Task 2.5).
- Every button that messages a customer (Send, Approve & send, Confirm COD) is a single click guarded against double-submit (disabled while in flight) and, for Approve & send and Confirm COD, sits behind the shared `ConfirmDialog`.
- Opening a list must never mark anything read. Only an explicit open of a conversation may clear unread (existing behaviour).
- Instagram is not live (0 rows in `ig_threads`, 17 Sep 2026). Build it in; it must render nothing extra when empty and must not error when `INSTAGRAM_ACCESS_TOKEN` is unset.
- Existing inbox features must survive: 90s dedup toast ("Already sent a moment ago"), image attach (JPG/PNG ≤ 5MB via `/api/whatsapp/media-upload`), 24h window timer (`WindowTimer`, `WindowChip`), Share link, sound + browser alerts (`InboxNotifier`), template picker, AI draft (`/api/whatsapp/threads/[id]/draft`), customer facts (`/api/whatsapp/threads/[id]/customer`), assign, bot/human toggle, resolve ticket.
- Email "To approve" means `email_threads.status = 'pending' AND should_reply IS NOT FALSE`. Use this one rule in the page, the API and the attention feed.
- Ticket "past target" means ticket open or pending, and no human reply (outbound `wa_messages` whose `sent_by` is not `bot`, not `campaign%`, not null) within 4 hours of `ticket_opened_at`.
- Words on screen (no codes): ticket statuses New / With {name} / Waiting on customer / Resolved; email categories `customer_support`→Support, `order_tracking`→Order status, `complaint`→Complaint, `partnership_inquiry`→Partnership, `wholesale`→Wholesale, `job_application`→Job application, `spam`→Spam, `general`→General; urgency `critical`→Urgent, `high`→Soon, `medium`/`low`→ no pill.
- SQL migrations are applied by hand in the Supabase dashboard SQL editor, **before** the edge deploy that needs them. The Supabase CLI currently returns 403 on `db query` for this account; edge deploys may also need `supabase login` first.
- Deploy order at the end (Task 2.10): migration → `supabase functions deploy email-draft-action slack-interactivity slack-events` → `vercel --prod`. Report committed vs deployed separately.

---

## File map

**Create**
- `src/components/pm/ConfirmDialog.tsx` — lifted from `src/app/dashboard/sales/orders/page.tsx:133-212` unchanged (focus Keep on mount, restore focus, Esc closes, 2-button Tab trap).
- `src/components/pm/Chips.tsx` — `<Chips items={{key,label,count?}[]} value onChange ariaLabel />` over `.pm2-chips/.pm2-chip`.
- `src/components/pm/Avatar.tsx` — initials avatar with optional channel badge.
- `src/components/pm/ListRow.tsx` — inbox/queue row (avatar, name, one pill, one-line preview, time, unread count).
- `src/components/pm/Board.tsx` — kanban columns; swipe on phone inside its own scroll container.
- `src/components/inbox/Bubbles.tsx` — message list (in / human out / bot out / template out, day separators, system lines).
- `src/components/inbox/Composer.tsx` — multi-line reply box with action row.
- `src/components/inbox/WaConversation.tsx` — WhatsApp conversation pane (used by list pane and full page).
- `src/components/inbox/IgConversation.tsx` — Instagram conversation pane.
- `src/components/inbox/labels.ts` — category/urgency/ticket-status words (pure, tested).
- `src/lib/inbox/conversations.ts` (+ `.test.ts`) — normalise and merge WhatsApp, Instagram, email rows.
- `src/lib/inbox/tickets.ts` (+ `.test.ts`) — board columns, past-target, KPIs.
- `src/lib/inbox/email.ts` (+ `.test.ts`) — "to approve" rule, queue ordering, stepper index.
- `src/app/api/inbox/conversations/route.ts` — GET merged list.
- `src/app/api/inbox/tickets/route.ts` — GET board.
- `src/app/api/inbox/email/route.ts` — GET queue.
- `src/app/api/inbox/email/[id]/action/route.ts` — POST approve|skip|rewrite|edit → edge `email-draft-action`.
- `src/app/dashboard/inbox/page.tsx` — Conversations.
- `src/app/dashboard/inbox/[id]/page.tsx` — Conversation (`wa-<uuid>` | `ig-<uuid>`; `em-<uuid>` redirects to drafts).
- `src/app/dashboard/inbox/tickets/page.tsx` — Tickets.
- `src/app/dashboard/inbox/email/page.tsx` — Email drafts.
- `promunch-email-agent/supabase/migrations/20260917120000_email_draft_actions.sql`
- `promunch-email-agent/supabase/functions/email-draft-action/index.ts`
- `promunch-email-agent/supabase/functions/_shared/email-actions.ts` — `skipThread`, `rewriteDraft`, `saveEditedDraft` (shared by Slack and CRM).

**Modify**
- `src/app/globals.css` — port unported inbox classes (see Task 2.1).
- `src/app/dashboard/sales/orders/page.tsx` — import `ConfirmDialog` from `@/components/pm`.
- `src/app/api/whatsapp/threads/[id]/route.ts` — GET honours `?peek=1` (skip the `unread_count=0` write).
- `src/app/api/instagram/threads/[id]/route.ts` — same `?peek=1`.
- `src/app/api/metrics/attention/route.ts` + `src/lib/metrics/attention.ts` — email count uses the "to approve" rule; ticket href → `/dashboard/inbox/tickets`; email href → `/dashboard/inbox/email`.
- `src/components/shell/nav.ts` (+ `nav.test.ts`) — Inbox items → new routes; add `ROUTES.inbox*`.
- `src/components/whatsapp/InboxNotifier.tsx` — `threadLink()` → `/dashboard/inbox/wa-<id>`.
- `src/components/shell/CommandPalette.tsx` — conversation results link to `/dashboard/inbox/wa-<id>`.
- `next.config.ts` — redirects (Task 2.9).
- `promunch-email-agent/supabase/functions/_shared/approve.ts` — Slack becomes optional; record CRM approver.
- `promunch-email-agent/supabase/functions/slack-interactivity/index.ts`, `slack-events/index.ts` — call `_shared/email-actions.ts` instead of inline skip/regenerate (same behaviour).
- `promunch-email-agent/supabase/functions/_shared/process-email.ts:730` — export `insertRevision`.
- `promunch-email-agent/supabase/config.toml` — `[functions.email-draft-action] verify_jwt = false`.
- `docs/README.md` — index this plan.

**Delete (Task 2.10, only after prod check passes)**
- `src/app/dashboard/support-emails/` (both pages), `src/components/whatsapp/InboxView.tsx`, `src/components/pm/InboxLayout.tsx` and their `.pm-inbox` CSS, the `inbox`/`tickets` branches in `src/app/dashboard/whatsapp/page.tsx`, the `inbox`/`needs_human`/`spam` tabs in `src/app/dashboard/instagram/page.tsx`.

---

### Task 2.1: Inbox building blocks (CSS + shared components)

**Files:** Create `ConfirmDialog.tsx`, `Chips.tsx`, `Avatar.tsx`, `ListRow.tsx`, `Board.tsx` in `src/components/pm/`; `Bubbles.tsx`, `Composer.tsx` in `src/components/inbox/`. Modify `src/components/pm/index.ts`, `src/app/globals.css`, `src/app/dashboard/sales/orders/page.tsx`.

**Interfaces (produces):**
```tsx
export type Channel = "wa" | "ig" | "em";
<ConfirmDialog title body confirmLabel keepLabel?="Keep" danger? busy onConfirm onClose />
<Chips items={{ key: string; label: string; count?: number }[]} value={string} onChange={(k: string) => void} ariaLabel={string} />
<Avatar name={string} channel?: Channel size?: 28 | 34 />            // initials, colour picked by stable hash of name from [sun, cyan, crimson, orange, good, hypd, muted]
<ListRow name pill?={ReactNode} preview when={string} unread?={number} channel?: Channel selected? href? onClick? />
<Board columns={{ key: string; title: string; count: number; cards: ReactNode[] }[]} empty?: string />
<Bubbles items={BubbleItem[]} />
type BubbleItem =
  | { kind: "day"; label: string }                                  // "Today", "Yesterday", "12 Sep"
  | { kind: "system"; text: string }
  | { kind: "in" | "human" | "bot" | "template"; text: string; meta: string; mediaUrl?: string; failed?: string };
<Composer placeholder value onChange busy disabledReason?={string} actions={ReactNode} onSend={() => void} onAttach?={(f: File) => void} attachment?={{ name: string } | null} />
```

- [ ] **Step 1: CSS.** Port from `docs/plans/2026-09-15-crm-redesign/index.html` into the `/* pm v2 */` block of `globals.css`, prefixing every class with `pm2-`: `.av` base (200), `.inbox-grid` (242; phone 491), `.kan/.kcol/.kc` (339-345; phone 522-523), `.bub` in/out/bot + `small`, `.convo`, `.sysline` (347-353; phone 528), `.list-row`, `.ch-ic`, `.ch-wa/.ch-ig/.ch-em` (355-363, overrides 422-426), `.composer` (419-421; phone 501), `.thread-h` (427), `.m-only` (411; phone 511), `.drafts-list`/`.drafts-step` (phone 495; add desktop rule `.pm2-drafts-step{display:none}`). Add `.pm2-bub.tpl` (template: dashed border, same colours as out) and `.pm2-bub .fail` (crit text). Phone `.pm2-kan`: `display:flex; overflow-x:auto; scroll-snap-type:x mandatory` with `.pm2-kcol{flex:0 0 86%; scroll-snap-align:start}` so only the board swipes, never the page.
- [ ] **Step 2: ConfirmDialog.** Move the component verbatim out of `orders/page.tsx:133-212` into `src/components/pm/ConfirmDialog.tsx`, export from `index.ts`, import it in `orders/page.tsx`. No behaviour change.
- [ ] **Step 3:** Build `Chips`, `Avatar`, `ListRow`, `Board`, `Bubbles`, `Composer` as plain function components reading `--pm-*` tokens. `Composer`: `<textarea rows=2>` that grows to 6 rows; Enter inserts a newline, **⌘/Ctrl+Enter sends**; Send button disabled while `busy` or empty; `disabledReason` shows as a line above the actions (used for "24-hour window closed, send a template").
- [ ] **Step 4:** Temporary `/dashboard/_kit-inbox` page rendering each component with the prototype copy; check at 1280 and 390 (no sideways scroll, board swipes inside itself). Delete the page.
- [ ] **Step 5:** `npm run build && npm run test && npm run lint`. Open `/dashboard/sales/orders`, open and Esc a Cancel dialog (do **not** confirm). Commit: `feat(ui): inbox building blocks and shared confirm dialog`.

### Task 2.2: Conversation list aggregator (TDD)

**Files:** Create `src/lib/inbox/conversations.ts`, `src/lib/inbox/conversations.test.ts`, `src/components/inbox/labels.ts`, `src/components/inbox/labels.test.ts`.

**Interfaces (produces):**
```ts
export type InboxFilter = "human" | "mine" | "bot" | "all";
export type WaThreadRow = { id: string; status: "bot" | "human" | "snoozed" | "closed"; assigned_to: string | null; ticket_status: string | null; ticket_number: number | null; ticket_assignee: string | null; unread_count: number | null; last_message_snippet: string | null; last_activity_at: string | null; created_at: string; archived_at: string | null; contact: { name: string | null; phone: string | null; wa_id: string } | null };
export type IgThreadRow = { id: string; status: "bot" | "human"; classification: string | null; handle: string | null; full_name: string | null; ticket_status: string | null; assigned_to: string | null; unread_count: number | null; last_message_snippet: string | null; last_activity_at: string | null; archived_at: string | null };
export type EmailThreadRow = { id: string; status: string; should_reply: boolean | null; from_name: string | null; from_email: string; subject: string | null; lead_category: string | null; urgency: string | null; created_at: string };
export type InboxItem = {
  key: string;               // "wa-<id>" | "ig-<id>" | "em-<id>"
  channel: "wa" | "ig" | "em";
  name: string;              // contact name → phone → "@handle" → from_name → from_email
  preview: string;           // one line, max 90 chars, whitespace collapsed
  at: string;                // ISO; wa/ig last_activity_at (fallback created_at), email created_at
  pill: { tone: "info" | "neu" | "crit" | "warn" | "good"; text: string };
  needsHuman: boolean;
  assignee: string | null;
  bot: boolean;
  unread: number;
};
export function waToItem(r: WaThreadRow): InboxItem;
export function igToItem(r: IgThreadRow): InboxItem;
export function emailToItem(r: EmailThreadRow): InboxItem;
export function matchesFilter(i: InboxItem, f: InboxFilter, me: string): boolean;
export function mergeItems(lists: InboxItem[][], limit: number): InboxItem[];   // sort by at desc, then key; take limit
export function nextCursor(items: InboxItem[], limit: number): string | null;   // `${at}|${key}` of last item when items.length === limit
export function countFilters(items: InboxItem[], me: string): Record<InboxFilter, number>;
// labels.ts
export function categoryWord(c: string | null): string;          // mapping in Global Constraints; unknown → "General"
export function urgencyPill(u: string | null): { tone: "crit" | "warn"; text: string } | null;
export function ticketStatusWord(s: string | null, assignee: string | null, teamName: (email: string) => string): string;
```

Rules:
- WhatsApp pill: open/pending ticket → `crit` "Ticket #N"; else `status==="human"` → `warn` "Needs a human"; else `status==="closed"` → `good` "Closed"; else `info` "Bot". `needsHuman` = open/pending ticket OR status human. `bot` = status bot AND no open/pending ticket. Archived rows are excluded by the API, not here.
- Instagram pill: classification `collab` → `neu` "Creator"; open ticket → `crit` "Needs a human"; status human → `warn` "Needs a human"; else `info` "Bot". `needsHuman` = open ticket OR status human.
- Email pill: `warn` "Draft ready" when pending and should_reply is not false; `neu` categoryWord otherwise. `needsHuman` = pending AND should_reply is not false. `bot` = false. `assignee` = null.
- `matchesFilter`: human → needsHuman; mine → assignee (or ticket_assignee for wa) equals `me` case-insensitive; bot → bot; all → true.

- [ ] **Step 1:** Write tests with fixed fixtures: one WA thread per pill branch; IG collab; email pending/should_reply false/sent; `mergeItems` interleaves three lists by `at` and caps at limit; `nextCursor` null when fewer than limit; `countFilters` counts; preview trims to 90 chars and collapses newlines; `categoryWord("wholesale")==="Wholesale"`, `categoryWord("x")==="General"`; `urgencyPill("critical")` → Urgent crit, `urgencyPill("low")` → null.
- [ ] **Step 2:** `npx vitest run src/lib/inbox src/components/inbox` → fails (modules missing).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests pass. Commit: `feat(inbox): unified conversation list rules`.

### Task 2.3: `GET /api/inbox/conversations` + peek reads

**Files:** Create `src/app/api/inbox/conversations/route.ts`. Modify `src/app/api/whatsapp/threads/[id]/route.ts`, `src/app/api/instagram/threads/[id]/route.ts`.

**Interfaces (produces):**
```ts
// GET /api/inbox/conversations?filter=human|mine|bot|all&channel=all|wa|ig|em&q=&cursor=&limit=20
type ConversationsResponse = { items: InboxItem[]; counts: Record<InboxFilter, number>; total: number; nextCursor: string | null; me: string };
```

- [ ] **Step 1:** Session user from the Supabase server client (`getCaller()` in `src/lib/rbac-server.ts`); `me` = user email.
- [ ] **Step 2:** For each requested channel, one read-only query, newest first, `limit` rows before the cursor's `at` (`lt`), with the same `q` semantics as today: WA reuse the search logic in `src/app/api/whatsapp/threads/route.ts` (name/phone/snippet, digits-only also `ticket_number`), exclude `archived_at not null`; IG `handle`/`full_name`/snippet ilike, exclude archived; email `from_name`/`from_email`/`subject` ilike, statuses `pending|sent|skipped|failed`. Map with `waToItem/igToItem/emailToItem`, filter with `matchesFilter`, `mergeItems(…, limit)`.
- [ ] **Step 3:** `counts`: a second, lighter pass over the last 500 rows per channel (id + fields the pill needs), then `countFilters`. Cache counts 30s in a module Map keyed by `me|channel|q`.
- [ ] **Step 4:** If the `ig_threads` query errors (table missing or empty env), treat IG as empty; never 500 the whole list.
- [ ] **Step 5:** Add `?peek=1` to both thread GET routes: when present, skip the `unread_count: 0` update. Default behaviour unchanged.
- [ ] **Step 6:** curl locally with a session cookie (magic-link cookie trick): `?filter=all&limit=5`, `?filter=human`, `?channel=em`, then the returned `nextCursor`. Confirm `wa_threads.unread_count` for the top thread is unchanged after `GET /api/whatsapp/threads/<id>?peek=1`. Commit: `feat(api): unified inbox list and peek thread reads`.

### Task 2.4: Conversations page (`screens.js` id `inbox`)

**Files:** Create `src/app/dashboard/inbox/page.tsx`.

- [ ] **Step 1:** `Suspense` wrapper + inner component (pattern: `sales/orders/page.tsx`). URL state: `?filter=` (default `human`), `?channel=` (default `all`), `?q=`, `?open=<key>` (laptop selection). `router.replace` on change, dropping defaults.
- [ ] **Step 2:** `PageHeader` crumb "Inbox", title "Conversations", actions = `Chips` Needs a human / Mine / Bot / All with counts + a single channel `<select>` "All channels / WhatsApp / Instagram / Email" (laptop only, phone shows it under search).
- [ ] **Step 3:** `useQuery(["inbox-list", filter, channel, q, cursor], …, { refetchInterval: 4000, placeholderData: keepPreviousData })` (same cadence the WA inbox uses today). Search box "Search name, phone, order…" debounced 250ms. Footer "{total} conversations" + "Next 20 →" / "← Newer" cursor paging.
- [ ] **Step 4:** Layout `.pm2-inbox-grid`: left `ListRow`s. Laptop: right pane shows `?open=` or the first item, rendered with `WaConversation`/`IgConversation` in `peek` mode (reads with `?peek=1`, composer present; the first send or explicit click on the row clears unread by calling the normal GET once). Email items in the pane show the email + draft summary with an "Open in Email drafts" button to `/dashboard/inbox/email?id=<id>`. Phone: no pane; tapping a row navigates to `/dashboard/inbox/<key>` (email → drafts page).
- [ ] **Step 5:** Empty states in words: Needs a human → "Nobody is waiting on a person right now."; Mine → "Nothing assigned to you."; others → "No conversations match."
- [ ] **Step 6:** Loading: skeleton rows; error: `Callout tone="crit"` with Retry.
- [ ] **Step 7:** Build/lint/test. Check 1280 + 390 against prototype 11. Commit: `feat(inbox): conversations list across WhatsApp, Instagram and email`.

### Task 2.5: Conversation view (`thread`)

**Files:** Create `src/components/inbox/WaConversation.tsx`, `src/components/inbox/IgConversation.tsx`, `src/app/dashboard/inbox/[id]/page.tsx`.

**Interfaces:**
- Consumes: `GET/PATCH /api/whatsapp/threads/[id]`, `POST /api/whatsapp/send`, `POST /api/whatsapp/media-upload`, `POST /api/whatsapp/threads/[id]/draft`, `GET /api/whatsapp/threads/[id]/customer`, `GET /api/whatsapp/templates?status=approved`, `GET/POST /api/whatsapp/cod-gate`, `GET /api/instagram/threads/[id]`, `POST /api/instagram/threads/[id]/reply`, `WindowTimer`/`WindowChip` from `src/components/whatsapp/WindowTimer.tsx`, `TemplatePicker` (extract from `InboxView.tsx:1050-1108` into `src/components/inbox/TemplatePicker.tsx` unchanged).
- Produces: `<WaConversation id={string} peek?: boolean compact?: boolean />`, `<IgConversation id={string} peek?: boolean compact?: boolean />`.

WhatsApp pane:
- [ ] **Step 1: Header.** Title = contact name (fallback phone). Crumb "Inbox · WhatsApp · {phone with the last 3 digits masked, e.g. +91 98230 41xxx}". One pill: "Bot is replying" (info) when status bot; "You are replying" (warn) when human; "Closed" (good). Buttons: **Take over** (PATCH `{status:"human"}`) when bot; **Hand back to bot** (PATCH `{status:"bot"}`) when human; **Resolve** (PATCH `{ticket_status:"resolved"}`) only when a ticket is open/pending; **Share** (copies `/dashboard/inbox/wa-<id>`); assign menu (PATCH `{assigned_to}` from `/api/team`). None of these message the customer.
- [ ] **Step 2: Facts strip** from the customer endpoint: city (latest order shipping city if present), "{n} orders · ₹{total}" (`formatINR`), latest COD order waiting "#{order} · COD · waiting" when `GET /api/whatsapp/cod-gate?hours=168` lists an order whose phone matches `wa_id` (last 10 digits), "Profile →" to `/dashboard/contacts/<contact.id>` when a CRM contact exists. Open ticket line: "Ticket #N · {escalation_reason}".
- [ ] **Step 3: Bubbles.** Map `wa_messages`: inbound → `in`; outbound `sent_by==="bot"` → `bot` with meta "Bot · {time} · {status word}" (+ " · from Master KB" only when `ai_meta` records KB chunks used); `template_name` set → `template` meta "Template {template_name} · {time}"; other outbound → `human` meta "{first name of sent_by email or 'Team'} · {time} · {status word}". Status words: queued "sending", sent "sent", delivered "delivered", read "read", failed → `failed` = translated reason via `src/components/whatsapp/waErrors.ts`. Day separators by IST date. System line when a ticket was opened: "Bot handed off: {escalation_reason}" placed at `ticket_opened_at`.
- [ ] **Step 4: Composer.** Placeholder "Reply as {first name}…". Send posts **exactly** the body InboxView sends today (`thread_id`, `kind`, `text` / `image{link,caption}` / `template{name,language,vars}`) with `sent_by` = signed-in user's email instead of the hardcoded `khush@promunch.in` (attribution only; the dedup key in `send/route.ts:29` hashes `kind` + content, not `sent_by`). Keep the duplicate toast: on `{skipped:true, reason:"duplicate"}` show "Already sent a moment ago, not sent again." Actions row: **Confirm COD #N** (only when a waiting COD order exists; `ConfirmDialog` "Confirm order #N? It will be released for shipping." → `POST /api/whatsapp/cod-gate {shopify_id, action:"confirm"}`; admin-only route, show its 403 as "Only an admin can confirm orders."), **Template** (TemplatePicker), **AI draft** (fills the box, never sends; `{action:"escalate"}` shows "The bot suggests a person handles this: {reason}"), **Photo** (JPG/PNG ≤ 5MB), **Send**. Under the box when bot mode: "The bot is still replying. Take over to pause it." (replaces the prototype's untrue "bot pauses while you type"). When the 24h window is closed (`WindowTimer` logic on last inbound): free text disabled with `disabledReason` "24-hour window closed. Send a template to restart the chat."; Template stays enabled.
- [ ] **Step 5: Polling** `["wa-thread-messages", id]` every 4000ms; `peek` adds `?peek=1`.

Instagram pane:
- [ ] **Step 6:** Same header/bubbles/composer shape. Bubbles from `ig_messages` (`ai_generated` or `sent_by==="bot"` → bot). Send → `POST /api/instagram/threads/[id]/reply {text}`. On 403 `window_closed` show "Instagram only allows replies within 24 hours of their last message."; `human_agent_required` → "Outside the 24-hour window. Human agent replies are not enabled yet." Note under the header: "Replying here switches this chat to you." (the existing route sets status human). No Template/Photo/COD buttons.

Page:
- [ ] **Step 7:** `src/app/dashboard/inbox/[id]/page.tsx`: parse `wa-`/`ig-`/`em-` prefix; `em-` → `router.replace('/dashboard/inbox/email?id=…')`; unknown → "This conversation was not found" + link back. Full-height layout, composer pinned to bottom on phone above the tab bar.
- [ ] **Step 8:** Build/lint/test. Local check at 1280 + 390 on a real thread **without sending**. Live send test is in Task 2.10. Commit: `feat(inbox): conversation view for WhatsApp and Instagram`.

### Task 2.6: Tickets board (`tickets`)

**Files:** Create `src/lib/inbox/tickets.ts`, `src/lib/inbox/tickets.test.ts`, `src/app/api/inbox/tickets/route.ts`, `src/app/dashboard/inbox/tickets/page.tsx`.

**Interfaces (produces):**
```ts
export type TicketRow = { id: string; channel: "wa" | "ig"; ticket_number: number | null; ticket_status: "open" | "pending" | "resolved" | "closed"; ticket_subject: string | null; ticket_category: string | null; escalation_reason: string | null; ticket_assignee: string | null; ticket_opened_at: string | null; ticket_resolved_at: string | null; customer: string; firstHumanReplyAt: string | null };
export type TicketCard = { key: string; number: number | null; title: string; customer: string; orderRef: string | null; orderValue: number | null; ageText: string; tone: "crit" | "warn" | "neu"; pastTarget: boolean; assignee: string | null; href: string };
export type TicketsBoard = {
  columns: { key: string; title: string; cards: TicketCard[] }[];   // "new", "with:<email>" (one per assignee), "waiting", "resolved-today"
  kpis: { open: number; pastTarget: number; medianResolveHours: number | null; prevMedianResolveHours: number | null; topCategory: { word: string; count: number; prevCount: number } | null };
  counts: { open: number; waiting: number; resolvedWeek: number };
};
export function extractOrderRef(text: string | null): string | null;  // first /#?(\d{4,6})/ → "#2231"
export function isPastTarget(t: TicketRow, now: Date): boolean;       // open|pending AND no firstHumanReplyAt within 4h of opened AND now-opened > 4h
export function ageText(from: string, now: Date): string;             // "40m", "2h 10m", "1 day", "3 days"
export function buildBoard(rows: TicketRow[], orders: Record<string, number>, now: Date, teamName: (email: string) => string): TicketsBoard;
```
Rules: New = open with no assignee. With {name} = open or pending with assignee, one column per assignee, title "With {first name}". Waiting on customer = pending with no assignee. Resolved today = resolved/closed with `ticket_resolved_at` on today's IST date, card meta "resolved in {ageText(opened→resolved)}" (no "by whom": not recorded). Cards sort oldest first. Tone: pastTarget → crit with text "{age} · past target"; age > 2h → warn; else neu. Median resolve = resolved in the last 7 days vs the 7 before. Top category = most frequent `ticket_category` opened in the last 7 days (word via labels), with previous-7-day count.

- [ ] **Step 1:** Tests: `extractOrderRef("pack crushed order 2231")==="#2231"`, null when none; `isPastTarget` true at 5h with no reply, false at 5h with reply at 1h, false at 3h; `ageText`; `buildBoard` puts unassigned open in New, two assignees → two columns, pending unassigned → waiting, resolved yesterday excluded; median of [1h,3h,5h] = 3; categories count.
- [ ] **Step 2:** Run → fail. Implement. Run → pass.
- [ ] **Step 3: API** `GET /api/inbox/tickets`: `wa_threads` where `ticket_status in (open,pending)` OR `ticket_resolved_at >= now-14d`, not archived, with contact name; same for `ig_threads` (tolerate errors → empty). `firstHumanReplyAt`: one query over `wa_messages` for those thread ids, `direction='outbound'`, `created_at >= min(opened)`, `sent_by not in ('bot') and sent_by not like 'campaign%' and sent_by is not null`, reduce to first per thread after its `ticket_opened_at`. Order values: look up `shopify_orders.total_price` by `order_number` for extracted refs (`isRevenueOrder` not applied; show the order's own value). Team names from `/api/team` source table.
- [ ] **Step 4: Page.** `PageHeader` title "Tickets", actions `Chips` Open / Waiting on customer / Resolved this week (filter which columns show; Open shows New + With…), laptop caption "target: first human reply within 4h". `KpiStrip cols=3`: "Open" value open, sub "{pastTarget} past target"; "Median time to resolve" `{h}h` with `Delta` (`invert`: lower is better), sub "this week"; "{topCategory word} tickets" count with Delta vs previous week, sub "this week". `Board` of cards: title "#{n} {ticket_subject or escalation_reason, 60 chars}", meta "{customer} · {orderRef} · ₹{value}", age `Pill`, assignee avatar. Card click → `/dashboard/inbox/wa-<id>`. Card menu (⋯): Assign to…, Waiting on customer (PATCH `{ticket_status:"pending"}`), Resolve (PATCH `{ticket_status:"resolved"}`). Footnote: "Ops can also close a ticket by replying \"done #N\" on WhatsApp." Poll every 15s.
- [ ] **Step 5:** Build/lint/test; check 1280 + 390 (board swipes, page does not). Commit: `feat(inbox): tickets board with 4-hour target`.

### Task 2.7: Email draft actions backend (new send trigger, owner-approved 17 Sep 2026)

**Files:** Create migration, `email-draft-action/index.ts`, `_shared/email-actions.ts`, `src/app/api/inbox/email/[id]/action/route.ts`. Modify `_shared/approve.ts`, `_shared/process-email.ts`, `slack-interactivity/index.ts`, `slack-events/index.ts`, `config.toml`.

**Interfaces (produces):**
```ts
// edge: POST /functions/v1/email-draft-action  (requireInternal)
type EmailDraftActionReq =
  | { action: "approve"; email_thread_id: string; actor_email: string }
  | { action: "skip"; email_thread_id: string; actor_email: string }
  | { action: "rewrite"; email_thread_id: string; actor_email: string; feedback?: string }
  | { action: "edit"; email_thread_id: string; actor_email: string; body: string };
type EmailDraftActionRes = { ok: boolean; status?: "sent" | "already_sent" | "skipped" | "rewritten" | "saved"; error?: string; revision?: number };
// Next: POST /api/inbox/email/[id]/action  body = EmailDraftActionReq minus email_thread_id/actor_email
```

- [ ] **Step 1: Migration** `20260917120000_email_draft_actions.sql` (idempotent):
```sql
-- email_threads.status: allow the 'sending' claim state approve.ts already writes.
alter table email_threads drop constraint if exists email_threads_status_check;
alter table email_threads add constraint email_threads_status_check
  check (status in ('pending', 'sending', 'sent', 'skipped', 'failed'));
-- CRM approvals record the team member's email (Slack approvals keep the Slack user id).
alter table sent_replies add column if not exists approved_by_email text;
```
Before writing it, confirm the live constraint name in the SQL editor: `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='public.email_threads'::regclass and contype='c';`. If the live constraint already allows `sending`, keep the migration (it is idempotent) and note that in the commit message. If a stuck `sending` row exists (`select id from email_threads where status='sending'`), list it in the report; do not change it.
- [ ] **Step 2: approve.ts.** Change the options to `{ emailThreadId; approvedBySlackUser: string | null; approvedByEmail?: string | null; slackChannel?: string | null; slackThreadTs?: string | null }`. Wrap every `replyInThread`/`updateMessage` call in `if (slackChannel && slackThreadTs)`. When called from the CRM and the thread has `slack_channel_id` + `slack_thread_ts`, pass those so Slack shows ":white_check_mark: Sent (approved in CRM by {email})." and the Slack buttons are removed. Insert `approved_by_email` into `sent_replies`; `logEvent` actor = Slack user ?? email ?? "system". **The atomic claim block and Gmail send stay byte-for-byte the same.** Return `{ ok: true, status: "already_sent" }` when the claim is lost or status is already sent (Slack callers ignore `status`).
- [ ] **Step 3: email-actions.ts.** Move the Slack `skip` case body into `skipThread({ emailThreadId, actor })` (same updates, same `brand_knowledge` insert); move `regenerate()` into `rewriteDraft({ emailThreadId, feedback, actor })` using the exported `insertRevision` from `process-email.ts:730` (the backoff-safe revision insert) instead of the inline update+insert; add `saveEditedDraft({ emailThreadId, body, actor })` that inserts a revision with `model: "human-edit"`, `feedback: "(edited in CRM)"` via `insertRevision`. Slack posting stays optional inside each (post only when the thread has Slack ids). `skipThread` and `rewriteDraft`/`saveEditedDraft` refuse (return `{ok:false,error:"already sent"}`) when status is `sent` or `sending`. Update `slack-interactivity` and `slack-events` to call these; Slack-visible messages unchanged.
- [ ] **Step 4: email-draft-action/index.ts.** `requireInternal(req)` first; validate body; `approve` → `approveAndSend({ emailThreadId, approvedBySlackUser: null, approvedByEmail: actor_email, slackChannel, slackThreadTs })` (Slack ids read from the thread row); other actions → `email-actions.ts`. `config.toml`: `[functions.email-draft-action]` `verify_jwt = false  # called by Next.js API with service role bearer; gated by requireInternal`.
- [ ] **Step 5: Next route** `POST /api/inbox/email/[id]/action`: session required (`getCaller()`; 401 otherwise), validate `action` and `body` (edit: 1-8000 chars; rewrite feedback ≤ 500), proxy to the edge function with `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}` (pattern `src/app/api/whatsapp/cod-gate/route.ts:47`), `recordAudit({ action: "email_draft.<action>", entityType: "email_thread", entityId: id, summary, request, actor })` on success, return edge JSON (502 on edge failure).
- [ ] **Step 6:** `cd promunch-email-agent && deno check supabase/functions/email-draft-action/index.ts supabase/functions/slack-interactivity/index.ts supabase/functions/slack-events/index.ts`. `npm run build && npm run lint`. Commit: `feat(email): approve, edit, rewrite and skip drafts from the CRM`.
- [ ] **Step 7: Approval gate.** Before any deploy of this task, the report to the owner states the customer-visible effect: "A team member clicking Approve & send in Inbox › Email drafts now emails the customer from the support mailbox, once. The same guard as Slack prevents a second send whether the second click comes from the CRM or Slack." Deploy only in Task 2.10.

### Task 2.8: Email drafts page (`drafts`)

**Files:** Create `src/lib/inbox/email.ts`, `src/lib/inbox/email.test.ts`, `src/app/api/inbox/email/route.ts`, `src/app/dashboard/inbox/email/page.tsx`. Modify `src/lib/metrics/attention.ts`, `src/app/api/metrics/attention/route.ts`.

**Interfaces (produces):**
```ts
export type EmailQueueTab = "approve" | "noreply" | "sent" | "skipped";
export function tabOf(r: { status: string; should_reply: boolean | null }): EmailQueueTab | null;  // pending+should_reply!==false → approve; pending+false → noreply; sent → sent; skipped → skipped; else null
export function sortQueue<T extends { urgency: string | null; created_at: string }>(rows: T[]): T[]; // critical, high, then rest; oldest first within a group
export function stepIndex(ids: string[], current: string | null): { index: number; total: number; prev: string | null; next: string | null };
// GET /api/inbox/email?tab=approve|noreply|sent|skipped&id=
type EmailQueueResponse = {
  counts: Record<EmailQueueTab, number>;
  items: { id: string; from_name: string | null; from_email: string; subject: string | null; category: string; urgency: { tone: "crit" | "warn"; text: string } | null; created_at: string }[]; // max 200, sorted
  selected: null | { id: string; from_name: string | null; from_email: string; subject: string | null; body_plain: string | null; created_at: string; category: string; status: string;
    draft: { body: string; revision: number } | null; revisions: { revision: number; feedback: string | null; created_at: string }[]; sent: { body: string; sent_at: string; approved_by: string | null } | null };
};
```

- [ ] **Step 1:** Tests for `tabOf`, `sortQueue` (critical before high before medium, oldest first inside), `stepIndex` (middle, first, last, missing id → index 0). Run → fail → implement → pass.
- [ ] **Step 2: API.** Counts via four `count: exact, head: true` queries; items for the tab; `selected` = `?id` or first item, with current draft (`is_current`), revision history (no model names shown), sent reply (`approved_by_email` ?? "Slack").
- [ ] **Step 3: Attention.** `route.ts` email query adds `.or("should_reply.is.null,should_reply.eq.true")`; title stays "N email drafts waiting for review"; href `/dashboard/inbox/email`. Update `attention.test.ts` expectations for the href. Ticket href → `/dashboard/inbox/tickets`.
- [ ] **Step 4: Page, laptop.** `PageHeader` crumb "Inbox · Email drafts", title "{n} drafts waiting" (or "No drafts waiting"), `Chips` To approve / No reply needed / Sent / Skipped. `.pm2-g12`: left `.pm2-drafts-list` of `ListRow` (avatar, name, category pill, subject, age); right panel: subject as heading, basis "{from_email} · {age} ago", the email in an `in` bubble (plain text, max 1,200 chars with "Show all"), urgency pill when present, draft block with eyebrow "Draft · reply goes to {from_email} · grounded in Master KB", then buttons **Approve & send** (pri) → `ConfirmDialog` "Send this reply to {from_email}?" body "It goes out from the support mailbox. This cannot be undone." confirm "Send reply"; **Edit** (swaps draft for a textarea + Save draft / Cancel → action `edit`); **Rewrite** (small input "What should change?" → action `rewrite`, shows "Writing a new draft…" until the next poll shows a higher revision); **Skip** (ghost button → `ConfirmDialog` "Skip this email? Similar emails will be skipped automatically." confirm "Skip"; no undo, because skip also teaches the classifier). "How this was drafted" expands revision list: "Draft {n} · {feedback or 'first draft'} · {time}". After a successful action the queue moves to the next item. Sent tab shows the sent reply read-only.
- [ ] **Step 5: Page, phone.** No list. `.pm2-drafts-step` bar on top: "**{i} of {n}**" · "{name} · {category}" · "Next →" (and "← Prev"). Email full width, draft below. Action bar fixed at the bottom above the tab bar: Approve & send / Edit / Skip (Rewrite inside Edit sheet).
- [ ] **Step 6:** Buttons disabled while a request is in flight; errors from the edge (e.g. Gmail auth) shown as `Callout tone="crit"` "The reply was not sent: {error}. Nothing went to the customer." Poll every 10s.
- [ ] **Step 7:** Build/lint/test. Check at 1280 + 390 locally **without clicking Approve, Skip, Edit or Rewrite** on real emails. Commit: `feat(inbox): email drafts queue with approve, edit, rewrite and skip`.

### Task 2.9: Navigation, links and redirects

**Files:** Modify `src/components/shell/nav.ts`, `src/components/shell/nav.test.ts`, `src/components/whatsapp/InboxNotifier.tsx`, `src/components/shell/CommandPalette.tsx`, `next.config.ts`, `docs/README.md`.

- [ ] **Step 1: nav.ts** Inbox hub items: Conversations `/dashboard/inbox` `badge:"inbox"`; Tickets `/dashboard/inbox/tickets`; Email drafts `/dashboard/inbox/email`. Remove the Instagram Inbox item (DMs live in Conversations; Partners › Creators already points at the Instagram page). Add `ROUTES.inbox`, `ROUTES.inboxTickets`, `ROUTES.inboxEmail`, `ROUTES.conversation(key)`. Update `nav.test.ts` active-item cases: `/dashboard/inbox/wa-123` → Conversations; `/dashboard/inbox/tickets` → Tickets.
- [ ] **Step 2:** `InboxNotifier.threadLink(id)` → `/dashboard/inbox/wa-${id}`. CommandPalette conversation results → same.
- [ ] **Step 3: next.config.ts** redirects (all `permanent:false`):
```ts
{ source: "/dashboard/support-emails", destination: "/dashboard/inbox/email", permanent: false },
{ source: "/dashboard/support-emails/:id", destination: "/dashboard/inbox/email?id=:id", permanent: false },
{ source: "/dashboard/whatsapp", has: [{ type: "query", key: "tab", value: "tickets" }], destination: "/dashboard/inbox/tickets", permanent: false },
{ source: "/dashboard/whatsapp", has: [{ type: "query", key: "thread", value: "(?<thread>[0-9a-f-]{36})" }], missing: [{ type: "query", key: "tab" }], destination: "/dashboard/inbox/wa-:thread", permanent: false },
{ source: "/dashboard/whatsapp", has: [{ type: "query", key: "tab", value: "inbox" }, { type: "query", key: "thread", value: "(?<thread>[0-9a-f-]{36})" }], destination: "/dashboard/inbox/wa-:thread", permanent: false },
{ source: "/dashboard/whatsapp", missing: [{ type: "query", key: "tab" }], destination: "/dashboard/inbox", permanent: false },
{ source: "/dashboard/whatsapp", has: [{ type: "query", key: "tab", value: "inbox" }], destination: "/dashboard/inbox", permanent: false },
```
Order matters: thread link before the bare-path rule. Verify each with `curl -sI` locally (Location header), including that `/dashboard/whatsapp?tab=campaigns` is **not** redirected. Next appends the original query string to redirects; confirm `?thread=` does not leak into `/dashboard/inbox/wa-<id>` in a way that breaks the page (ignore unknown params).
- [ ] **Step 4:** `docs/README.md`: add this plan under the redesign entry. Build/lint/test. Commit: `feat(shell): inbox hub routes, links and redirects`.

### Task 2.10: Verification, live tests and ship

- [ ] **Step 1:** `npm run build && npm run test && npm run lint` (lint: no new errors beyond the 27 pre-existing). `deno check` the three edge functions.
- [ ] **Step 2: Playwright, local** (magic-link cookie, onboarding flag set): `/dashboard/inbox` (each filter), `/dashboard/inbox/wa-<Khush's own thread id>`, `/dashboard/inbox/tickets`, `/dashboard/inbox/email`, plus every redirect in Task 2.9, at 1280 and 390: status 200, `scrollWidth - innerWidth === 0`, no console errors, no API 4xx/5xx. Read-only: no clicks on Send, Approve, Skip, Edit, Rewrite, Resolve, Confirm COD.
- [ ] **Step 3: Apply migration** `20260917120000_email_draft_actions.sql` by hand in the Supabase SQL editor; re-run the constraint query; `bash scripts/check-migrations.sh`.
- [ ] **Step 4: Owner approval** for the Task 2.7 effect statement, then deploy edge: `cd promunch-email-agent && supabase functions deploy email-draft-action slack-interactivity slack-events` (run `supabase login` first if it 403s).
- [ ] **Step 5: Live tests on production data that only reach the owner:**
  - WhatsApp: in `/dashboard/inbox/wa-<Khush thread>` (Khush's own number, 24h window open: Khush messages the business number first), type a text and press Send twice quickly. Expect exactly one message on Khush's phone and the "Already sent a moment ago" toast. Send one JPG. Take over → Hand back to bot (no message received).
  - Email: from `kmutha@vippysoya.com` send "Test: do you ship to Nashik?" to the support mailbox. When the draft appears in `/dashboard/inbox/email`: Edit (add a line) → Save; Rewrite with "shorter" → new revision appears; Approve & send → confirm. Expect exactly one reply in kmutha@vippysoya.com, `email_threads.status='sent'`, one `sent_replies` row with `approved_by_email`, Slack thread shows "Sent (approved in CRM by …)" with buttons removed, and clicking Approve in Slack afterwards says "Already sent". Send a second test email and Skip it from the CRM.
  - Tickets: move Khush's own test ticket (if none open, skip this item and say so) to Waiting on customer and back; confirm no WhatsApp message.
- [ ] **Step 6:** `vercel --prod`. Repeat Step 2 against `https://admin.promunch.in`.
- [ ] **Step 7: Cleanup commit** after prod passes: delete the files listed under "Delete" in the file map, remove `.pm-inbox` CSS, build/lint/test, commit `chore(inbox): remove replaced inbox screens`, `vercel --prod` again, re-check `/dashboard/whatsapp?tab=campaigns` and `/dashboard/instagram?tab=discovery` still render.
- [ ] **Step 8:** Update memory + `.superpowers/sdd/progress.md`. Report committed vs deployed (Vercel, each edge function, migration) separately.

---

## Out of scope (later phases)
- Matching Instagram handles to CRM customers (no identity column today; needs a migration + a matching rule).
- "Create a deal" from an email (Phase 4 deals work).
- Recording who resolved a ticket (needs a `ticket_resolved_by` column written by both PATCH and the `done #N` path in `wa-webhook`, which is a WhatsApp edge change).
- Realtime subscriptions instead of polling.
