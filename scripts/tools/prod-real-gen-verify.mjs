// Real-generation PROD verification — enqueues real generations against production
// (Neon + the prod worker + prod R2) and confirms each produces output. The worker
// picks the provider from GENERATION_PROVIDER (prod = byteplus: Seedream image /
// Seedance video). SPENDS REAL MONEY (~$1.2): t2i x2 + 3x 5s seedance-2-mini 720p
// (≈$0.38 each, SEEDANCE_COGS_USD_PER_SECOND; #769 前跑 fast 时是 ≈$0.60 each / ~$1.9).
// Run AFTER deploy via:  railway run --service worker -- node scripts/tools/prod-real-gen-verify.mjs
import { interlock } from "./_interlock.mjs";
interlock({ spends: "~$1.9 — real generations (t2i x2 + i2v + t2v + last-frame i2v, 3x 5s Seedance 720p)", prod: "prod Neon DB + prod worker queue + prod R2" });
import { createRequire } from "node:module";
const require = createRequire(new URL("../../apps/worker/package.json", import.meta.url));
const { PgBoss } = await import(require.resolve("pg-boss"));
const { prisma } = await import("../../packages/db/dist/src/index.js");
const { GEN_QUEUE, GEN_DLQ, GEN_QUEUE_POLICY, newId, FOUNDER_OWNER_ID } = await import("../../packages/core/dist/index.js");

const DB = process.env.DATABASE_URL;
if (!DB) { console.error("DATABASE_URL not set — run via `railway run --service worker -- node ...`"); process.exit(1); }
if (!/neon|aws|amazonaws|railway/.test(DB)) console.log("· warning: DATABASE_URL doesn't look like prod —", DB.replace(/:[^@]*@/, ":***@"));
const OWNER = FOUNDER_OWNER_ID;
const step = (m) => console.log(`✓ ${m}`);

const boss = new PgBoss({ connectionString: DB, schema: "pgboss", supervise: false, schedule: false, max: 2 });
await boss.start();
await boss.createQueue(GEN_DLQ).catch(() => {});
await boss.createQueue(GEN_QUEUE, { ...GEN_QUEUE_POLICY }).catch(() => {});

async function enqueue(data) {
  const job = await prisma.genJob.create({ data: { id: newId(), ownerId: OWNER, count: 1, entityIds: [], ...data } });
  await boss.send(GEN_QUEUE, { genJobId: job.id });
  return job.id;
}
async function wait(id, label, secs = 300) {
  for (let i = 0; i < secs; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const row = await prisma.genJob.findUnique({ where: { id } });
    if (row.status === "DONE" || row.status === "FAILED") {
      if (row.status !== "DONE") throw new Error(`${label} FAILED: ${row.error}`);
      if (!row.generationIds.length) throw new Error(`${label} produced no output`);
      return row;
    }
  }
  throw new Error(`${label} timed out`);
}

const project = await prisma.project.create({ data: { id: newId(), ownerId: OWNER, name: "prod gen verify" } });
step(`project ${project.id}`);

// t2i x2 (Seedream) — real images on prod R2; sources for i2v + last-frame
const t2i = async (prompt) => (await wait(await enqueue({ projectId: project.id, prompt, kind: "IMAGE", model: "seedream" }), "t2i")).generationIds[0];
const g1 = await t2i("a lone lighthouse on a rocky cliff, dramatic sky, photoreal");
step("text-to-image #1 DONE (real Seedream)");
const g2 = await t2i("the same lighthouse, dawn light, calm sea, photoreal");
step("text-to-image #2 DONE (real Seedream)");

// i2v (Seedance) from g1
await wait(await enqueue({ projectId: project.id, prompt: "slow cinematic push-in, waves moving", kind: "VIDEO", model: "seedance-2-mini", sourceGenerationId: g1 }), "i2v");
step("image-to-video DONE (real Seedance, from the uploaded/generated still)");

// t2v (Seedance) from text
await wait(await enqueue({ projectId: project.id, prompt: "aerial over a stormy ocean at dusk, cinematic", kind: "VIDEO", model: "seedance-2-mini" }), "t2v");
step("text-to-video DONE (real Seedance)");

// last-frame i2v (Seedance, #646 T5 解禁) g1 → g2
await wait(await enqueue({ projectId: project.id, prompt: "transition from night to dawn", kind: "VIDEO", model: "seedance-2-mini", sourceGenerationId: g1, tailGenerationId: g2 }), "last-frame");
step("last-frame image-to-video DONE (real Seedance, start → end)");

await boss.stop();
await prisma.$disconnect();
console.log("\nREAL-GEN PROD VERIFY PASSED — t2i, i2v, t2v, last-frame all produced real output (~$1.9 spent)");
process.exit(0);
