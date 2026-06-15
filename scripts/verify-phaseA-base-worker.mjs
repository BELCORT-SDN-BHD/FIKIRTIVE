// Drives a BASE refgen job through handleRefGen with the MOCK provider ($0) and
// filesystem storage, then asserts the BASE money-safe path:
//   job → DONE, Entity.baseAssetId pinned to the produced asset (in the same
//   $transaction as the DONE flip), and a base-level ReferenceImage attached.
// No real spend: provider stays mock (GENERATION_PROVIDER unset), storage is
// the local-disk default. Loads packages/db/.env so DATABASE_URL targets the
// local dev DB (the prisma singleton reads DATABASE_URL_POOLED || DATABASE_URL).
//
// NOTE: unlike the other phaseA verify scripts (read-only), this one CREATEs a
// test entity + RefGenJob and leaves the produced rows in the LOCAL dev DB.
//
// Run (tsx lives under apps/worker, so point --import at its loader):
//   node --import ./apps/worker/node_modules/tsx/dist/loader.mjs \
//     scripts/verify-phaseA-base-worker.mjs
import { readFileSync } from "node:fs";

const envPath = new URL("../packages/db/.env", import.meta.url);
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
// guard: never let a stray env flip us onto the paid provider
if (process.env.GENERATION_PROVIDER === "fal") {
  console.error("✗ refusing to run: GENERATION_PROVIDER=fal would spend real money");
  process.exit(1);
}

const { prisma } = await import("../packages/db/dist/src/index.js");
const { newId } = await import("../packages/core/dist/index.js");
const { handleRefGen } = await import("../apps/worker/src/jobs/refgen.ts");

try {
  const entity = await prisma.entity.create({
    data: { id: newId(), type: "CHARACTER", name: "PhaseA base test" },
  });
  const job = await prisma.refGenJob.create({
    data: {
      id: newId(),
      entityId: entity.id,
      prompt: "full-body studio photo",
      count: 1,
      model: "seedream",
      mode: "BASE",
    },
  });

  await handleRefGen({ refGenJobId: job.id }, 0);

  const done = await prisma.refGenJob.findUnique({ where: { id: job.id } });
  const ent = await prisma.entity.findUnique({ where: { id: entity.id } });
  const ref = await prisma.referenceImage.findFirst({
    where: { entityId: entity.id, assetId: ent?.baseAssetId ?? "", deletedAt: null, variantId: null },
  });

  console.log("job:", done?.status, "baseAssetId set:", !!ent?.baseAssetId, "base ref attached:", !!ref);
  // the produced asset, the pinned base, and the attached ref must all be the SAME asset
  const pinnedMatchesOutput = !!ent?.baseAssetId && done?.outputAssetIds?.[0] === ent.baseAssetId;
  if (done?.status !== "DONE" || !ent?.baseAssetId || !ref || !pinnedMatchesOutput) {
    console.error("✗ BASE worker path failed an assertion", {
      status: done?.status,
      baseAssetId: ent?.baseAssetId,
      firstOutput: done?.outputAssetIds?.[0],
      refAttached: !!ref,
    });
    process.exit(1);
  }
  console.log("✓ BASE worker path: t2i image attached + baseAssetId pinned");
} finally {
  await prisma.$disconnect();
}
