# Critical Security Fixes — Deploy Runbook

Status as of this commit: **all code + migration written and verified (build passes, exit 0). NOTHING is deployed. No key is rotated. No migration is applied.** The steps below are the parts only you can do (dashboards / irreversible), in the order they must happen.

> **Sequencing rule:** fail-closed code (Shopify webhook, cron routes, Resend webhooks) will reject live traffic if its secret isn't set. **Set the secrets first, then deploy.** Apply the RLS migration **after** the app deploy, or the dashboard breaks.

---

## What was changed in code (already done)

| Audit | Change | Files |
|---|---|---|
| **C1** | Locked anon RLS; moved all DB access off the public anon key | `supabase/migrations/004_lock_anon_rls.sql` (new) + 10 server routes swapped to service-role client + 3 client components swapped to the session browser client |
| **C2** | Removed the leaked service_role key + a user password from the settings allowlist | `.claude/settings.json` (11 entries stripped) |
| **C3** | Added a fail-closed, constant-time inbound-auth gate to the 6 paid send/reply edge functions | `_shared/require-internal.ts` (new) + `wa-send`, `wa-ai-reply`, `wa-campaign-send`, `ig-send`, `ig-ai-reply`, `ig-analyze` |
| **C4** | Real Shopify HMAC verification (fail-closed) + service-role client | `src/app/api/webhooks/shopify/route.ts` |
| **H4** | Cron routes fail closed when `CRON_SECRET` unset | `cron/amazon-poll`, `cron/amazon-settlements`, `cron/leads-tick`, `cron/wa-watchdog` |
| **H5** | Resend webhook signature checks fail closed | `webhooks/resend`, `webhooks/resend-inbound` |

---

## Step 1 — Rotate the leaked service_role key (C2)  ⚠️ do first

The key `role: service_role`, ref `hlykspakpewuilttnydm`, is in git history (commit `6f809d5`) and still matches the live key. Rotate it:

1. Supabase dashboard → **Settings → API** → rotate/roll the key.
   - ⚠️ On the legacy JWT scheme, rolling the JWT secret **also rotates the anon key**. If so, you must update `NEXT_PUBLIC_SUPABASE_ANON_KEY` too (Vercel + `.env.local`).
2. Update the new `SUPABASE_SERVICE_ROLE_KEY` in:
   - **Vercel** project env (used by the Next app + C3 callers).
   - **`.env.local`** (local dev).
   - Edge functions get it auto-injected by Supabase — no action, but redeploy (Step 5) picks it up.
3. Purge it from git history (after rotation, so the exposed key is already dead):
   ```bash
   # using git-filter-repo (preferred) or BFG
   git filter-repo --path .claude/settings.json --invert-paths   # or use BFG --replace-text
   git push --force-with-lease origin main
   ```
   Also change the user password `Khush@03!` that was in the file (auth user `cebeb4f1-...`).

## Step 2 — Set the prerequisite secrets in Vercel (before deploying)

These make the new fail-closed checks pass for legitimate traffic:

- `CRON_SECRET` — Vercel Cron auto-sends it as `Authorization: Bearer <CRON_SECRET>` once set. Required by leads-tick + wa-campaign-tick (scheduled) and the amazon/wa-watchdog routes.
- `SHOPIFY_WEBHOOK_SECRET` — **only if** the Next.js `/api/webhooks/shopify` route is actually registered in Shopify (see note). Must equal the secret Shopify signs with.
- `RESEND_WEBHOOK_SECRET` and `RESEND_INBOUND_SECRET` — from the Resend dashboard webhook signing secret. **If these webhooks are live and you deploy without setting these, email tracking + cold-email replies will 401.**
- `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` — *optional but recommended.* From the Sentry project (Settings → Client Keys). Both hold the same DSN (server + browser). Until set, Sentry is a no-op — the app runs fine, just with no error tracking. For source-map upload at build, also set `SENTRY_ORG`, `SENTRY_PROJECT`, and `SENTRY_AUTH_TOKEN` (build succeeds without them, just no upload).

> **Note on the Shopify Next route:** it duplicates the Supabase edge `shopify-webhook` (which writes `shopify_orders`); this route writes the legacy `orders`/`contacts` tables. Check Shopify → Settings → Notifications/webhooks to see if anything points at `promunch-crm.vercel.app/api/webhooks/shopify`. If nothing does, failing it closed is harmless and you can delete the route instead.

## Step 3 — Deploy the Next app

```bash
vercel --prod
```
Activates C1 (app side), C4, H4, H5. Do this **only after Steps 1–2**.

## Step 4 — Apply the RLS migration (C1)  ⚠️ after the app deploy

Supabase dashboard → **SQL editor** → paste and run `supabase/migrations/004_lock_anon_rls.sql`.
Then verify the breach is closed (both should return `42501 / permission denied`):
```bash
URL=<NEXT_PUBLIC_SUPABASE_URL>; ANON=<NEXT_PUBLIC_SUPABASE_ANON_KEY>
curl -s "$URL/rest/v1/contacts?select=*&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
curl -s "$URL/rest/v1/orders?select=*&limit=1"   -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
```
Then click through the dashboard (Contacts list + a contact detail, Analytics, Campaigns) to confirm staff reads still work via the authenticated session.

## Step 5 — Deploy the 6 gated edge functions (C3)

```bash
cd promunch-email-agent
supabase functions deploy wa-send wa-ai-reply wa-campaign-send ig-send ig-ai-reply ig-analyze
```
- Do **not** set `INTERNAL_FN_SECRET` (leave unset → the gate uses `SUPABASE_SERVICE_ROLE_KEY`, which every caller already sends).
- This touches `wa-ai-reply` — the change is an auth gate only, **no customer reply behavior changes**. Send a test WhatsApp message afterward to confirm the bot still replies.
- After deploy, confirm an unauthenticated call is rejected:
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' -X POST "$URL/functions/v1/wa-send" -d '{}'   # expect 401
  ```

## Step 6 — Commit

Per repo convention, commit directly to `main` (no auto-deploy on Vercel, so committing is safe and separate from deploying).

---

## Deferred (not critical — follow-ups)

- **M3:** the cron/tick/worker edge functions (`wa-jobs-tick`, `wa-journey-tick`, `wa-confirmation-sweep`, `amazon-poll`, etc.) are still `verify_jwt=false` with no gate. They're invoked by pg_cron with no auth header, so gating them requires adding the bearer to the pg_cron `net.http_post` calls first. Track separately.
- **M1:** no rate limiting on public endpoints.
- **L3:** empty `next.config.ts` — add CSP/HSTS/X-Frame-Options.
- Rotate the other plaintext keys in `.env.local` (OpenAI, Klaviyo, Google Places, Resend) as a precaution given the service-key leak.

---

## M1 — Rate limiting (chosen: Vercel Firewall + BotID; dashboard, no code)

Covers the Next.js `/api/*` surface (the Supabase edge functions are gated separately by M3's secret + Supabase's own limits).

1. Vercel → your project → **Firewall** → **Configure** → add **Rate Limiting** rules:
   - `/api/webhooks/*` — e.g. 60 req / 10s per IP (webhooks burst legitimately; tune to provider volume).
   - `/api/cron/*` — e.g. 10 req / 60s per IP (only Vercel Cron should hit these).
   - `/api/*` (catch-all, lower priority) — e.g. 100 req / 10s per IP.
   - Action: **Deny** (429) on exceed.
2. Enable **BotID** (Firewall → Bot Management) to challenge automated traffic. For deep protection on a specific sensitive route you can later add `checkBotId()` in code, but the managed challenge is config-only.
3. Note: rules apply at the edge before the function runs, so they also blunt the C3/C4/H4 abuse vectors from the internet side.

## M3 — Gate cron/worker edge functions (code done; coordinated apply)

12 cron-only functions are now gated with `requireInternal`. Apply in this order (AFTER C2 rotation, so the Vault key matches the new service_role key):
1. Set the Vault secret to the current service_role key (see `scripts/m3-gate-cron-auth.sql` header for the exact `vault.create_secret` / `vault.update_secret` call).
2. Deploy the 12 gated functions:
   ```bash
   cd promunch-email-agent && supabase functions deploy amazon-poll gmail-poll gmail-watch-renew nudge-pending shopify-daily-summary wa-campaign-worker wa-health wa-jobs-tick wa-journey-tick wa-rfm-tick wa-ticket-watchdog wa-weekly-summary
   ```
3. Run `promunch-email-agent/scripts/m3-gate-cron-auth.sql` in the SQL editor (re-schedules all 16 cron jobs to send the Vault bearer; also removes the anon key hardcoded in the shopify-monthly-recap job).
4. Verify: `curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/functions/v1/wa-jobs-tick"` → 401; check a cron run succeeds (2xx) in the function logs.
