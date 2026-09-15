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

/** 会话时区钉死 UTC 的那一条启动参数。导出给结构性回归测试断言用。 */
export const SESSION_TIMEZONE_OPTION = "-c timezone=UTC";

/**
 * buildClient() 实际交给 pg 的连接池配置。
 *
 * 单独抽出来并导出,是因为这里有一条**静默**的坑,只有结构性断言抓得住:
 * pg 的 ConnectionParameters(node_modules/pg/lib/connection-parameters.js:60)执行
 *   config = Object.assign({}, config, parse(config.connectionString))
 * —— 连接串解析出来的字段盖在显式配置**之上**。所以连接串里只要带 `?options=…`
 * (Neon 文档里的 `options=endpoint%3D…` / `options=project%3D…` 就是这个形状),
 * 我们显式写的 `-c timezone=UTC` 会被整条替换掉,不报错、不警告。
 * 实测 pg 8.21.0:
 *   带 `?options=endpoint%3D…` → 生效 options = "endpoint=…",时区钉子消失。
 *
 * 所以这里**组合**而不是覆盖:把连接串里原有的 options 取出来,和时区钉子拼在一起,
 * 再把 options 从连接串里摘掉,免得它又盖回来。没带 options 的连接串(绝大多数情况)
 * 原样不动,不做 URL 往返,避免把密码里的特殊字符重新编码。
 */
export function buildPoolConfig(url: string): {
  connectionString: string;
  max: number;
  options: string;
} {
  // Explicit pool ceiling per process. node-postgres defaults Pool.max to 10; with N
  // horizontally-scaled web/worker replicas that is N×10 connections against Neon's
  // budget. Tune DB_POOL_MAX per (replica-count × max) ≤ Neon pooled limit. Going
  // through the Neon -pooler (PgBouncer) endpoint multiplexes, so this app-side max is
  // the real cap to size. (scale audit 2026-06-20)
  const max = Number(process.env.DB_POOL_MAX) || 10;

  let connectionString = url;
  let carried = "";
  try {
    const parsed = new URL(url);
    const existing = parsed.searchParams.get("options");
    if (existing !== null) {
      carried = existing.trim();
      parsed.searchParams.delete("options");
      connectionString = parsed.toString();
    }
  } catch {
    // 连接串不是 URL 解析得动的形状(例如 libpq 的 key=value 串):原样透传,
    // 仍然把钉子放进显式配置 —— 这种串不会被上面那条 Object.assign 盖掉。
  }

  const options = carried ? `${carried} ${SESSION_TIMEZONE_OPTION}` : SESSION_TIMEZONE_OPTION;
  return { connectionString, max, options };
}

function buildClient(): PrismaClient {
  // `||` not `??`: empty-string env vars (common in .env templates) must fall through.
  const url = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL (or DATABASE_URL_POOLED) is not set");
  const adapter = new PrismaPg(
    // 会话时区钉死 UTC。这不是测试便利,是写入正确性。
    // @prisma/adapter-pg@7.8.0 的 formatDateTime(dist/index.mjs:353)把 JS Date 序列化成
    // 「UTC 墙钟、但不带任何偏移」的裸字符串(例:2099-01-01 00:00:00)。timestamptz 列
    // 收到裸字符串时,Postgres 按**会话时区**去解释它 —— 于是服务端默认时区不是 UTC 时,
    // 每一个 Date 参数都整体漂移该时区的偏移量。
    // 实测(服务端默认 Asia/Kuala_Lumpur):Date("2099-01-01T00:00:00Z") 落库成 epoch
    // 4070880000,比正确的 4070908800 早 8 小时;同一个 Date 直接走裸 pg 驱动则落库正确。
    // 漂移同时打中 ORM 写入与 $queryRaw 绑定(两条路共用 adapter 的 mapArg),所以商家的
    // consent 发生时间、拒收过期时间这类时刻都会随「服务端装在哪个时区」而变。
    //
    // 为什么钉在启动包参数,而不是连上以后再 `SET TIME ZONE`:后者是会话状态,
    // 在任何做连接复用的中间层后面都不保证还在;启动包参数是建立连接时就带上的。
    //
    // 实测(2026-09-15,staging 的 Postgres 公网端点,只读事务):
    //   带这条 options → SHOW timezone = UTC,
    //                    pg_settings.TimeZone = {source: "client", setting: "UTC"}
    //   不带          → SHOW timezone = Etc/UTC,
    //                    pg_settings.TimeZone = {source: "configuration file"}
    // `source` 从 "configuration file" 变成 "client",就是「启动包参数真的被远端接受
    // 并生效了」的直接证据,不是推断。server_version 18.6。
    //
    // 未验证的部分,明写在这里:staging 的 Postgres 服务上**没有** DATABASE_URL_POOLED,
    // 所以上面这次实测走的是普通端点,不是 PgBouncer 池化端点。
    // 「PgBouncer 会透传 options 启动参数」这条来自上游文档、我们自己没验过,
    // 不要当成已证事实;等生产/staging 真有池化端点时补一次同样的 source 断言。
    // 详见 PR #1451 正文「复核修正」节。
    buildPoolConfig(url),
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
