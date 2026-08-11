/**
 * THE Prisma client, on its own module.
 *
 * It used to live inside `index.ts`, and it moved here for one reason (#795): a module that must
 * reach the database even when `@fikirtive/db` has been REPLACED by a test double needs a path to
 * it that the double does not sit on.
 *
 * Dozens of apps/web test files mock the `@fikirtive/db` barrel wholesale, which is right for what
 * those files are about — they are testing an action's logic, not its storage. But the rate-limit
 * counter is not logic that can be stubbed away: a gate whose counter is unreachable REFUSES (it
 * fails closed, deliberately), so a stubbed barrel would turn every one of those files into a
 * cascade of "too many requests" failures that say nothing about the thing under test.
 *
 * So `rate-limit.ts` imports the client from HERE, and the barrel re-exports the very same object.
 * One client, one pool, one singleton — two import paths, and only one of them is the one the
 * doubles replace.
 *
 * Nothing else should import from this file. Every other module in the package keeps importing
 * `prisma` from `./index.js`, because those ARE the ones a test double is meant to stand in for.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { withTenantGuard } from "./tenant-guard.js";

function buildClient(): PrismaClient {
  // `||` not `??`: empty-string env vars (common in .env templates) must fall through.
  const url = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL (or DATABASE_URL_POOLED) is not set");
  const adapter = new PrismaPg(
    // Explicit pool ceiling per process. node-postgres defaults Pool.max to 10; with N
    // horizontally-scaled web/worker replicas that is N×10 connections against Neon's
    // budget. Tune DB_POOL_MAX per (replica-count × max) ≤ Neon pooled limit. Going
    // through the Neon -pooler (PgBouncer) endpoint multiplexes, so this app-side max is
    // the real cap to size. (scale audit 2026-06-20)
    { connectionString: url, max: Number(process.env.DB_POOL_MAX) || 10 },
    // pg-boss owns its own schema; Prisma stays on public (eng review D9)
    { schema: "public" },
  );
  // P3: tenant-guard backstop — warns (prod) / throws (test) on a tenant read with no
  // ownerId filter. Additive; never alters results. The explicit per-site filters + the
  // 2-org isolation test remain the primary guarantee.
  return withTenantGuard(new PrismaClient({ adapter }));
}

const globalForPrisma = globalThis as unknown as { __fikirtivePrisma?: PrismaClient };

let moduleClient: PrismaClient | undefined;

// globalThis cache only in development — the hot-reload pool leak this guards
// against only exists under `next dev`; caching under NODE_ENV=test would leak
// pools across vitest worker threads.
function getClient(): PrismaClient {
  if (process.env.NODE_ENV === "development") {
    return (globalForPrisma.__fikirtivePrisma ??= buildClient());
  }
  return (moduleClient ??= buildClient());
}

// Lazy proxy: `next build` imports this module while collecting page data with
// no DATABASE_URL present — the connection must not be built until first use.
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? (value as () => unknown).bind(client) : value;
  },
});
