# Custom domain migration (PROMUNCH CRM off `promunch-crm.vercel.app`)

**Status:** NOT DECIDED, NOT STARTED. This is a contingency runbook written 2026-08-27 so the
migration can be executed without re-deriving the inventory. Nothing here has been applied.

**Decision owner:** Khush. Two decisions are required before step 1 (see §1).

---

## 0. Summary

Today production serves everything from a single origin, `https://promunch-crm.vercel.app`:
the authenticated dashboard, all 114 API routes, the public WhatsApp click-tracking redirector
`/r/[code]`, the email unsubscribe endpoint, and the storefront embed script.

The origin is **already env-driven in code** (`SITE_APP_URL` app-side, `SITE_URL` edge-side) with a
hardcoded `promunch-crm.vercel.app` fallback. `SITE_APP_URL` is currently **unset in Vercel prod**,
so prod runs on the fallback. Migration is therefore mostly configuration, not a code rewrite.

The migration is **additive**: `promunch-crm.vercel.app` keeps resolving after a custom domain is
added, so already-sent links do not break. That makes it low-risk and reversible, with exactly one
exception (Meta template re-review, §5).

---

## 1. Decisions required first

### 1a. Is this CRM ever going to be sold or run for another brand?

If yes, the dashboard belongs on its own **product** domain, not any PROMUNCH subdomain. Decide now,
because the Meta template re-review cost (§5) means you only want to move the link base once.

### 1b. Which domains?

Recommended split, and the reasoning is a security one, not a cosmetic one:

| Surface | Recommended domain | Why |
|---|---|---|
| Dashboard + `/api/*` | `crm.trypromunch.in` | `trypromunch.in` is the outreach domain. No Shopify, no third-party app scripts, so nothing else can set cookies on the registrable domain. |
| `/r/[code]`, `/api/public/*`, unsubscribe | `go.promunch.in` | Customer-facing. Brand domain in WhatsApp and email beats a `vercel.app` link for click-through and spam heuristics. |

Both can be added to the same Vercel project; Vercel serves the same deployment on every attached
domain. Cookies stay isolated because they are host-only (verified: no `domain:` option is set in
`src/lib/supabase-server.ts` / `supabase-browser.ts`, so Supabase SSR defaults to host-only).

### Why NOT `crm.promunch.in`

`promunch.in` is the Shopify storefront (`PROMUNCH_SITE_URL` default, see
`promunch-email-agent/supabase/functions/_shared/journeys.ts:4`). Putting the admin dashboard on a
subdomain of it means:

- The storefront runs third-party Shopify app scripts you do not control. An XSS or a rogue app there
  can set cookies on `.promunch.in`, which the CRM would then receive (cookie tossing / session
  fixation).
- `SameSite=Lax` treats storefront -> CRM requests as **same-site**, weakening CSRF posture on every
  mutation route.
- `vercel.app` is on the Public Suffix List, so today nothing can set a cookie across it. Moving to a
  shared registrable domain with the storefront is a **downgrade** on this axis.

A custom domain by itself buys no security. The win is brand trust on customer-facing links. Choose
the domains accordingly.

---

## 2. Complete inventory of the origin

### 2a. App-side code (reads `SITE_APP_URL`, falls back to the vercel.app literal)

| File | Line | What it serves |
|---|---|---|
| `src/app/api/public/wa-embed/route.ts` | 31, 37 | `appOrigin` baked into the WhatsApp popup/chat-button script served to the Shopify storefront |
| `src/app/api/public/email-embed/route.ts` | 14 | email signup widget origin |
| `src/app/api/whatsapp/growth/route.ts` | 20-21 | `EMBED_URL` written into the Shopify **script tag** at install time |
| `src/lib/email/unsubscribe.ts` | 29 | unsubscribe link base in every marketing email |

`src/app/r/[code]/route.ts:11` reads a different var, `SITE_URL`, and falls back to
`https://trypromunch.in` — that is the **redirect fallback destination**, not the link base. Do not
confuse the two.

### 2b. Edge-function side

| Secret | Read at | Purpose |
|---|---|---|
| `SITE_URL` | `_shared/links.ts:94` | base for minted `/r/<code>` short links. **This is the link base that ends up inside approved Meta templates.** |
| `PROMUNCH_SITE_URL` | `_shared/journeys.ts:4` | Shopify storefront, default `https://promunch.in`. **Unrelated to this migration. Do not touch.** |

### 2c. Infrastructure references (not code)

- Supabase Auth: Site URL + Redirect allowlist (dashboard only, no CLI path).
- Shopify: the installed script tag, which hardcodes the origin captured at install time.
- pg_cron: `docs/plans/2026-07-05-b2b-leads-v2.md:28` documents a job calling
  `https://promunch-crm.vercel.app/api/cron/leads-tick` with a Vault bearer. Audit `cron.job` for any
  other Vercel-targeted jobs; most cron jobs target Supabase edge functions and are unaffected.
- Resend webhook URL.
- Shopify webhook, **only if** one points at the Next route rather than the edge function. See
  `docs/runbooks/SECURITY_CRITICALS_RUNBOOK.md:49` — verify in Shopify -> Settings -> Notifications.
- Docs: `docs/runbooks/DEPLOY_GUIDE.md:11,110`, `docs/whatsapp/WA_CAMPAIGN_HANDOFF.md:6`.

---

## 3. Execution order

Steps 1-4 are safe and reversible. Step 5 onward changes customer-visible behavior.

1. **Add domains in Vercel**, point DNS. Verify both serve the app before changing any env var.
2. **Supabase Auth**: add the new dashboard origin to Site URL and the Redirect allowlist.
   *Do this before step 3.* Missing it breaks login and the branded invite emails
   (`generateLink`) immediately, with no error that names the cause.
3. **Set `SITE_APP_URL`** in Vercel prod to the link domain. Redeploy with `vercel --prod`
   (env changes do not take effect without a deploy).
4. **Verify** `/api/public/wa-embed` and an unsubscribe link now render the new origin.
5. **Set the edge secret `SITE_URL`** to the link domain and redeploy the functions that mint links
   (`wa-campaign-send`, and anything else importing `_shared/links.ts`). New short links now use the
   new base; already-minted codes are unaffected because the old domain still resolves.
6. **Re-install the Shopify script tag** from the WhatsApp -> Growth tab. The already-installed tag
   hardcodes the old `appOrigin` and will never update itself. Until this is done the storefront
   widget keeps calling the vercel.app origin, which is fine but leaves the migration half-done.
7. **Meta template button URLs** — see §5. This is the only step with a real cost.
8. **Update pg_cron job URLs** that target Vercel, or leave them (old domain still resolves).
   Prefer updating, so the vercel.app dependency is documented rather than silent.
9. **Update Resend webhook URL**, and the Shopify webhook if §2c found one.
10. **Update docs**: `DEPLOY_GUIDE.md`, `WA_CAMPAIGN_HANDOFF.md`, and this file's status header.

---

## 4. Never retire the vercel.app domain

Permanent links already delivered to customers point at it:

- every `/r/<code>` short link inside an already-sent WhatsApp campaign,
- every unsubscribe link inside an already-sent marketing email,
- any Shopify storefront still serving the old script tag.

Vercel keeps the `*.vercel.app` origin alive for the project automatically. Do not delete the project
or rename it.

---

## 5. The one irreversible-ish cost: Meta template re-review

Approved WhatsApp templates that carry a **dynamic URL button** store the link base in the template
itself. `wa-campaign-send/index.ts:636` identifies these by `b.url.includes("/r/")`.

Changing that base requires PATCHing Meta, which sends the template **back to review (`pending`)**.
The tooling exists: `wa-template-create` `editDb` mode accepts `button_url`
(`wa-template-create/index.ts:400-418`) and mirrors the change locally.

Consequences to plan around:

- A template in `pending` **cannot send**. Do not do this mid-campaign, and do not do it to the order
  confirmation or shipping templates during business hours.
- Meta limits how many times an approved template may be edited per month.
- Re-review can reject. Have the old template still approved as fallback where possible.

**Mitigation:** step 5 (new `SITE_URL`) and step 7 (template button edit) can be separated by weeks.
New short links work on the new base immediately; old templates keep minting codes against the old
base, which still resolves. There is no forcing function to do step 7 quickly. Schedule it on a quiet
day and batch all affected templates in one pass.

Before step 7, enumerate the affected templates:

```sql
select name, language, status, buttons
from wa_templates
where buttons::text like '%/r/%';
```

---

## 6. Rollback

Steps 1-6 roll back by reverting the env var / secret and redeploying, plus re-installing the script
tag. The old origin never stopped working, so there is no broken-link window.

Step 7 does not roll back cleanly: reverting a template button URL is another Meta edit and another
review cycle, consuming another slot in the monthly edit budget. Treat step 7 as one-way.

---

## 7. Open questions to answer before starting

1. Where is DNS for `promunch.in` and `trypromunch.in` hosted (registrar vs Shopify vs Cloudflare)?
   Determines whether CNAME records can be added and by whom.
2. Confirm `SITE_APP_URL` is genuinely unset in Vercel prod (`vercel env ls`). The code path implies
   it, but it was not verified against the live project when this doc was written.
3. Does any Shopify webhook point at the Next route (`/api/webhooks/shopify`)? If nothing does, that
   route can be deleted rather than migrated.
4. Vercel plan: production commercial traffic currently runs on **Hobby**, whose terms bar commercial
   use. Attaching a brand domain raises the visibility of that. Pro is $20/mo and also unblocks
   sub-daily crons, which would let some pg_cron scheduling move back into `vercel.json`. Not a
   blocker, but decide deliberately rather than by accident.
