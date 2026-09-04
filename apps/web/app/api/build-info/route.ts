/**
 * /api/build-info — **发布身份**(Codex 全 beta 审计 P1-012)。
 *
 * 审计原话:staging 没有不可变的发布标识,工程师没法证明一次修复到底是在哪次部署上验的。
 * `/api/health` 的 `build:{sha,ref}`(2026-09-04 Codex staging 审计,见 lib/health.ts)只报
 * web 这一侧;这个端点把三件事拼成一份可引用的发布身份,供工程师核对「我看到的这次修复,
 * 是不是我以为的那次部署」:
 *
 *   - `web`        —— 这个进程的 commit sha / git ref / 从什么时候开始服务(`startedAt`)。
 *   - `worker`     —— 每一班还活着的心跳各报一行短 sha 与最近一次心跳时间(角色 id 即 `role`,
 *                     时间字段是 `at`)。
 *   - `migrations` —— 数据库真正跑到了哪一步:`_prisma_migrations` 最新一条成功记录的迁移
 *                     **id**(只取时间戳前缀,下划线后面的名字部分不报——见下面 `readLatestMigration`)
 *                     与完成时刻 `appliedAt`。
 *
 * 免鉴权(与 /api/health 同级,proxy.ts 的 auth-wall-ledger.ts 已把 `api/build-info` 列为豁免),
 * 但判官四轮 P1-1 指出:这**不是** `/api/health` 那份「只报状态词、不报时间戳」的零数据契约
 * (`app/api/health/route.ts:5`「只报 up/stale/unknown」、`:33`「只报一个词,不报 key 名、
 * 不报大小、不报时间戳」)——本端点如实报三个时间戳(`web.startedAt`、`worker[].at`、
 * `migrations.appliedAt`)、每个 worker 角色的短 sha 与迁移 id。这些时间戳本身就是这个端点
 * 存在的理由,不是顺带泄露:光有 sha 分不清「同一个 sha 的两次重启」与「真的换了新代码」,
 * `web.startedAt` 补上这一格;`worker[].at` 答的是「这一班此刻还活不活着」,与
 * `/api/health` 的 `worker` 状态词同一件事的另一种呈现;`migrations.appliedAt` 答的是「库结构
 * 追没追上代码」——这三者正是发布身份要核对的东西。仍然**零敏感字段**:不含
 * `configFingerprint`(那一格的比对纪律留在鉴权后的 admin 面,见 `lib/deploy-fingerprint.ts`),
 * 不含任何 env 变量名、路径或原始 env 值。
 *
 * 下游读取一律 `bestEffort` + `singleFlight`(与 /api/health 同一条纪律,见 lib/health.ts 的
 * 注释)——一次挂住的查询不该让这个端点跟着挂住,也不该在库持续挂住时把连接池顶垮。
 */
import { prisma } from "@fikirtive/db";
import { bestEffort, singleFlight } from "@/lib/health";
import { buildBuildInfoResponse, type HeartbeatRow, type LatestMigration } from "@/lib/build-info";

export const dynamic = "force-dynamic";

/** 这个 web 进程从什么时候开始服务——模块顶层只算一次,整个进程生命期不变。 */
const PROCESS_STARTED_AT = new Date();

const readHeartbeats = singleFlight(
  (): Promise<HeartbeatRow[]> => prisma.workerHeartbeat.findMany({ select: { id: true, commitSha: true, at: true } }),
);

/**
 * `_prisma_migrations` 是 Prisma 自己的迁移账本,不在 `schema.prisma` 里建模(没有对应
 * model),只能 `$queryRaw`。只取**成功**完成的那一条最新记录——`finished_at IS NOT NULL`;
 * 一条还在跑或跑失败的记录(`finished_at` 为空)不代表数据库已经到了那一步。
 *
 * 判官四轮 P1-1:这是一个匿名端点,`migration_name` 的下划线后半截是人写的迁移**描述**
 * (例如 `20260903120000_org_home_layout` 的 `org_home_layout`),会把「这次改的是什么」
 * 这种业务信息白送给没有会话的调用方——发布身份只需要**能排序、能对比**的一个 id,不需要
 * 这半截名字。`.replace(/_.*$/, "")` 把它切掉,只留时间戳前缀这个 id 本身。
 */
const readLatestMigration = singleFlight(async (): Promise<LatestMigration | null> => {
  const rows = await prisma.$queryRaw<{ migration_name: string; finished_at: Date }[]>`
    SELECT migration_name, finished_at
    FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL
    ORDER BY finished_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  return row ? { name: row.migration_name.replace(/_.*$/, ""), finishedAt: row.finished_at } : null;
});

export async function GET(): Promise<Response> {
  const [heartbeatRows, latestMigration] = await Promise.all([
    bestEffort(readHeartbeats),
    bestEffort(readLatestMigration),
  ]);
  const body = buildBuildInfoResponse({
    env: process.env,
    processStartedAt: PROCESS_STARTED_AT,
    now: new Date(),
    heartbeatRows,
    latestMigration,
  });
  return Response.json(body, { status: 200 });
}
