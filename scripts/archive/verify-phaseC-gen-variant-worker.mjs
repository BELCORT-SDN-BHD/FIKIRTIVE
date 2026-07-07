// Drives the Phase C gen worker (apps/worker/src/jobs/gen.ts handleGen) with the MOCK
// provider ($0) and proves variant-scoped conditioning + money-safety:
//   CASE 1  variant @mention  → DONE; snapshot records variantId + ONLY the variant's
//           ref hash (not the base hash) → conditioned on the variant.
//   CASE 2  bare @mention     → DONE; snapshot variantId null + ONLY the base hash →
//           backward-compat (base-ref conditioning).
//   CASE 3  deleted variant   → FAILED before any spend (spent=false, no generation),
//           the fail-closed backstop for a variant whose images were removed.
// No real spend: provider stays mock, storage is local disk. Leaves rows in the LOCAL
// dev DB (like the Phase B worker scripts).
//
// Run (tsx lives under apps/worker):
//   node --import ./apps/worker/node_modules/tsx/dist/loader.mjs \
//     scripts/archive/verify-phaseC-gen-variant-worker.mjs
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
const { handleGen } = await import("../../apps/worker/src/jobs/gen.ts");

const hashOfRef = async (entityId, variantId) => {
  const r = await prisma.referenceImage.findFirst({ where: { entityId, variantId, deletedAt: null }, include: { asset: true } });
  return r?.asset.contentHash ?? null;
};
const snapOf = async (jobId) => {
  const job = await prisma.genJob.findUnique({ where: { id: jobId } });
  if (!job?.generationIds?.length) return { job, snap: null };
  const gen = await prisma.generation.findUnique({ where: { id: job.generationIds[0] } });
  return { job, snap: gen?.entitySnapshot ?? null };
};

let failed = false;
const check = (label, ok, detail) => { console.log(`${ok ? "✓" : "✗"} ${label}`, detail ?? ""); if (!ok) failed = true; };

try {
  const project = await prisma.project.create({ data: { id: newId(), name: "PhaseC gen test" } });
  const entity = await prisma.entity.create({ data: { id: newId(), type: "CHARACTER", name: "PhaseC gen char" } });

  // base ref via the BASE refgen path
  const baseJob = await prisma.refGenJob.create({ data: { id: newId(), entityId: entity.id, prompt: "full-body studio photo", count: 1, model: "seedream", mode: "BASE" } });
  await handleRefGen({ refGenJobId: baseJob.id }, 0);
  const baseHash = await hashOfRef(entity.id, null);

  // variant + its ref via the VARIANT refgen path (i2i on the base)
  const variant = await prisma.entityVariant.create({ data: { id: newId(), entityId: entity.id, name: "Red dress", handle: "red-dress", prompt: "wearing a red gown" } });
  const vjob = await prisma.refGenJob.create({ data: { id: newId(), entityId: entity.id, prompt: variant.prompt, count: 1, model: "seedream", mode: "VARIANT", variantId: variant.id } });
  await handleRefGen({ refGenJobId: vjob.id }, 0);
  const variantHash = await hashOfRef(entity.id, variant.id);

  check("setup: distinct base + variant ref hashes", !!baseHash && !!variantHash && baseHash !== variantHash, { baseHash, variantHash });

  // CASE 1 — variant @mention conditions on the variant
  const g1 = await prisma.genJob.create({ data: { id: newId(), projectId: project.id, prompt: "@char in the red dress", entityIds: [entity.id], variantSel: { [entity.id]: variant.id }, kind: "IMAGE", model: "seedream", count: 1 } });
  await handleGen({ genJobId: g1.id }, 0);
  const r1 = await snapOf(g1.id);
  const e1 = r1.snap?.entities?.[0];
  check("CASE 1 variant mention → DONE", r1.job?.status === "DONE", { status: r1.job?.status });
  check("CASE 1 snapshot.variantId == variant", e1?.variantId === variant.id, { got: e1?.variantId });
  check("CASE 1 conditioned on VARIANT ref (variant hash present, base absent)", !!e1 && e1.refHashes.includes(variantHash) && !e1.refHashes.includes(baseHash), { refHashes: e1?.refHashes });

  // CASE 2 — bare @mention conditions on the base (backward-compat)
  const g2 = await prisma.genJob.create({ data: { id: newId(), projectId: project.id, prompt: "@char standing", entityIds: [entity.id], kind: "IMAGE", model: "seedream", count: 1 } });
  await handleGen({ genJobId: g2.id }, 0);
  const r2 = await snapOf(g2.id);
  const e2 = r2.snap?.entities?.[0];
  check("CASE 2 bare mention → DONE", r2.job?.status === "DONE", { status: r2.job?.status });
  check("CASE 2 snapshot.variantId == null", e2?.variantId === null, { got: e2?.variantId });
  check("CASE 2 conditioned on BASE ref (base hash present, variant absent)", !!e2 && e2.refHashes.includes(baseHash) && !e2.refHashes.includes(variantHash), { refHashes: e2?.refHashes });

  // CASE 3 — deleted variant fails closed before spend
  const v2 = await prisma.entityVariant.create({ data: { id: newId(), entityId: entity.id, name: "Blue suit", handle: "blue-suit", prompt: "blue suit" } });
  const v2job = await prisma.refGenJob.create({ data: { id: newId(), entityId: entity.id, prompt: v2.prompt, count: 1, model: "seedream", mode: "VARIANT", variantId: v2.id } });
  await handleRefGen({ refGenJobId: v2job.id }, 0);
  // remove its only image, simulating refs deleted after the guardian passed
  await prisma.referenceImage.updateMany({ where: { entityId: entity.id, variantId: v2.id, deletedAt: null }, data: { deletedAt: new Date() } });
  const g3 = await prisma.genJob.create({ data: { id: newId(), projectId: project.id, prompt: "@char in blue suit", entityIds: [entity.id], variantSel: { [entity.id]: v2.id }, kind: "IMAGE", model: "seedream", count: 1 } });
  await handleGen({ genJobId: g3.id }, 0);
  const r3 = await prisma.genJob.findUnique({ where: { id: g3.id } });
  check("CASE 3 deleted-variant gen → FAILED", r3?.status === "FAILED", { status: r3?.status, error: r3?.error });
  check("CASE 3 NO spend (spent=false, no generation rows)", r3?.spent === false && r3?.generationIds.length === 0, { spent: r3?.spent, gens: r3?.generationIds.length });

  // CASE 4 — variant soft-deleted but its ref left LIVE (a delete path that didn't
  // cascade, or a race): the worker's EntityVariant liveness check must still fail closed.
  const v3 = await prisma.entityVariant.create({ data: { id: newId(), entityId: entity.id, name: "Green coat", handle: "green-coat", prompt: "green coat" } });
  const v3job = await prisma.refGenJob.create({ data: { id: newId(), entityId: entity.id, prompt: v3.prompt, count: 1, model: "seedream", mode: "VARIANT", variantId: v3.id } });
  await handleRefGen({ refGenJobId: v3job.id }, 0);
  await prisma.entityVariant.update({ where: { id: v3.id }, data: { deletedAt: new Date() } }); // delete variant ONLY, leave ref live
  const liveRefStillThere = await prisma.referenceImage.findFirst({ where: { entityId: entity.id, variantId: v3.id, deletedAt: null } });
  const g4 = await prisma.genJob.create({ data: { id: newId(), projectId: project.id, prompt: "@char in green coat", entityIds: [entity.id], variantSel: { [entity.id]: v3.id }, kind: "IMAGE", model: "seedream", count: 1 } });
  await handleGen({ genJobId: g4.id }, 0);
  const r4 = await prisma.genJob.findUnique({ where: { id: g4.id } });
  check("CASE 4 setup: variant deleted but ref still live", !!liveRefStillThere, { ref: !!liveRefStillThere });
  check("CASE 4 deleted-variant (live ref) gen → FAILED", r4?.status === "FAILED", { status: r4?.status, error: r4?.error });
  check("CASE 4 NO spend (spent=false, no generation rows)", r4?.spent === false && r4?.generationIds.length === 0, { spent: r4?.spent, gens: r4?.generationIds.length });

  // CASE 5 — parent ENTITY soft-deleted (softDeleteEntity does NOT cascade refs) → the
  // worker's entity-liveness check must fail closed even for a bare mention with live refs.
  await prisma.entity.update({ where: { id: entity.id }, data: { deletedAt: new Date() } });
  const baseRefStillLive = await prisma.referenceImage.findFirst({ where: { entityId: entity.id, variantId: null, deletedAt: null } });
  const g5 = await prisma.genJob.create({ data: { id: newId(), projectId: project.id, prompt: "@char standing", entityIds: [entity.id], kind: "IMAGE", model: "seedream", count: 1 } });
  await handleGen({ genJobId: g5.id }, 0);
  const r5 = await prisma.genJob.findUnique({ where: { id: g5.id } });
  check("CASE 5 setup: entity deleted but base ref still live (no cascade)", !!baseRefStillLive, { ref: !!baseRefStillLive });
  check("CASE 5 deleted-entity gen → FAILED", r5?.status === "FAILED", { status: r5?.status, error: r5?.error });
  check("CASE 5 NO spend (spent=false, no generation rows)", r5?.spent === false && r5?.generationIds.length === 0, { spent: r5?.spent, gens: r5?.generationIds.length });

  if (failed) { console.error("\n✗ Phase C gen worker FAILED an assertion"); process.exit(1); }
  console.log("\n✓ Phase C gen worker: variant-scoped conditioning + snapshot + fail-closed on deleted variant");
} finally {
  await prisma.$disconnect();
}
