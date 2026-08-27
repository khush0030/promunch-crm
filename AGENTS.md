# AGENTS.md — PROMUNCH CRM

Canonical instructions for any AI agent (Claude Code, Codex, Cursor, etc.) working in this repo. `CLAUDE.md` imports this file. Read it fully before changing anything. For the edge-function subproject there is a second, deeper handoff: [promunch-email-agent/CLAUDE.md](promunch-email-agent/CLAUDE.md).

**System map + change recipes:** [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) (what everything is) and [docs/architecture/AI_CHANGE_PLAYBOOK.md](docs/architecture/AI_CHANGE_PLAYBOOK.md) (how to add pages/routes/functions/migrations/crons, verification gate, debugging order). Read the playbook before your first change.

---

## 1. What this repo is

A production CRM + marketing + customer-ops platform for **PROMUNCH** (high-protein roasted soya snacks, D2C India). It runs real customer traffic across WhatsApp, email, Shopify, Amazon, and B2B outreach. Two deployables:

| Deployable | Path | Deployed with |
|---|---|---|
| Next.js 16 dashboard + API routes | `src/` | `vercel --prod` (manual, see §3) |
| Supabase Edge Functions (Deno) + their migrations | `promunch-email-agent/` | `supabase functions deploy <name>` |

The root `supabase/migrations/` holds the Next-app-side SQL migrations (001–007). Both migration sets are applied **by hand in the Supabase dashboard SQL editor**, never via CLI.

## 2. Repo map (where to find anything)

```
promunch-crm/
├── AGENTS.md / CLAUDE.md / README.md   # you are here
├── src/                    # Next.js app (App Router)
│   ├── app/dashboard/      # all authenticated screens (one folder per module)
│   ├── app/api/            # route handlers (gated by middleware, see §7)
│   ├── components/         # Sidebar, pm/ (design system), whatsapp/, ui/
│   └── lib/                # supabase clients, shopify, resend, rbac, secrets, gdpr
├── promunch-email-agent/   # Supabase project: config.toml, 56 edge functions, migrations
│   ├── CLAUDE.md           # deep handoff incl. the no-duplicate-message invariant
│   ├── supabase/functions/ # wa-*, shopify-*, amazon-poll, ig-*, kb-*, gmail-*, slack-*, b2b-*
│   ├── supabase/migrations/# edge-fn-side SQL (incl. 20260705100000 canonical pg_cron)
│   └── scripts/            # deploy.sh, verify.sh, one-off cron/backfill SQL
├── supabase/migrations/    # app-side SQL migrations 001–007
├── docs/                   # all documentation — see docs/README.md index
│   ├── runbooks/           # DEPLOY_GUIDE, MIGRATIONS, CRON_TOPOLOGY, SECURITY_CRITICALS_RUNBOOK
│   ├── whatsapp/           # META_WHATSAPP_TEMPLATE_RULES, WA_CAMPAIGN_HANDOFF, customer flow
│   ├── instagram/          # team guide + influencer pipeline spec
│   ├── integrations/       # amazon-integration-setup
│   ├── plans/              # dated feature plans/specs
│   ├── audits/             # audit deliverables (HTML)
│   └── archive/            # superseded specs/mockups — historical only, do not follow
├── design/                 # ACTIVE warm-editorial redesign source (tokens, prototype, handoff)
├── scripts/                # local ops scripts (check-migrations.sh, backfills)
├── shopify-app/            # Shopify app scaffolding (shopify.app.toml)
├── media/                  # gitignored local media (campaign videos etc.)
└── vercel.json             # Vercel crons — DAILY ONLY (Hobby plan), see §3
```

Untracked local secrets that must stay at root and never be committed: `.env.local`, `PM-CRM_GKeys.json`.

## 3. Git + deploy rules (this repo is unusual, read carefully)

- **Commit and push straight to `main`.** No feature branches, no PRs.
- **Vercel does NOT auto-deploy from git.** Code on `main` is not live until someone runs `vercel --prod`. Always say explicitly whether a change is deployed or committed-only.
- **Vercel Hobby plan blocks sub-daily crons.** Keep `vercel.json` crons daily; anything more frequent runs on Supabase **pg_cron** (canonical topology: `promunch-email-agent/supabase/migrations/20260705100000_cron_jobs_canonical.sql`, documented in [docs/runbooks/CRON_TOPOLOGY.md](docs/runbooks/CRON_TOPOLOGY.md)).
- **Edge functions:** deploy per-function with `supabase functions deploy <name>` from `promunch-email-agent/`. CLI function deploys work fine.
- **SQL migrations:** the CLI path does NOT work; paste migrations into the Supabase dashboard SQL editor by hand, then verify with `scripts/check-migrations.sh`. Conventions in [docs/runbooks/MIGRATIONS.md](docs/runbooks/MIGRATIONS.md).
- Full production deploy sequence lives in [docs/runbooks/DEPLOY_GUIDE.md](docs/runbooks/DEPLOY_GUIDE.md).
- Sync failures (Shopify/Amazon pipelines going quiet) are almost always **ops/config** (missing secrets, pg_cron not scheduled, migration not applied), not code bugs. Check config before debugging code.

## 4. Hard product invariants (never violate)

1. **Never message a customer twice.** Every WhatsApp/email send path must take an atomic claim before sending (durable ledger `wa_messages` + per-entity claim + one owner per message type). A missed message is recoverable; a duplicate reads as spam. Full rules: `promunch-email-agent/CLAUDE.md` §0. When in doubt, do not send.
2. **WhatsApp reply-behavior changes require explicit user approval BEFORE editing or deploying.** Present "these changes done, this is how it affects the customer WhatsApp convo" and wait for a yes. The bot must answer from the Master KB (`kb_documents`), never from the model's own knowledge.
3. **Bare `STOP` = unsubscribe.** It never reaches the AI and never triggers a cancel flow. `START` re-opts-in. Order cancellation is explicit-only: urgent ticket + ops WhatsApp ping. Marketing templates always carry a STOP footer.
4. **Email audiences MUST filter `email IS NOT NULL`.** Since migration 007, contacts can be phone-only (93% of Shopify orders have no email). Any `email.split("@")` style code must be null-safe.
5. **Consent:** wa_contacts includes imported order phones; do not cold-blast the full list. Respect opt-in tags and Meta's ~250/day marketing tier (the real deliverability ceiling).

## 5. Brand + copy rules (enforce in every AI prompt and template)

- Brand name is always **PROMUNCH** in all caps in copy. Lowercase `promunch` only in technical identifiers (slugs, URLs, package names).
- **Em dashes are banned in all customer-facing copy.**
- **Never mention "Oltaflock"** in PROMUNCH copy, KB, footers, or docs. Infra identifiers (the `oltaflock-ai` Vercel org, `admin@oltaflock.ai`) stay as-is.
- Tagline: **"Your Munchy Pal"** (email, WhatsApp chatbot, marketing templates).
- B2B cold outreach always sends as **Parth (founder), parth@trypromunch.in** (from + reply-to + sign-off), driven by the `outreach_settings` row. B2B drafts must be grounded in the Master KB (product facts: chips and sticks are FRIED; only Crunchies are roasted).
- Email marketing sender: `hello@trypromunch.in` via Resend (domain `trypromunch.in` verified; free tier caps at 100/day).
- Shipping/payment policy (lives in Master KB): free shipping ≥ ₹599, ₹99 below, COD +₹50, prepaid 5% off.
- WhatsApp shipping links always point to the **Shopify order-status page**; never guess carrier deep links.

## 6. Data model gotchas

- Real order data lives in **`shopify_orders`**, not the legacy `orders` table. Channel mapping: `source_name` `web` → D2C site, `341128478721` → HYPD.
- WhatsApp revenue attribution joins `shopify_orders.customer_phone = wa_id`. There is **no `contact_id`** on shopify_orders.
- `wa_messages.status` lifecycle: `sent → delivered → read`. Dedup queries must include all three.
- WhatsApp inbox threads order by `last_activity_at` (inbound OR outbound).
- `contacts.email` is **nullable** (migration 007); identity falls back to phone.
- ₹0.01 orders are HYPD creator seeds (`is_creator`, tag "HYPD Creator") and are excluded from revenue metrics.
- Table grants move around for security. Current state (Jul 6, 2026): `anon` revoked on `contacts`/`orders`, `service_role` restored. Verify grants before assuming a 401/permission bug is code.
- Abandoned-cart recovery links must come from the Shopify checkout **NOTE** (partner URL), not `abandoned_checkout_url`.
- GDPR: `gdpr.ts` + `anonymized_at` column; anonymized contacts must stay anonymized.

## 7. Security + auth

- `src/middleware.ts` gates all `/api/*` except webhooks and cron routes, which **fail closed**: `CRON_SECRET`, `RESEND_WEBHOOK_SECRET` (and `SHOPIFY_WEBHOOK_SECRET` where used) are REQUIRED or the route 401s by design. A 401 there usually means a missing secret, not a bug.
- Dashboard auth: Supabase Auth with email-domain allowlist (`trypromunch.in` included); branded invite emails via Resend `generateLink`.
- API key management (Settings → API keys) is owner-only (`kmutha@vippysoya.com`), backed by `app_secrets` + `getSecret()` live rotation. Edge functions and routes read provider keys through `getSecret()`, not env, where wired.
- gitleaks runs in CI (`.gitleaks.toml`). Never commit `.env*`, `PM-CRM_GKeys.json`, or anything matching those patterns. A Google SA key was leaked once and had to be purged from history; do not repeat it.
- All AI code is on **OpenAI** (migrated from Anthropic). If an edge function throws provider auth errors, it is probably running a stale deploy: redeploy the AI functions.

## 8. WhatsApp channel specifics

- Meta Cloud API; templates + journeys managed from the dashboard (template builder pushes to Meta; `{edit}` mode updates copy).
- Template/component rules (image/video headers, buttons, error codes like #132012, #131049): [docs/whatsapp/META_WHATSAPP_TEMPLATE_RULES.md](docs/whatsapp/META_WHATSAPP_TEMPLATE_RULES.md). Error 131049 = Meta marketing cap, not a bug.
- Campaign engine: atomic send lock, pg_cron `wa-campaign-worker`, per-send failure alerts, wholesale-failure circuit breaker. Campaign handoff doc: [docs/whatsapp/WA_CAMPAIGN_HANDOFF.md](docs/whatsapp/WA_CAMPAIGN_HANDOFF.md).
- Review/restock/abandoned-cart asks go as free personalized text inside an open 24h window to dodge marketing caps; template fallback is cap-aware with backoff.
- Escalation: order issues route to `OPS_WA_ID` (Narendra), everything else to the owner; ops replies "done #N" to close a ticket. Slack watchdog model is retired.
- WhatsApp access token is a system-user token; if auth dies with code 1 or 190, the token expired (rotate at Meta, set expiry Never).
- Journey timings are dashboard-editable config in `wa_flow_settings` (Flows tab), not code constants.
- RFM segments: nightly `wa-rfm-tick` tags `rfm:*` on wa_contacts; campaign modal has a "By segment" picker.

## 9. Verification before "done"

```bash
npm run build        # Next.js production build must pass
npm run test         # vitest (config pins TZ; keep it deterministic)
npm run lint         # eslint
# edge functions: cd promunch-email-agent && deno check supabase/functions/<fn>/index.ts
bash scripts/check-migrations.sh   # migration drift vs hand-applied history
```

State plainly what is committed vs deployed. "Shipped" means `vercel --prod` and/or `supabase functions deploy` actually ran.

## 10. Documentation rules

- Every new doc goes under `docs/` in the matching subfolder (runbooks / whatsapp / instagram / integrations / plans / audits). Never drop loose `.md`/`.html` files at repo root.
- Superseded material moves to `docs/archive/`, it is never left in place.
- Update [docs/README.md](docs/README.md) (the index) when adding or moving docs.
- `design/` is the active source of truth for the warm-editorial redesign (`pm-` design system); `src/app/globals.css` mirrors `design/promunch-design-tokens.css`. Redesign phases 3/4 are still open.
