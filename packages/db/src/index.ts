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

export * from "../generated/prisma/client.js";

function buildClient(): PrismaClient {
  // `||` not `??`: empty-string env vars (common in .env templates) must fall through.
  const url = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL (or DATABASE_URL_POOLED) is not set");
  const adapter = new PrismaPg(
    { connectionString: url },
    // pg-boss owns its own schema; Prisma stays on public (eng review D9)
    { schema: "public" },
  );
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { __artlioPrisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.__artlioPrisma ?? buildClient();

// Cache only in development — the hot-reload pool leak this guards against only
// exists under `next dev`; caching under NODE_ENV=test would leak pools across
// vitest worker threads.
if (process.env.NODE_ENV === "development") globalForPrisma.__artlioPrisma = prisma;
