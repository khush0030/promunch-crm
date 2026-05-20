# CLAUDE.md — PROMUNCH Email Agent

> This file is a complete handoff for **Claude Code**. Read it top-to-bottom before running anything. It tells you what this project is, how it's organized, and exactly how to take it from a fresh clone to a live production system that monitors `hello@promunch.in`, drafts replies with Claude, and ships them via Slack approval.
>
> When the user says "deploy it" or "make it live", follow [§5 Deployment runbook](#5-deployment-runbook) step by step. Don't skip steps — every step has a verification command to confirm it worked before moving on.

---

## 1. What this project is

An AI email assistant for **PROMUNCH** (snack brand under Vippy Industries Limited).

- **Input:** new emails to `hello@promunch.in` (Google Workspace)
- **Output:** Slack message → human approval → reply sent in the original Gmail thread
- **Brains:** Claude (default `claude-sonnet-4-6`) drafts every reply using a brand-aware system prompt
- **Loop:** the human can reply in the Slack thread with feedback ("make it shorter", "ask for the order ID"), and the bot regenerates the draft

**Architecture:** Supabase Edge Functions (Deno + TypeScript), Gmail API + Pub/Sub for instant push notifications, Slack Web API for the human-in-the-loop UX, Anthropic API for drafting, Postgres for state.

If you need the deep architecture, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — sequence diagram + state machine + design rationale.

---

## 2. File map (what lives where)

```
promunch-email-agent/
├── CLAUDE.md                         # ← you are here
├── README.md                         # human-facing setup guide (more verbose)
├── slack-app-manifest.json           # Slack app definition — paste into api.slack.com
├── .env.example                      # all env vars the app needs
├── deno.json                         # lint/format/import config
├── scripts/
│   ├── deploy.sh                     # idempotent deploy: secrets + functions + cron
│   └── verify.sh                     # post-deploy smoke test
├── docs/
│   └── ARCHITECTURE.md
└── supabase/
    ├── config.toml                   # per-function settings (verify_jwt=false for webhooks)
    ├── migrations/
    │   └── 20260518000000_init.sql   # creates email_threads, draft_revisions, sent_replies, oauth_tokens, gmail_watch
    └── functions/
        ├── _shared/                  # ALL shared logic lives here — edit once, applies everywhere
        │   ├── anthropic.ts          # ★ Claude draft generation + SYSTEM_PROMPT (the persona lives here)
        │   ├── approve.ts            # send-via-Gmail pipeline (used by button + "approve" command)
        │   ├── gmail.ts              # Gmail REST: OAuth refresh, history, get, send, watch
        │   ├── process-email.ts      # new-email → draft → post-to-slack pipeline
        │   ├── slack.ts              # Slack Web API + signature verification + block builders
        │   ├── supabase.ts           # Postgres service-role client
        │   └── types.ts
        ├── gmail-webhook/            # POST — Pub/Sub push receiver (instant new-mail handling)
        ├── gmail-poll/               # GET — cron fallback (every 2 min, idempotent)
        ├── gmail-watch-renew/        # GET — daily cron, keeps the 7-day Gmail watch alive
        ├── slack-events/             # POST — thread replies → regenerate draft
        ├── slack-interactivity/      # POST — button clicks (Approve / Regenerate / Skip)
        └── oauth-callback/           # GET — one-time browser flow to save the Gmail refresh token
```

**The 80/20 rule for this codebase:**
- To change how drafts *sound* → edit `SYSTEM_PROMPT` in `supabase/functions/_shared/anthropic.ts`.
- To change what the Slack message *looks* like → edit `buildEmailBlocks()` in `supabase/functions/_shared/slack.ts`.
- To change how feedback is *interpreted* → edit `handleMessage()` in `supabase/functions/slack-events/index.ts`.
- Everything else is plumbing — touch sparingly.

---

## 3. Prerequisites (check before deploying)

Run this exact preflight before [§5](#5-deployment-runbook). If any check fails, stop and tell the user.

```bash
# Tools that must be on PATH
command -v supabase  >/dev/null || echo "MISSING: supabase CLI — brew install supabase/tap/supabase"
command -v gcloud    >/dev/null || echo "MISSING: gcloud CLI — https://cloud.google.com/sdk/docs/install"
command -v jq        >/dev/null || echo "MISSING: jq — brew install jq"
command -v curl      >/dev/null || echo "MISSING: curl"

# Accounts the user needs (you can't create these for them)
echo "Confirm with user they have:"
echo "  [ ] Supabase project (note the project-ref)"
echo "  [ ] Google Cloud project with billing enabled"
echo "  [ ] Anthropic API key (starts with sk-ant-)"
echo "  [ ] Admin access to a Slack workspace"
echo "  [ ] Access to hello@promunch.in (for the OAuth consent step)"
```

You will need these values from the user before starting:

| Variable | Where to get it |
|---|---|
| `SUPABASE_PROJECT_REF` | Supabase dashboard → project settings → Reference ID (looks like `abcdefghij`) |
| `GCP_PROJECT_ID` | GCP console top bar |
| `ANTHROPIC_API_KEY` | console.anthropic.com → Settings → API Keys |
| `SLACK_CHANNEL_ID` | Slack → right-click channel → View channel details → bottom (`C…`) |

Don't proceed without all four.

---

## 4. Environment variables — single source of truth

`.env.example` is the canonical list. Copy it to `.env` and fill in:

```bash
cp .env.example .env
```

Reference table — every variable, where it comes from, and which function uses it:

| Var | Source | Used by |
|---|---|---|
| `MAILBOX_EMAIL` | hardcoded `hello@promunch.in` (override if testing) | gmail-*, process-email |
| `GOOGLE_CLIENT_ID` / `_SECRET` | GCP OAuth credentials (step 5.2c) | gmail.ts, oauth-callback |
| `OAUTH_REDIRECT_URI` | `https://<ref>.supabase.co/functions/v1/oauth-callback` | oauth-callback |
| `SETUP_TOKEN` | `openssl rand -hex 24` | oauth-callback (gates the bootstrap endpoint) |
| `GMAIL_PUBSUB_TOPIC` | full topic name from step 5.2b | gmail-watch-renew |
| `PUBSUB_VERIFICATION_TOKEN` | `openssl rand -hex 24` | gmail-webhook (?token= query param) |
| `SLACK_BOT_TOKEN` | Slack app install (step 5.3) | slack.ts |
| `SLACK_SIGNING_SECRET` | Slack app basic info | slack.ts (verifies webhooks) |
| `SLACK_BOT_USER_ID` | `auth.test` (step 5.3d) | slack-events (so bot doesn't react to itself) |
| `SLACK_CHANNEL_ID` | Slack channel details | slack.ts (where new emails get posted) |
| `ANTHROPIC_API_KEY` | console.anthropic.com | anthropic.ts |
| `ANTHROPIC_MODEL` | default `claude-sonnet-4-6`, change to `claude-opus-4-6` for higher quality | anthropic.ts |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are **auto-injected** by Supabase — never set them yourself.

---

## 5. Deployment runbook

Work top to bottom. Each step has a ✅ Verify line — run it before continuing.

### 5.1 Link the Supabase project & apply the migration

```bash
supabase login
supabase link --project-ref <SUPABASE_PROJECT_REF>
supabase db push
```

**✅ Verify:**
```bash
supabase db remote list                    # should show your project
# In Supabase dashboard → Table Editor, you should see:
#   email_threads, draft_revisions, sent_replies, oauth_tokens, gmail_watch
```

### 5.2 Google Cloud + Gmail setup

#### 5.2a Enable APIs
```bash
gcloud config set project <GCP_PROJECT_ID>
gcloud services enable gmail.googleapis.com pubsub.googleapis.com
```

#### 5.2b Create the Pub/Sub topic & subscription

```bash
# Topic
gcloud pubsub topics create gmail-hello

# Allow Gmail's system service account to publish to it
gcloud pubsub topics add-iam-policy-binding gmail-hello \
  --member=serviceAccount:gmail-api-push@system.gserviceaccount.com \
  --role=roles/pubsub.publisher

# Generate the shared token now (you'll need it in two places)
PUBSUB_VERIFICATION_TOKEN=$(openssl rand -hex 24)
echo "Save this — also goes into .env: $PUBSUB_VERIFICATION_TOKEN"

# Push subscription pointing at the webhook
gcloud pubsub subscriptions create gmail-hello-sub \
  --topic=gmail-hello \
  --push-endpoint="https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/gmail-webhook?token=${PUBSUB_VERIFICATION_TOKEN}" \
  --ack-deadline=30
```

Note the full topic name for `.env`:
```
GMAIL_PUBSUB_TOPIC=projects/<GCP_PROJECT_ID>/topics/gmail-hello
```

**✅ Verify:**
```bash
gcloud pubsub topics list | grep gmail-hello
gcloud pubsub subscriptions list | grep gmail-hello-sub
```

#### 5.2c Create OAuth credentials

This part can't be scripted — guide the user through it:

1. Open <https://console.cloud.google.com/apis/credentials> in the project.
2. **Configure consent screen** → User type: **External** → fill in app name "PROMUNCH Inbox Bot", support email, dev contact. Add scopes: `gmail.modify` and `gmail.send`. Add `hello@promunch.in` as a **test user** (keeps you in Testing status indefinitely — that's fine for a single mailbox).
3. **Create credentials → OAuth client ID → Web application.**
4. Authorized redirect URI: `https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/oauth-callback`
5. Copy the **Client ID** and **Client Secret** into `.env`.

**✅ Verify:** `.env` now has non-empty `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

### 5.3 Slack app setup

#### 5.3a Update the manifest with your URLs

```bash
sed -i.bak \
  "s/REPLACE_WITH_YOUR_SUPABASE_PROJECT/<SUPABASE_PROJECT_REF>/g" \
  slack-app-manifest.json
rm slack-app-manifest.json.bak
```

#### 5.3b Create the app

1. Go to <https://api.slack.com/apps> → **Create New App** → **From an app manifest**.
2. Pick the workspace, paste the contents of `slack-app-manifest.json`, click **Create**.
3. **Install to Workspace** → grant the scopes.
4. **OAuth & Permissions** → copy **Bot User OAuth Token** (`xoxb-…`) into `SLACK_BOT_TOKEN`.
5. **Basic Information** → copy **Signing Secret** into `SLACK_SIGNING_SECRET`.

#### 5.3c Get the bot user ID

```bash
curl -s -X POST https://slack.com/api/auth.test \
  -H "Authorization: Bearer <SLACK_BOT_TOKEN>" | jq -r .user_id
# → U06XXXXXXXX  ← put into SLACK_BOT_USER_ID
```

#### 5.3d Invite the bot to the destination channel

In Slack: `/invite @PROMUNCH Inbox` in the channel.

Get the channel ID: right-click the channel → View channel details → scroll to bottom (`C0XXXXXXXX`) → put in `SLACK_CHANNEL_ID`.

**✅ Verify:**
```bash
curl -s -X POST https://slack.com/api/conversations.info \
  -H "Authorization: Bearer <SLACK_BOT_TOKEN>" \
  -d "channel=<SLACK_CHANNEL_ID>" | jq '.ok, .channel.name'
# → true, "your-channel-name"
```

### 5.4 Push env vars + deploy all functions

`.env` should now be complete. Run the one-shot deploy script:

```bash
./scripts/deploy.sh
```

It runs:
```bash
supabase secrets set --env-file .env
supabase functions deploy gmail-webhook
supabase functions deploy gmail-poll
supabase functions deploy gmail-watch-renew
supabase functions deploy slack-events
supabase functions deploy slack-interactivity
supabase functions deploy oauth-callback
```

**✅ Verify:**
```bash
supabase functions list
# → 6 functions, all "ACTIVE"
```

### 5.5 Bootstrap Gmail OAuth (one-time, in a browser)

Open this URL (replace placeholders):

```
https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/oauth-callback?action=start&token=<SETUP_TOKEN>
```

1. Log in **as `hello@promunch.in`** (this matters — the refresh token is bound to whoever consents).
2. Click through the unverified-app warning (your test-user designation makes this safe).
3. Approve the `gmail.modify` and `gmail.send` scopes.
4. You should see "✅ OAuth complete — Refresh token saved for hello@promunch.in".

**✅ Verify:**
```bash
# In Supabase dashboard → SQL Editor:
select email, created_at from oauth_tokens;
# → hello@promunch.in, <recent timestamp>
```

### 5.6 Start the Gmail watch

```bash
curl -X POST "https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/gmail-watch-renew" \
  -H "Authorization: Bearer $(supabase projects api-keys --project-ref <SUPABASE_PROJECT_REF> | grep anon | awk '{print $4}')"
```

**✅ Verify:** Response is `{"ok":true,"historyId":"…","expiration":"…"}`.

Also check the DB:
```sql
select email, history_id, expiration from gmail_watch;
```

### 5.7 Schedule the cron jobs

```bash
# Renew Gmail watch daily at 6 AM UTC (watches expire after 7 days; daily gives ample buffer)
supabase functions schedule create gmail-watch-renew "0 6 * * *"

# Poll fallback every 2 min — only fires if Pub/Sub misses something
supabase functions schedule create gmail-poll "*/2 * * * *"
```

**✅ Verify:**
```bash
supabase functions schedule list
# → both schedules listed
```

### 5.8 End-to-end smoke test

```bash
./scripts/verify.sh
```

Then the real test: **send an email from another address to `hello@promunch.in`**.

Within ~10 seconds you should see:
1. A new Slack message in the configured channel with the email content + a drafted reply + three buttons.
2. A row in `email_threads` (status=`pending`) and a row in `draft_revisions` (revision=1, is_current=true).

Try the human-in-the-loop:
- Reply in the Slack thread: `make it shorter and add a thank you` → bot posts a v2 draft within a few seconds.
- Reply in the thread: `approve` → bot sends the v2 draft via Gmail. Confirm the reply lands in the sender's inbox in the same Gmail thread.

If all three checks pass, **you're live**. Tell the user.

---

## 6. Common tasks (post-deploy)

### Change the draft voice / persona
Edit `SYSTEM_PROMPT` in `supabase/functions/_shared/anthropic.ts`, then:
```bash
supabase functions deploy gmail-webhook gmail-poll slack-events slack-interactivity
```
(only the functions that call `generateDraft` need redeploying)

### Switch to Claude Opus for higher-quality drafts
```bash
supabase secrets set ANTHROPIC_MODEL=claude-opus-4-6
# no redeploy needed — secrets propagate on next cold start
```

### Look at recent activity
```sql
-- last 10 emails the agent handled
select created_at, from_email, subject, status
from email_threads
order by created_at desc
limit 10;

-- conversion: how many drafts → sent?
select status, count(*) from email_threads group by status;

-- average revisions before sending
select avg(rev_count) from (
  select email_thread_id, count(*) as rev_count
  from draft_revisions
  group by email_thread_id
) t;
```

### Re-OAuth (if the refresh token is revoked)
Visit `/oauth-callback?action=start&token=<SETUP_TOKEN>` again.

### Pause the bot temporarily
```bash
supabase functions schedule delete gmail-poll
# and either stop the Gmail watch:
curl -X POST "https://<ref>.supabase.co/functions/v1/oauth-callback?stop=watch&token=..."
# or just disable the Pub/Sub subscription in GCP console
```

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| New emails don't appear in Slack | Pub/Sub push failing (check GCP → Pub/Sub → subscription → metrics for "Delivery errors") | Verify `?token=` matches `PUBSUB_VERIFICATION_TOKEN`. Check function logs: `supabase functions logs gmail-webhook` |
| Slack URL verification fails when adding event subscription | `verify_jwt` is true on `slack-events` | `supabase/config.toml` has `verify_jwt = false` — redeploy: `supabase functions deploy slack-events` |
| `No refresh token stored for hello@promunch.in` in function logs | OAuth bootstrap never ran or ran for a different mailbox | Re-run step 5.5, log in as the right account |
| Drafts post but Approve button does nothing | Slack signing secret mismatch | Re-copy `SLACK_SIGNING_SECRET`, `supabase secrets set --env-file .env`. Test with `supabase functions logs slack-interactivity` |
| `history.list 404` in webhook logs | Stale historyId (>7 days old) | The function auto-resets to the notification's historyId on 404 — this self-heals on the next push |
| Bot replies to its own messages in Slack threads | `SLACK_BOT_USER_ID` not set or wrong | Re-run `auth.test` (5.3c), set the secret |
| Email sent but customer doesn't see it as a threaded reply | `In-Reply-To` header missing | Check `email_threads.in_reply_to_header` is populated — if not, the inbound email lacked a Message-Id. Manually patch via SQL if needed. |

### Reading logs
```bash
supabase functions logs gmail-webhook --tail        # live tail
supabase functions logs slack-events --since 1h
```

---

## 8. Things this project deliberately does not do

So you don't waste time looking for them:

- **No queue / no worker pool.** At <1k emails/month this is overkill. Pub/Sub retries on 5xx, and the cron poll backstops anything that slips through.
- **No attachment handling.** Inbound attachments are ignored; outbound replies are plain text.
- **No per-customer context (yet).** Claude only sees the incoming email. To give it Shopify order lookup, define an Anthropic tool inside `_shared/anthropic.ts` and switch from `messages.create` to the tool-use loop.
- **No triage classifier.** Every inbound email gets a draft. If volume grows past ~100/day, add a cheap Haiku classifier in front of `generateDraft` that filters out marketing/auto-responses.
- **No multi-mailbox routing.** The schema supports it (the `email` column is keyed) but `processIncomingMessage` assumes a single configured mailbox.

If the user asks for any of these, they're additions — not bugs.

---

## 9. Cost estimate

At PROMUNCH's current volume (under 1k orders/month, assume ~500 inbound emails/month average across customer support, partnerships, vendors):

| Service | Monthly cost |
|---|---|
| Supabase (free tier covers it) | $0 |
| GCP Pub/Sub | <$0.10 |
| Anthropic (Sonnet, ~1.5k tokens/email × 500) | ~$2–5 |
| Slack | $0 (uses existing workspace) |
| **Total** | **<$10/month** |

Switching to Opus quadruples the Anthropic line item but is still under $25/month.
