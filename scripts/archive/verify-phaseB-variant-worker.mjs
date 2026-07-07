// Drives a VARIANT refgen job through handleRefGen with the MOCK provider ($0) and
// filesystem storage, then asserts the VARIANT money-safe path:
//   job → DONE, a ReferenceImage attached tagged with the variant's id, the
//   produced asset == that variant ref's asset, and Entity.baseAssetId UNCHANGED
//   (variants never repin the base). First establishes a base via the BASE path.
// No real spend: provider stays mock (GENERATION_PROVIDER unset), storage is the
// local-disk default. Loads packages/db/.env so DATABASE_URL targets the local dev DB.
//
// NOTE: like the base-worker script, this CREATEs test rows and leaves them in the LOCAL dev DB.
//
// Run (tsx lives under apps/worker):
//   node --import ./apps/worker/node_modules/tsx/dist/loader.mjs \
//     scripts/archive/verify-phaseB-variant-worker.mjs
import { readFileSync } from "node:fs";

const envPath = new URL("../../packages/db/.env", import.meta.url);
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (process.env.GENERATION_PROVIDER === "fal") {
  console.error("✗ refusing to run: GENERATION_PROVIDER=fal would spend real money");
  process.exit(1);
}

const { prisma } = await import("../../packages/db/dist/src/index.js");
const { newId } = await import("../../packages/core/dist/index.js");
const { handleRefGen } = await import("../../apps/worker/src/jobs/refgen.ts");

try {
  const entity = await prisma.entity.create({
    data: { id: newId(), type: "CHARACTER", name: "PhaseB variant test" },
  });

  // establish a base via the BASE path
  const baseJob = await prisma.refGenJob.create({
    data: { id: newId(), entityId: entity.id, prompt: "full-body studio photo", count: 1, model: "seedream", mode: "BASE" },
  });
  await handleRefGen({ refGenJobId: baseJob.id }, 0);
  const withBase = await prisma.entity.findUnique({ where: { id: entity.id } });
  if (!withBase?.baseAssetId) { console.error("✗ base setup failed — BASE path did not pin baseAssetId"); process.exit(1); }
  const baseBefore = withBase.baseAssetId;

  // generate a variant via the VARIANT path (i2i conditioned on the base)
  const variant = await prisma.entityVariant.create({
    data: { id: newId(), entityId: entity.id, name: "Red dress", handle: "red-dress", prompt: "wearing a red evening gown" },
  });
  const vjob = await prisma.refGenJob.create({
    data: { id: newId(), entityId: entity.id, prompt: variant.prompt, count: 1, model: "seedream", mode: "VARIANT", variantId: variant.id },
  });
  await handleRefGen({ refGenJobId: vjob.id }, 0);

  const done = await prisma.refGenJob.findUnique({ where: { id: vjob.id } });
  const ent = await prisma.entity.findUnique({ where: { id: entity.id } });
  const vref = await prisma.referenceImage.findFirst({
    where: { entityId: entity.id, variantId: variant.id, deletedAt: null },
  });

  const baseUnchanged = ent?.baseAssetId === baseBefore;
  const outputMatches = !!vref && done?.outputAssetIds?.[0] === vref.assetId;
  console.log("variant job:", done?.status, "variant ref attached:", !!vref, "base unchanged:", baseUnchanged, "output==ref:", outputMatches);
  if (done?.status !== "DONE" || !vref || !baseUnchanged || !outputMatches) {
    console.error("✗ VARIANT worker path failed an assertion", {
      status: done?.status, variantRef: !!vref, baseBefore, baseAfter: ent?.baseAssetId, firstOutput: done?.outputAssetIds?.[0], refAsset: vref?.assetId,
    });
    process.exit(1);
  }
  console.log("✓ VARIANT worker path: i2i image attached with variantId, base unchanged");
} finally {
  await prisma.$disconnect();
}
