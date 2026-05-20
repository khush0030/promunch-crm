#!/usr/bin/env bash
# Idempotent deploy of the PROMUNCH Email Agent.
# Safe to re-run after any code change — `supabase functions deploy` is upsert-style.

set -euo pipefail

cd "$(dirname "$0")/.."

# ---- Preflight ----
command -v supabase >/dev/null || { echo "✗ supabase CLI not found — brew install supabase/tap/supabase"; exit 1; }

if [[ ! -f .env ]]; then
  echo "✗ .env not found. Copy .env.example to .env and fill in real values first."
  exit 1
fi

REQUIRED_VARS=(
  MAILBOX_EMAIL
  GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET
  OAUTH_REDIRECT_URI
  SETUP_TOKEN
  GMAIL_PUBSUB_TOPIC
  PUBSUB_VERIFICATION_TOKEN
  SLACK_BOT_TOKEN
  SLACK_SIGNING_SECRET
  SLACK_BOT_USER_ID
  SLACK_CHANNEL_ID
  ANTHROPIC_API_KEY
)
missing=0
for v in "${REQUIRED_VARS[@]}"; do
  if ! grep -qE "^${v}=.+" .env; then
    echo "✗ .env is missing or has empty value for: $v"
    missing=1
  fi
done
[[ $missing -eq 1 ]] && exit 1

# ---- Push secrets ----
echo "▸ Pushing secrets from .env"
supabase secrets set --env-file .env >/dev/null
echo "✓ secrets set"

# ---- Apply migrations (no-op if already applied) ----
echo "▸ Applying migrations"
supabase db push
echo "✓ migrations applied"

# ---- Deploy functions ----
FUNCTIONS=(
  gmail-webhook
  gmail-poll
  gmail-watch-renew
  slack-events
  slack-interactivity
  oauth-callback
)
for fn in "${FUNCTIONS[@]}"; do
  echo "▸ Deploying $fn"
  supabase functions deploy "$fn"
done

echo ""
echo "✅ All functions deployed."
echo ""
echo "Next steps:"
echo "  1. If this is the first deploy: visit /oauth-callback?action=start&token=\$SETUP_TOKEN in a browser"
echo "  2. Trigger /gmail-watch-renew once to start the Pub/Sub watch"
echo "  3. supabase functions schedule create gmail-watch-renew \"0 6 * * *\""
echo "  4. supabase functions schedule create gmail-poll \"*/2 * * * *\""
echo "  5. ./scripts/verify.sh"
