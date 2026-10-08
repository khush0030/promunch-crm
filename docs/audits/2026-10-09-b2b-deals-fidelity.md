# B2B leads and Deals: fidelity + UX audit (9 Oct 2026)

Scope: `/dashboard/leads` (all tabs, modals) and `/dashboard/deals` on branch `redesign/app-v2`, compared with the prototype `docs/plans/2026-10-07-app-redesign/b2b.html` (screens `b2b-home`, `b2b-list`, `b2b-find`, `b2b-review`, `b2b-track`, `b2b-deals`, `b2b-setup` + overlays) and IA `04-ia.md` row 6 ("B2B & deals: Overview · Find · Review · Sent & replies · Deals"). Follows Tier 1 item "B2B/Deals never rebuilt" in `2026-10-08-redesign-fidelity.md`.

Live numbers seen while auditing (prod data via local dev): 772 leads, 25 lists, **408 AI drafts waiting**, 4 sent, 3 replied, 0 in follow-up campaigns, daily cap 15. 102 open deals, 81 flagged for follow-up.

## 1. Screen by screen

| Prototype screen | What it shows | What was built (before this pass) | Gap |
|---|---|---|---|
| Header (all B2B screens) | eyebrow `★ B2B & deals`, UPPERCASE title, one sentence with the key number in bold, ONE primary action, then the B2B tabs | Legacy `pm-head`, no eyebrow; **3 equal buttons + 3 icon buttons** (New email campaign, Find companies, Keep going, Guide, Settings, Refresh); section tabs were only `Leads · Deals` | Wrong header pattern, no single next action, tab set did not match the IA |
| `b2b-home` Overview | "How it flows" stepper with the next step marked red, "Your lists" with found → emails → sent → replied → deal per list + a stage bar, New replies, Deals summary | Flow card existed (6 steps) but no "next" step, counts mislabelled (step 3 "Review emails" showed 408 drafts but opened a *list picker*, not the drafts). Below it a stat line duplicating the flow, then 5 inner tabs (Lists / Campaigns / Saved emails / Replies / Analytics) and a 25-row list index | No next-step guidance, duplicated numbers, Overview and Lists mixed on one screen, no replies or deals summary |
| `b2b-list` List detail | List picker title, stage filter tiles (All · No email · To review · Sent · Follow-up · Replied), one calm row per business with its stage tag, Add email for no-email rows | Dense `pm-tbl` table (Fit / Company / Contact / Last contacted / Status / trash), long instruction paragraph, browser `prompt()` rename, no stage filter | No stage view, table not usable at 390 px, filled badges |
| `b2b-find` New list | Inline page: business type chips, area, Find, results with a pick step, sticky action bar "Save list & write emails" | A modal (`SearchModal`) with 7 sections; after submit the page runs ticks in the browser and shows nothing but a header sentence | Find was a modal with no progress view. A real pick step needs a synchronous search endpoint (Tier 2, backend) |
| `b2b-review` Review one at a time | Progress bar "3 of 8 done", left: who it goes to, email check, fit; right: subject + body editor, Skip / Rewrite / Looks good, next | **Missing.** The only way to review an AI draft was: Replies tab or a list → open a lead modal → scroll to "Outreach email" → Approve & send. 408 drafts had no queue at all | Biggest gap: no review queue |
| `b2b-track` Replies | Stat line (sent, opened, replied, bounced), chips Replied / Follow-up due / No open / Bounced, one row per reply with the quote and the next action | Replies tab = old `LeadTable` (table of replied leads); no sent / bounced views; "Replies become deals" only a text hint | No quote, no link to the matching deal, no sent/bounced views |
| `b2b-deals` Deals board | Header with ₹ open + one sentence, Board/List seg, New deal; columns New · Talking · Sample sent · Won with calm cards (avatar, name, sub, value, due pill) | Board existed (drag to stage works) with legacy `PageHead`, a 4-tile stat line, filters row, explanatory paragraph, 7 columns | Header pattern, card look. ₹ value and "New deal" need backend (no column / no create endpoint) |
| `b2b-setup` Outreach setup | Sender (from, reply-to, daily limit), follow-up timeline, saved lists, email starters | Spread over: settings icon modal, Campaigns tab, Saved emails tab, Analytics tab | No single setup place |
| Overlays | Send batch confirm, Rewrite, Deal drawer, New deal | LeadModal (centre modal, 6 action buttons, tables), CampaignWizard, SettingsModal, GuideModal, ListPickerModal, Confirm/TextPrompt dialogs, DealDrawer | Batch send and New deal need backend changes (not in scope: approval gates stay one email per click) |

## 2. UX friction in the old flow

Clicks from nothing to one sent email (old UI):

1. Find companies (modal) → choose chips → Find companies. The page then says "Working…" in the header sentence; nothing shows which list is filling.
2. Wait, or press **Keep going** (unclear name for "run the pipeline").
3. Lists tab → scroll a 25-row grouped index → open a list.
4. Click a lead row → lead modal → scroll past contacts, history, intel → "Outreach email" → **Approve & send**.

So at least 7 clicks and two scrolls, and the 408 AI drafts already written were invisible: the step labelled "Review emails" opened a list picker that leads into the *campaign wizard* (a different sending path) rather than the drafts.

Other friction:

- **Two sending paths, not explained:** one-off AI drafts (approve each) vs list campaigns (sequence wizard). The UI called both "campaign" in places.
- **Confusing labels:** "Keep going", "Campaigns" (= sequences), "Saved emails" (= templates), "Save as a list" step counting emails, fit shown as a bare number pill.
- **Dead ends:** Replies told you to "track it in Deals" but there was no link from a reply to its deal; Analytics was a separate tab disconnected from the flow.
- **Numbers repeated** three times (flow card, stat line, tab counts).
- **Phone (390 px):** the lead tables scrolled sideways; the header wrapped into 6 buttons.
- **Deals:** "81 need your attention" with no way to see which first except a toggle; filled lane tints.

## 3. What this pass rebuilds (UI only, same API calls)

- B2B tabs per prototype: **Overview · Lists · Review · Replies · Deals** (section tabs from `nav.ts`), with Find and Setup as back-link sub pages.
- Overview: guided stepper Find → Score and find emails → Write → Review and send → Follow-ups → Replies → Deals with counts, the next step marked, and one primary header action that always matches it.
- Lists: calm list rows with stage counts + bar; list detail with stage filter tiles, row list, bulk bar (email selected, find emails, remove) unchanged in behaviour.
- Find: inline page (same POST `/api/leads/search` body), live progress of recent searches, pipeline runner.
- Review: one-at-a-time queue over drafted leads; Send uses the exact existing per-draft approve route (`POST /api/leads/drafts/[id]/send`), one click per email. Skip, Rewrite (existing regenerate), Discard (existing PATCH).
- Replies: Replied / Sent / Bounced views with the reply quote and a link to the matching deal.
- Setup: sender + daily limit, follow-up campaigns, email starters, results, list management.
- Deals: new header, calm kanban cards; drag-to-stage PATCH unchanged.

## 4. Still needs backend (Tier 2, scope with owner)

- Find with a synchronous pick step (search returns results before saving).
- Batch "Send N approved" (would need an `approved` draft state + batch endpoint; today each send is its own approval).
- Deal ₹ value, "New deal" create endpoint, lead → deal history, reply type tags (Interested / Question / Later).
- Per-list "to review" count in `GET /api/leads/lists` (the Overview shows it globally).
