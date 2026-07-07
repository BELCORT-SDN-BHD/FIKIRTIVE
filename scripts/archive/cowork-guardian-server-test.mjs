// SERVER Guardian backstop test (the money-safety net the UI E2E can't reach,
// because the client mirror intercepts first). Calls the real server-side
// checkCast() directly against the real DB — proving the backstop BLOCKS a paid
// generation on a 0-ref CHARACTER and PASSES a character that has a reference.
// Run: node --import tsx --conditions=react-server scripts/archive/cowork-guardian-server-test.mjs
process.env.DATABASE_URL ??= "postgresql://fikirtive:fikirtive@localhost:5432/fikirtive";
const { prisma } = await import("../../packages/db/dist/src/index.js");
const { newId } = await import("../../packages/core/dist/index.js");
const { checkCast } = await import("../../apps/web/lib/cowork-guardian.ts");

const tag = Date.now().toString(36);
const project = await prisma.project.create({ data: { id: newId(), ownerId: "founder", name: "Guardian server test " + tag } });
const noRef = await prisma.entity.create({ data: { id: newId(), ownerId: "founder", type: "CHARACTER", name: "NoRefSrv" + tag } });
const asset = await prisma.asset.create({ data: { id: newId(), ownerId: "founder", contentHash: "srvtest" + tag, ext: "png", mime: "image/png", sizeBytes: 1n, source: "UPLOAD" } });
const withRef = await prisma.entity.create({ data: { id: newId(), ownerId: "founder", type: "CHARACTER", name: "WithRefSrv" + tag } });
const ref = await prisma.referenceImage.create({ data: { id: newId(), ownerId: "founder", entityId: withRef.id, assetId: asset.id } });

let ok = true;
try {
  // 1) a CHARACTER with ZERO refs → server Guardian must BLOCK (the money-saver)
  const blocked = await checkCast({ projectId: project.id, entityIds: [noRef.id], model: "seedream", kind: "image" });
  if (!blocked || !blocked.error) throw new Error("server checkCast did NOT block a 0-ref CHARACTER");
  if (!blocked.report.findings.some((f) => f.kind === "character-no-refs")) throw new Error("block had no character-no-refs finding");
  console.log("✓ server checkCast BLOCKED a 0-ref CHARACTER →", JSON.stringify(blocked.error).slice(0, 70));

  // 2) a CHARACTER that HAS a reference → server Guardian must PASS (additive-only)
  const passed = await checkCast({ projectId: project.id, entityIds: [withRef.id], model: "seedream", kind: "image" });
  if (passed) throw new Error("server checkCast wrongly blocked a CHARACTER that has a reference");
  console.log("✓ server checkCast PASSED a CHARACTER with a reference (no over-block)");
} catch (e) {
  ok = false; console.error("✗", e.message);
} finally {
  await prisma.referenceImage.deleteMany({ where: { id: ref.id } }).catch(() => {});
  await prisma.entity.deleteMany({ where: { id: { in: [noRef.id, withRef.id] } } }).catch(() => {});
  await prisma.asset.deleteMany({ where: { id: asset.id } }).catch(() => {});
  await prisma.project.delete({ where: { id: project.id } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
}
if (!ok) process.exit(1);
console.log("\nSERVER GUARDIAN BACKSTOP TEST PASSED — the money-safety net blocks 0-ref + passes with-ref, server-side");
