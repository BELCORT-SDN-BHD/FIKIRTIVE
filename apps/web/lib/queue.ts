import "server-only";
import { PgBoss } from "pg-boss";

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
  const boss = new PgBoss({ connectionString: url, schema: "pgboss" });
  boss.on("error", (err) => console.error("[web:pg-boss]", err));
  await boss.start();
  return boss;
}

let moduleBoss: Promise<PgBoss> | undefined;

export function getBoss(): Promise<PgBoss> {
  if (process.env.NODE_ENV === "development") {
    return (globalForBoss.__artlioBoss ??= buildBoss());
  }
  return (moduleBoss ??= buildBoss());
}
