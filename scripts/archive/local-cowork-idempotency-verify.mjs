// LOCAL verification of the Cowork card "exactly-once-EVER" money-safety fix.
// The bug Codex found: coworkGenerate's any-status idempotency READ is not atomic with
// startGen's INSERT, and the general unique index is ACTIVE-only — so a TOCTOU race where
// the first job reaches DONE before the second inserts could create (and pay for) a 2nd job.
// The fix: migration 20260617000000 adds GenJob_cowork_idempotency_once — an ALL-status
// partial UNIQUE index on cowork:<cardId> keys. This proves it at the DB level (no worker,
// no spend): a 2nd insert of a DONE cowork key is rejected (P2002); a general key is NOT.
// Run:  node scripts/archive/local-cowork-idempotency-verify.mjs
import { randomUUID } from "node:crypto";

process.env.DATABASE_URL ??= "postgresql://artlio:artlio@localhost:5432/artlio";
const { prisma } = await import("../../packages/db/dist/src/index.js");

const OWNER = "founder";
const projectId = `idem-test-${randomUUID()}`;
const fail = (m) => { throw new Error(m); };
const isP2002 = (e) => typeof e === "object" && e !== null && e.code === "P2002";

const base = (idempotencyKey, status) => ({
  id: randomUUID(), ownerId: OWNER, projectId, prompt: "test", idempotencyKey, status,
});

let passed = false;
try {
  // --- Case 1: a cowork:<cardId> key is EXACTLY-ONCE-EVER ---
  const coworkKey = `cowork:${randomUUID()}`;
  await prisma.genJob.create({ data: base(coworkKey, "DONE") }); // first job, already finished
  let rejected = false;
  try {
    await prisma.genJob.create({ data: base(coworkKey, "QUEUED") }); // the TOCTOU re-insert
  } catch (e) {
    if (!isP2002(e)) throw e;
    rejected = true;
  }
  if (!rejected) fail("REGRESSION: a 2nd insert of a DONE cowork key was NOT rejected — double-spend window open");
  const coworkCount = await prisma.genJob.count({ where: { projectId, idempotencyKey: coworkKey } });
  if (coworkCount !== 1) fail(`expected exactly 1 cowork job, found ${coworkCount}`);
  console.log("✓ cowork key: 2nd insert after DONE rejected at DB (exactly-once-ever)");

  // --- Case 2: a general (shot-frame) key is unchanged — re-gen after DONE still allowed ---
  const generalKey = `frame:${randomUUID()}:0`;
  await prisma.genJob.create({ data: base(generalKey, "DONE") });
  await prisma.genJob.create({ data: base(generalKey, "QUEUED") }); // must SUCCEED (active-only index)
  const generalCount = await prisma.genJob.count({ where: { projectId, idempotencyKey: generalKey } });
  if (generalCount !== 2) fail(`REGRESSION: general key should allow re-gen after DONE, found ${generalCount} jobs (expected 2)`);
  console.log("✓ general key: re-gen after DONE still allowed (active-only index untouched)");

  passed = true;
} catch (e) {
  console.error("✗", e.message);
} finally {
  await prisma.genJob.deleteMany({ where: { projectId } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
}
if (!passed) process.exit(1);
console.log("LOCAL COWORK IDEMPOTENCY FIX VERIFIED");
process.exit(0);
