# Redesign handoff: continue in any session (local or cloud)

**Keep this file current.** Updated at every milestone. Last update: **9 Oct 2026**, branch `redesign/app-v2` @ see `git log -1`.

Read first: `AGENTS.md`, `CLAUDE.md`, `promunch-email-agent/CLAUDE.md` §0 (never message a customer twice).


## Update 9 Oct 2026 (day session), branch head d0308ee

Done on redesign/app-v2 (pushed, NOT merged, NOT deployed; main merged in, 0 behind):
- Owner decisions applied: COD waiting = pending/needs_call, unshipped, uncancelled, any age (badge = page);
  Home action button neutral (sales tile is the one red); campaign Orders = shared 7-day last-touch rule
  (src/lib/whatsapp/campaign-attribution.ts); cart templates = live wording minus dashes (resubmitted to Meta).
- Rebuilt: Inbox three-panel Live chats + customer context panel; B2B guided flow (Overview, Lists, Review,
  Replies, Find, Setup) + Deals; Creators = Find · Outreach · Collabs · Settings (Instagram folded in,
  /dashboard/instagram redirects); Reputation on the shared shell; My profile (name + photo, email-assets bucket).
- P1 gaps closed: Settings Connections (live status, Slack gone), Voice calls KPIs, All orders chips/search/CSV,
  Segments counts, Tickets Reports + Topics, Bot knowledge Test a question (dry run), Insights Repeat & cohorts +
  What people buy, Maya Saved answers, New deal, New email template.
- QA: docs/audits/2026-10-09-full-qa.md (untracked) pass 1 + 2, no open P0.
- Checks at d0308ee: tsc clean, vitest 1582/1582, build green.

Live prod changes made today (outside the branch): 148 stale COD rows settled, 47 WA tickets resolved (5 human
threads kept human), COD call spacing 3h -> 6h, 7 pg_cron jobs + SITE_URL/SITE_APP_URL secrets + Vercel
SITE_APP_URL moved to admin.promunch.in (prod redeployed, no code change).

Needs owner / manual:
- Paste supabase/migrations/20261009120000_assistant_saved_answers.sql (Saved answers hidden until then).
- Instagram tables never migrated: Creators Find/Outreach show "Not switched on yet" (needs IG migrations,
  ig-* crons, APIFY_TOKEN).
- Bot KB is 32.7k chars > 28k budget, so the bot uses stale kb_chunks: trim or re-embed.
- review_request / replenishment_reminder templates still have em dashes (ask before resubmitting).
- Merge: owner says "merge" -> merge to main, vercel --prod, live-test, report committed vs deployed.

## 1. Where things stand (one paragraph)

The full CRM redesign lives on branch **`redesign/app-v2`** (pushed; ~32 commits ahead of `main`, `main` already merged in). It is **NOT merged and NOT deployed**. The branch exists because the owner asked for a review branch (exception to "commit to main"). Owner wants it merged soon; merging needs the owner's explicit "merge".

## 2. Done so far (8 Oct)

1. **Functional QA, complete.** 3 static audits plus 6 parallel E2E testers clicked every control at 1440/768/390 px against main as a baseline.
   - Result: no mock data, and every API call, send handler, guard and confirm is identical to main.
   - Both campaign wizards were verified to the final step, with request bodies byte-identical to main:
     - WhatsApp steps 1-6, test send and launch confirm.
     - Email Check & send.
2. **QA fixes committed and pushed** (commits `729727c`..`3572559`):
   - **Shell:**
     - tablet (761-1099px) opens with the icon rail;
     - tablet/phone gutter bug fixed (`:root[data-theme]` specificity);
     - tabs fade on phones and align with the title;
     - dialog titles in sentence case;
     - Settings follows #hash and ⌘K switches sections;
     - Maya brings a `?q=` prefill into view;
     - Home shows its section tabs and urgent amounts are ink;
     - More sheet focus.
   - **Email:**
     - container-query table fit;
     - one rate column = click rate (the list only has open events);
     - pinned Save in the automation editor;
     - links "Show all".
   - **Orders/Insights/Voice/Inbox:**
     - Resend-missing desktop-only again (as on main);
     - no `−−₹`;
     - near-empty previous period hides the % change;
     - Web store date comes from the data;
     - voice scorecards hidden while filtered;
     - inbox layout fixes.
   - **Creators/B2B/Customers:**
     - New kit no longer a dead end;
     - phone Sort by;
     - customer email visible;
     - leads summary on phone;
     - deal stepper fits.
   - **WhatsApp:**
     - container-query list/detail;
     - honest "Reached"/"Completed · 0 reached";
     - one funnel base;
     - Meta template names visible;
     - Automations tab resets.
3. **Checks after the fixes:**
   - `tsc` clean, `vitest` 1439/1439, `npm run build` passes.
   - Lint is at main's level (20 errors, all pre-existing).
   - The production build crawled under 4 parallel browsers: 68 routes, no hydration errors, no failed API calls.
   - The click-through on the production build was still running at last update.

## 3. Owner decisions already made

- **Leaner UI (8 Oct):** do NOT re-add info the redesign dropped. That covers the email click-rate/When columns, WhatsApp campaign reach/Delivered/Replies/Clicks, the Results Replies/Orders tiles, contacts lists/status, and the Home Web/Amazon/Repeat tiles. Only fix numbers that are wrong, dead ends and clipping.
- Calm UI rules: status = coloured text + dot, no filled blocks, one red element per screen, yellow only for Maya, green only for good, hairlines and no boxes in boxes, readable at 390px, nothing cut off.

## 4. Current state (9 Oct): top 5 + all bug fixes done; waiting on owner answers, then merge

- **Done and pushed** on `redesign/app-v2` (HEAD `e204b36`):
  - fidelity Tier 1 items 1-5;
  - audit bug list;
  - code-review fixes;
  - both bug hunts;
  - owner decisions from 9 Oct (below).
- **Checks:**
  - `tsc` clean, `vitest` 1460/1460, lint 20 (= main), `npm run build` 70/70.
  - Production crawl clean; the remaining flags are known false positives: Amazon order ids starting "404", sr-only text, blocked test writes, fake-id 404s.
- **Owner decided 9 Oct (done):**
  - Phones always stored as `+91…` (`src/lib/contacts/phone.ts`, POST + PATCH `/api/contacts`).
  - B2B fit prompt: no em dashes, PROMUNCH caps, chips/sticks not called roasted.
  - WhatsApp campaign report tiles = Delivered · Read · Clicked · Orders (the leaner-tiles decision does NOT cover the report).
  - Anonymize/Deactivate are visible buttons on the customer page (NOT in a ⋯ menu).
- **Owner approved removing em dashes from the live abandoned-cart WhatsApp templates. NOT DONE, waiting on A/B:**
  - Live Meta copy (DB `wa_templates`) differs from the source copy in `promunch-email-agent/supabase/functions/wa-template-create/index.ts` (an optimised rewrite that was never pushed). Resubmitting rebuilds from source.
  - **A** = keep the live wording, only drop the dashes (edit the source to match live).
  - **B** = ship the source rewrite without dashes.
  - Flow: edit the source, run `deno check`, `supabase functions deploy wa-template-create --project-ref wlungshkwfuggtbantkb`, then invoke `{ edit: true, names: ["abandoned_cart_reminder","abandoned_cart_recovery"] }` (internal auth; see memory internal-fn-secret-mismatch).
  - The old copy keeps sending until Meta re-approves, so there is no downtime.
  - Ask the owner about `review_request` / `replenishment_reminder` (em dashes too); leave `order_confirmation_v2` unless told.
  - Ops templates (`order_cancel_ops`, `ops_ticket_alert`) are team-only, so leave them.
- **Still open with the owner:**
  1. COD count: badge 14d (26) vs Confirm COD default 7d (21). Proposal: Confirm COD lists every order still waiting.
  2. Home has two reds (sales tile + Confirm COD button). Which wins?
  3. Campaign "Orders": the report tile (7-day attribution) says 0 while the Journey card ("ordered any time later") says 7. Use one definition?
  4. (Unchanged) COD manual confirm, ticket owner merge, per-session sign-out, dark mode.
- **Before merge:** `origin/main` has 10+ new commits (influencer dashboard/portal, team role presets, bulk-orders fan-out, ORM plan). Merge `origin/main` into the branch, re-run build/tests/lint/crawl, then follow runbook §6.
- **Before deploy:** locally `/api/whatsapp/quota` shows `standing_error "wa-meta-info HTTP 401"` (internal key after the Mumbai move). Verify it in prod.
- **Later:** design pass 2 = audit Tier 1 items 6-20 (B2B/Deals rebuild, ticket detail, Maya answer cards, WA report trim, email automations rows, Confirm COD grouping, Live chats rail, customer profile, ⌘K, Needs you, Creators collab page, sign-up popup editor), plus Tier 2 backend items as the owner scopes them.

## 5. Open owner decisions (do not build without a yes)

1. COD: a manual Confirm button for orders still waiting on the WhatsApp tap (changes the COD flow: AGENTS.md §4.2 approval).
2. Tickets: merge queue assignee and chat owner into one field?
3. Security: per-session "Sign out" (needs a new API).
4. Dark mode: the branch forces light (`<html data-theme="light">`). Main follows the OS.

## 6. Merge + deploy runbook (only after the owner says "merge")

1. `git fetch && git log HEAD..origin/main` and merge any drift into `redesign/app-v2`. Re-run `npm run build && npm run test && npm run lint`.
2. `git checkout main && git merge --no-ff redesign/app-v2 && git push origin main`.
3. `vercel --prod` (git push deploys nothing). No edge functions or migrations changed on this branch, so there are no `supabase functions deploy` or SQL steps.
4. Live-test on prod:
   - order → WA confirmation;
   - inbox reply;
   - a campaign test send to the owner's number only.
5. Report "committed" vs "deployed" separately.
6. Update the docs: `docs/README.md` index, the ARCHITECTURE nav section, page/route counts.

## 7. How to work on this branch

### Local machine (normal)

- Worktree: `~/Projects/promunch-crm-redesign` (never `/private/tmp`).
- The shared checkout `~/Projects/promunch-crm` is on another session's branch (`codex/premium-redesign-preview`); leave it alone.
- Dev server: `npx next dev -p 3217`. Main baseline worktree: `~/Projects/promunch-crm-mainbase` on :3218. Production build: `npm run build && npx next start -p 3219`.
- Prototype: `cd docs/plans/2026-10-07-app-redesign && python3 -m http.server 3230` (on main / the mainbase worktree).

### Cloud session (if the local account hits its limit)

- **What a cloud session CAN do:**
  - clone `khush0030/promunch-crm`, `git checkout redesign/app-v2`, read this file, `npm ci`;
  - edit UI code, run `npx tsc --noEmit -p .`, `npx vitest run`, `npm run lint` and `npm run build`;
  - commit and push to `redesign/app-v2`.
- **What it CANNOT do without secrets** (`.env.local` is never committed): run the app against real data, mint test logins, deploy.
  - Do UI work plus the static checks there, and leave browser QA and deploy to a local session.
  - Never paste prod secrets into a cloud session unless the owner explicitly says so.
- **Never in cloud:** merge to `main`, `vercel --prod`, `supabase functions deploy`, or any send/live test.

### Safe browser QA (needs `.env.local` with the Mumbai project keys)

- Tools are in `scripts/redesign-qa/` (copied from `~/.promunch-redesign-tools`).
- `node scripts/redesign-qa/login.mjs .env.local scripts/redesign-qa/session.json` mints a short-lived owner session. This is standing owner approval for read-only local checks only, and `session.json` is gitignored.
- `safe.mjs`: **always** drive the app through `openSafe()`.
  - It aborts every non-GET request to any origin and logs it in `log.writes`.
  - It blocks trigger-like GETs.
  - It has explicit allowlists only for endpoints verified read-only: POST `/api/whatsapp/campaigns/audience-preview`, POST `/api/email-studio/segments/count`, and GET `/api/email-studio/campaigns/:id/send` (readiness).
- `crawl.mjs <port> <width> routes-final.txt out.json` loads every route and records API calls and errors. `clicks.mjs` does a safe click-through.
- Production has no creator (influencer) data. To render the Creators screens, mock the GETs with `page.route` for `/api/influencers/*`.

## 8. Infra facts that bite

- The CRM DB is Supabase **`wlungshkwfuggtbantkb` (Mumbai)**. Seoul was deleted on 7 Oct.
- The main checkout's `.env.local` still points at Seoul; the redesign worktree's is correct.
- Vercel functions run in `bom1`. Vercel Hobby allows daily crons only; sub-daily work runs on pg_cron.

## 9. Update log

- 2026-10-09: owner decisions applied (phones +91, fit prompt, report tiles, profile buttons); cart template A/B pending; main has new commits to merge before shipping.
- 2026-10-09 early AM: code-review + both bug hunts fixed and pushed (ba70ad4..2ce460f); build/tests/lint/crawl green; 7 owner decisions listed in section 4.
- 2026-10-08 ~22:00 IST: all 7 audit bugs fixed + pushed; bug hunt (3 agents) running.
- 2026-10-08 ~19:45 IST: top 5 done and verified (build, tests, lint, prod crawl); 404 hydration fix. Waiting on owner review + the two-red question.
- 2026-10-08 evening: public pages done (428ee48); remaining 4 areas pushed as WIP 448ab88 after repeated rate limits; agents resumed. Machine load is high; the 3218/3219 servers were stopped to free CPU (restart them for final checks).
- 2026-10-08 12:10 IST: owner said "start with top 5"; IA tab sets + header slot committed (f6584ef); 5 build agents running.
- 2026-10-08 11:45 IST: fidelity audit finished (6 areas), written to docs/audits/2026-10-08-redesign-fidelity.md. Prod-build click-through passed. Waiting on owner to pick fixes.
- 2026-10-08 10:15 IST: file created. QA + fixes done and pushed; fidelity review running; final prod click-through running.
