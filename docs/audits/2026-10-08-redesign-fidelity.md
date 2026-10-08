# Redesign fidelity audit: approved prototype vs built app (8 Oct 2026)

- **Prototype:** round 8 (`47023aa`), `docs/plans/2026-10-07-app-redesign/` on `main`.
- **Build:** branch `redesign/app-v2` @ `7e46726`.
- **Method:** 6 agents compared every prototype screen and pop-up with the same app screen at 1440 and 390 px.
- **Why:** the owner said the build "still feels quite different to what we planned".

**Classes:** **A** = UI-only fix. **B** = needs data or a backend that doesn't exist yet. **C** = already decided, or an open owner decision.
**Already decided (C, not defects):**
- Leaner UI, owner 8 Oct: no re-added email click-rate/When columns, WhatsApp campaign-row reach stats, Results Replies/Orders tiles, contacts lists/status, or Home Web/Amazon/Repeat tiles.
- Still open with the owner: COD manual Confirm, merging ticket owner with chat owner, per-session sign-out, dark mode.

Raw per-area reports and paired screenshots (local only, not in git) are under `~/.promunch-redesign-tools/e2e/fidelity/<area>/shots/` (`proto-*.png` / `app-*.png`).

## The pattern (why it "feels different")

The build has the prototype's **tokens, fonts and colours**, but most screens kept the **old structure** and added panels, so:

1. **The header pattern is flipped.**
   - Prototype: eyebrow, title, a one-line summary and actions, then the tabs below.
   - App: title, tabs, then summary/KPIs/actions in the body.
   - Affects Inbox, Orders, WhatsApp, Email, Settings and Customers.
2. **Tab sets don't match the IA** (`04-ia.md`): Inbox, Orders, Insights, Customers, Settings, Email, B2B and Maya.
3. **Extra teaching/ops chrome:**
   - amber "N messages didn't arrive" pill on every WhatsApp tab;
   - "Words on this step" chips and "?" tips;
   - status strips, Getting-started checklists, Audience insights;
   - pages run 2-6× taller than planned.
4. **Some screens were never redesigned:**
   - B2B outreach and Deals (old pages, new paint);
   - Email Results (old `/dashboard/analytics`);
   - customer profile;
   - login, set-password, unsubscribe, no-access, 404 (Next default) and the error page;
   - the creator portal `/c/[code]` (old dark bar);
   - the welcome pop-up (old, with an emoji);
   - the WhatsApp sign-up popup editor (full old editor).
5. **Signature moments are missing:**
   - Home's red pinstripe hero tile and uppercase "GOOD MORNING, KHUSH.";
   - Maya's structured answer card;
   - the red pinstripe login/portal/welcome bands.

## Ranked fix list

### Tier 1: highest visibility, UI-only (A)
1. **Header pattern everywhere:** each page/tab gets its own title, summary sentence and actions above the tabs. The WhatsApp tabs get their own titles instead of "WHATSAPP MARKETING".
2. **Home:**
   - red pinstripe hero tile;
   - uppercase greeting with the real name (set the owner's `full_name`);
   - one full-width area chart; drop the "By channel" card;
   - all-clear empty state.
3. **Login and 404:**
   - pinstripe login ("CRUNCH THE NUMBERS.", one form, magic link);
   - branded `not-found.tsx` in the app shell;
   - no-access, error, set-password and unsubscribe pages too.
4. **Welcome pop-up:** "SAME CRM. LESS NOISE." band and 3 steps; no emoji; new tour names.
5. **Tabs to match the IA:**
   - Inbox: Tickets · Live chats · Email drafts · Bot knowledge (+ Reports = B).
   - Orders: Confirm COD · Voice calls · All orders · Call rules (Call rules reuses `flows/OrderSection` settings).
   - Settings: one row, Connections · Team & access · API keys · Brand & email · Security.
   - Email: Overview · Campaigns · Automations · Templates · Results. Audiences moves to Customers·Segments, and Brand to Settings.
   - Amazon: one sectioned page, not 5 sub-tabs.
6. **Ticket detail:**
   - subject as the title, "← Tickets", due chip;
   - Status/Priority/Topic editable (the PATCH already accepts `ticket_status`, `ticket_priority`, `ticket_category`);
   - customer stats card and "This order" card (`threads/[id]/customer` exists).
7. **Live chats:** 3-column rail (Need a human / Mine / Bot / All + channels); keep email drafts out of the chat list; one "Alerts on" button instead of Chime select + green Sound on.
8. **Confirm COD:** group by voice outcome with call history per row (`/api/whatsapp/voice-calls` data); no raw phone/Call button on rows; per-tab titles.
9. **WhatsApp campaign report:**
   - results sentence;
   - Pause / Add a follow-up / ⋯ menu;
   - cut the Journey, empty Progress box and 50-row recipients table to the planned ~1 screen.
10. **Email Automations list:** calm one-line rows ("3 emails over 3 days · ● Live"), not cards with 4 buttons. Automation detail edits an email in a drawer, not inline.
11. **Email builder:**
    - 4 steps (Write · Who gets it · Check · Approve & send);
    - audience option cards with counts and the phone-only note;
    - "Check it" done-timeline;
    - Send now / Schedule option cards;
    - no filled pink blocked box.
    - The canvas + block-settings editor is a large rebuild.
12. **Templates (WhatsApp):** compact horizontal cards and 3 chips; template creator inside the app shell with a numbered stepper.
13. **Sign-up popup:** lean 4-field form with a phone preview; Live and Publish in the header.
14. **Ask Maya:**
    - centred column with Ask · Saved answers tabs;
    - answer card layout (headline, drivers, chart, "Ask next" chips);
    - never show tool names like `get_system_health`.
15. **⌘K:** "Jump to" actions with live counts and an "Ask Maya: …" line; drop the retired Brevo/legacy entries.
16. **Needs you:**
    - header "NEEDS YOU" plus the sentence;
    - group labels above the cards;
    - Lucide icons, not count numbers;
    - snooze picker (3h / Tomorrow / Next week) with Undo.
17. **Customer profile:**
    - redesign: initials avatar, Message + ⋯, SPENT · ORDERS · EVERY · FAVOURITE;
    - designed GDPR modal instead of `confirm()`;
    - no JSON dump, no em dashes.
18. **Creators:**
    - collab view as a page with a red-bordered "Your move" card, brief summary + drawer, lifecycle timeline;
    - per-tab titles and buttons; "Creators" not "Library";
    - one Filter button; "Waiting on us" amber;
    - Add collab trimmed to 8 fields;
    - New kit with product chips (not "Shopify variant ID");
    - pinstripe creator portal with "STEP x OF 4".
19. **Settings detail:**
    - API keys as 4 calm rows (no env names or `getSecret()`);
    - Security in plain English (no raw IPs/event codes);
    - access pop-up with the 8 sidebar areas (`src/lib/access.ts`);
    - brand red #AF272F, not #B9303F;
    - Connections without the retired Slack rows.
20. **Small rule breaks:**
    - red "Send test" next to red "Send campaign";
    - recipe gallery with 7 red buttons;
    - em dashes in B2B copy and the customer profile;
    - green used for selected chips;
    - Maya/Creators icons swapped;
    - Add customer requires an email (the API accepts phone-only, and 93% of customers are phone-only).

### Bugs found during the fidelity pass (fix regardless)
- "Cancelled –. Nobody else will get it." when the cancel time is missing (`CampaignDetail.tsx:131`).
- "Sends about **?** a day" (`StepSchedule.tsx:121`).
- Email Results (`/dashboard/analytics`) reads old tables: "2,353 active subscribers" and "Delivery rate 25%" vs 626 on Email Overview.
- The owner shows as ADMIN on the Team tab but OWNER elsewhere.
- Customer names stored as "there"; "₹0 spent" with 1 order.
- A reopened Maya answer says "Answered from what Maya already knows" even when tools were used; the newest conversation reopened empty.

### Tier 2: needs backend (B), scope with the owner first
- **Insights:** "Repeat & cohorts" and "What people buy" screens plus metrics endpoints. Data exists (`customer_order_index`, `line_items`, `rfm:*`).
- **Customers · Segments** screen and builder (partial segment APIs exist).
- **Charts and series:**
  - Results "Revenue by week" (WhatsApp, Email);
  - campaign "Orders by day";
  - email report "Opens over 48h";
  - Web store daily chart;
  - Sales stacked by channel.
- **B2B:**
  - one-at-a-time Review screen;
  - Find with a pick step;
  - Replies with type tags;
  - Deals ₹ value and "New deal" (no create endpoint);
  - lead→deal history.
- **Inbox:**
  - internal notes, saved replies (macros), merge, escalate, solve + CSAT;
  - New ticket and Rules;
  - "On hold" status; tags;
  - Reports tab;
  - KB "Test a question".
- **All orders** across Website/Amazon/HYPD with an order drawer; "Call all now" voice trigger; RTO-saved KPI.
- **WhatsApp:** wizard "Design your own" + "Offer & link" steps (custom text needs Meta submission); per-campaign products; revenue per automation.
- **Email:** "Write with Maya" + KB fact check; approval notes/reject; per-step opens/clicks; revenue per automation.
- **Global and other:**
  - bell notifications drawer;
  - Creators badge count;
  - Maya saved/pinned answers;
  - connector health for WhatsApp/Amazon/Sarvam;
  - "My notifications";
  - unsubscribe undo.

## What is already close to the plan
Sidebar (8 places, 3 groups), phone tab bar, More sheet, Bot knowledge, Email drafts, Voice calls, colour/fonts/tokens, status-as-text styling.

## Functional verdict (separate from fidelity)
Functionally the branch is equivalent to `main`:
- every API call, send, guard and confirm is identical;
- both campaign wizards were verified to the final step with byte-identical requests;
- the production build crawled 68 routes × 2 widths under load with no hydration errors or failed calls;
- the safe click-through made 1,037 clicks with no app errors (the remaining items were harness timing or test-browser limits, all identical on main).

The fidelity gaps above are design work, not breakage.
