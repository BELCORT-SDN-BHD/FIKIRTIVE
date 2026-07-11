#!/usr/bin/env bash
# Fence (northstar PROGRAM.md §二 方案 A): app/northstar + components/northstar are DESIGN
# files — pure client prototypes with mock data. They must never import the backend:
# no server actions (lib/*-actions), no @fikirtive/db (Prisma), no @fikirtive/generation,
# no auth/guard modules, no server-only. Structural guarantee, not honour system.
# Not wired into ci.yml yet — run manually / wire with the first prototype-page PR.
set -uo pipefail

DIRS="apps/web/app/northstar apps/web/app/northstar-immersive apps/web/components/northstar"

bad=$(grep -rnE "from [\"'][^\"']*(-actions|auth-guard|server-only)([\"']|/)|from [\"']@fikirtive/(db|generation)|from [\"'][^\"']*lib/auth" \
  $DIRS --include='*.ts' --include='*.tsx' 2>/dev/null | grep -vE ':\s*(\*|//)' || true)

if [ -n "$bad" ]; then
  echo "FAIL: northstar prototype files must not import server actions, @fikirtive/db, auth, or server-only:"
  echo "$bad"
  exit 1
fi

count=$(find $DIRS -name '*.tsx' -o -name '*.ts' 2>/dev/null | wc -l | tr -d ' ')
echo "northstar-imports fence: clean ($count files checked; zero backend imports)."
exit 0
