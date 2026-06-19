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
import * as Sentry from "@sentry/node";
import { PgBoss } from "pg-boss";
import { QUEUES } from "./queues.js";
import { handleIngest, type IngestJobData } from "./jobs/ingest.js";
import { handleRender } from "./jobs/render.js";
import { handleRefGen } from "./jobs/refgen.js";
import { handleGen } from "./jobs/gen.js";
import { handleCaption } from "./jobs/caption.js";
import {
  RENDER_DLQ,
  RENDER_QUEUE_POLICY,
  REFGEN_QUEUE,
  REFGEN_DLQ,
  REFGEN_QUEUE_POLICY,
  GEN_QUEUE,
  GEN_DLQ,
  GEN_QUEUE_POLICY,
  CAPTION_DLQ,
  CAPTION_QUEUE_POLICY,
  type RenderJobData,
  type RefGenJobData,
  type GenJobData,
  type CaptionJobData,
} from "@artlio/core";

// Long-lived worker prefers the DIRECT url — a persistent process gains nothing
// from PgBouncer and the direct path avoids pooler quirks (audit P3).
const connectionString = process.env.DATABASE_URL || process.env.DATABASE_URL_POOLED;
if (!connectionString) {
  console.error("[worker] DATABASE_URL is not set — exiting");
  process.exit(1);
}

// Minimal error monitoring (closed-beta P0). No-op unless SENTRY_DSN is set.
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0, environment: process.env.NODE_ENV });
}
// Non-fatal capture (e.g. pg-boss errors) — log + report, keep running.
const captureError = (err: unknown) => { if (process.env.SENTRY_DSN) Sentry.captureException(err); };
// Fatal capture: a worker in an unknown state should crash (Railway restarts it) — the
// SAME default Node behavior, but flushed to Sentry first. (Adding a handler otherwise
// suppresses Node's default crash-on-fatal, which would leave a wedged process running.)
const fatal = (label: string) => (err: unknown) => {
  console.error(`[worker] ${label}:`, err);
  if (!process.env.SENTRY_DSN) { process.exit(1); return; }
  Sentry.captureException(err);
  void Sentry.flush(2000).catch(() => {}).finally(() => process.exit(1));
};
process.on("unhandledRejection", fatal("unhandledRejection"));
process.on("uncaughtException", fatal("uncaughtException"));

// Report UNEXPECTED job errors (provider/store/parse failures that throw) to Sentry, then
// rethrow so pg-boss still owns retry/fail bookkeeping. Expected "return-style" terminal
// FAILEDs (deleted project/shot/entity, etc.) don't throw and correctly stay out of Sentry.
async function runHandler<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (err) { captureError(err); throw err; }
}

const boss = new PgBoss({
  connectionString,
  schema: "pgboss",
});

boss.on("error", (err) => { console.error("[worker] pg-boss error:", err); captureError(err); });

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
  await boss.createQueue(RENDER_DLQ);
  await boss.createQueue(QUEUES.render, { ...RENDER_QUEUE_POLICY });
  await boss.createQueue(REFGEN_DLQ);
  await boss.createQueue(REFGEN_QUEUE, { ...REFGEN_QUEUE_POLICY });
  await boss.createQueue(GEN_DLQ);
  await boss.createQueue(GEN_QUEUE, { ...GEN_QUEUE_POLICY });
  await boss.createQueue(CAPTION_DLQ);
  await boss.createQueue(QUEUES.caption, { ...CAPTION_QUEUE_POLICY });

  await boss.work<IngestJobData>(QUEUES.ingest, { batchSize: 1 }, async ([job]) => {
    if (!job) return;
    console.log(`[worker] ingest job ${job.id} start`, job.data);
    await runHandler(() => handleIngest(job.data));
    console.log(`[worker] ingest job ${job.id} done`);
  });

  // includeMetadata: retryCount drives the FAILED-vs-requeue status decision
  await boss.work<RenderJobData>(
    QUEUES.render,
    { batchSize: 1, includeMetadata: true },
    async ([job]) => {
      if (!job) return;
      console.log(`[worker] render job ${job.id} start (try ${job.retryCount + 1})`, job.data);
      await runHandler(() => handleRender(job.data, job.retryCount));
      console.log(`[worker] render job ${job.id} done`);
    },
  );

  await boss.work<RefGenJobData>(
    REFGEN_QUEUE,
    { batchSize: 1, includeMetadata: true },
    async ([job]) => {
      if (!job) return;
      console.log(`[worker] refgen job ${job.id} start (try ${job.retryCount + 1})`, job.data);
      await runHandler(() => handleRefGen(job.data, job.retryCount));
      console.log(`[worker] refgen job ${job.id} done`);
    },
  );

  await boss.work<GenJobData>(
    GEN_QUEUE,
    { batchSize: 1, includeMetadata: true },
    async ([job]) => {
      if (!job) return;
      console.log(`[worker] gen job ${job.id} start (try ${job.retryCount + 1})`, job.data);
      await runHandler(() => handleGen(job.data, job.retryCount));
      console.log(`[worker] gen job ${job.id} done`);
    },
  );

  // $0 caption job ($0 — whisper.cpp only, NEVER fal): SEPARATE queue from render
  // so a slow transcribe never blocks a render.
  await boss.work<CaptionJobData>(
    QUEUES.caption,
    { batchSize: 1, includeMetadata: true },
    async ([job]) => {
      if (!job) return;
      console.log(`[worker] caption job ${job.id} start (try ${job.retryCount + 1})`, job.data);
      await runHandler(() => handleCaption(job.data, job.retryCount));
      console.log(`[worker] caption job ${job.id} done`);
    },
  );

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
