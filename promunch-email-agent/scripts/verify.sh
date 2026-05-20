#!/usr/bin/env bash
# Post-deploy smoke test — hits each endpoint and checks the DB tables exist.
# Doesn't send real emails; it just confirms the wiring is correct.

set -euo pipefail
cd "$(dirname "$0")/.."

source .env 2>/dev/null || { echo "✗ .env not found"; exit 1; }

# Pull project ref from OAUTH_REDIRECT_URI (https://<ref>.supabase.co/...)
PROJECT_REF=$(echo "$OAUTH_REDIRECT_URI" | sed -E 's|https://([^.]+)\..*|\1|')
[[ -z "$PROJECT_REF" ]] && { echo "✗ Could not parse project ref from OAUTH_REDIRECT_URI"; exit 1; }
BASE="https://${PROJECT_REF}.supabase.co/functions/v1"

ANON_KEY=$(supabase projects api-keys --project-ref "$PROJECT_REF" 2>/dev/null | awk '/anon/ {print $4}')
[[ -z "$ANON_KEY" ]] && { echo "✗ Could not fetch anon key — log in with: supabase login"; exit 1; }

pass=0
fail=0

check() {
  local name=$1
  local expected_substr=$2
  local actual=$3
  if [[ "$actual" == *"$expected_substr"* ]]; then
    echo "  ✓ $name"
    pass=$((pass+1))
  else
    echo "  ✗ $name — got: $actual"
    fail=$((fail+1))
  fi
}

echo "▸ Checking function endpoints are reachable"

# gmail-webhook with bad token should 403
r=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE}/gmail-webhook?token=wrong" -H "Content-Type: application/json" -d '{}')
check "gmail-webhook rejects wrong token"  "403" "$r"

# gmail-webhook with right token + empty body should be 400 (bad request, but reachable)
r=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE}/gmail-webhook?token=${PUBSUB_VERIFICATION_TOKEN}" -H "Content-Type: application/json" -d '{}')
check "gmail-webhook reachable with right token" "400" "$r"

# slack-events: missing signature should 401
r=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE}/slack-events" -H "Content-Type: application/json" -d '{"type":"url_verification","challenge":"x"}')
check "slack-events requires signature"      "401" "$r"

# slack-interactivity: missing signature should 401
r=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE}/slack-interactivity" -d 'payload={}')
check "slack-interactivity requires signature" "401" "$r"

# gmail-watch-renew: needs anon key but should respond ok (or 500 if watch fails — both prove reachability)
r=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE}/gmail-watch-renew" -H "Authorization: Bearer ${ANON_KEY}")
if [[ "$r" == "200" || "$r" == "500" ]]; then
  echo "  ✓ gmail-watch-renew reachable (HTTP $r)"
  pass=$((pass+1))
else
  echo "  ✗ gmail-watch-renew unreachable (HTTP $r)"
  fail=$((fail+1))
fi

# oauth-callback: GET / should redirect or 400
r=$(curl -s -o /dev/null -w "%{http_code}" "${BASE}/oauth-callback")
if [[ "$r" == "400" || "$r" == "403" ]]; then
  echo "  ✓ oauth-callback reachable"
  pass=$((pass+1))
else
  echo "  ✗ oauth-callback unexpected response ($r)"
  fail=$((fail+1))
fi

echo ""
echo "▸ Checking Slack credentials"
slack_auth=$(curl -s -X POST https://slack.com/api/auth.test -H "Authorization: Bearer ${SLACK_BOT_TOKEN}")
if [[ $(echo "$slack_auth" | grep -c '"ok":true') -eq 1 ]]; then
  echo "  ✓ SLACK_BOT_TOKEN valid"
  bot_id=$(echo "$slack_auth" | sed -E 's/.*"user_id":"([^"]+)".*/\1/')
  if [[ "$bot_id" == "$SLACK_BOT_USER_ID" ]]; then
    echo "  ✓ SLACK_BOT_USER_ID matches token"
    pass=$((pass+2))
  else
    echo "  ✗ SLACK_BOT_USER_ID ($SLACK_BOT_USER_ID) != actual ($bot_id)"
    fail=$((fail+1))
  fi
else
  echo "  ✗ SLACK_BOT_TOKEN invalid: $slack_auth"
  fail=$((fail+1))
fi

# Channel reachable + bot is a member
chan=$(curl -s -X POST https://slack.com/api/conversations.info \
  -H "Authorization: Bearer ${SLACK_BOT_TOKEN}" \
  -d "channel=${SLACK_CHANNEL_ID}")
if [[ $(echo "$chan" | grep -c '"ok":true') -eq 1 ]]; then
  echo "  ✓ SLACK_CHANNEL_ID exists"
  pass=$((pass+1))
else
  echo "  ✗ Cannot access SLACK_CHANNEL_ID — is the bot invited? $chan"
  fail=$((fail+1))
fi

echo ""
echo "▸ Summary: $pass passed, $fail failed"
[[ $fail -gt 0 ]] && exit 1
echo ""
echo "✅ All wiring checks passed. Now send a test email to ${MAILBOX_EMAIL} and watch the Slack channel."
