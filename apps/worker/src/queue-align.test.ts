/**
 * queue-align.test.ts — 判官 P1-2 修复的钉板(PR #1410 合并前收掉)。
 *
 * 不 mock pg-boss、不 mock 数据库:真 `pgboss.queue` 表、真 SQL。为什么必须是真库测试而不是
 * 断言常量——这条链的漏洞恰恰在「常量对不对」与「库里那一行是不是那个常量」之间:pg-boss
 * 12.18.2 的 `create_queue`(node_modules/.pnpm/pg-boss@12.18.2/node_modules/pg-boss/dist/
 * plans.js:381)以 `ON CONFLICT DO NOTHING` 收尾——GEN_QUEUE_POLICY.expireInSeconds 从
 * 20 分钟改到 40 分钟(#1386)这件事,对任何已经建过 `gen` 队列行的库(生产/staging 只要跑过
 * 旧代码一次)而言,单靠 `boss.createQueue()` 是**发了等于没发**:行里仍是旧值,作业过期时间
 * 仍从这一行快照,GEN_QUEUE_POLICY 常量与 clock-invariants.test.ts 的断言全部正确,却对不上
 * 生产库里正在发生的事。本文件用真 Postgres 模拟这个「跑过旧代码的库」,再跑一遍开机对齐,
 * 直接 SELECT 真表验证行被改写——不信 pg-boss 的类型化返回值,也不信常量本身。
 */
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAndAlignQueue, GEN_DLQ, GEN_QUEUE, GEN_QUEUE_POLICY, REFGEN_DLQ, REFGEN_QUEUE, REFGEN_QUEUE_POLICY } from "@fikirtive/core";

const DATABASE_URL = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;

let boss: PgBoss;

/** 直接读 pgboss.queue 这一行的 expire_seconds —— 用 pg-boss 的公开 `getDb()`(types.d.ts
 *  `IDatabase.executeSql`)发真 SQL,不经过 `getQueues()`/`getQueue()` 的字段映射,避免任何
 *  「其实读的是 pg-boss 自己某层缓存」的疑虑(dlq-watch-live.test.ts 记录过 `queuedCount` 那类
 *  字段确实是 supervisor 才刷新的缓存计数——`expire_seconds` 不是那一类,它是 create_queue /
 *  update_queue 直接写的列,但这里仍然选最没有争议的路径:直接 SELECT)。 */
async function readExpireSeconds(queueName: string): Promise<number | undefined> {
  const { rows } = await boss.getDb().executeSql(
    "SELECT expire_seconds FROM pgboss.queue WHERE name = $1",
    [queueName],
  );
  return rows[0]?.expire_seconds;
}

beforeAll(async () => {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set — this suite needs the *_test database");
  boss = new PgBoss({
    connectionString: DATABASE_URL,
    schema: "pgboss",
    supervise: false,
    schedule: false,
    migrate: true, // pgboss schema 由 pg-boss 自建,这条 suite 不碰 Prisma 的 public schema
    max: 2,
  });
  boss.on("error", () => {});
  await boss.start();
  // GEN_QUEUE_POLICY / REFGEN_QUEUE_POLICY 各带 deadLetter,createQueue 要求死信队列先存在
  // (manager.js createQueue → getQueueCache(options.deadLetter)) —— 与真实开机顺序一致
  // (apps/worker/src/index.ts、apps/web/lib/queue.ts 都是先建 *_DLQ 再建主队列)。
  await boss.createQueue(GEN_DLQ);
  await boss.createQueue(REFGEN_DLQ);
}, 120_000);

afterAll(async () => {
  await boss?.stop({ graceful: false, close: true });
});

describe("createAndAlignQueue — 已存在的队列行必须被对齐到新 policy(判官 P1-2,PR #1410)", () => {
  it("gen 队列:模拟「跑过旧代码的库」(20 分钟建的行)→ 对齐 → SELECT 真表证明已是 GEN_QUEUE_POLICY 的当前值(40 分钟)", async () => {
    // 每次跑这条用例都从空行开始(deleteQueue 幂等地清掉上一轮留下的行)——测试套件在同一个
    // 库上重跑多次时,ON CONFLICT DO NOTHING 本身会让「用旧值建行」这一步在已存在的行上悄悄
    // 变成 no-op,把下面要证的漏洞场景吃掉。
    await boss.deleteQueue(GEN_QUEUE);
    // 第一步:模拟生产/staging 里那一行 —— 用旧值(#1386 之前的 20 分钟)先建队列,就像
    // 一个跑过旧代码的进程已经做过的那样。
    await boss.createQueue(GEN_QUEUE, { ...GEN_QUEUE_POLICY, expireInSeconds: 60 * 20 });
    expect(await readExpireSeconds(GEN_QUEUE)).toBe(60 * 20);

    // 光靠 createQueue 复现判官点名的漏洞:ON CONFLICT DO NOTHING,旧值原地不动。
    await boss.createQueue(GEN_QUEUE, { ...GEN_QUEUE_POLICY });
    expect(await readExpireSeconds(GEN_QUEUE)).toBe(60 * 20); // 仍是旧值 —— 这就是判官描述的漏洞

    // 第二步:跑真正上线的那个函数(worker/web 开机都调它),传当前的 GEN_QUEUE_POLICY。
    await createAndAlignQueue(boss, GEN_QUEUE, GEN_QUEUE_POLICY);

    // 直接 SELECT pgboss.queue,不经任何 JS 侧常量比对 —— 库里这一行真的被改写成新值了。
    expect(await readExpireSeconds(GEN_QUEUE)).toBe(GEN_QUEUE_POLICY.expireInSeconds);
    // 这个当前值本身就是 40 分钟(#1386)——两条断言合起来钉死「常量是 40 分钟」且「库里的行
    // 也是 40 分钟」,而不只是其中一条。
    expect(GEN_QUEUE_POLICY.expireInSeconds).toBe(60 * 40);
  });

  it("refgen 队列:同一场景 —— 旧值建行 → 对齐 → SELECT 真表证明已是 REFGEN_QUEUE_POLICY 的当前值(40 分钟)", async () => {
    await boss.deleteQueue(REFGEN_QUEUE);
    await boss.createQueue(REFGEN_QUEUE, { ...REFGEN_QUEUE_POLICY, expireInSeconds: 60 * 20 });
    expect(await readExpireSeconds(REFGEN_QUEUE)).toBe(60 * 20);

    await createAndAlignQueue(boss, REFGEN_QUEUE, REFGEN_QUEUE_POLICY);

    expect(await readExpireSeconds(REFGEN_QUEUE)).toBe(REFGEN_QUEUE_POLICY.expireInSeconds);
    expect(REFGEN_QUEUE_POLICY.expireInSeconds).toBe(60 * 40);
  });

  it("再跑一次(下一次进程重启)是真正的收敛 —— 值不再变化,不是每次重启都往哪个方向漂", async () => {
    await createAndAlignQueue(boss, GEN_QUEUE, GEN_QUEUE_POLICY);
    expect(await readExpireSeconds(GEN_QUEUE)).toBe(GEN_QUEUE_POLICY.expireInSeconds);
  });

  it("对齐只碰它自己传的字段 —— retryLimit 等其余字段仍与 GEN_QUEUE_POLICY 当前值一致(COALESCE 行为,不是整行覆盖)", async () => {
    const { rows } = await boss.getDb().executeSql(
      "SELECT retry_limit, retry_delay, retry_backoff FROM pgboss.queue WHERE name = $1",
      [GEN_QUEUE],
    );
    expect(rows[0]).toMatchObject({
      retry_limit: GEN_QUEUE_POLICY.retryLimit,
      retry_delay: GEN_QUEUE_POLICY.retryDelay,
      retry_backoff: GEN_QUEUE_POLICY.retryBackoff,
    });
  });
});
