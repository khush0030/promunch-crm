# Redesign handoff: continue in any session (local or cloud)

**Keep this file current.** Updated at every milestone. Last update: **8 Oct 2026, ~19:45 IST**, branch `redesign/app-v2` @ see `git log -1`.

Read first: `AGENTS.md`, `CLAUDE.md`, `promunch-email-agent/CLAUDE.md` §0 (never message a customer twice).

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

## 4. Current state: top 5 DONE (fidelity Tier 1 items 1-5), owner to review

- **Committed and pushed:**
  - `f6584ef`: IA tab sets + header slot.
  - `428ee48`: login, set-password, unsubscribe, 404, no-access, error.
  - `448ab88`: WIP that carries Home + welcome.
  - `212a880`: Inbox/Orders.
  - `c435c3b`: Customers/Segments/Insights/Settings/Security.
  - `153ec17`: WhatsApp/Email.
  - Plus the shell hydration fix.
- **Checks after the top 5:**
  - `tsc` clean, `vitest` 1440/1440, lint at main's level (20).
  - `npm run build` 70/70.
  - Production crawl of 71 routes × 1440/390: only known/expected flags (fake-id 404s, the built-in template key 500, sr-only text).
  - The dashboard 404 hydration error was fixed.
- **Known remaining gaps** in these areas, intentional or needing backend:
  - Tickets has no "New ticket"/"Rules" (no API).
  - Voice has no period picker (the API has no range).
  - Live chats has no 3-column rail yet.
  - Email drafts still appear in the chat list (API).
  - Home: the third tile stays "Needs you"; the API has no "Today".
  - Segments page content is not rebuilt.
  - The wizard and template-creator "Words on this step" chips remain (shared StepHeader).
- **Open question for the owner:** Home shows TWO red elements (red sales tile + red "Confirm COD orders" button), as the prototype does, but the brand rule says one red per view. Which wins?
- **Still open:** does "no Replies/Orders tiles" cover the WhatsApp campaign report?
- **Next:** owner review on localhost:3217, then the fidelity audit's bug list and further Tier 1 items 6-20 as the owner picks.
- **Machine note:** `promunch-crm-mainbase` (main baseline) was removed by another session. Recreate it with `git worktree add --detach ../promunch-crm-mainbase origin/main`, copy `.env.local`, and clone `node_modules` with `cp -cR` (a symlink breaks Turbopack). The prototype is also in this worktree at `docs/plans/2026-10-07-app-redesign/`.

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

- 2026-10-08 ~19:45 IST: top 5 done and verified (build, tests, lint, prod crawl); 404 hydration fix. Waiting on owner review + the two-red question.
- 2026-10-08 evening: public pages done (428ee48); remaining 4 areas pushed as WIP 448ab88 after repeated rate limits; agents resumed. Machine load is high; the 3218/3219 servers were stopped to free CPU (restart them for final checks).
- 2026-10-08 12:10 IST: owner said "start with top 5"; IA tab sets + header slot committed (f6584ef); 5 build agents running.
- 2026-10-08 11:45 IST: fidelity audit finished (6 areas), written to docs/audits/2026-10-08-redesign-fidelity.md. Prod-build click-through passed. Waiting on owner to pick fixes.
- 2026-10-08 10:15 IST: file created. QA + fixes done and pushed; fidelity review running; final prod click-through running.
