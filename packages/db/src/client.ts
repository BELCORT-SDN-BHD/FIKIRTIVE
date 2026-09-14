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
 * Nothing else in application code should import from this file. Every other module in the
 * package keeps importing `prisma` from `./index.js`, because those ARE the ones a test double is
 * meant to stand in for.
 *
 * IT IS AN EXPORTED ENTRY POINT (`@fikirtive/db/client`) FOR ONE REASON: a test that claims to
 * record EVERY database call the request path makes has to be able to reach this client too.
 * Tracing only the barrel leaves the limiter's calls invisible, and an invisible step is a step
 * where an address-dependent query could be added without the enumeration fence going red — see
 * apps/web/lib/__tests__/auth-enumeration-structural.test.ts, which mocks this entry point to
 * install its recorder at the single place both paths share.
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
    {
      connectionString: url,
      max: Number(process.env.DB_POOL_MAX) || 10,
      // 会话时区钉死 UTC。这不是测试便利,是写入正确性。
      // @prisma/adapter-pg@7.8.0 的 formatDateTime(dist/index.mjs:353)把 JS Date 序列化成
      // 「UTC 墙钟、但不带任何偏移」的裸字符串(例:2099-01-01 00:00:00)。timestamptz 列
      // 收到裸字符串时,Postgres 按**会话时区**去解释它 —— 于是服务端默认时区不是 UTC 时,
      // 每一个 Date 参数都整体漂移该时区的偏移量。
      // 实测(服务端默认 Asia/Kuala_Lumpur):Date("2099-01-01T00:00:00Z") 落库成 epoch
      // 4070880000,比正确的 4070908800 早 8 小时;同一个 Date 直接走裸 pg 驱动则落库正确。
      // 漂移同时打中 ORM 写入与 $queryRaw 绑定(两条路共用 adapter 的 mapArg),所以商家的
      // consent 发生时间、拒收过期时间这类时刻都会随「服务端装在哪个时区」而变。
      // 钉在启动包参数而不是 `SET TIME ZONE`:PgBouncer 事务池化下启动参数对每条后端连接
      // 都生效,而事后 SET 会随连接复用丢失。
      options: "-c timezone=UTC",
    },
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
