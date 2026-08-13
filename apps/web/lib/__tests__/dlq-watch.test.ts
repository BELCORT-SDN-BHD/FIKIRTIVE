import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEAD_LETTER_QUEUES } from "@fikirtive/core";
import { checkDeadLetters, DEAD_LETTER_CACHE_MS } from "@/lib/dlq-watch";

/**
 * 巡检的缓存 / 上报 / 判定行为。
 *
 * r2(判官 r1 P2):这里以前 mock 掉 `getBoss`,于是「探针到底读的是什么」整段被绕开。
 * 现在只 mock 数据库这一层(`prisma.$queryRaw`),被测物 —— 取数、化验、缓存、上报 ——
 * 全程跑真的。SQL 本身跑不跑得动、读到的是不是 job 表真相,由 `dlq-watch-live.test.ts`
 * 拿真 Postgres + 真 pg-boss 钉住。
 */
const queryRaw = vi.fn();
const captureMessage = vi.fn();

vi.mock("@fikirtive/db", () => ({
  prisma: { $queryRaw: (...args: unknown[]) => queryRaw(...args) },
}));
vi.mock("@sentry/node", () => ({ captureMessage: (...args: unknown[]) => captureMessage(...args) }));

const emptyRows = () =>
  DEAD_LETTER_QUEUES.map((name) => ({ name, queuedCount: 0, deferredCount: 0, activeCount: 0 }));

/**
 * 模块级缓存是被测行为的一部分,不能重置掉。用不着 `vi.resetModules()`(那会让每个用例
 * 重新转译整张模块图,实测每条 ~1 秒):巡检的时钟是参数,把每个用例的起点推到上一条的
 * 缓存窗口之外就够了。
 */
let clock = 0;

beforeEach(() => {
  vi.clearAllMocks();
  queryRaw.mockResolvedValue(emptyRows());
  clock += 10 * DEAD_LETTER_CACHE_MS;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkDeadLetters", () => {
  /**
   * 探针问的是 job 表,不是 `pgboss.queue` 上那份只有 worker 才会刷新的缓存计数
   * (判官 r1 P1-2)。这条钉的是查询的**形状**;真值由 live 测试证。
   */
  it("asks the job table itself, not pg-boss's cached queue counters", async () => {
    await checkDeadLetters(clock);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const [fragments, ...values] = queryRaw.mock.calls[0] as [string[], ...unknown[]];
    const sql = fragments.join(" ");
    expect(sql).toContain("pgboss.job");
    expect(sql).not.toMatch(/queued_count|deferred_count|active_count/);
    expect(values[0]).toEqual([...DEAD_LETTER_QUEUES]);
  });

  it("is clear when every dead-letter queue exists and is empty", async () => {
    const census = await checkDeadLetters(clock);
    expect(census.status).toBe("clear");
    expect(census.total).toBe(0);
  });

  it("is backed-up and names the offender when a job was dead-lettered", async () => {
    queryRaw.mockResolvedValue([
      ...emptyRows().filter((r) => r.name !== "gen.dlq"),
      { name: "gen.dlq", queuedCount: 2, deferredCount: 0, activeCount: 0 },
    ]);
    const census = await checkDeadLetters(clock);
    expect(census.status).toBe("backed-up");
    expect(census.offenders).toEqual([{ queue: "gen.dlq", count: 2 }]);
  });

  // r2:缺席的队列曾经被算作健康。查不到自己要看的东西,只能说 unknown。
  it("is unknown — never clear — when a queue the probe watches is absent", async () => {
    queryRaw.mockResolvedValue(emptyRows().filter((r) => r.name !== "ingest.dlq"));
    const census = await checkDeadLetters(clock);
    expect(census.status).toBe("unknown");
    expect(census.missing).toEqual(["ingest.dlq"]);
  });

  // 免鉴权路由 + 每次都真查 = 谁都能拿它当 DB 压力源。
  it("serves a cached verdict inside the cache window instead of re-querying", async () => {
    await checkDeadLetters(clock);
    await checkDeadLetters(clock + DEAD_LETTER_CACHE_MS - 1);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("re-queries once the cache window has passed", async () => {
    await checkDeadLetters(clock);
    await checkDeadLetters(clock + DEAD_LETTER_CACHE_MS);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it("propagates a database failure instead of reporting a clean bill of health", async () => {
    queryRaw.mockRejectedValue(new Error("connect ECONNREFUSED"));
    await expect(checkDeadLetters(clock)).rejects.toThrow(/ECONNREFUSED/);
  });

  it("does not cache a failed read", async () => {
    queryRaw.mockRejectedValueOnce(new Error("down"));
    await expect(checkDeadLetters(clock)).rejects.toThrow();
    const census = await checkDeadLetters(clock);
    expect(census.status).toBe("clear");
  });
});

describe("dead-letter reporting", () => {
  const backedUp = () => [
    ...emptyRows().filter((r) => r.name !== "publish.dlq"),
    { name: "publish.dlq", queuedCount: 3, deferredCount: 0, activeCount: 0 },
  ];

  it("stays silent when no monitoring endpoint is configured", async () => {
    vi.stubEnv("SENTRY_DSN", "");
    queryRaw.mockResolvedValue(backedUp());
    await checkDeadLetters(clock);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("reports once per cache window, with counts in the payload and not the title", async () => {
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.example/2");
    queryRaw.mockResolvedValue(backedUp());

    await checkDeadLetters(clock);
    await checkDeadLetters(clock + 500); // inside the window — cached, so no second event
    expect(captureMessage).toHaveBeenCalledTimes(1);

    const [title, context] = captureMessage.mock.calls[0] as [string, Record<string, never>];
    expect(title).toBe("Dead-letter queues are not empty: publish.dlq");
    expect(title).not.toMatch(/\d/);
    expect(context).toMatchObject({
      level: "error",
      tags: { probe: "dead-letters" },
      extra: { status: "backed-up", total: 3, offenders: "publish.dlq=3" },
    });

    await checkDeadLetters(clock + DEAD_LETTER_CACHE_MS);
    expect(captureMessage).toHaveBeenCalledTimes(2);
  });

  // r2:一个探针查不到自己要看的队列,以前是彻底静音的 —— 503 只有拉探针的人看得到。
  it("also speaks up when a queue could not be read at all", async () => {
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.example/2");
    queryRaw.mockResolvedValue(emptyRows().filter((r) => r.name !== "ingest.dlq"));
    await checkDeadLetters(clock);

    const [title, context] = captureMessage.mock.calls[0] as [string, Record<string, never>];
    expect(title).toBe("Dead-letter queues could not be read: ingest.dlq");
    expect(context).toMatchObject({ extra: { status: "unknown", missing: "ingest.dlq" } });
  });

  it("never reports a clear census", async () => {
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.example/2");
    await checkDeadLetters(clock);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  // 死信里躺的是商家的活。上报只说「哪条队列、几条」,不带 owner/org/job payload。
  it("sends no merchant identity or job payload", async () => {
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.example/2");
    queryRaw.mockResolvedValue(backedUp());
    await checkDeadLetters(clock);
    const serialized = JSON.stringify(captureMessage.mock.calls[0]);
    for (const forbidden of ["ownerId", "orgId", "email", "data", "payload"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
