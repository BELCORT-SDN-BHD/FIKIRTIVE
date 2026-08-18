/**
 * route-database-down.test.ts — C1b ②:**就绪探针在数据库出事时到底回什么。**
 *
 * 为什么单独一个文件(与隔壁 `route.test.ts` 同一个理由的镜像):这里要把数据库换成「炸的」
 * 和「永不回话的」,所以整个 `@fikirtive/db` 被 mock 掉,不能和那份跑真库的集成测试同居。
 *
 * 隔壁那份已经证过「迁移没跑成 → 503」。**数据库不可达那一路从来没被证过** —— 而这条正是
 * C1b ② 把 Railway 的部署闸从 `/api/health` 改指到这里之后,闸门真正的守卫内容:
 * 一个连不上库的新容器接了流量也只会回一堆 500,它必须在被切流量之前就说「我没准备好」。
 *
 * 三种不健康态,三条断言,因为它们在生产里是三件不同的事:
 *   ① 库明确拒绝(连接被拒/认证失败)      → 503 database-unreachable
 *   ② 库不回话(挂住)                     → 到点仍然 503,而且**不陪着一起卡死**
 *   ③ 迁移没跑成                           → 503 migrations-not-applied,且**根本不去碰库**
 *
 * ②的时间断言不是装饰:Railway 的健康检查有自己的超时,一个挂住不作答的探针与一个答 503 的
 * 探针对平台是同一个结果(部署失败),但对**我们**不是 —— 前者不留下任何可读的原因。
 *
 * 每个用例前 `resetModules`:路由里的 single-flight 是模块级状态,用例之间不能互相串。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MIGRATION_STATUS_ENV } from "@/lib/boot-status";

const m = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock("@fikirtive/db", () => ({ prisma: { $queryRaw: m.queryRaw } }));

/** 每个用例拿一份全新的路由模块(连同它模块级的 single-flight)。 */
const loadRoute = async () => (await import("../route")).GET;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env[MIGRATION_STATUS_ENV];
});

describe("GET /api/ready 在数据库出事时(C1b ② 部署闸的守卫内容)", () => {
  it("数据库明确不可达 → 503,原因说得清,db 如实写 down", async () => {
    m.queryRaw.mockRejectedValue(new Error("connection refused"));
    const GET = await loadRoute();

    const res = await GET();

    // 这一条就是把部署闸指到这里的全部理由:新容器连不上库,平台据此**不切流量**,
    // 旧部署继续承载。指着 /api/health 的时候,同一个容器会被判「健康」然后接管生产。
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ ready: false, reason: "database-unreachable", db: "down" });
  });

  it("数据库挂住不回话 → 到点仍然 503,而且探针自己不卡死", async () => {
    m.queryRaw.mockImplementation(() => new Promise(() => {})); // 永不 settle
    const GET = await loadRoute();

    const started = Date.now();
    const res = await GET();
    const elapsed = Date.now() - started;

    expect(res.status).toBe(503);
    expect((await res.json()).reason).toBe("database-unreachable");
    // 有界等待:一个永远不回话的查询等同于「没准备好」,不该把探针拖到平台自己的超时 ——
    // 那样部署一样会失败,但日志里不会留下任何说得清的原因。
    expect(elapsed).toBeLessThan(10_000);
  }, 20_000);

  it("迁移没跑成 → 503,且根本不去碰数据库(这个判断与库无关)", async () => {
    process.env[MIGRATION_STATUS_ENV] = "failed";
    m.queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    const GET = await loadRoute();

    const res = await GET();

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ready: false, reason: "migrations-not-applied" });
    // 先答,不必去问库:迁移跑没跑成是启动脚本留下的事实,拿一次查询去确认它只会在库也出事时
    // 把一个说得清的原因换成一个说不清的原因。
    expect(m.queryRaw).not.toHaveBeenCalled();
  });

  it("两样都好 → 200 ready(降级不是新常态)", async () => {
    m.queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    const GET = await loadRoute();

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ready: true, db: "up", migrations: "applied" });
  });

  it("不健康的回话里也没有任何商家数据或库内幕(这个端点免鉴权)", async () => {
    m.queryRaw.mockRejectedValue(new Error("password authentication failed for user \"fikirtive\""));
    const GET = await loadRoute();

    const body = await (await GET()).json();

    // 闭集:多一个字段就是多一条免鉴权泄漏路径。
    expect(Object.keys(body).sort()).toEqual(["db", "migrations", "ready", "reason"]);
    // 库的原始报错(用户名、主机、凭据线索)一个字都不许出现在回话里。
    const shown = JSON.stringify(body).toLowerCase();
    for (const leak of ["password", "authentication", "fikirtive", "connection"]) {
      expect(shown, `readiness body leaked "${leak}"`).not.toContain(leak);
    }
  });

  it("库持续挂住时,探针不许把连接池吃光 —— 100 次探针只发起 1 次查询", async () => {
    m.queryRaw.mockImplementation(() => new Promise(() => {})); // 永不 settle
    const GET = await loadRoute();

    // 部署期间平台按自己的节拍反复拉这条路径,同时外部 uptime 监控也在拉。库挂着的时候,
    // 每来一次探针就多积一个永不结束的查询,于是一个只跑 `SELECT 1` 的端点反而把连接池压垮,
    // 顺手把真正要用库的请求一起拖下水。
    const responses = await Promise.all(Array.from({ length: 100 }, () => GET()));
    for (const res of responses) expect(res.status).toBe(503);

    expect(m.queryRaw).toHaveBeenCalledTimes(1);
  }, 30_000);
});
