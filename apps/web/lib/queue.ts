import "server-only";
import { PgBoss } from "pg-boss";
import { RENDER_DLQ, RENDER_QUEUE, RENDER_QUEUE_POLICY, REFGEN_DLQ, REFGEN_QUEUE, REFGEN_QUEUE_POLICY, GEN_DLQ, GEN_QUEUE, GEN_QUEUE_POLICY } from "@artlio/core";

/**
 * Send-only pg-boss handle for the web side (producers). Same lazy-singleton
 * discipline as the Prisma client: nothing connects at import time (next
 * build collects pages with no DATABASE_URL), and dev hot-reload reuses one
 * instance via globalThis. The worker owns queue creation; senders only send.
 */
const globalForBoss = globalThis as unknown as { __artlioBoss?: Promise<PgBoss> };

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
  await boss.start();
  // idempotent, same policy as the worker: dispatch never races worker boot
  await boss.createQueue(RENDER_DLQ);
  await boss.createQueue(RENDER_QUEUE, { ...RENDER_QUEUE_POLICY });
  await boss.createQueue(REFGEN_DLQ);
  await boss.createQueue(REFGEN_QUEUE, { ...REFGEN_QUEUE_POLICY });
  await boss.createQueue(GEN_DLQ);
  await boss.createQueue(GEN_QUEUE, { ...GEN_QUEUE_POLICY });
  return boss;
}

let moduleBoss: Promise<PgBoss> | undefined;

export function getBoss(): Promise<PgBoss> {
  if (process.env.NODE_ENV === "development") {
    return (globalForBoss.__artlioBoss ??= buildBoss());
  }
  return (moduleBoss ??= buildBoss());
}
