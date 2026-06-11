// Focused refgen money-safety check ($0, DB-level, storage-agnostic) — verifies
// the codex-review hardening of handleRefGen without depending on storage or
// conditioning (the full happy path is covered by refgen-tracer.mjs):
//   - crash-after-spend: a redelivered GENERATING job (no outputAssetIds) fails
//     closed without re-spending (atomic claim loses → terminal FAILED)
//   - deleted-entity: validate-before-spend terminal-fails without a provider call
//   - FAILED is terminal on entry: a redelivered FAILED job never reprocesses
// Run from repo root with the worker (mock) + postgres up.
import { createRequire } from "node:module";
const require = createRequire(new URL("../apps/worker/package.json", import.meta.url));
const { PgBoss } = await import(require.resolve("pg-boss"));
const { prisma } = await import("../packages/db/dist/src/index.js");
const { REFGEN_QUEUE, REFGEN_DLQ, REFGEN_QUEUE_POLICY, newId } = await import("../packages/core/dist/index.js");

const DB = process.env.DATABASE_URL ?? "postgresql://artlio:artlio@localhost:5432/artlio";
process.env.DATABASE_URL = DB;
const OWNER = "founder";
const step = (m) => console.log(`✓ ${m}`);
const genCount = () => prisma.asset.count({ where: { source: "GENERATED", deletedAt: null } });
async function settle(id, secs = 20) {
  for (let i = 0; i < secs; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const row = await prisma.refGenJob.findUnique({ where: { id } });
    if (row.status === "FAILED" || row.status === "DONE") return row;
  }
  throw new Error(`refgen ${id} timed out`);
}

const boss = new PgBoss({ connectionString: DB, schema: "pgboss", supervise: false, schedule: false, max: 2 });
await boss.start();
await boss.createQueue(REFGEN_DLQ).catch(() => {});
await boss.createQueue(REFGEN_QUEUE, { ...REFGEN_QUEUE_POLICY }).catch(() => {});

// 1. crash-after-spend: GENERATING redelivery with no outputs → fail closed
{
  const e = await prisma.entity.create({ data: { id: newId(), ownerId: OWNER, type: "PRODUCT", name: "Interrupted" } });
  const before = await genCount();
  const ghost = await prisma.refGenJob.create({
    data: { id: newId(), ownerId: OWNER, entityId: e.id, prompt: "x", count: 4, model: "seedream", status: "GENERATING", startedAt: new Date(), attempts: 1 },
  });
  await boss.send(REFGEN_QUEUE, { refGenJobId: ghost.id });
  const row = await settle(ghost.id);
  if (row.status !== "FAILED") throw new Error(`crash-resume ended ${row.status}, expected FAILED`);
  if (!/interrupted/i.test(row.error)) throw new Error(`crash-resume error not the guard: "${row.error}"`);
  if (row.outputAssetIds.length !== 0) throw new Error("crash-resume produced outputs (spent!)");
  if ((await genCount()) !== before) throw new Error("crash-resume re-spent (new GENERATED asset)");
  step(`crash-after-spend: GENERATING redelivery fails closed, no re-spend`);
}

// 2. validate-before-spend: deleted entity terminal-fails without a provider call
{
  const e = await prisma.entity.create({ data: { id: newId(), ownerId: OWNER, type: "PRODUCT", name: "Doomed" } });
  const job = await prisma.refGenJob.create({ data: { id: newId(), ownerId: OWNER, entityId: e.id, prompt: "wasted", count: 4, model: "seedream" } });
  await prisma.entity.update({ where: { id: e.id }, data: { deletedAt: new Date() } });
  const before = await genCount();
  await boss.send(REFGEN_QUEUE, { refGenJobId: job.id });
  const row = await settle(job.id);
  if (row.status !== "FAILED") throw new Error(`deleted-entity ended ${row.status}, expected FAILED`);
  if (row.outputAssetIds.length !== 0 || (await genCount()) !== before) throw new Error("deleted-entity spent!");
  step(`deleted-entity terminal-fails without spending`);

  // 3. FAILED is terminal on entry: redelivering that FAILED job must no-op
  const before2 = await genCount();
  await boss.send(REFGEN_QUEUE, { refGenJobId: job.id });
  await new Promise((r) => setTimeout(r, 4000));
  const row2 = await prisma.refGenJob.findUnique({ where: { id: job.id } });
  if (row2.status !== "FAILED") throw new Error(`FAILED job changed to ${row2.status} on redelivery`);
  if ((await genCount()) !== before2) throw new Error("redelivered FAILED job re-spent");
  step(`FAILED is terminal on entry: redelivery no-ops, no re-spend`);
}

await boss.stop();
await prisma.$disconnect();
console.log("\nREFGEN MONEY-SAFETY PASSED (mock, $0)");
process.exit(0);
