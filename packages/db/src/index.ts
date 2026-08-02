/**
 * Prisma 7 client wired through @prisma/adapter-pg (driver adapters are
 * mandatory in v7 — no Rust engine).
 *
 * URL discipline (eng review D7):
 *   - runtime  → DATABASE_URL_POOLED (Neon -pooler endpoint) falling back to DATABASE_URL
 *   - migrate  → DATABASE_URL (direct), used by prisma.config.ts / CLI only
 *
 * Singleton via globalThis so Next.js dev hot-reload doesn't leak pools.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { withTenantGuard } from "./tenant-guard.js";

export * from "../generated/prisma/client.js";
export { reserveCredits, settleCredits, refundReservation, grantCredits, grantCreditsTx, InsufficientCredits, type CreditGrantSource } from "./credits.js";
// #601: the server writes a finished job's canvas cards. Not a spend path — see the file header.
export {
  settleCanvasCardsForGenJob,
  findCanvasSettlementBacklog,
  canvasJobPlacementLockKey,
  type CanvasSettlementOutcome,
  type CanvasSettlementBacklogJob,
  type CanvasSettlementBacklogCursor,
  type CanvasSettlementBacklogPage,
} from "./canvas-settlement.js";
export * from "./consent-fold.js";
export * from "./consent-runtime.js";
export * from "./send-eligibility.js";

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

export * from "./message-delivery-reconciliation.js";
export * from "./workflow-compiler.js";
export * from "./workflow-business-hours.js";
export * from "./workflow-engine.js";
export * from "./workflow-journey.js";
