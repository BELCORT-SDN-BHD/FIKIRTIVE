/**
 * build-info — `/api/build-info` 的纯逻辑(Codex 全 beta 审计 P1-012:发布身份)。
 *
 * 审计原话:staging 没有不可变的发布标识,工程师没法证明一次修复到底是在哪次部署上验的。
 * `/api/health` 的 `build:{sha,ref}`(2026-09-04 Codex staging 审计,见 lib/health.ts 的
 * `buildInfo`)只回答了「web 这一侧」;这个端点把三件事拼成一份可引用的发布身份:
 *
 *   - web  —— 复用 `lib/health.ts` 的 `buildInfo`(同一对 `commitShaFrom`/`shortSha`,§7.3
 *             单一权威,不另起一套),外加这个进程从什么时候开始服务(`startedAt`)。
 *   - worker —— 每一班还活着的心跳(`WorkerHeartbeat`)各报一行短 sha 与最近一次心跳时间。
 *             刻意**不带** `configFingerprint`——那一格的比对纪律留在鉴权后的
 *             `lib/deploy-fingerprint.ts`(admin 面),这里是匿名端点。
 *   - migrations —— 数据库真正跑到了哪一步(`_prisma_migrations` 最新一条成功记录的迁移
 *             **id**,不带迁移名后缀——见 route.ts 的 `readLatestMigration`,那半截人写的
 *             描述文字不该白送给没有会话的调用方),而不是 `lib/boot-status.ts` 那句「这次
 *             启动跑成没跑成」的二元判断——两者答的是不同问题,后者今天没有别的地方能读到。
 *
 * 判官四轮 P1-1:这不是 `/api/health` 那份「只报状态词、不报时间戳」的零数据契约——本端点
 * 如实报三个时间戳(`web.startedAt`、`worker[].at`、`migrations.appliedAt`),因为这几个
 * 时间戳本身就是「哪次部署」这句话的组成部分:没有它们,两次共享同一个 sha 的部署(比如
 * 没有新提交的重启)分不清先后,一班 worker 死没死、库结构追没追上代码也都答不出来。
 * 仍然零敏感字段:不含 `configFingerprint`、env 变量名或任何商家数据。
 *
 * 纯函数,和 `lib/health.ts` 同一个理由:调用方(route.ts)负责去拿数据库/环境这些不纯的
 * 输入,这里只负责把它们拼成响应形状,方便单测覆盖每一种「读不到」的组合。
 */
import { shortSha } from "@fikirtive/core/env-contract";
import { buildInfo } from "@/lib/health";

export type BuildInfoWorkerRow = { role: string; sha: string | null; at: string };

export type BuildInfoMigrations = { latest: string | null; appliedAt: string | null };

export type BuildInfoResponse = {
  web: { sha: string | null; ref: string | null; startedAt: string };
  worker: BuildInfoWorkerRow[];
  migrations: BuildInfoMigrations;
  generatedAt: string;
};

/** 读心跳表拿到的一行,只取组成响应要用的三列——调用方选列即选中这个形状。 */
export type HeartbeatRow = { id: string; commitSha: string | null; at: Date };

/** `_prisma_migrations` 最新一条**成功**记录,读不到就是 `null`(调用方的 `bestEffort` 已处理)。
 *  `name` 这里已经是 route.ts 剥过后缀的迁移**id**(时间戳前缀),不是完整目录名——见
 *  route.ts 的 `readLatestMigration`;这个模块自己不做剥离,只负责原样传到响应里。 */
export type LatestMigration = { name: string; finishedAt: Date | null };

/**
 * 拼出 `/api/build-info` 的响应体。
 *
 * @param env              进程环境(转给 `buildInfo` 取 web 的 sha/ref)
 * @param processStartedAt 这个 web 进程的启动时刻(调用方在模块顶层算一次,整个进程生命期不变)
 * @param now              响应生成时刻
 * @param heartbeatRows    `WorkerHeartbeat.findMany()` 的结果;读不到(数据库故障/超时)传 `null`,
 *                         回一个空数组——「不知道」不等于「没有 worker」,但这个端点没有第三种状态
 *                         好报,空数组是最接近事实的写法(与 `/api/health` 的 `worker: "unknown"`
 *                         不同:那里有专门的 unknown 态,这里 worker 是一份列表,唯一诚实的「读不到」
 *                         表达就是「列不出一行」)。
 * @param latestMigration  `_prisma_migrations` 最新成功行;读不到或从未成功过都传 `null`。
 */
export function buildBuildInfoResponse(params: {
  env: Record<string, string | undefined>;
  processStartedAt: Date;
  now: Date;
  heartbeatRows: readonly HeartbeatRow[] | null;
  latestMigration: LatestMigration | null;
}): BuildInfoResponse {
  const web = buildInfo(params.env);
  const worker: BuildInfoWorkerRow[] = (params.heartbeatRows ?? []).map((row) => ({
    role: row.id,
    sha: shortSha(row.commitSha),
    at: row.at.toISOString(),
  }));
  return {
    web: { sha: web.sha, ref: web.ref, startedAt: params.processStartedAt.toISOString() },
    worker,
    migrations: {
      latest: params.latestMigration?.name ?? null,
      appliedAt: params.latestMigration?.finishedAt?.toISOString() ?? null,
    },
    generatedAt: params.now.toISOString(),
  };
}
