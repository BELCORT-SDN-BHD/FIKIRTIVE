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

function buildClient(): PrismaClient {
  // `||` not `??`: empty-string env vars (common in .env templates) must fall through.
  const url = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL (or DATABASE_URL_POOLED) is not set");
  const adapter = new PrismaPg(
    { connectionString: url },
    // pg-boss owns its own schema; Prisma stays on public (eng review D9)
    { schema: "public" },
  );
  // P3: tenant-guard backstop — warns (prod) / throws (test) on a tenant read with no
  // ownerId filter. Additive; never alters results. The explicit per-site filters + the
  // 2-org isolation test remain the primary guarantee.
  return withTenantGuard(new PrismaClient({ adapter }));
}

const globalForPrisma = globalThis as unknown as { __artlioPrisma?: PrismaClient };

let moduleClient: PrismaClient | undefined;

// globalThis cache only in development — the hot-reload pool leak this guards
// against only exists under `next dev`; caching under NODE_ENV=test would leak
// pools across vitest worker threads.
function getClient(): PrismaClient {
  if (process.env.NODE_ENV === "development") {
    return (globalForPrisma.__artlioPrisma ??= buildClient());
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
