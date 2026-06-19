#!/usr/bin/env bash
# Tripwire (closed-beta P0 skeleton): count direct prisma.<ownerScopedModel> reads/writes
# in apps/web. In P0 this is informational baseline (the codebase predates the tenant-scoped
# repo); P3 routes these through the scoped client and flips this to fail CI.
set -uo pipefail
MODELS='project|entity|entityVariant|referenceImage|asset|shot|shotEntityRef|generation|genJob|refGenJob|renderJob|captionJob|transcript|chatThread|chatMessage'
hits=$(grep -rnE "prisma\.($MODELS)\." apps/web/ --include='*.ts' --include='*.tsx' 2>/dev/null | wc -l | tr -d ' ')
echo "raw prisma owner-scoped call-sites in apps/web: $hits (P0 baseline; P3 routes these through the scoped repo)"
exit 0  # P0: never fail — baseline only
