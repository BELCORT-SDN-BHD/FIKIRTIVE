/**
 * route-degraded.test.ts — #796 判官 r2 P1-2 / r3 P2-1:**数据库出事时的存活探针。**
 *
 * 为什么单独一个文件:这里要把数据库替换成「炸的」和「永不回话的」,所以整个
 * `@fikirtive/db` 被 mock 掉,不能和隔壁那份跑真库的集成测试放在同一个文件里。
 *
 * 判词的因果链,原样记在这里免得日后被人「优化」掉:
 *   库故障 → /api/health 回 503 → 平台的**重启**探针判定不健康 → 重启还活着的 Web →
 *   启动脚本再跑三轮迁移重试 → 再失败 → 再重启 …… 正好是本票要消灭的那个重启循环。
 * 所以:存活只回答「这个进程还答不答得出话」,别的一概不问。
 *
 * r3 P2-1 追加的一条:光「放弃等待」还不够 —— 底层查询仍挂着占一条连接,库持续挂住时
 * 每次探针就多积一个永不结束的任务。路由用 single-flight 把它压到 1 个,这里逐条钉住。
 * 每个用例前 `resetModules`:那个 single-flight 是**模块级**状态,用例之间不能互相串。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@fikirtive/db", () => ({ prisma: { workerHeartbeat: { findMany: m.findMany } } }));

/** 每个用例拿一份全新的路由模块(连同它模块级的 single-flight)。 */
const loadRoute = async () => (await import("../route")).GET;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("GET /api/health 在下游出事时(判官 r2 P1-2)", () => {
  it("数据库不可达 → 仍然 200,db 如实写 unknown", async () => {
    m.findMany.mockRejectedValue(new Error("connection refused"));
    const GET = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(200); // ← 整条判词的要害:绝不是 503
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, db: "unknown", worker: "unknown", workers: {} });
  });

  it("数据库挂住(不回话)→ 到点也回 200,不把探针一起拖到超时", async () => {
    m.findMany.mockImplementation(() => new Promise(() => {})); // 永不 settle
    const GET = await loadRoute();
    const started = Date.now();
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).db).toBe("unknown");
    // 存活探针不许陪着下游一起卡住 —— 卡住和 503 对平台是同一个意思。
    expect(Date.now() - started).toBeLessThan(3000);
  }, 10_000);

  it("数据库正常 → 200 且 db 报 up(降级不是新常态)", async () => {
    m.findMany.mockResolvedValue([{ id: "worker-wait", at: new Date() }]);
    const GET = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.db).toBe("up");
    expect(body.workers).toEqual({ "worker-wait": "up" });
  });
});

describe("库持续挂住时,探针不许把连接池吃光(判官 r3 P2-1)", () => {
  it("100 次探针只发起 1 次查询 —— 而不是积 100 个永不结束的任务", async () => {
    m.findMany.mockImplementation(() => new Promise(() => {})); // 永不 settle
    const GET = await loadRoute();

    // 判官造的形状:库挂着,探针照来。并发 100 次(同一秒里挤进来)。
    const responses = await Promise.all(Array.from({ length: 100 }, () => GET()));
    for (const res of responses) expect(res.status).toBe(200); // 每一次都照常作答

    // 再来几次**顺序**探针,证明超时之后的下一次也不会另起一个(挂着的那趟还没结束)。
    for (let i = 0; i < 5; i++) expect((await GET()).status).toBe(200);

    // ← single-flight 之前这里会是 105,每一个都占着一条连接不放。
    expect(m.findMany).toHaveBeenCalledTimes(1);
  }, 30_000);

  it("库恢复之后不需要任何额外动作:下一次探针重新发起查询并报 up", async () => {
    let resolveFirst: ((rows: unknown[]) => void) | undefined;
    m.findMany.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve as (rows: unknown[]) => void; }));
    const GET = await loadRoute();

    expect((await GET()).status).toBe(200); // 挂住那次:放弃等待,回 unknown
    expect(m.findMany).toHaveBeenCalledTimes(1);

    // 挂着的那次终于回来了(库恢复),single-flight 随之释放
    resolveFirst!([]);
    await new Promise((r) => setTimeout(r, 5));

    m.findMany.mockResolvedValue([{ id: "worker", at: new Date() }]);
    const body = await (await GET()).json();
    expect(m.findMany).toHaveBeenCalledTimes(2); // 确实重新发起了
    expect(body.db).toBe("up");
    expect(body.worker).toBe("up");
  }, 10_000);
});
