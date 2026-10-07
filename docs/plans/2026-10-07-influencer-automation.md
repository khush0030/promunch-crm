# Influencer Pipeline Automation: replacing the agency

Status: PLAN, not built. Owner decisions locked 2026-10-07 (§8).
Date: 2026-10-07

## 1. Goal

Today an agency runs influencer outreach and chases deliverables. Replace that with the CRM:

1. **Sourcing + first contact:** stays manual (Instagram forbids automated cold DMs).
2. **Everything after the creator replies is automated:** the AI reads their profile, pitches a content idea, negotiates barter or fee within guardrails, collects the address, tells ops what kit to ship, chases the reel, and logs the post.
3. **Channel switch:** if the creator asks to move to WhatsApp, the bot moves them over smoothly and keeps one timeline.
4. **Influencer library:** one record per creator with live metrics, every touchpoint date, shipment, deliverable due dates, posted content, and results.

## 2. Verdict: viable, and about 60% is already built

| Need | Already in the CRM | Gap |
|---|---|---|
| IG DM receive + AI reply | `ig-webhook` → `ig-ai-reply` → `ig-send`, atomic reply claims, `ig-jobs-tick` retry | Influencer persona + negotiation state machine; record manual echoes (currently ignored) |
| Profile analysis | `ig-analyze` (Business Discovery: followers, ER, bio, captions), fit score 0-100, AI barter draft | Content-idea brief, reel view averages (Apify) |
| Sourcing | `ig-discovery` (Apify), `ig_prospects`, Discovery tab, batch pitch queue (copy + open profile) | Migrations never applied in prod (tab currently 500s) |
| Chasing | `ig_followups` + `ig-followup-tick`, per-stage cadences | Due-date-driven reminders, draft review loop |
| Pipeline stages | `ig_threads.collab_stage` (new → in_convo → terms_sent → agreed → shipped → posted) | Full deal record, dates, kit, rights, payment |
| WhatsApp | Full WA stack, ops pings via `OPS_WA_ID`, "done #N" tickets | IG → WA handoff + influencer routing in `wa-webhook` |
| Dispatch | Shopify integration, HYPD ₹0.01 creator seeds already tagged + excluded from revenue | Kit rules engine, auto-created ₹0 order, tracking updates to creator |

**Production reality (checked 2026-10-07):** `ig_threads` exists with 0 rows (Meta app not connected), `ig_prospects` and `ig_followups` do not exist (Phase 3 migrations unapplied). Nothing Instagram is live yet.

**The one real blocker:** Meta App Review for `instagram_manage_messages` (plus `instagram_manage_comments`, and the Human Agent tag in the same submission). Typically 1 to 4 weeks with a screencast. Everything else is our own code. Steps already written in [META_APP_SETUP.md](../instagram/META_APP_SETUP.md).

## 3. Platform rules that shape the design

- **No cold DMs via API.** The API can only answer people who messaged us. If our team sends the first DM by hand from the Instagram app and the creator replies, the reply arrives by webhook and the bot can take over. This is exactly the hybrid you described.
- **24h window.** Free-form replies only within 24h of the creator's last message. The Human Agent tag extends to 7 days but only for messages a human writes. So long gaps (waiting for a reel for 3 weeks) need either a creator reply, a human-sent nudge, or WhatsApp.
- **WhatsApp the same way:** we can only free-text inside 24h of their last WA message; outside that, approved templates only (utility ~₹0.15/msg, marketing ~₹0.90/msg in India). This is why WA is actually better for the long tail of a collab: approved utility templates ("Your PROMUNCH parcel shipped", "Reminder: reel due on 14 Oct") can reach them any time.
- **Metrics:** Business Discovery (official, free) gives followers, post count, and likes/comments on recent posts, so ER. It does NOT give reel views or audience demographics. Reel views: Apify scrape. Audience (city, age, gender): only the creator can share it, so the bot asks for an Insights screenshot and AI vision reads it. Paid tools (Modash, HypeAuditor) estimate it if you ever need it at scale.
- **Post detection:** official `mentions` webhook fires when they tag @PROMUNCH in caption/comment, `/tags` endpoint lists posts we're tagged in; Apify scrape of their last posts is the fallback when they forget to tag.

## 4. The pipeline (one creator, end to end)

```
SOURCED ─▶ CONTACTED ─▶ IN TALKS ─▶ TERMS PROPOSED ─▶ AGREED ─▶ KIT ASSIGNED ─▶ DISPATCHED
 (Apify/     (human DM,     (bot takes   (barter/fee      (address    (rules engine    (Shopify ₹0
  manual)     pitch queue)   over)        + brief)          captured)  + ops ping)      order, tracking)
                                                                                           │
CLOSED ◀── PAID (if fee) ◀── RESULTS LOGGED ◀── POSTED ◀── DRAFT APPROVED ◀── CONTENT DUE ◀── DELIVERED
                              (views/ER/code    (mention     (optional        (reminders
                               sales at 1d/7d)   detected)    review loop)     by due date)
```

### Step detail

1. **Sourced.** Discovery tab (Apify) or manual add by handle. `ig-analyze` scores fit, AI writes a personalised opener.
2. **Contacted (manual).** Team sends the opener from the IG app using the existing pitch queue (copy + open profile, tap through 30 in 10 minutes). We record the send by capturing message echoes, so the timeline is complete even for hand-sent DMs.
3. **In talks (bot).** Creator replies → bot owns the thread. It already knows their niche, tier, ER, top-performing post formats. It pitches 2 or 3 concrete reel ideas tailored to their niche (gym creator: "post-workout protein swap, 42g protein per 100g"; mom blogger: "tiffin box snack hack"; comedy: "snack thief POV"), grounded in Master KB product facts only.
4. **Terms proposed.** Bot negotiates inside guardrails stored in dashboard settings (per tier: barter-only below X followers, fee band by avg views, max fee it can agree to alone). Anything outside → owner gets a WA ping with Approve / Counter / Decline buttons; bot tells the creator "let me confirm with the team". The bot never commits money above its band.
5. **Agreed.** Bot generates the brief + terms summary (deliverable, format, key messages, do/don't, tag + collab invite, usage rights for ads, posting window, content due date) and gets an explicit "yes" from the creator in chat. Collects address + pincode + phone, validated.
6. **Kit assigned.** Rules engine picks the box from tier × niche (table editable in dashboard). Example starting rules:

   | Tier | Kit |
   |---|---|
   | Nano < 10k | 2 packs, best seller + one matched to niche |
   | Micro 10k to 50k | 4-pack sampler |
   | Mid 50k to 200k | Full range + Edamame |
   | Macro 200k+ | Hamper, human-approved |

   Niche overrides: fitness → highest-protein SKUs; kids/family → milder flavours; regional → regional-flavour heroes.
7. **Dispatched.** System creates a Shopify ₹0 order tagged `Influencer` + creator handle (flows into the existing fulfilment process, excluded from revenue like HYPD seeds) and pings ops on WhatsApp: "Influencer #N: @handle, kit = Micro sampler, address ..., reply done #N". Shopify fulfilment webhook moves the stage to shipped/delivered and the bot sends the creator the Shopify order-status link (per shipping-link policy).
8. **Content due.** Due date = delivered + agreed days. Follow-up engine (already built) nudges at T-3, T-1, T+1, T+4, then escalates to a human. Optional: creator sends the draft by DM/WA, team approves/requests changes in the dashboard, bot relays.
9. **Posted.** Mention webhook / tags endpoint / Apify fallback detects the post, links it to the deal, saves URL.
10. **Results logged.** Fetch views/likes/comments at 24h and 7d. Each creator gets a unique Shopify discount code (e.g. `MUNCH-RIYA10`), so sales attribute via `shopify_orders.discount_codes`. Library shows cost (kit COGS + fee + shipping) vs views vs orders → cost per view, cost per order. Next time you know who to rebook.

## 4A. Delivery assurance (owner's #1 priority, 2026-10-07)

The core job is: **every creator gets a complete, approved brief, confirms they read it, receives the product, and delivers on time, and nobody on our team has to remember to chase.** Negotiation automation is secondary.

### Why WhatsApp carries the chasing

Instagram only allows free messages within 24h of the creator's last message, and the waiting period (shipping → draft → post) is 1 to 3 weeks of silence. So Instagram cannot reliably chase. WhatsApp approved **utility templates** can reach the creator any time. We already need their phone for the Shopify order, so every barter deal has a WhatsApp route by default. Instagram stays for the conversation; WhatsApp carries brief, shipping, reminders.

### The brief: written properly, sent once, acknowledged

1. **Brief builder in the dashboard.** One structured brief per deal, AI-drafted from their niche + top posts + Master KB, then **a human approves it before it can be sent** (no brief leaves unapproved).
   - Concept + hook options, and the script/talking points
   - Must-say product facts (KB-grounded, e.g. protein per 100g; chips and sticks are fried, only Crunchies roasted)
   - Must-do checklist: tag @PROMUNCH, collab invite, hashtag, their discount code, link in story if a story is included
   - Don'ts (claims we can't make, competitor mentions)
   - Format: reel length, aspect ratio, story count
   - Dates: draft due, go-live date
   - Ad rights section only if the deal toggle is on
2. **Hosted brief page** per deal: `/brief/[code]` (public, unguessable code, like `/r/[code]`). Creator gets it as a link on WhatsApp and Instagram. Mobile-friendly, with product images and reference reels.
3. **"I've read this and agree" button** on the page logs `brief_acknowledged_at`. Proof the script was communicated, no "I didn't know I had to tag you". If they need changes to dates, a "request change" button pings the team.
4. Brief edits after sending create a new version, re-send, and need a fresh acknowledgement.

### The delivery clock (per deal, all dates editable)

| Gate | Trigger | Auto-nudges (WhatsApp utility template) | Escalation |
|---|---|---|---|
| Brief acknowledged | Brief sent | +24h, +48h | +72h → team task |
| Product received | Shopify fulfilled + expected delivery date | "Did your PROMUNCH box arrive?" Yes / Not yet buttons | "Not yet" or no answer +2d → ops ticket |
| Draft submitted | Received + N days (default 7) | T-2, due day, +1, +3 | +5 → owner WA ping, deal marked **At risk** |
| Draft approved | Draft submitted | none (our side) | Team task if we sit on it >24h, so we never cause the delay |
| Posted | Go-live date | Day before: checklist reminder (tag, collab, code) | +2 → **Overdue**; +7 → **Ghosted** flag |
| Post verified | Post detected | If tag/code/collab missing: polite fix request | Team task |

Drafts: creator sends the video on WhatsApp (or Drive link). It lands on the deal, team taps Approve / Request changes with a note, the creator gets the response automatically. Revision count is tracked.

Never-message-twice: every nudge is one row in a reminders table with a unique `(deal_id, step)` key and an atomic claim before send, same pattern as `ig_followups` / `wa_journey_runs`. Any creator reply pauses automatic nudges for that step; stage changes re-arm the schedule.

### Our-side accountability

The tracker also chases **us**: brief not approved within 24h of agreement, kit not dispatched within 48h, draft not reviewed within 24h. These go into a daily 9am WhatsApp digest to the owner:
"Due today: 3 · Overdue: 2 (@a 4d, @b 1d) · Briefs waiting for your approval: 1 · Drafts to review: 2 · Kits not dispatched: 1"

### Creator reliability

Each creator record keeps on-time %, average days late, revisions, and ghost count. Shown on the profile and in Discovery, so serial late/ghosting creators stop getting kits.

### Works before Meta approval

Nothing in this section needs Instagram API access. The team (or the agency during handover) negotiates in IG manually, then clicks **Add collab** (handle, phone, address, kit, dates). From there the system owns brief, dispatch, and chasing. This is the fastest way to stop the manual chasing.

## 5. Instagram → WhatsApp handoff

When the creator says "let's move to WhatsApp" or shares a number:

1. Bot replies with a **wa.me link with a prefilled message**: `https://wa.me/<PROMUNCH number>?text=Hi PROMUNCH, collab ref INF-0042`. One tap and they're chatting with us. Because *they* message first, the 24h window opens and costs nothing, and there's no consent ambiguity.
2. `wa-webhook` sees the `INF-xxxx` ref → links that wa_id to the creator record → routes the conversation to the **influencer persona**, not the customer support bot.
3. Fallback if they only drop a number and don't tap: send one approved utility template ("Hi Riya, this is PROMUNCH, continuing our Instagram chat here") to that number. They gave the number in chat for this purpose, which is consent.
4. Both channels write to one creator timeline. The bot always replies on whichever channel the creator last used.

Routing rule for `wa-webhook`: if the wa_id is linked to a creator with an open deal → influencer persona; otherwise normal customer bot. This is a WhatsApp reply-behavior change and needs your explicit approval before it ships (AGENTS.md §4.2).

## 6. Data model (new)

- `influencers`: one row per creator. handle, ig_user_id, wa_id, email, name, city, tier, niche[], fit_score, status, owner, notes, address (encrypted-at-rest columns or separate table), discount_code, first_contact_at, last_contact_at, last_contact_channel.
- `influencer_metrics_snapshots`: weekly refresh: followers, ER, avg likes/comments, avg reel views, audience (from screenshot), source (`business_discovery` / `apify` / `screenshot`).
- `influencer_deals`: one per collab, so repeat collabs are clean. type (barter/paid/hybrid), fee, deliverables jsonb (reel/story/post count, format), brief, usage_rights_days, kit_id, shopify_order_id, and dates: proposed_at, agreed_at, shipped_at, delivered_at, content_due_at, draft_received_at, approved_at, posted_at, post_url, paid_at. Stage = derived from these.
- `influencer_kits` + `influencer_kit_rules`: kit contents (SKU list, COGS) and tier/niche → kit mapping.
- `influencer_events`: unified timeline across IG, WA, email, ops, Shopify.
- Reuse: `ig_threads`, `ig_messages`, `ig_followups`, `ig_prospects` (prospect → influencer on first contact), `wa_*` ledger + claims (never message twice still applies).

## 7. Build phases

| Phase | What | Effort | Depends on |
|---|---|---|---|
| **1. Delivery tracker** (priority) | `influencers` + `influencer_deals` + reminders tables, Add collab form, deals board (Due today / At risk / Overdue), creator profile + timeline, our-side SLA tasks, daily owner digest | ~1 week | none |
| **2. Brief + chasing** | Brief builder (AI draft + human approve), hosted `/brief/[code]` page with acknowledge button, 6 WA utility templates submitted to Meta, reminder engine, draft submit + approve loop | ~1 week + template approval (1 to 3 days) | **Your approval (WA: creator replies land on deals, not the customer bot)** |
| **3. Dispatch** | Kit rules + UI, Shopify ₹0 order, ops WA ping "done #N", delivery-check buttons, per-creator discount code | ~4 days | Phase 1 |
| **4. Post verification + ROI** | Mentions webhook + tags + Apify fallback, checklist auto-check, 24h/7d metrics, reliability score, cost per view/order | ~1 week | Phase 0 for webhooks; Apify works before |
| **0. Unblock IG** (runs in parallel) | Apply 2 IG migrations, submit Meta App Review, deploy ig-* functions | 1 to 2 days, then 1 to 4 weeks Meta wait | Meta Business access |
| **5. AI negotiator** (later) | Influencer persona in `ig-ai-reply` (barter only), auto-create the deal on agreement, IG → WA ref-link handoff | ~1.5 weeks | Phase 0 approval |

Phases 1 to 3 (about 3 weeks) replace the agency's chasing and tracking with no dependency on Meta's Instagram review. Negotiation automation comes after.

Run in shadow mode for the first 2 weeks after Phase 2: the bot drafts each reply, a human taps Send. Switch to auto once the drafts are consistently right.

## 8. Decisions (locked by owner 2026-10-07)

1. **Barter only for v1.** The bot negotiates and closes barter deals (product kit for deliverables) on its own. If a creator asks for a fee, the bot does not quote or agree to any amount: it says the team will get back, and the owner gets a WA ping. Paid deals are a later phase; `influencer_deals.type` and fee columns exist from day one so nothing needs migrating later.
2. **Same PROMUNCH WhatsApp number**, with `INF-xxxx` ref-code routing to the influencer persona.
3. **Dispatch via Shopify ₹0 order** tagged `Influencer`, excluded from revenue.
4. **Ad rights are per deal, off by default.** `influencer_deals.usage_rights` toggle (none / organic repost / Partnership Ads + days). The bot only asks for ad rights when the deal has it switched on (set by a human in the dashboard, or by a kit rule such as "Mid tier and above"). The brief and terms summary include rights only when on.

## 9. Tool stack + monthly cost

| Item | Use | Cost |
|---|---|---|
| Meta Instagram Messaging + Graph API | DMs, Business Discovery, mentions/tags | Free |
| WhatsApp Cloud API | Creator chats | Creator-started chats free; utility templates ~₹0.15 each; ~₹100 to 300/mo |
| OpenAI (existing account) | Negotiation, briefs, niche analysis, screenshot reading | ~₹1 to 3 per creator conversation; ~₹500 to 1,500/mo at 100 to 300 creators |
| Apify (existing) | Discovery, reel views, post detection fallback | $5 free credit, ~$39/mo plan if discovery runs daily; cap already in `ig_settings` |
| Supabase, Vercel, Shopify | Already paid | ₹0 extra |
| Optional: Modash / HypeAuditor | Audience demographics + fake-follower checks at scale | ~$200 to 300/mo. Skip at start; screenshot route covers it |

**Software total: roughly ₹4,000 to 6,000/month** (mostly Apify), versus the agency retainer. Product kits and any creator fees are the same either way, but you'll now see cost per view and cost per order per creator, which the agency likely isn't reporting.

## 10. Risks

- **Meta review rejection or delay.** Mitigation: Phase 1 (library + tracking) works without it; ship that first.
- **Bot says something wrong or over-commits.** Guardrails in settings, KB-only product facts, shadow mode first, barter only (bot never discusses money).
- **Human and bot both replying in IG.** Capture echoes; if a human sends from the IG app, the bot pauses that thread for N hours (same "Human mode" idea as the WA inbox).
- **Creator ghosts after receiving product.** Follow-up engine + WA templates + flag in library ("received, not posted, 21 days") so you stop gifting serial ghosters.
- **Address PII.** Keep addresses in a restricted table, gated by the Influencers access area.
