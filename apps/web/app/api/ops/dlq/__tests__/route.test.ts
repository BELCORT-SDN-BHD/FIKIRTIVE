import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEAD_LETTER_QUEUES } from "@fikirtive/core";

/**
 * r2(判官 r1 P2):这个文件以前 mock 掉 `checkDeadLetters` —— 也就是路由背后的整条真实
 * 路径。于是「200 到底代表什么」是被 mock 定义的,不是被代码定义的。
 *
 * 现在只 mock 数据库这一层:路由 → 巡检 → 化验 → 状态码,全程跑真的,测试只决定
 * 「数据库这一刻返回什么行」。真 SQL / 真 pg-boss 那一层在 lib/__tests__/dlq-watch-live.test.ts。
 */
const queryRaw = vi.fn();
vi.mock("@fikirtive/db", () => ({
  prisma: { $queryRaw: (...args: unknown[]) => queryRaw(...args) },
}));
vi.mock("@sentry/node", () => ({ captureMessage: vi.fn() }));

const emptyRows = () =>
  DEAD_LETTER_QUEUES.map((name) => ({ name, queuedCount: 0, deferredCount: 0, activeCount: 0 }));

const { GET } = await import("../route");

/**
 * 巡检有 30 秒缓存,上一条用例的结论不能泄漏到下一条。用假时钟把每个用例推到窗口之外,
 * 而不是 `vi.resetModules()` —— 后者每条都要重新转译整张模块图(实测每条 ~1.5 秒)。
 */
let clock = Date.parse("2026-08-13T00:00:00.000Z");
const advance = () => vi.setSystemTime((clock += 10 * 60_000));

beforeEach(() => {
  vi.clearAllMocks();
  queryRaw.mockResolvedValue(emptyRows());
  vi.useFakeTimers();
  advance();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/ops/dlq", () => {
  it("answers 200 clear when all seven queues exist and no job was dead-lettered", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deadLetters: "clear" });
  });

  // 状态码即告警:任何免费 uptime 探针零配置就能用,不需要关键字匹配。
  it("answers 503 backed-up when a job has been dead-lettered", async () => {
    queryRaw.mockResolvedValue([
      ...emptyRows().filter((r) => r.name !== "gen.dlq"),
      { name: "gen.dlq", queuedCount: 2, deferredCount: 0, activeCount: 0 },
    ]);
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, deadLetters: "backed-up" });
  });

  /**
   * r2(判官 r1 P1-1):这一条是这次返修的钉子。`ingest.dlq` 整条查不到时,旧实现回的是
   * `200 clear` —— 一个证明不了自己看得见的探针在报平安,比没有探针更坏。
   */
  it("answers 503 unknown when a watched queue is absent, never 200 clear", async () => {
    queryRaw.mockResolvedValue(emptyRows().filter((r) => r.name !== "ingest.dlq"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, deadLetters: "unknown" });
  });

  it("answers 503 unknown when a count comes back unreadable", async () => {
    queryRaw.mockResolvedValue([
      ...emptyRows().filter((r) => r.name !== "render.dlq"),
      { name: "render.dlq", queuedCount: -1, deferredCount: 0, activeCount: 0 },
    ]);
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, deadLetters: "unknown" });
  });

  it("answers 503 unknown when the database itself cannot be reached", async () => {
    queryRaw.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.4:5432"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, deadLetters: "unknown" });
  });

  // 免鉴权路由:外面读得到的只能是 clear/backed-up/unknown 三个字,别的一概不给。
  it("leaks no counts, queue names or error detail", async () => {
    queryRaw.mockResolvedValue([
      ...emptyRows().filter((r) => r.name !== "gen.dlq"),
      { name: "gen.dlq", queuedCount: 7, deferredCount: 0, activeCount: 0 },
    ]);
    const body = await (await GET()).text();
    expect(body).not.toMatch(/\d/);
    expect(body).not.toContain("dlq");

    queryRaw.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.4:5432"));
    advance(); // past the cache window, so this really is a second read
    const errorBody = await (await GET()).text();
    expect(errorBody).not.toContain("ECONNREFUSED");
    expect(errorBody).not.toContain("5432");
  });

  /**
   * 这条路径是**只读**的(判官 r1 P0 的写入面)。旧实现经 `getBoss()` 冷启动 pg-boss,
   * 于是一次未认证的 GET 会跑一串 `createQueue` 写入;现在整个 pg-boss 句柄都不在这条
   * 路上,一次探针 = 一条 SELECT。库里确实一行没动,由 live 测试从数据库那头证。
   */
  it("issues exactly one statement, and it is a read", async () => {
    await GET();
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const sql = (queryRaw.mock.calls[0]![0] as string[]).join(" ");
    expect(sql.trim()).toMatch(/^SELECT\b/);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
  });
});
