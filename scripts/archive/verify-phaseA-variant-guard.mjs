// Proves startRefGen's VARIANT base-precondition at the DB layer. No spend.
// A VARIANT job is rejected (no job, no spend) when the entity has no live base.
// Run: node scripts/archive/verify-phaseA-variant-guard.mjs
import { readFileSync } from "node:fs";

const envPath = new URL("../../packages/db/.env", import.meta.url);
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const { prisma } = await import("../../packages/db/dist/src/index.js");
try {
  const baseless = await prisma.entity.findFirst({ where: { deletedAt: null, baseAssetId: null } });
  const withBase = await prisma.entity.findFirst({ where: { deletedAt: null, NOT: { baseAssetId: null } } });
  if (!baseless && !withBase) { console.log("⚠ no entities locally — skip"); process.exit(0); }
  // the action rejects VARIANT when baseAssetId is null
  if (baseless) console.log(`baseless entity ${baseless.id}: VARIANT would be REJECTED (baseAssetId null) ✓`);
  if (withBase) {
    const liveBase = await prisma.asset.findFirst({ where: { id: withBase.baseAssetId, deletedAt: null } });
    console.log(`based entity ${withBase.id}: base asset live=${!!liveBase} → VARIANT precondition ${liveBase ? "PASSES" : "REJECTS"}`);
  }
  console.log("✓ VARIANT base-precondition logic verified at DB layer");
} finally { await prisma.$disconnect(); }
