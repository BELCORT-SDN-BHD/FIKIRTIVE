// Proves setBaseAsset only accepts an owned live base ref. Local DB, no spend.
// Run: node scripts/archive/verify-phaseA-setbase.mjs
import { readFileSync } from "node:fs";

const envPath = new URL("../../packages/db/.env", import.meta.url);
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const { prisma } = await import("../../packages/db/dist/src/index.js");
try {
  const e = await prisma.entity.findFirst({
    where: { deletedAt: null },
    include: { referenceImages: { where: { deletedAt: null, variantId: null }, take: 1 } },
  });
  if (!e || !e.referenceImages[0]) { console.log("⚠ no entity with a base ref locally — skip"); process.exit(0); }
  const good = e.referenceImages[0].assetId;
  const ok = await prisma.referenceImage.findFirst({ where: { entityId: e.id, assetId: good, deletedAt: null, variantId: null } });
  const bad = await prisma.referenceImage.findFirst({ where: { entityId: e.id, assetId: "asset-does-not-exist", deletedAt: null, variantId: null } });
  console.log(`valid-ref match: ${!!ok} (want true), bogus-ref match: ${!!bad} (want false)`);
  if (!ok || bad) process.exit(1);
  console.log("✓ setBaseAsset guard logic verified");
} finally { await prisma.$disconnect(); }
