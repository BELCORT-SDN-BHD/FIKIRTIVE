import "server-only";
import { PgBoss } from "pg-boss";
import { RENDER_DLQ, RENDER_QUEUE, RENDER_QUEUE_POLICY, REFGEN_DLQ, REFGEN_QUEUE, REFGEN_QUEUE_POLICY, GEN_DLQ, GEN_QUEUE, GEN_QUEUE_POLICY, CAPTION_DLQ, CAPTION_QUEUE, CAPTION_QUEUE_POLICY, RESEARCH_DLQ, RESEARCH_QUEUE, RESEARCH_QUEUE_POLICY, PUBLISH_DLQ, PUBLISH_QUEUE, PUBLISH_QUEUE_POLICY } from "@fikirtive/core";

/**
 * Send-only pg-boss handle for the web side (producers). Same lazy-singleton
 * discipline as the Prisma client: nothing connects at import time (next
 * build collects pages with no DATABASE_URL), and dev hot-reload reuses one
 * instance via globalThis. The worker owns queue creation; senders only send.
 *
 * Only a SUCCESSFUL build is cached (#700). A rejected promise left in the cache
 * turned one bad moment — web booting before the worker migrated the schema, a
 * pooler restart — into a permanent verdict: the queue recovered, this process
 * never did, and only a restart brought generation back. "Could not connect this
 * time" is a fact about one attempt, not a fact about the queue.
 */
const globalForBoss = globalThis as unknown as { __fikirtiveBoss?: BossCell };

async function buildBoss(): Promise<PgBoss> {
  const url = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL (or DATABASE_URL_POOLED) is not set");
  const boss = new PgBoss({
    connectionString: url,
    schema: "pgboss",
    // producer handle (codex review): no maintenance loops or cron scheduling
    // in the web process — the worker owns supervision and schema migration.
    // Deploy-order rule (launch checklist) guarantees the worker migrates first.
    supervise: false,
    schedule: false,
    migrate: false,
    max: 2,
  });
  boss.on("error", (err) => console.error("[web:pg-boss]", err));
  try {
    await boss.start();
    // idempotent, same policy as the worker: dispatch never races worker boot
    await boss.createQueue(RENDER_DLQ);
    await boss.createQueue(RENDER_QUEUE, { ...RENDER_QUEUE_POLICY });
    await boss.createQueue(REFGEN_DLQ);
    await boss.createQueue(REFGEN_QUEUE, { ...REFGEN_QUEUE_POLICY });
    await boss.createQueue(GEN_DLQ);
    await boss.createQueue(GEN_QUEUE, { ...GEN_QUEUE_POLICY });
    await boss.createQueue(CAPTION_DLQ);
    await boss.createQueue(CAPTION_QUEUE, { ...CAPTION_QUEUE_POLICY });
    await boss.createQueue(RESEARCH_DLQ);
    await boss.createQueue(RESEARCH_QUEUE, { ...RESEARCH_QUEUE_POLICY });
    await boss.createQueue(PUBLISH_DLQ);
    await boss.createQueue(PUBLISH_QUEUE, { ...PUBLISH_QUEUE_POLICY });
    return boss;
  } catch (err) {
    // A half-started handle still owns its connection pool. Because the next call
    // retries, an abandoned attempt that keeps its pool would leak one pool per
    // retry against the database — hand the connections back. Deliberately NOT
    // awaited: pool.end() against an unreachable host can sit on the TCP timeout,
    // and making the caller wait for that would turn a fast, honest failure into
    // a hang. The retry builds its own handle, so nothing waits on this one.
    void boss.stop({ graceful: false, close: true }).catch(() => {});
    throw err;
  }
}

// Retrying must not mean "one connect attempt per request": a queue that is
// genuinely down would then make every click pay a full connect timeout. A failed
// build is dropped from the cache and remembered only for a bounded cooldown that
// doubles 1s → 2s → 4s … up to 30s, so a sustained outage costs at most one attempt
// per 30s per process while recovery still needs no restart. A success clears it.
const RETRY_BACKOFF_BASE_MS = 1_000;
const RETRY_BACKOFF_MAX_MS = 30_000;

type BossCell = {
  /** In-flight or already-resolved build. Never holds a rejected promise. */
  handle?: Promise<PgBoss>;
  failures: number;
  cooldownUntil: number;
  lastError?: unknown;
};

const moduleCell: BossCell = { failures: 0, cooldownUntil: 0 };

function acquire(cell: BossCell): Promise<PgBoss> {
  if (cell.handle) return cell.handle;
  if (cell.failures > 0 && Date.now() < cell.cooldownUntil) {
    return Promise.reject(
      new Error("pg-boss handle is cooling down after a recent failure", { cause: cell.lastError }),
    );
  }
  // Concurrent callers still share one attempt — the cache is cleared only on reject.
  const attempt = buildBoss().then(
    (boss) => {
      cell.failures = 0;
      cell.cooldownUntil = 0;
      cell.lastError = undefined;
      return boss;
    },
    (err: unknown) => {
      cell.handle = undefined;
      cell.failures += 1;
      cell.lastError = err;
      cell.cooldownUntil =
        Date.now() +
        Math.min(RETRY_BACKOFF_MAX_MS, RETRY_BACKOFF_BASE_MS * 2 ** (cell.failures - 1));
      throw err;
    },
  );
  cell.handle = attempt;
  return attempt;
}

export function getBoss(): Promise<PgBoss> {
  if (process.env.NODE_ENV === "development") {
    return acquire((globalForBoss.__fikirtiveBoss ??= { failures: 0, cooldownUntil: 0 }));
  }
  return acquire(moduleCell);
}
