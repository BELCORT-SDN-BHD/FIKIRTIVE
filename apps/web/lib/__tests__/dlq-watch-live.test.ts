/**
 * #793 r2 —— 死信探针的验收条件,拿真 Postgres + 真 pg-boss 钉住(判官 r1 P1-2 / P2)。
 *
 * 票面承诺的原话是:「放在 web 侧,worker 死透了它照样出声」。r1 的实现读的是
 * `PgBoss.getQueues()`,而那是 `pgboss.queue` 表里的**缓存计数**,只有 pg-boss 的
 * supervisor 会刷新它;web 侧的句柄 `supervise: false`,所以刷新只可能来自 worker。
 * 「worker 写完死信就死了」这一路——恰恰是本探针存在的理由——web 会无限期读到 0 并回 200。
 *
 * 所以这里的场地就是那个场景:**全程没有任何 supervisor 在跑**。下面第二条测试先证明
 * 旧真相源(缓存计数)此刻确实还是 0,再证明探针照样变红。这条测试在旧实现上必红。
 *
 * 不 mock 被测物,也不 mock 数据库:真表、真 job 行、真 SQL。
 */
import { PgBoss } from "pg-boss";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DEAD_LETTER_QUEUES } from "@fikirtive/core";
import { checkDeadLetters } from "@/lib/dlq-watch";

const QUEUES = [...DEAD_LETTER_QUEUES];
const DATABASE_URL = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;

let boss: PgBoss;

/** 巡检有 30 秒缓存,而缓存本身是被测行为 —— 每次探针把时钟推到窗口之外。 */
let clock = 0;
const probe = () => checkDeadLetters((clock += 60_000));

beforeAll(async () => {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set — this suite needs the *_test database");
  boss = new PgBoss({
    connectionString: DATABASE_URL,
    schema: "pgboss",
    // 关键:没有 supervisor。这就是「worker 死透了」的场地条件。
    supervise: false,
    schedule: false,
    migrate: true,
    max: 2,
  });
  boss.on("error", () => {});
  await boss.start();
  for (const queue of QUEUES) await boss.createQueue(queue);
}, 120_000);

afterEach(async () => {
  for (const queue of QUEUES) await boss.deleteAllJobs(queue);
});

afterAll(async () => {
  await boss?.stop({ graceful: false, close: true });
});

describe("dead-letter probe against a real queue", () => {
  it("answers clear when all seven queues exist and hold nothing", async () => {
    const census = await probe();
    expect(census).toMatchObject({ status: "clear", total: 0, offenders: [], missing: [], malformed: [] });
  });

  it("goes red on a real dead letter even though nothing ever refreshed pg-boss's counters", async () => {
    await boss.send("gen.dlq", {});

    // 旧真相源此刻的说法(判官 r1 P1-2 的实证):缓存计数还是 0,因为没有 supervisor。
    const cachedRow = (await boss.getQueues(["gen.dlq"]))[0];
    expect(cachedRow?.queuedCount).toBe(0);

    // 新真相源:job 表。同一时刻,同一个进程。
    const census = await probe();
    expect(census.status).toBe("backed-up");
    expect(census.offenders).toEqual([{ queue: "gen.dlq", count: 1 }]);
    expect(census.total).toBe(1);
  });

  it("counts each dead letter once, and names every offending queue", async () => {
    await boss.send("render.dlq", {});
    await boss.send("render.dlq", {});
    await boss.send("publish.dlq", {});

    const census = await probe();
    expect(census.offenders).toEqual([
      { queue: "render.dlq", count: 2 },
      { queue: "publish.dlq", count: 1 },
    ]);
    expect(census.total).toBe(3);
  });

  // 一条还没到点的死信(startAfter 在未来)仍然是「被放弃的活」,不许因为形态不同而漏报。
  it("sees a deferred dead letter too", async () => {
    await boss.send("caption.dlq", {}, { startAfter: 3_600 });
    const census = await probe();
    expect(census.status).toBe("backed-up");
    expect(census.offenders).toEqual([{ queue: "caption.dlq", count: 1 }]);
  });

  it("answers unknown — not clear — when a watched queue does not exist", async () => {
    await boss.deleteQueue("research.dlq");
    try {
      const census = await probe();
      expect(census.status).toBe("unknown");
      expect(census.missing).toEqual(["research.dlq"]);
    } finally {
      await boss.createQueue("research.dlq");
    }
  });

  // 只读:一次巡检不许在库里留下任何东西(免鉴权路由不能是写入路径)。
  it("writes nothing — the public probe is a read", async () => {
    const before = await boss.getQueues(QUEUES);
    await probe();
    const after = await boss.getQueues(QUEUES);
    expect(after.map((q) => q.name).sort()).toEqual(before.map((q) => q.name).sort());
    expect(after.map((q) => q.updatedOn?.toISOString())).toEqual(
      before.map((q) => q.updatedOn?.toISOString()),
    );
  });
});
