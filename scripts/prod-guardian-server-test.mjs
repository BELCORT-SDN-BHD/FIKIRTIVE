// PROD server-Guardian backstop check — the money-safety net the UI E2E structurally
// can't reach (the client mirror intercepts before startGen). Calls the REAL server-side
// checkCast() against PROD data, proving the backstop itself BLOCKS a 0-ref CHARACTER and
// PASSES a character that has a reference — on prod, not just locally.
//
// READS-ONLY: creates nothing, deletes nothing, spends nothing (checkCast is a $0
// validation that returns a block WITHOUT creating a job). It reuses CHARACTERs already
// on prod (prefers the Pass 2 "Sloppy*" ones; falls back to any 0-ref / with-ref char).
//
// Run (server-only needs the react-server condition):
//   NODE_OPTIONS="--conditions=react-server" PROD_DATABASE_URL=<prod-neon-url> \
//     ./packages/core/node_modules/.bin/tsx scripts/prod-guardian-server-test.mjs
const PROD_DB = process.env.PROD_DATABASE_URL;
if (!PROD_DB) { console.error("PROD_DATABASE_URL is required"); process.exit(1); }
process.env.DATABASE_URL = PROD_DB;
const { prisma } = await import("../packages/db/dist/src/index.js");
const { checkCast } = await import("../apps/web/lib/cowork-guardian.ts");

const fail = (m) => { throw new Error(m); };
let ok = true;
try {
  const chars = await prisma.entity.findMany({
    where: { ownerId: "founder", type: "CHARACTER", deletedAt: null },
    select: { id: true, name: true, _count: { select: { referenceImages: { where: { deletedAt: null } } } } },
    orderBy: { createdAt: "desc" }, take: 80,
  });
  const noRef = chars.find((c) => c.name.startsWith("SloppyNoRef") && c._count.referenceImages === 0) || chars.find((c) => c._count.referenceImages === 0);
  const withRef = chars.find((c) => c.name.startsWith("SloppyRef") && c._count.referenceImages > 0) || chars.find((c) => c._count.referenceImages > 0);
  if (!noRef) fail("no 0-ref CHARACTER on prod to test the block (run prod-pass2-sloppy first)");
  if (!withRef) fail("no with-ref CHARACTER on prod to test the pass (run prod-pass2-sloppy first)");

  // 1) a CHARACTER with ZERO live refs → the prod server Guardian must BLOCK (the money-saver)
  const blocked = await checkCast({ projectId: "guardian-prod-check", entityIds: [noRef.id], model: "seedream", kind: "image" });
  if (!blocked || !blocked.error) fail(`prod server checkCast did NOT block 0-ref CHARACTER @${noRef.name}`);
  if (!blocked.report.findings.some((f) => f.kind === "character-no-refs")) fail("block had no character-no-refs finding");
  console.log(`✓ PROD server checkCast BLOCKED 0-ref @${noRef.name} → ${JSON.stringify(blocked.error).slice(0, 80)}`);

  // 2) a CHARACTER that HAS a reference → must PASS (additive-only, no over-block)
  const passed = await checkCast({ projectId: "guardian-prod-check", entityIds: [withRef.id], model: "seedream", kind: "image" });
  if (passed) fail(`prod server checkCast wrongly blocked with-ref CHARACTER @${withRef.name}`);
  console.log(`✓ PROD server checkCast PASSED with-ref @${withRef.name} (no over-block)`);
} catch (e) {
  ok = false; console.error("✗", e.message);
} finally {
  await prisma.$disconnect().catch(() => {});
}
if (!ok) process.exit(1);
console.log("\nPROD GUARDIAN BACKSTOP TEST PASSED — the server money-safety net blocks 0-ref + passes with-ref, on prod");
