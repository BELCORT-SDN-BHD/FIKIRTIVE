#!/usr/bin/env bash
# Fence (Otto skill framework §3.3): skills/* must reach spend/providers ONLY via injected ctx ports.
# HARD-fail: importing the fal provider (@fikirtive/generation) or reserveCredits directly.
# WARN: direct @fikirtive/db (Prisma) use — current skills do owner-scoped reads this way; migrate
#       behind read-ports incrementally (does not fail CI yet).
set -uo pipefail
DIR="packages/otto/src/skills"

hard=$(grep -rnE "from \"@fikirtive/generation\"|reserveCredits" "$DIR" --include='*.ts' 2>/dev/null \
  | grep -v '\.test\.ts' | grep -vE ':\s*(\*|//)' || true)

if [ -n "$hard" ]; then
  echo "FAIL: skills/ must not import the fal provider or reserveCredits — route spend through a ctx port:"
  echo "$hard"
  exit 1
fi

warn=$(grep -rnE "from \"@fikirtive/db\"" "$DIR" --include='*.ts' 2>/dev/null | grep -v '\.test\.ts' | wc -l | tr -d ' ' || true)
echo "skill-imports fence: 0 spend/provider bypass (hard-clean); $warn direct-Prisma sites (warn baseline)."
exit 0
