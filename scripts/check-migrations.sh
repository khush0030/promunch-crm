#!/usr/bin/env bash
# Guard against duplicate migration timestamps (audit R6). Two migrations that
# share a <14-digit>_ prefix have an ambiguous apply order. This catches new
# collisions in CI/pre-commit. Pre-existing duplicates are grandfathered via the
# ALLOWLIST below (they are already applied in prod; renaming them would desync
# the hand-applied migration history — see docs/runbooks/MIGRATIONS.md).
set -euo pipefail

DIRS=(
  "supabase/migrations"
  "promunch-email-agent/supabase/migrations"
)

# Known pre-existing collisions — do NOT rename these (already applied).
ALLOWLIST="20260520130000 20260610170000 20260624140000 20260624170000 20260629120000"

fail=0
for d in "${DIRS[@]}"; do
  [ -d "$d" ] || continue
  dupes=$(ls "$d"/*.sql 2>/dev/null | xargs -n1 basename \
    | sed -E 's/^([0-9]{14})_.*/\1/' | sort | uniq -d)
  for ts in $dupes; do
    if echo " $ALLOWLIST " | grep -q " $ts "; then continue; fi
    echo "ERROR: duplicate migration timestamp $ts in $d"
    fail=1
  done
done

if [ "$fail" -eq 0 ]; then
  echo "migrations OK — no new timestamp collisions"
fi
exit "$fail"
