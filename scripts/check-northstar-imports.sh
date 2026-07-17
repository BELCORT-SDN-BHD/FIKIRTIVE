#!/usr/bin/env bash
# Fence (northstar PROGRAM.md §二 方案 A): gallery + components/northstar stay pure
# design files. Fenced route/component files must never import the backend directly:
# no server actions (lib/*-actions), no @fikirtive/db (Prisma), no @fikirtive/generation,
# no auth/guard modules, no server-only. Structural guarantee, not honour system.
# The immersive Canvas reaches its authenticated runtime only through the reviewed
# components/canvas adapter outside this tree; this exception does not weaken the regex.
# Wired into ci.yml (check job, fences step) since PR #236.
set -uo pipefail

DIRS="apps/web/app/northstar apps/web/app/northstar-immersive apps/web/components/northstar"

# Three forms are fenced: static `from "..."`, dynamic `import("...")`, and the
# side-effect form `import "server-only"`. `lib/actions` (THE server-actions module)
# is fenced explicitly — it doesn't match the `*-actions` suffix pattern.
bad=$(grep -rnE "(from[[:space:]]+|import[[:space:]]*\([[:space:]]*)[\"'][^\"']*(-actions|auth-guard|server-only)([\"']|/)|(from[[:space:]]+|import[[:space:]]*\([[:space:]]*)[\"']@fikirtive/(db|generation)|(from[[:space:]]+|import[[:space:]]*\([[:space:]]*)[\"'][^\"']*lib/(auth|actions)([\"']|/)|import[[:space:]]+[\"']server-only[\"']" \
  $DIRS --include='*.ts' --include='*.tsx' 2>/dev/null | grep -vE ':\s*(\*|//)' || true)

if [ -n "$bad" ]; then
  echo "FAIL: fenced northstar files must not import server actions, @fikirtive/db, auth, or server-only:"
  echo "$bad"
  exit 1
fi

count=$(find $DIRS -name '*.tsx' -o -name '*.ts' 2>/dev/null | wc -l | tr -d ' ')
echo "northstar-imports fence: clean ($count files checked; zero backend imports)."
exit 0
