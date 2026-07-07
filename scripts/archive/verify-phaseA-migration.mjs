// Verifies Phase A schema + backfill against the LOCAL dev DB. Read-only except
// it asserts invariants. Run: node scripts/archive/verify-phaseA-migration.mjs
//
// Loads packages/db/.env so it targets the local dev DB (the prisma singleton
// reads DATABASE_URL_POOLED || DATABASE_URL). Imports the package's compiled
// entrypoint — the repo's generated client is emitted as TypeScript ESM and is
// wired through the @prisma/adapter-pg adapter in packages/db/src/index.ts; that
// adapter wiring is what dist/src/index.js exposes, so it's the runnable client
// (same one every scripts/*.mjs uses). The raw generated/prisma/client.js has no
// adapter and can't be `new`ed directly under Prisma 7.
import { readFileSync } from "node:fs";

const envPath = new URL("../../packages/db/.env", import.meta.url);
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const { prisma } = await import("../../packages/db/dist/src/index.js");
try {
  // 1. every live entity with a live base-level ref has a baseAssetId pointing at its lowest-position ref
  const entities = await prisma.entity.findMany({
    where: { deletedAt: null },
    include: { referenceImages: { where: { deletedAt: null, variantId: null }, orderBy: { position: "asc" } } },
  });
  let bad = 0;
  for (const e of entities) {
    const expected = e.referenceImages[0]?.assetId ?? null;
    if (e.baseAssetId !== expected) { bad++; console.error(`✗ ${e.id} base=${e.baseAssetId} expected=${expected}`); }
  }
  // 2. the new tables/columns are queryable
  await prisma.entityVariant.count();
  console.log(`entities checked: ${entities.length}, backfill mismatches: ${bad}`);
  if (bad > 0) process.exit(1);
  console.log("✓ Phase A migration verified");
} finally { await prisma.$disconnect(); }
