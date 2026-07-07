// Drives the gen worker (apps/worker/src/jobs/gen.ts handleGen) with the MOCK provider
// ($0) and proves the bare-@mention character money-safety backstop (Codex Phase-C flag):
//   CASE A  bare @mention of a CHARACTER with ZERO base refs → FAILED before any spend
//           (spent=false, no generation rows). This is the worker's independent gate for
//           when the (fail-OPEN) guardian faults and lets an unanchored character through.
//   CASE B  bare @mention of a LOCATION with ZERO refs → DONE (t2i is INTENDED for
//           non-character types; only CHARACTER must be anchored, matching castFindings).
// No real spend: provider stays mock, storage is local disk. Leaves rows in the LOCAL dev DB.
//
// Run (tsx lives under apps/worker):
//   node --import ./apps/worker/node_modules/tsx/dist/loader.mjs \
//     scripts/archive/verify-gen-character-no-refs-worker.mjs
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
const { handleGen } = await import("../../apps/worker/src/jobs/gen.ts");

let failed = false;
const check = (label, ok, detail) => { console.log(`${ok ? "✓" : "✗"} ${label}`, detail ?? ""); if (!ok) failed = true; };

try {
  const project = await prisma.project.create({ data: { id: newId(), name: "char-no-refs gen test" } });

  // CASE A — CHARACTER with NO base ref, bare @mention (no variantSel) → FAILED, no spend
  const char = await prisma.entity.create({ data: { id: newId(), type: "CHARACTER", name: "Unanchored char" } });
  const liveCharRefs = await prisma.referenceImage.count({ where: { entityId: char.id, variantId: null, deletedAt: null } });
  check("CASE A setup: character has zero base refs", liveCharRefs === 0, { liveCharRefs });
  const gA = await prisma.genJob.create({ data: { id: newId(), projectId: project.id, prompt: "@char standing", entityIds: [char.id], kind: "IMAGE", model: "seedream", count: 1 } });
  await handleGen({ genJobId: gA.id }, 0);
  const rA = await prisma.genJob.findUnique({ where: { id: gA.id } });
  check("CASE A bare CHARACTER mention, 0 refs → FAILED", rA?.status === "FAILED", { status: rA?.status, error: rA?.error });
  check("CASE A NO spend (spent=false, no generation rows)", rA?.spent === false && rA?.generationIds.length === 0, { spent: rA?.spent, gens: rA?.generationIds.length });

  // CASE B — LOCATION with NO ref, bare @mention → DONE (t2i allowed for non-characters)
  const loc = await prisma.entity.create({ data: { id: newId(), type: "LOCATION", name: "Empty location" } });
  const liveLocRefs = await prisma.referenceImage.count({ where: { entityId: loc.id, variantId: null, deletedAt: null } });
  check("CASE B setup: location has zero refs", liveLocRefs === 0, { liveLocRefs });
  const gB = await prisma.genJob.create({ data: { id: newId(), projectId: project.id, prompt: "@loc wide shot", entityIds: [loc.id], kind: "IMAGE", model: "seedream", count: 1 } });
  await handleGen({ genJobId: gB.id }, 0);
  const rB = await prisma.genJob.findUnique({ where: { id: gB.id } });
  check("CASE B bare LOCATION mention, 0 refs → DONE (t2i allowed)", rB?.status === "DONE", { status: rB?.status, error: rB?.error });
  check("CASE B did spend (generation rows present)", (rB?.generationIds.length ?? 0) > 0, { gens: rB?.generationIds.length });

  if (failed) { console.error("\n✗ gen char-no-refs backstop FAILED an assertion"); process.exit(1); }
  console.log("\n✓ gen worker: bare-@mention CHARACTER with 0 base refs fails closed; LOCATION with 0 refs still t2i");
} finally {
  await prisma.$disconnect();
}
