# PROMUNCH CRM — Production Deploy Guide (step-by-step)

Concrete, ordered instructions to take everything from code → live. Follow top to
bottom. **Order matters** — fail-closed code rejects live traffic if its secret
isn't set first, so secrets/keys come before deploys, and the RLS migration comes
*after* the app deploy.

Reference values for this project:
- Supabase project ref: **`hlykspakpewuilttnydm`**
- Supabase URL: **`https://hlykspakpewuilttnydm.supabase.co`**
- Production app: **`https://promunch-crm.vercel.app`**
- `CRON_SECRET` (already chosen): **`w1xcPz5K2mFm-N2N7Mfh-0YGGPDtbKS8voUpyXd0YJ0`**

Keep a scratch note as you go — you'll copy the **new service_role key** and **new
anon key** into three places each.

---

## Step 0 — Pre-flight (do this before Step 1)

**0a. Clean the working tree.** `supabase functions deploy` and `vercel --prod`
ship whatever is in your working directory, not what's committed — so uncommitted
work WILL go live. Right now the tree has uncommitted changes from parallel work
(analytics/utm, Flows, `wa-campaign-send`). Commit or stash them first:

```bash
cd /Users/khush/Projects/promunch-crm
git status                      # review what's uncommitted
# commit the parallel work (or `git stash` if it isn't ready to ship)
git add -A && git commit -m "…" && git push origin main
git status                      # must show: nothing to commit, working tree clean
```

**0b. Authenticate the CLIs** (both are currently not logged in / linked):

```bash
# Vercel
vercel login                    # opens browser; sign in
vercel link                     # pick the promunch-crm project (once, in repo root)

# Supabase
supabase login                  # opens browser; paste the access token
supabase link --project-ref hlykspakpewuilttnydm
# it will ask for the DB password — from Supabase → Settings → Database
```

**0c. Confirm the build is green locally:**

```bash
npx tsc --noEmit && npm test && npm run build
```

---

## Step 1 — Rotate the leaked service_role key (C2) ⚠️ DO FIRST

The old key is still live (verified). Nothing else matters until this is dead.

1. Supabase dashboard → **Settings → JWT Keys**.
2. Rotate the **"Legacy JWT Secret"** (the *Legacy JWT Secret* tab — NOT the ECC
   "JWT Signing Keys" you rotated before; that did not kill this key).
   - This regenerates **both** the `service_role` key **and** the `anon` key.
3. Copy the **new** values from **Settings → API Keys**:
   - new `service_role` key
   - new `anon` (public) key

> If you'd rather migrate to the new publishable/secret API-key scheme instead of
> rolling the legacy secret, do that and then **revoke** the "Legacy HS256 (Shared
> Secret)" standby key — that also kills the leaked key. Either path is fine; the
> legacy-secret roll is the fewer-moving-parts option.

4. **Verify the old key is dead** (should now return `401`, not an email):

```bash
URL=https://hlykspakpewuilttnydm.supabase.co
OLD=<the old service_role key from .env.local>
curl -s -o /dev/null -w '%{http_code}\n' \
  "$URL/rest/v1/oauth_tokens?select=email&limit=1" \
  -H "apikey: $OLD" -H "Authorization: Bearer $OLD"
# 401 = dead ✅   200 = still live, rotation didn't take ❌
```

5. Update `.env.local` with the new keys (local dev):

```
SUPABASE_SERVICE_ROLE_KEY=<new service_role>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<new anon>
```

---

## Step 2 — Set Vercel environment variables (before the app deploy)

Dashboard path: **Vercel → promunch-crm → Settings → Environment Variables**
(set each for **Production**, and Preview if you use it). Or via CLI:
`vercel env add <NAME> production`.

**Required — the rotated keys:**
| Name | Value |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | new service_role key (Step 1) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | new anon key (Step 1) |

**Required — fail-closed secrets (routes 401 without these):**
| Name | Value / source |
|---|---|
| `CRON_SECRET` | `w1xcPz5K2mFm-N2N7Mfh-0YGGPDtbKS8voUpyXd0YJ0` |
| `RESEND_WEBHOOK_SECRET` | Resend dashboard → Webhooks → signing secret |
| `RESEND_INBOUND_SECRET` | Resend dashboard → Inbound → signing secret |
| `SHOPIFY_WEBHOOK_SECRET` | **only if** a Shopify webhook points at `promunch-crm.vercel.app/api/webhooks/shopify` (check Shopify → Settings → Notifications). If nothing does, skip it. |

**Optional — error tracking (recommended):**
| Name | Value / source |
|---|---|
| `SENTRY_DSN` | Sentry → project → Settings → Client Keys (DSN) |
| `NEXT_PUBLIC_SENTRY_DSN` | same DSN as above |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | only for source-map upload at build (build works without them) |

> Leave `INTERNAL_FN_SECRET` **unset** — the edge-function auth gate falls back to
> `SUPABASE_SERVICE_ROLE_KEY`, which every internal caller already sends.

---

## Step 3 — Set the Vault secrets (for the cron jobs)

Supabase dashboard → **SQL editor**. These let pg_cron authenticate to the edge
functions at run time. Use the **new** service_role key from Step 1.

```sql
-- service_role_key: create if missing, else update to the NEW key
select vault.create_secret('<NEW_SERVICE_ROLE_KEY>', 'service_role_key');
-- if it already exists you'll get a duplicate error → run this instead:
select vault.update_secret(
  (select id from vault.secrets where name = 'service_role_key'),
  '<NEW_SERVICE_ROLE_KEY>');

-- cron_secret: the CRON_SECRET value, so pg_cron can call the Next.js cron route
select vault.create_secret('w1xcPz5K2mFm-N2N7Mfh-0YGGPDtbKS8voUpyXd0YJ0', 'cron_secret');
```

---

## Step 4 — Deploy the edge functions

⚠️ Only after Steps 1–3 (they must pick up the rotated key, which Supabase
auto-injects as `SUPABASE_SERVICE_ROLE_KEY`).

**Decision point — `wa-ai-reply`:** deploying it ships two things beyond the auth
gate: (a) the **H1 behavior change** — the bot now only ever shows a customer
*their own* orders (phone-scoped), and (b) the 11-module structural refactor +
OpenAI migration. This is a customer-visible reply-path change. **Deploy it only
when you're ready for that.** Two options:

```bash
cd /Users/khush/Projects/promunch-crm/promunch-email-agent

# Option A — everything EXCEPT wa-ai-reply (hold the reply-path change):
supabase functions deploy \
  wa-send wa-campaign-send ig-send ig-ai-reply ig-analyze \
  amazon-poll gmail-poll gmail-watch-renew nudge-pending shopify-daily-summary \
  wa-campaign-worker wa-health wa-jobs-tick wa-journey-tick wa-rfm-tick \
  wa-ticket-watchdog wa-weekly-summary shopify-webhook shopify-status

# Option B — the above PLUS wa-ai-reply (ships H1 + the split):
supabase functions deploy wa-ai-reply
```

**Verify a gated function rejects unauthenticated calls (expect 401):**

```bash
URL=https://hlykspakpewuilttnydm.supabase.co
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$URL/functions/v1/wa-send" -d '{}'   # 401 ✅
```

If you deployed `wa-ai-reply`, send a real WhatsApp message to the business number
and confirm the bot still replies (and only shows the sender their own orders).

---

## Step 5 — Deploy the Next app

```bash
cd /Users/khush/Projects/promunch-crm
vercel --prod
```

Activates the app-side of C1, plus C4/H4/H5, Sentry, BotID config, the audit log,
GDPR routes, and the React-Query views. Wait for the deploy URL to go live.

---

## Step 6 — Apply the migrations (Supabase SQL editor)

CLI migrations don't run against this project — paste each file's contents into
**SQL editor** and run. **The RLS lock (004) must come AFTER the app deploy** (Step
5), or the dashboard loses DB access mid-flight.

Run in this order:

1. `supabase/migrations/004_lock_anon_rls.sql` — closes the C1 anon PII breach.
2. `supabase/migrations/005_audit_log.sql` — audit-log table.
3. `supabase/migrations/006_gdpr_anonymized_at.sql` — adds `contacts.anonymized_at`.
4. `promunch-email-agent/supabase/migrations/20260702130000_hardening.sql` — search_path + indexes.
5. `promunch-email-agent/supabase/migrations/20260705190000_wa_flow_settings.sql` — Flows settings (no-op until edited).
6. `promunch-email-agent/supabase/migrations/20260705100000_cron_jobs_canonical.sql` — canonical pg_cron (needs the Vault secrets from Step 3).

**Verify the C1 breach is closed** (both must now return `permission denied` /
`42501`, using the NEW anon key):

```bash
URL=https://hlykspakpewuilttnydm.supabase.co
ANON=<new anon key>
curl -s "$URL/rest/v1/contacts?select=*&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
curl -s "$URL/rest/v1/orders?select=*&limit=1"   -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
```

Then log into the dashboard and click Contacts (list + one detail), Analytics,
Campaigns — confirm staff reads still work via the authenticated session.

**Confirm cron is authenticated:** in SQL editor run
`select jobname, schedule, active from cron.job order by jobname;` — every command
should contain a `vault.decrypted_secrets` lookup (no literal keys), and jobs
should be `active = true`.

---

## Step 7 — Enable rate limiting / BotID (M1) + final checks

1. Vercel → promunch-crm → **Firewall**:
   - **Rules → enable "Vercel BotID Deep Analysis"** (the code already calls
     `checkBotId()` on team + contact-erasure routes; Basic is free, Deep Analysis
     is this toggle).
   - Optionally add **Rate Limiting** rules (see the M1 section of
     `SECURITY_CRITICALS_RUNBOOK.md`): `/api/webhooks/*`, `/api/cron/*`, and an
     `/api/*` catch-all, action Deny/429.
2. **Purge the leaked key from git history** (safe now that it's rotated + dead):
   ```bash
   # from a clean clone, using git-filter-repo
   git filter-repo --path .claude/settings.json --path PM-CRM_GKeys.json --invert-paths
   git push --force-with-lease origin main
   ```
   Then re-run the gitleaks scan / let CI confirm clean, and you can drop the two
   allowlisted commits from `.gitleaks.toml`.
3. **Smoke test the live app:**
   - Send a WhatsApp message → bot replies (if `wa-ai-reply` deployed).
   - Place / simulate a Shopify order → confirmation fires.
   - Open the dashboard: Contacts, Campaigns, WhatsApp inbox, Audit Log all load.
   - Check Sentry receives events (if DSN set) — trigger a harmless client error.

---

## Rollback notes

- **App:** Vercel → Deployments → previous deployment → **Promote to Production**
  (instant; env vars persist).
- **Edge function:** redeploy the prior version from a prior git checkout
  (`git checkout <sha> -- <fn>` then `supabase functions deploy <fn>`).
- **Migrations:** 004/005/006 are additive or policy-only; 004 is the one that
  changes access — if the dashboard breaks, it means the app deploy (Step 5) didn't
  land the service-role client swap, so re-check Step 5 rather than reverting 004.
- **Key rotation is not reversible** — if something authenticates with the old key
  after rotation, update it to the new key (that's the point).
```
