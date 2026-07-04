#!/usr/bin/env bash
# Parity fence (Seam 9, 宪法 7 — harmony-02): every exported human server action must have a row in
# packages/otto/src/parity-manifest.ts — paired to an Otto skill, exempt (four closed classes:
# ADMIN / VISUAL / MONEY_IN / ACCOUNT_SECURITY — new class = constitution amendment), or TODO_SKILL debt.
#
# Phase: WARN-ONLY (harmony-02 §四.2) — prints the unregistered red list but NEVER fails on parity
# debt. Flips to hard fail once the backfill (盘点回填, §四.1) clears the list. It DOES fail if the
# fence itself is broken (manifest missing / nothing enumerated) — a fence silently scanning nothing
# is worse than no fence.
#
# Division of labour: the manifest-side invariants (skill names exist in the registry, exemption
# classes closed at four, TODO notes non-empty) are unit-tested in parity-manifest.test.ts.
# This script owns the SCAN side (harmony-02 §二.1–3):
#   1. enumerate the action surface — every export of a `"use server"` file under apps/web/lib.
#      Detection is by directive line, not filename: lib has "use server" files beyond *-actions.ts
#      (actions.ts, brand-research.ts, ...) and they are equally public POST endpoints. In these
#      files every runtime export is an async function (Next.js enforces it), so
#      `export async function NAME` is the complete inventory. Key format: <basename>.<export>.
#   2. forward check: every enumerated action has a manifest row → else WARN (red list).
#   3. reverse check: every manifest row still points at a live action → else WARN (zombie row).
# app/api/**/route.ts enumeration is deferred to the hard-gate phase (harmony-02 §二.1 second half).
set -uo pipefail

LIB="apps/web/lib"
MANIFEST="packages/otto/src/parity-manifest.ts"

if [ ! -f "$MANIFEST" ]; then
  echo "FAIL: parity fence is broken — $MANIFEST not found (moved? update this script)."
  exit 1
fi

# 1. Action surface. The directive match is a whole line (^"use server";$) so comments that merely
# MENTION the directive (meta-build-actions.ts's F12 note) don't drag non-action modules in.
actions=$(grep -rlE '^[[:space:]]*"use server";?[[:space:]]*$' "$LIB" --include='*.ts' 2>/dev/null \
  | sort | while IFS= read -r f; do
      base=$(basename "$f" .ts)
      grep -hoE '^export async function [A-Za-z0-9_]+' "$f" | awk -v b="$base" '{print b "." $4}'
    done | sort -u)

if [ -z "$actions" ]; then
  echo "FAIL: parity fence is broken — no exported server actions found under $LIB."
  exit 1
fi

# 2. Manifest keys. The manifest is a pure literal by design (one row per line, SECTION_MATRIX
# style — a reviewer nail in harmony-02), so the keys are greppable without a TS parser.
keys=$(grep -oE '^[[:space:]]*"[^"]+"[[:space:]]*:' "$MANIFEST" \
  | sed -E 's/^[[:space:]]*"([^"]+)".*$/\1/' | sort -u)

missing=$(comm -23 <(printf '%s\n' "$actions") <(printf '%s\n' "$keys"))
zombies=$(comm -13 <(printf '%s\n' "$actions") <(printf '%s\n' "$keys"))

total=$(grep -c . <<<"$actions")
n_missing=$(grep -c . <<<"$missing" || true)
n_zombies=$(grep -c . <<<"$zombies" || true)
registered=$((total - n_missing))

echo "parity fence (WARN phase): $total exported server actions; $registered registered in the manifest; $n_missing unregistered; $n_zombies zombie manifest rows."

if [ -n "$missing" ]; then
  echo ""
  echo "WARN: $n_missing action(s) not in parity-manifest.ts — each needs a skill pairing, an"
  echo "exemption (ADMIN/VISUAL/MONEY_IN/ACCOUNT_SECURITY + reason), or a TODO_SKILL debt row:"
  printf '%s\n' "$missing" | sed 's/^/  - /'
fi

if [ -n "$zombies" ]; then
  echo ""
  echo "WARN: $n_zombies manifest row(s) reference an action that no longer exists (delete or fix the row):"
  printf '%s\n' "$zombies" | sed 's/^/  - /'
fi

exit 0  # WARN phase: red list visible, never blocks (harmony-02 §四.2). Hard fail comes after backfill.
