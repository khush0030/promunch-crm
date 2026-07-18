# AI Change Playbook — how to safely change PROMUNCH CRM

> For any AI agent (or human) making changes. [ARCHITECTURE.md](ARCHITECTURE.md) tells you what the system is; this tells you how to change it without breaking production. [AGENTS.md](../../AGENTS.md) and `promunch-email-agent/CLAUDE.md` §0 always override this doc.

## 1. The five rules that outrank everything

1. **Never message a customer twice.** Every WhatsApp/email/IG send takes an atomic claim BEFORE the external call (guarded `UPDATE ... WHERE status = expected` returning rows, or an insert against a unique index — never read-then-act). Winners send; losers exit silently. On failure release the claim so the sweep retries. When in doubt, do not send.
2. **WhatsApp reply-behavior changes need explicit user approval BEFORE editing.** Describe the customer-visible effect, wait for a yes. The bot answers from the Master KB (`kb_documents`) only.
3. **Committed ≠ deployed.** `git push` ships nothing. App: `vercel --prod`. Functions: `supabase functions deploy <name>` from `promunch-email-agent/`. Migrations: hand-paste in the Supabase SQL editor. Always report the two states separately.
4. **Email audiences filter `email IS NOT NULL`** (93% of contacts are phone-only). `verify_jwt=true` is NOT authorization (the public anon key passes it) — internal edge functions gate with `requireInternal`.
5. **Copy rules in anything user-visible:** PROMUNCH in caps, no em dashes in customer-facing copy, tagline "Your Munchy Pal", never mention Oltaflock.

## 2. Recipes by change type

### Add a dashboard page/module
1. Folder under `src/app/dashboard/<module>/` with `page.tsx` (client component is the norm).
2. Use the `pm-` design system (`src/components/pm/`) and warm-editorial tokens; look at `instagram/` for the reference data-loading pattern (every fetch checks `res.ok`, error states have Retry).
3. Fetch through `apiFetch<T>()` from `src/lib/api-fetch.ts` — it handles 401→login redirect, non-OK→typed `ApiError`, safe JSON parse. Never `setState(await res.json())` raw.
4. Render three states: loading, error (with retry), genuinely-empty. An auth failure must never render as "No data yet".
5. The segment-level `src/app/dashboard/error.tsx` + `loading.tsx` boundaries catch what you miss — do not remove them.
6. Add the Sidebar entry (`src/components/Sidebar.tsx`).

### Add an API route
1. File under `src/app/api/<area>/route.ts`. Middleware session-gates it automatically — anything under `/api/webhooks/` or `/api/cron/` is PUBLIC by prefix and must self-auth fail-closed (secret missing ⇒ 401).
2. Parse bodies with `parseBody<T>()` from `src/lib/api-helpers.ts` (never bare `await req.json()`); sanitize any `.or()` search interpolation with `sanitizeSearch()`.
3. Escalate auth where warranted: `requireAdmin()` (rbac-server) for destructive/admin ops, `requireSecretsOwner()` for key management. Roles live in `app_metadata` — never trust `user_metadata`.
4. Mutations: allowlist updatable fields (`PATCHABLE` pattern), write `recordAudit()` for sensitive actions.
5. Paginate reads on growing tables (`shopify_orders`, `wa_messages`, `contacts`); never accumulate a full table in memory.
6. Error envelope: match the area's existing shape (`{error}` or `{ok:false,error}`).

### Add an edge function
1. Folder under `promunch-email-agent/supabase/functions/<name>/index.ts`; shared logic goes in `_shared/` (never copy-paste helpers between functions — that is how fixes miss spots).
2. Add a `config.toml` entry. `verify_jwt = false` + `requireInternal(req)` for internal functions; webhook receivers verify provider signatures (Meta X-Hub-Signature-256, Shopify HMAC, Slack signing secret) with timing-safe compare, failing closed when the secret is unset.
3. If it sends to a customer: atomic claim first (rule 1), durable `wa_messages`/equivalent ledger row in the same call, `alertWaSendFailure`/`logConnector(level:"error")` on failure (errors auto-page Slack).
4. Webhooks: log a durable `webhook_received` connector event FIRST, return 200 even on processing errors (5xx ⇒ provider retry storm ⇒ duplicate processing), dedupe on the provider's event/message id via a unique index insert, not a select.
5. Bound every loop (batch size + cursor) — edge functions have a wall clock. Big backlogs must survive being killed mid-run.
6. Verify: `deno check supabase/functions/<name>/index.ts` from `promunch-email-agent/`.
7. Deploy: `supabase functions deploy <name>`; cron it via a migration using the `_cron_post` Vault-bearer pattern (see `20260705100000_cron_jobs_canonical.sql`), never an inline secret.

### Add/modify a table (migration)
1. App-side concerns → `supabase/migrations/NNN_*.sql`; edge/channel concerns → `promunch-email-agent/supabase/migrations/<timestamp>_*.sql`. Run `bash scripts/check-migrations.sh` (filename-collision check only — it does NOT verify what's applied in prod).
2. Every new table ships WITH its security story in the same file: `enable row level security`, `revoke all from anon`, and either a `for select to authenticated` policy (staff-visible) or no policies at all (service-role only). The May–June 2026 tables that skipped this became audit criticals.
3. Dedup/claim semantics get a unique index in the DB, not just code.
4. Add indexes for the query patterns you're introducing (check what columns your `.eq/.in/.order` hit).
5. Apply by hand in the SQL editor, then verify with the file's own verification query (include one).
6. If both the Next app and edge functions touch the table, grep BOTH trees before renaming/dropping anything.

### Add a scheduled job
- Sub-daily → pg_cron migration (Vault bearer via `_cron_post`). Daily-or-slower with independent-fate requirements → Vercel cron (2 Hobby slots, currently both used by the wa-watchdog dead-man's switch — do not evict it without replacing the pg_cron-death alarm).
- Update [docs/runbooks/CRON_TOPOLOGY.md](../runbooks/CRON_TOPOLOGY.md) in the same commit. The canonical migration + later feature migrations are the source of truth; keep the doc matching `select jobname, schedule from cron.job`.

### Change WhatsApp behavior
- STOP. Rule 2. Describe the customer-visible diff, get approval, then edit. Journey timings are dashboard config (`wa_flow_settings`), not code constants. Template/component rules and Meta error codes: [docs/whatsapp/META_WHATSAPP_TEMPLATE_RULES.md](../whatsapp/META_WHATSAPP_TEMPLATE_RULES.md). Error 131049 = Meta marketing cap, not a bug.

## 3. Verification gate (before saying "done")

```bash
npm run build        # Next production build
npm run test         # vitest (TZ pinned)
npm run lint
cd promunch-email-agent && deno check supabase/functions/<touched>/index.ts
bash scripts/check-migrations.sh
```

Then live-verify the actual flow you changed (standing rule: every rollout gets a real test — a real send to the owner's number, a real webhook, a real page load). Green checks alone don't count.

## 4. Deploy sequence

1. Commit + push to `main` (no branches, no PRs).
2. Migrations first (SQL editor, run the verification query).
3. Edge functions: `supabase functions deploy <each touched fn>`.
4. App: `vercel --prod` (project `promunch-crm` under org `oltaflock-ai`).
5. Report: what is committed, what is deployed, what is still manual.

Full sequence with env/secrets: [docs/runbooks/DEPLOY_GUIDE.md](../runbooks/DEPLOY_GUIDE.md). Secret rotation gotcha: the pg_cron Vault secrets (`service_role_key`, `cron_secret`) must be updated with `vault.update_secret` when keys rotate, or every scheduled job silently 401s.

## 5. Debugging production (before opening any code)

Work this order — most "bugs" here are ops/config:

1. **Is it deployed?** Stale edge deploys throw provider-auth errors (the OpenAI-migration incident). `supabase functions list`, Vercel deployment list.
2. **Is it scheduled?** `select jobname, schedule from cron.job;` and `select * from cron.job_run_details order by start_time desc limit 20;`
3. **Is it configured?** `supabase secrets list` — missing secret ⇒ fail-closed 401 by design on webhooks/cron/internal calls.
4. **What do the logs/events say?** `connector_events` table (Integrations page), `supabase functions logs <fn>`, Slack alert channels, `wa_campaigns.last_error`, `deal_scan_state.last_error`.
5. **Only then read code.** Ask Maya (`/dashboard/assistant`) can query cron health and recent events conversationally.

| Symptom | Go to |
|---|---|
| Page shows error card / blank | Browser console; usually expired session (401) or an API 500 — the error boundary + `apiFetch` will name the failing route |
| WA bot silent | `wa_jobs` backlog, `connector_events`, `wa-health` heartbeats, then `supabase functions logs wa-ai-reply` |
| Campaign stuck | `wa_campaigns.status/last_error`, `cron.job_run_details` for wa-campaign-worker, Meta cap 131049 |
| No new support emails | `gmail_watch` expiry, Pub/Sub delivery errors, `PUBSUB_VERIFICATION_TOKEN` match, gmail-poll cron |
| Everything quiet at once | pg_cron died or Vault bearer stale — the Vercel wa-watchdog cron should have paged Slack |

## 6. Where things live (fast lookup)

| Need | Location |
|---|---|
| WA bot persona/behavior | `promunch-email-agent/supabase/functions/wa-ai-reply/` (12 modules) + Master KB via dashboard |
| Email draft persona | `_shared/openai.ts` (`generateDraft`) |
| Journey timings | Dashboard → WhatsApp → Flows (`wa_flow_settings`) |
| Provider keys | Settings → API keys (owner-only, `app_secrets` + `getSecret()`); edge functions use `supabase secrets` |
| Design tokens | `design/promunch-design-tokens.css` → mirrored in `src/app/globals.css` |
| RBAC | `src/lib/rbac.ts` (app_metadata roles, fail-closed) + `rbac-server.ts` |
| Auth allowlist | `src/lib/auth-domains.ts` |
| Shared client helpers | `src/lib/api-fetch.ts` (browser), `src/lib/api-helpers.ts` (routes) |
| Atomic claim reference impls | `_shared/order-confirmation.ts`, `wa-campaign-send` (unique-index insert), `_shared/approve.ts` (guarded update) |
| Audit deliverables | `docs/audits/` |
