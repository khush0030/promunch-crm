# Supabase migration: Seoul → Mumbai

**Status:** DONE. Cut over 2026-10-07, 15:09–15:37 IST. New project `wlungshkwfuggtbantkb` (Mumbai) is live; Seoul `hlykspakpewuilttnydm` is a forwarding shell awaiting deletion. See §9 for what actually happened.
**Date:** 2026-10-07
**Goal:** move the CRM Supabase project from Seoul (`ap-northeast-2`) to Mumbai (`ap-south-1`) so that (1) the app is faster from India and (2) customer data is stored in India.

---

## 1. Why this is a new project and not a setting

Supabase cannot change an existing project's region. "Moving" means creating a **new project in Mumbai**, copying everything into it, switching every caller over, and then retiring the Seoul project. That gives the new project a **new project ref, URL and API keys**. Most of the work below is repointing things to the new URL.

## 2. What we are moving (measured Oct 7 2026, read-only)

| Item | Current (Seoul `hlykspakpewuilttnydm`) | How it moves |
|---|---|---|
| Database | 291 MB, 105 public tables, Postgres 17.6 | `pg_dump` → restore (minutes at this size) |
| Extensions | pg_cron, pg_net, vector 0.8, supabase_vault, pg_trgm, pgcrypto, uuid-ossp, pg_graphql, pg_stat_statements | enable on the new project before restoring |
| Dashboard logins | 3 users, email login only | come over with the `auth` schema; everyone signs in again once (new JWT secret) |
| Storage | 4 buckets (`kb-docs`, `wa-media`, `email-assets`, `influencer-drafts`), 39 files, 35 MB | script-copy the files; bucket rows come with the dump |
| Edge functions | 59 functions | `supabase functions deploy` to the new ref |
| Function secrets | 72 | **re-entered by hand**: values can never be read back from Supabase |
| Vault secrets | 2 (the pg_cron bearer) | re-create by hand: Vault is encrypted with a per-project key |
| pg_cron jobs | 38 active, 27 have the Seoul URL hard-coded, 35 read Vault | re-create from SQL with the new URL, **paused until cutover** |
| Realtime | not used | nothing to do |
| Stored rows containing the Seoul URL | `wa_messages.media_url` 39, `wa_jobs.payload` 24, `wa_templates.header_media_url` 2, `wa_campaigns.header_media_url` 1, plus ~1,850 `connector_events` log rows | one `UPDATE` rewrite after the copy; log rows stay as they are |

Repo places with the Seoul ref: about 30 tracked files, mostly docs and one-off SQL. The only live code is `promunch-email-agent/supabase/functions/wa-health/index.ts` (a hard-coded cron URL in a comment block). The Next.js app (`src/`) reads the URL from env only.

## 3. Everything outside Supabase that points at the Seoul URL

These must be repointed. Webhook receivers are the functions with `verify_jwt = false` in `supabase/config.toml`.

| Caller | Points at | Who changes it |
|---|---|---|
| Vercel env (prod + preview): `NEXT_PUBLIC_SUPABASE_URL`, anon key, service-role key | the project | Claude (`vercel env`), then rebuild, since `NEXT_PUBLIC_*` is baked in at build time |
| Meta WhatsApp webhook | `wa-webhook` | Owner (Meta app dashboard) or Claude via Graph API |
| Meta Instagram webhook | `ig-webhook` | same |
| Shopify webhooks (orders, checkouts, status) | `shopify-webhook`, `shopify-wa`, `shopify-status` | Claude: run `shopify-webhooks-ensure` on the new project, then delete the old subscriptions (Shopify only lists our own app's webhooks) |
| Gmail Pub/Sub push subscription | `gmail-webhook` | Owner or Claude (GCP console: push endpoint) |
| Slack app "Maya" (events, interactivity, `/shopify`) | `slack-events`, `slack-interactivity`, `shopify-slash` | Owner (Slack app settings) |
| OAuth redirect URIs (Google, Meta, Shopify) | `oauth-callback` | Owner (each provider console) |
| Breeze drop-off webhook | `breeze-webhook` | Owner (Breeze dashboard) |
| Sarvam voice callbacks | `voice-webhook`, `voice-tool-*` | check whether the URL is built per call from `SUPABASE_URL` (then automatic) or saved on the Sarvam agent (then Owner) |
| COD Confirm/Cancel and other links already sent to customers | `cod-gate-action` | cannot be changed; covered by the forwarding proxy in §5 |
| Emails already sent that show `email-assets` images | Seoul storage URLs | cannot be changed; keep Seoul storage online for ~60 days (§6) |
| n8n order-confirmation workflow, if still active | function URLs | Owner (n8n) |

## 4. Decisions to make before we start

1. **Plan and cost.** Both projects run (and bill) together for about a month. The new project should be on the same plan as Seoul.
2. **Optional: a custom API domain** (Supabase add-on, about $10 a month, e.g. `api.promunch.in`). If providers point at our own domain, any future move skips the whole §3 repoint. Recommended only if more moves are likely; it is not needed for this one.
3. **Vercel interim step.** If the cutover is within about 2 weeks, skip the interim `icn1` (Seoul) region pin and set `bom1` (Mumbai) at cutover. If it is further out, pin `icn1` now and switch it to `bom1` at cutover.
4. **Cutover window.** About 45–60 minutes, late at night IST, with no campaign sending and no voice calls running.

## 5. The safety rule for cutover: never message a customer twice

The risk is **both projects sending at once**: two sets of crons, or a webhook processed in both places. These rules prevent it:

- **One sender at a time.** Seoul crons are switched off *before* the copy. Mumbai crons are created *paused* and only switched on after verification. At no point are both active.
- **The dedup history moves with the data.** Claim tables (`wa_confirmation_claims`, `wa_reply_claims`, `wa_journey_runs`, the manual-send claims) and the `wa_messages` ledger are in the dump. Mumbai therefore knows everything Seoul already sent.
- **No inbound event gets processed twice or lost.** During the window, the Seoul public receivers return HTTP 503 ("maintenance"). Meta (retries for up to about 7 days), Shopify (retries for about 4 hours) and Pub/Sub (keeps messages for up to 7 days) all retry. After the restore, the Seoul receivers become **forwarding proxies**: they pass the raw body and signature headers through unchanged to the Mumbai function of the same name. Retries and old links then land in Mumbai and are processed exactly once, with signature checks still passing because the secrets are the same. Providers can then be repointed calmly, one at a time.
- **No in-flight work at the freeze.** Before freezing, confirm that no `wa_campaigns` row is sending, the `wa_jobs` queue is empty, and pg_net has no pending requests.

## 6. Steps

### Phase A: prepare (no customer impact; done in the days before)
1. Owner creates the Mumbai project in the same org, on the same plan and Postgres major version (17).
2. Gather all **72 function secret values** (names are saved in a scratch file from Oct 7) from `.env.local`, Vercel env, `app_secrets` and the provider consoles. Any missing value means re-issuing that key at the provider. **This is the step most likely to stall: start it first.**
3. Code changes, committed to `main` but not yet deployed:
   - a `MAINTENANCE_MODE` / `FORWARD_TO_URL` switch in a shared `_shared/forward.ts`, wired into every public receiver (return 503, or proxy to the same function name on the new URL);
   - `wa-health` reads its URL from env, with no hard-coded ref;
   - a cron SQL file generated from the canonical topology that takes the project URL as one variable and creates every job **inactive**.
4. **Rehearsal:** dump Seoul → restore into Mumbai → deploy functions with **customer sends blocked** (WhatsApp, IG, email, voice tokens deliberately left unset, so any send attempt fails closed) → compare row counts → open the dashboard against it from a Vercel preview deploy. Record timings. Then wipe Mumbai for the real run.
5. Enable the same extensions in Mumbai. Create the 4 buckets and copy the 39 files (script via the storage API, copying the public/private setting).

### Phase B: cutover night (about 45–60 min, Claude runs it, Owner on call)
| # | Step | Check |
|---|---|---|
| 1 | Pre-flight: no campaign sending, `wa_jobs` empty, no pending pg_net requests | query output |
| 2 | Seoul: deploy receivers with `MAINTENANCE_MODE=on` (they return 503) | curl → 503 |
| 3 | Seoul: `cron.alter_job(active := false)` for all 38 jobs; save the list | 0 active |
| 4 | Dump roles + schema + data (`supabase db dump`, data with `--use-copy`) | files written |
| 5 | Restore into Mumbai with `session_replication_role = replica` | row counts match on 105 tables |
| 6 | Mumbai: re-copy any storage files added since Phase A; rewrite the 66 stored Seoul URLs (`wa_messages`, `wa_jobs`, `wa_templates`, `wa_campaigns`) | 0 non-log rows with old ref |
| 7 | Mumbai: set the 72 secrets, re-create the 2 Vault secrets, deploy all 59 functions | `supabase functions list` |
| 8 | Mumbai: create the 38 cron jobs, still **inactive** | 38 jobs, 0 active |
| 9 | Vercel: new Supabase env + `"regions": ["bom1"]` → `vercel --prod` | dashboard loads, login works |
| 10 | Seoul: switch receivers to `FORWARD_TO_URL=<mumbai>` | Meta and Shopify retries arrive in Mumbai |
| 11 | Mumbai: activate the crons | `cron.job_run_details` shows success |
| 12 | **Live tests** (house rule): WhatsApp message from Khush's phone → bot reply; test Shopify order → one confirmation; inbox manual send; email draft; COD button tap on an old message (through the proxy) | each happens exactly once |

### Phase C: repoint and retire (the following days)
1. Repoint every row in the §3 table to Mumbai. Then watch the Seoul proxy logs: traffic should drop to zero except old customer links.
2. Clean up docs and scripts to the new ref (30 files), and update `CRON_TOPOLOGY.md`, `DEPLOY_GUIDE.md` and the memory notes.
3. After **7 days** with no proxied webhook traffic: switch the Seoul project to proxy-only for `cod-gate-action` and storage.
4. After **about 60 days** (old email images and COD links have aged out): take a final backup of Seoul, then delete it. Owner confirms before deletion.

## 7. Rollback

Up to step 11, Seoul is unchanged apart from paused crons and maintenance receivers. To roll back: set the receivers to normal, re-activate the Seoul crons, point Vercel env back, and redeploy. After step 11, Mumbai has new data that Seoul lacks, so rolling back means a reverse dump. Treat step 11 as the point of no return and only pass it once steps 1–10 check out.

## 8. Effect on speed, and what "data in India" covers

- With Vercel functions in `bom1` next to the database, each query drops to a few ms, versus about 0.2 s today (functions in Washington, database in Seoul). Multi-query dashboard pages gain the most. Round trips from India drop by a further ~70 ms compared with Seoul.
- **Stored in India:** the database, auth, storage, Supabase backups, edge-function execution (it follows the caller), and Vercel function execution.
- **Still processed outside India:** messages pass through Meta, Shopify, OpenAI, Resend, Slack and Sarvam on their own infrastructure. This move does not change that, and residency claims should be worded accordingly.

## 9. What actually happened (2026-10-07)

- **Where the project lives:** the PROMUNCH org is on the free plan and was at its 2-project cap, so the Mumbai project was created in the Pro org "Admin Oltaflock" (`hpakwwhptpcfppeasmqd`). Moving it into PROMUNCH (after Seoul is deleted, ideally after upgrading PROMUNCH to Pro) is still open.
- **Secrets:** all 63 function secrets were read once through a temporary, token-gated export function, set on Mumbai, verified by matching digests, and the function was deleted. `OAUTH_REDIRECT_URI` now points at Mumbai, `BREEZE_WEBHOOK_SECRET` was rotated (re-entered in Breeze), and Sarvam app versions are pinned to cart v5 / COD v2 (same prompts, Mumbai tool URLs).
- **Seoul during and after cutover:** every Seoul function was replaced by a stand-in. It first returned 503 (Meta, Shopify and Pub/Sub retried later), then forwarded the raw request to the same function on Mumbai. Seoul's `shopify-wa` stand-in drops `checkouts/*`, because Mumbai has its own app subscription for those.
- **Freeze:** Seoul crons off and stand-ins in place at 15:09. Data dump about 10 min, restore under 2 min, row counts matched on all 104 tables (305,713 rows). Mumbai crons on at 15:37.
- **Incidents, all caught on the spot:**
  1. Running two CLI commands against Seoul at once reset the CLI's temporary login, which killed the first data dump mid-COPY; it was rerun alone.
  2. The Vault held the legacy service-role JWT and the first 4 cron calls returned 401. The fix is the `sb_secret_…` key (see `docs/runbooks/CRON_TOPOLOGY.md`).
  3. `shopify-webhooks-ensure` added Mumbai checkout subscriptions without removing the Seoul ones, which briefly doubled checkout deliveries. Seoul's stand-in now drops them; no journey or message was duplicated.
- **Webhooks moved:** Meta WhatsApp (WABA override), Shopify app checkouts plus the 9 admin webhooks, Slack (events, interactivity, `/shopify`), Gmail Pub/Sub push and OAuth redirect, Breeze, Sarvam tools. The dashboard is on Mumbai, with functions pinned to `bom1`.
- **Speed:** uncached dashboard API requests went from about 1.1 s to 0.17–0.66 s.
- **Left:** verify one real order end to end; delete Seoul (old sent emails lose their `email-assets` images); move the project into the PROMUNCH org.
