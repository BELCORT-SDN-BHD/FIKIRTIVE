/**
 * Artlio worker — long-lived pg-boss consumer (eng review D6/D9).
 *
 *   Postgres (pgboss schema) ──▶ ingest queue ──▶ hash verify → ffprobe → thumbs
 *                            └─▶ sweep queue  ──▶ D21 refcount purge (cron)
 *
 * pg-boss v12 rules honored here: explicit createQueue() before work(),
 * own `pgboss` schema (excluded from Prisma migrations), generous
 * expireInSeconds for multi-GB jobs, idempotent handlers (content-hash keys).
 */
import { PgBoss } from "pg-boss";
import { QUEUES } from "./queues.js";
import { handleIngest, type IngestJobData } from "./jobs/ingest.js";
import { handleRender } from "./jobs/render.js";
import type { RenderJobData } from "@artlio/core";

// Long-lived worker prefers the DIRECT url — a persistent process gains nothing
// from PgBouncer and the direct path avoids pooler quirks (audit P3).
const connectionString = process.env.DATABASE_URL || process.env.DATABASE_URL_POOLED;
if (!connectionString) {
  console.error("[worker] DATABASE_URL is not set — exiting");
  process.exit(1);
}

const boss = new PgBoss({
  connectionString,
  schema: "pgboss",
});

boss.on("error", (err) => console.error("[worker] pg-boss error:", err));

async function main(): Promise<void> {
  await boss.start();

  await boss.createQueue(`${QUEUES.ingest}.dlq`);
  await boss.createQueue(QUEUES.ingest, {
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 60 * 30, // multi-GB download + ffprobe headroom
    deadLetter: `${QUEUES.ingest}.dlq`,
  });
  await boss.createQueue(QUEUES.sweep);
  await boss.createQueue(`${QUEUES.render}.dlq`);
  await boss.createQueue(QUEUES.render, {
    retryLimit: 2,
    retryDelay: 20,
    retryBackoff: true,
    expireInSeconds: 60 * 15, // a cut render should never exceed the ffmpeg timeout
    deadLetter: `${QUEUES.render}.dlq`,
  });

  await boss.work<IngestJobData>(QUEUES.ingest, { batchSize: 1 }, async ([job]) => {
    if (!job) return;
    console.log(`[worker] ingest job ${job.id} start`, job.data);
    await handleIngest(job.data);
    console.log(`[worker] ingest job ${job.id} done`);
  });

  await boss.work<RenderJobData>(QUEUES.render, { batchSize: 1 }, async ([job]) => {
    if (!job) return;
    console.log(`[worker] render job ${job.id} start`, job.data);
    await handleRender(job.data);
    console.log(`[worker] render job ${job.id} done`);
  });

  // Heartbeat: the status panel's "worker alive" signal (appendix A).
  setInterval(() => console.log(`[worker] heartbeat ${new Date().toISOString()}`), 60_000);

  console.log("[worker] started — queues:", Object.values(QUEUES).join(", "));
}

// Graceful shutdown: finish in-flight work, then release pg connections.
// Re-entry guard: signals are often delivered twice (process-group kills, tsx watch).
let shuttingDown = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[worker] ${sig} — shutting down`);
    try {
      await boss.stop({ graceful: true, timeout: 30_000 });
      process.exit(0);
    } catch (err) {
      console.error("[worker] shutdown error:", err);
      process.exit(1);
    }
  });
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
