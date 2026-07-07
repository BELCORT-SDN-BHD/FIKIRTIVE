// Verifies the DB-layer backstop createVariant/renameVariant rely on: the PARTIAL
// UNIQUE index on EntityVariant (entityId, handle) WHERE deletedAt IS NULL. This is
// the race-proof guard against a duplicate-handle double-submit creating two paid
// variant jobs — proves: (1) a duplicate LIVE handle is rejected with P2002, and
// (2) soft-deleting a variant frees its handle for reuse. Local dev DB; no spend.
//
// (Action-level orchestration — validate-before-spend, transactional create, the
//  -N collision retry, soft-delete cascade — is covered by typecheck + Codex; this
//  script proves the load-bearing DB invariant without importing the "use server"
//  module, which pulls in next/cache + pg-boss and isn't node-importable cleanly.)
//
// Run: node scripts/archive/verify-phaseB-variant-actions.mjs
import { readFileSync } from "node:fs";

const envPath = new URL("../../packages/db/.env", import.meta.url);
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const { prisma } = await import("../../packages/db/dist/src/index.js");
const { newId } = await import("../../packages/core/dist/index.js");

try {
  const e = await prisma.entity.create({ data: { id: newId(), type: "CHARACTER", name: "PhaseB actions test" } });

  // 1. a duplicate LIVE (entityId, handle) must be rejected by the partial unique index
  await prisma.entityVariant.create({ data: { id: newId(), entityId: e.id, name: "Red", handle: "red", prompt: "x" } });
  let dupBlocked = false;
  try {
    await prisma.entityVariant.create({ data: { id: newId(), entityId: e.id, name: "Red 2", handle: "red", prompt: "y" } });
  } catch (err) {
    dupBlocked = typeof err === "object" && err !== null && err.code === "P2002";
  }

  // 2. soft-deleting the first frees the handle for reuse (WHERE deletedAt IS NULL)
  const first = await prisma.entityVariant.findFirst({ where: { entityId: e.id, handle: "red", deletedAt: null } });
  await prisma.entityVariant.update({ where: { id: first.id }, data: { deletedAt: new Date() } });
  let reused = false;
  try {
    await prisma.entityVariant.create({ data: { id: newId(), entityId: e.id, name: "Red 3", handle: "red", prompt: "z" } });
    reused = true;
  } catch {
    reused = false;
  }

  console.log("dup live handle blocked (P2002):", dupBlocked, "| handle reusable after soft-delete:", reused);
  if (!dupBlocked || !reused) {
    console.error("✗ partial-unique handle backstop failed", { dupBlocked, reused });
    process.exit(1);
  }
  console.log("✓ variant handle partial-unique backstop verified (the double-submit/double-spend guard)");
} finally {
  await prisma.$disconnect();
}
