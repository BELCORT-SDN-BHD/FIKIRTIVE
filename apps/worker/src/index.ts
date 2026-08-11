/**
 * Fikirtive worker — long-lived pg-boss consumer (eng review D6/D9).
 *
 *   Postgres (pgboss schema) ──▶ ingest queue ──▶ hash verify → ffprobe → thumbs
 *                            └─▶ sweep queue  ──▶ created for future D21 refcount purge;
 *                                                 NO producer, NO consumer yet (D21 deferred)
 *                                                 — do not assume it runs
 *
 * pg-boss v12 rules honored here: explicit createQueue() before work(),
 * own `pgboss` schema (excluded from Prisma migrations), generous
 * expireInSeconds for multi-GB jobs, idempotent handlers (content-hash keys).
 */
import * as Sentry from "@sentry/node";
import { PgBoss } from "pg-boss";
import { QUEUES } from "./queues.js";
import { handleIngest, redispatchLostIngest, type IngestJobData } from "./jobs/ingest.js";
import { handleRender } from "./jobs/render.js";
import { handleRefGen, reapStaleRefGenJobs } from "./jobs/refgen.js";
import { handleGen, reapStaleGenJobs } from "./jobs/gen.js";
import { backfillCanvasBoards } from "./jobs/canvas-backfill.js";
import { reapStaleLlmReservations } from "./jobs/llm-reservation-reaper.js";
import { reapExpiredAuthVerifications } from "./jobs/auth-verification-reaper.js";
import { handleCaption } from "./jobs/caption.js";
import { handleResearch, reapStaleResearchJobs } from "./jobs/research.js";
import { handlePublish, reapStalePublishAttempts, scanDuePublishPosts } from "./jobs/publish.js";
import { maybeRunNightlyBackup } from "./db-backup.js";
import { publishChainWarning } from "./publish-env-check.js";
import { assertWorkerEnv } from "./boot-env.js";
import { beatOnce } from "./heartbeat.js";
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
  RESEARCH_QUEUE,
  RESEARCH_DLQ,
  RESEARCH_QUEUE_POLICY,
  PUBLISH_QUEUE,
  PUBLISH_DLQ,
  PUBLISH_QUEUE_POLICY,
  type RenderJobData,
  type RefGenJobData,
  type GenJobData,
  type CaptionJobData,
  type ResearchJobData,
  type PublishJobData,
} from "@fikirtive/core";
import { runAsSystem } from "@fikirtive/db/principal";

// #797 env contract, fail-FAST: a production worker whose required configuration is missing, or
// whose values are the wrong shape, exits here instead of running jobs that will fail in odd
// places later. Outside production it only warns. (The fail-SOFT publish-chain check below asks
// a different question and stays.)
assertWorkerEnv();

// Long-lived worker prefers the DIRECT url — a persistent process gains nothing
// from PgBouncer and the direct path avoids pooler quirks (audit P3).
const connectionString = process.env.DATABASE_URL || process.env.DATABASE_URL_POOLED;
if (!connectionString) {
  console.error("[worker] DATABASE_URL is not set — exiting");
  process.exit(1);
}

// L1 publish-chain contract (spec §四), fail-SOFT: a half-configured chain (some secrets set, one
// missing) would silently fail every publish as an opaque NEEDS_ATTENTION, so surface it LOUDLY at
// boot — by variable NAME, never value. Never exits: the chain is inert until Meta App Review, so a
// fully-unset chain is the normal pre-launch state and must not take the whole worker down.
{
  const warning = publishChainWarning(process.env);
  if (warning) console.warn(warning);
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
  await boss.createQueue(RESEARCH_DLQ);
  await boss.createQueue(RESEARCH_QUEUE, { ...RESEARCH_QUEUE_POLICY });
  // L1 publish queue (Seam 6): SAME policy object as web (apps/web/lib/queue.ts) so boot order
  // can't split them. The consumer (boss.work) + scheduler + reaper land in the publish-worker
  // energize slice; for now the queue exists but nothing produces to it (fail-closed, inert).
  await boss.createQueue(PUBLISH_DLQ);
  await boss.createQueue(PUBLISH_QUEUE, { ...PUBLISH_QUEUE_POLICY });

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

  // Otto deep research (research S3, the MONEY CORE): bounded search→read→synthesize agent,
  // metered by ONE withLlmBudget. retryLimit:0 (RESEARCH_QUEUE_POLICY) + a status CAS in
  // handleResearch make any redelivery a no-op — a failed run does NOT auto-retry into the spend.
  await boss.work<{ jobId: string }>(
    RESEARCH_QUEUE,
    { batchSize: 1, includeMetadata: true },
    async ([job]) => {
      if (!job) return;
      console.log(`[worker] research job ${job.id} start (try ${job.retryCount + 1})`, job.data);
      await runHandler(() => handleResearch(job.data as ResearchJobData, job.retryCount));
      console.log(`[worker] research job ${job.id} done`);
    },
  );

  // L1 organic publish (spec §四A). One due, approved ScheduledPost per job → drives the shared
  // adapter orchestration. Fail-closed by construction: the scheduler below only enqueues posts
  // whose connection can publish RIGHT NOW, and the handler re-checks + triple-locks idempotency.
  await boss.work<PublishJobData>(
    PUBLISH_QUEUE,
    { batchSize: 1, includeMetadata: true },
    async ([job]) => {
      if (!job) return;
      console.log(`[worker] publish job ${job.id} start (try ${job.retryCount + 1})`, job.data);
      await runHandler(() => handlePublish(job.data, job.retryCount));
      console.log(`[worker] publish job ${job.id} done`);
    },
  );

  // Heartbeat: the status panel's "worker alive" signal (appendix A) + the durable
  // liveness row /api/health reads (2026-07-04 可观测性盲区修复). A failed write is
  // logged but never crashes the worker — health degrades to "stale", which is the signal.
  // The row now also carries this deploy's identity (commit sha + config fingerprint) so admin
  // can see when web and worker are NOT the same deploy — see ./heartbeat.ts (#797).
  setInterval(() => {
    console.log(`[worker] heartbeat ${new Date().toISOString()}`);
    void beatOnce();
  }, 60_000);
  void beatOnce(); // flip /api/health to "up" immediately on boot, not after the first minute

  // Reaper: jobs the worker hung/crashed on (no redelivery → the on-claim stale path
  // never runs) would sit GENERATING forever, holding the credit reservation and spinning
  // the UI. Sweep every 5 min — fail-close + refund + post a terminal message.
  let reaping = false; // re-entrancy guard — a long sweep must not overlap the next tick
  // #463: the whole tick carries a named system identity; each sub-reaper re-enters with its own
  // reason for its scan and with the row's tenant for each write (two-phase).
  const reap = async () => {
    if (reaping) return;
    reaping = true;
    try {
      await runAsSystem("worker-reaper-tick", async () => {
        const n = await reapStaleGenJobs();
        if (n) console.log(`[worker] reaped ${n} stale gen job(s)`);
        // #601: the LAST step of a delivered job — writing its cards onto the board — is
        // best-effort, so a merchant who was charged can still be looking at a half-empty board
        // if that write fell over. This is the retry behind it: money-free, it only re-runs the
        // same idempotent card writer for jobs whose board is provably incomplete.
        const cn = await backfillCanvasBoards();
        if (cn) console.log(`[worker] finished ${cn} incomplete canvas board(s)`);
        const rn = await reapStaleRefGenJobs();
        if (rn) console.log(`[worker] reaped ${rn} stale refgen job(s)`);
        const ln = await reapStaleLlmReservations();
        if (ln) console.log(`[worker] reaped ${ln} leaked LLM reservation(s)`);
        // #678: expired sign-in / verification / reset tokens. Nothing consumes them once they
        // lapse, and nothing used to delete them either, so the table only ever grew.
        const vn = await reapExpiredAuthVerifications();
        if (vn) console.log(`[worker] reaped ${vn} expired auth verification row(s)`);
        // Research: a worker SIGKILL'd mid-run (retryLimit:0 → no redelivery) strands the card
        // "Researching…" forever. Credits are already recovered by reapStaleLlmReservations above;
        // this flips the stranded RUNNING job → FAILED + its card → failed (pure UX, $0).
        const sn = await reapStaleResearchJobs();
        if (sn) console.log(`[worker] reaped ${sn} stale research job(s)`);
        // L1 publish (spec §四F): reconcile dangling APPLYING attempts (worker crashed mid-publish) —
        // query Meta's truth first, then PUBLISHED vs NEEDS_ATTENTION, never a blind re-post.
        const pn = await reapStalePublishAttempts();
        if (pn) console.log(`[worker] reconciled ${pn} dangling publish attempt(s)`);
        // F41(c): recover uploads whose ingest dispatch was lost (finalize commits
        // rows before the send). singletonKey dedupes while a re-send is in flight.
        const ri = await redispatchLostIngest((assetId) =>
          boss.send(QUEUES.ingest, { assetId } satisfies IngestJobData, { singletonKey: `ingest-recover:${assetId}` }),
        );
        if (ri) console.log(`[worker] re-dispatched ${ri} lost ingest job(s)`);
      });
    } catch (e) {
      console.error("[worker] reaper error:", e);
      captureError(e);
    } finally {
      reaping = false;
    }
  };
  // Nightly DB backup (P0-1②) rides the same 5-min tick: fail-soft by contract
  // (never throws), own re-entrancy flag inside the module, and its trigger rule
  // (KL >= 03:00 + key-not-in-R2) makes every extra call a cheap no-op.
  // #463: intentionally NOT wrapped in a principal frame — db-backup.ts makes zero Prisma
  // calls (pg_dump → R2). Do not flag it as a missing system context.
  setInterval(() => { void reap(); void maybeRunNightlyBackup(); }, 5 * 60_000);
  void reap(); // also sweep once on startup (clears anything stranded by a prior crash)
  void maybeRunNightlyBackup(); // startup check too — a worker restart must not skip a missed night

  // L1 publish scheduler (spec §四A): IG has no native scheduling, so we poll for due, approved
  // posts and enqueue them. The scan is canPublish-gated → before App Review it returns nothing,
  // so this is an inert no-op in prod (zero behavior change). singletonKey dedupes an id whose
  // previous publish is still in flight; the handler's triple idempotency is the real guard.
  let scheduling = false;
  // #463: the due-post scan spans every authorized tenant by design — a named system identity,
  // never a tenant one. The enqueue below carries only ids; the consumer resolves the owner.
  const schedule = async () => {
    if (scheduling) return;
    scheduling = true;
    try {
      await runAsSystem("publish-scheduler", async () => {
        const due = await scanDuePublishPosts();
        for (const scheduledPostId of due) {
          await boss.send(PUBLISH_QUEUE, { scheduledPostId } satisfies PublishJobData, { singletonKey: `publish:${scheduledPostId}` });
        }
        if (due.length) console.log(`[worker] enqueued ${due.length} due publish job(s)`);
      });
    } catch (e) {
      console.error("[worker] publish scheduler error:", e);
      captureError(e);
    } finally {
      scheduling = false;
    }
  };
  setInterval(() => void schedule(), 60_000);
  void schedule(); // sweep due posts once on startup too

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
