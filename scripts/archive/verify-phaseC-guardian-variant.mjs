// Verifies the DB query + block decision the Phase C guardian (apps/web/lib/cowork-guardian.ts
// checkCast) uses to validate @mentioned variants BEFORE spend. The guardian is a
// "server-only" module (pulls next/cache) so it isn't node-importable; this replicates its
// exact EntityVariant findFirst({ _count referenceImages where deletedAt:null }) + decision
// and asserts: a variant WITH a live ref passes, a variant with 0 refs blocks ("empty"),
// a soft-deleted variant blocks ("missing"), and a bogus id blocks ("missing"). Local dev
// DB, no spend. Action-level wiring (threading variantSel into checkCast) is covered by typecheck.
//
// Run: node scripts/archive/verify-phaseC-guardian-variant.mjs
import { readFileSync } from "node:fs";

const envPath = new URL("../../packages/db/.env", import.meta.url);
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const { prisma } = await import("../../packages/db/dist/src/index.js");
const { newId, FOUNDER_OWNER_ID } = await import("../../packages/core/dist/index.js");

// the guardian's exact lookup + decision (kept in sync with checkCast)
async function decide(entityId, variantId) {
  const v = await prisma.entityVariant.findFirst({
    where: { id: variantId, entityId, ownerId: FOUNDER_OWNER_ID, deletedAt: null },
    select: { name: true, _count: { select: { referenceImages: { where: { deletedAt: null } } } } },
  });
  if (!v) return "missing";
  if (v._count.referenceImages === 0) return "empty";
  return null; // ok — has >=1 live ref
}

const created = { assets: [], refs: [], variants: [], entities: [] };
try {
  const entity = await prisma.entity.create({ data: { id: newId(), type: "CHARACTER", name: "PhaseC guardian test" } });
  created.entities.push(entity.id);

  const mkVariant = async (name, handle) => {
    const v = await prisma.entityVariant.create({ data: { id: newId(), entityId: entity.id, ownerId: FOUNDER_OWNER_ID, name, handle, prompt: "x" } });
    created.variants.push(v.id);
    return v;
  };
  const addRef = async (variantId) => {
    const a = await prisma.asset.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, contentHash: "phaseC-" + newId(), ext: "png", mime: "image/png", sizeBytes: 1n, source: "GENERATED" } });
    const r = await prisma.referenceImage.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, entityId: entity.id, assetId: a.id, position: 0, variantId } });
    created.assets.push(a.id); created.refs.push(r.id);
    return r;
  };

  const withRef = await mkVariant("Red dress", "red-dress");
  await addRef(withRef.id);

  const noRef = await mkVariant("Blue suit", "blue-suit"); // never gets a ref

  const deleted = await mkVariant("Gone", "gone");
  await addRef(deleted.id); // even with a ref, a deleted variant must block
  await prisma.entityVariant.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });

  const r1 = await decide(entity.id, withRef.id);   // expect null (ok)
  const r2 = await decide(entity.id, noRef.id);      // expect "empty"
  const r3 = await decide(entity.id, deleted.id);    // expect "missing"
  const r4 = await decide(entity.id, "bogus" + newId()); // expect "missing"

  console.log("has-ref:", r1, "| no-ref:", r2, "| deleted:", r3, "| bogus:", r4);
  const ok = r1 === null && r2 === "empty" && r3 === "missing" && r4 === "missing";
  if (!ok) { console.error("✗ guardian variant decision failed an assertion"); process.exit(1); }
  console.log("✓ Phase C guardian: live variant passes; empty/deleted/bogus all block (fail-closed)");

  // char-no-refs base-count semantics (Codex round 2): an entity whose refs live ONLY
  // under a variant has zero BASE refs, so a BARE mention must read it as unanchored
  // (the worker conditions a bare mention on base refs only). Prove the query isolates them.
  const baseCount = await prisma.referenceImage.count({ where: { entityId: entity.id, variantId: null, deletedAt: null } });
  const allCount = await prisma.referenceImage.count({ where: { entityId: entity.id, deletedAt: null } });
  console.log("base refs:", baseCount, "| all refs:", allCount);
  if (!(baseCount === 0 && allCount > 0)) { console.error("✗ base-ref count did not isolate base from variant refs"); process.exit(1); }
  console.log("✓ char-no-refs uses BASE count: entity with only variant refs reads 0 base refs (a bare mention would block)");
} finally {
  // clean up this script's rows (refs → assets → variants → entity), respecting FKs
  for (const id of created.refs) await prisma.referenceImage.delete({ where: { id } }).catch(() => {});
  for (const id of created.assets) await prisma.asset.delete({ where: { id } }).catch(() => {});
  for (const id of created.variants) await prisma.entityVariant.delete({ where: { id } }).catch(() => {});
  for (const id of created.entities) await prisma.entity.delete({ where: { id } }).catch(() => {});
  await prisma.$disconnect();
}
