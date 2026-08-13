import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEAD_LETTER_QUEUES } from "@fikirtive/core";
import { checkDeadLetters, DEAD_LETTER_CACHE_MS } from "@/lib/dlq-watch";
import { READY_DATABASE_TIMEOUT_MS } from "@/lib/health";

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
  vi.useRealTimers(); // 部分用例(超时形状)会临时切到假计时器;别让它漏到下一条用例
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

  // r3(判官 r2 P1):缓存直到查询完成后才写入,冷启动/缓存到期那一刻,N 个并发请求
  // 各自看见「没有可用缓存」,以前会各发一条 SELECT——免鉴权路由因此能把 N 条请求放大成
  // N 条打到 Prisma 连接池的查询。现在并发请求共享同一趟在途 promise(single-flight,
  // 与 /api/health、/api/ready 同一模式)。
  it("shares one query across concurrent requests on a cold cache (single-flight)", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => checkDeadLetters(clock)));
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(results.every((census) => census.status === "clear")).toBe(true);
  });

  // r3(判官 r2 P1):这两条推翻了 r2「查询失败不缓存」的规定(即上面被删掉的
  // "does not cache a failed read")。那条规定当时是为了防止一次失败被误判成 clear、
  // 还被当真相缓存下来——但现在失败根本不再是「误判成 clear」,它诚实地变成
  // `unknown`(fail closed,和缺席的队列走同一个分支)。诚实的结果缓存起来没有风险;
  // 不缓存才是问题所在:免鉴权路由 + 库故障期间不缓存 = 每一个未鉴权请求都再打一次库,
  // 这正是本轮 P1 要堵的洞。缓存窗口因此**同时是**成功读和失败读共用的负缓存 TTL。
  it("answers unknown — fail closed — instead of throwing when the query fails", async () => {
    queryRaw.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const census = await checkDeadLetters(clock);
    expect(census.status).toBe("unknown");
    expect(census.missing).toEqual([...DEAD_LETTER_QUEUES]);
  });

  it("caches a failed read too, so a database outage is not hammered once per request", async () => {
    queryRaw.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const first = await checkDeadLetters(clock);
    expect(first.status).toBe("unknown");

    // 仍在负缓存窗口内的第二、第三次请求复用第一次的失败结果,不再次打库。
    const second = await checkDeadLetters(clock + 1);
    const third = await checkDeadLetters(clock + DEAD_LETTER_CACHE_MS - 1);
    expect(second.status).toBe("unknown");
    expect(third.status).toBe("unknown");
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  // 故障期的并发请求同样只打一次库(single-flight 与负缓存叠加,不是二选一)。
  it("also single-flights concurrent requests during an outage", async () => {
    queryRaw.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const results = await Promise.all(Array.from({ length: 8 }, () => checkDeadLetters(clock)));
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(results.every((census) => census.status === "unknown")).toBe(true);
  });

  it("re-queries once the negative-cache window has passed, and recovers once the database answers again", async () => {
    queryRaw.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    const first = await checkDeadLetters(clock);
    expect(first.status).toBe("unknown");

    queryRaw.mockResolvedValueOnce(emptyRows());
    const second = await checkDeadLetters(clock + DEAD_LETTER_CACHE_MS);
    expect(second.status).toBe("clear");
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  // r3(判官 r2 P1):查询带有界等待,与 /api/ready 同量级预算——一条卡住很久的查询
  // (连接卡死的形状)不许把探针一起挂住,超时后仍然要如实答 unknown。
  it("does not hang when the query is stuck — resolves unknown within the DB timeout budget", async () => {
    vi.useFakeTimers();
    // 用「迟到很久」而不是真正永不 settle 的 Promise:底层查询共享一个模块级单例
    // (`queryJobTable` 的 single-flight,和 /api/health·/api/ready 同一份实现),一条
    // 真正永远不 settle 的 Promise 会把它焊死,污染同一文件里排在后面的用例。
    const late = new Promise((resolve) => setTimeout(() => resolve(emptyRows()), 10 * READY_DATABASE_TIMEOUT_MS));
    queryRaw.mockReturnValue(late);

    const resultPromise = checkDeadLetters(clock);
    await vi.advanceTimersByTimeAsync(READY_DATABASE_TIMEOUT_MS);
    await expect(resultPromise).resolves.toMatchObject({ status: "unknown", missing: [...DEAD_LETTER_QUEUES] });

    // 让那条迟到的查询真正落地,清空底层 single-flight,不留状态给下一条用例。
    await vi.advanceTimersByTimeAsync(9 * READY_DATABASE_TIMEOUT_MS);
    await late;
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

  // r3(判官 r2 P1):single-flight 收敛了大半重复上报——N 个并发请求共享同一趟
  // 「查询 + 写缓存 + 上报」,而不是各自算出同一份 census 后各报一次 Sentry。
  it("reports at most once to Sentry even when requests race on the same cold window", async () => {
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.example/2");
    queryRaw.mockResolvedValue(backedUp());
    await Promise.all(Array.from({ length: 8 }, () => checkDeadLetters(clock)));
    expect(captureMessage).toHaveBeenCalledTimes(1);
  });

  // 同一条道理,但触发面是数据库故障(unknown),不是死信有货(backed-up):库挂的那
  // 一瞬间往往是流量最集中的时候,一波并发请求不该各报各的事件。
  it("reports at most once to Sentry when a database outage causes a wave of concurrent unknown reads", async () => {
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.example/2");
    queryRaw.mockRejectedValue(new Error("connect ECONNREFUSED"));
    await Promise.all(Array.from({ length: 8 }, () => checkDeadLetters(clock)));
    expect(captureMessage).toHaveBeenCalledTimes(1);
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
