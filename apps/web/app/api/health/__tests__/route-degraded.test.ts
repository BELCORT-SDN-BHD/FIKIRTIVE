/**
 * route-degraded.test.ts — #796 判官 r2 P1-2:**数据库出事时,存活探针必须仍然回 200。**
 *
 * 为什么单独一个文件:这里要把数据库替换成「炸的」和「永不回话的」,所以整个
 * `@fikirtive/db` 被 mock 掉,不能和隔壁那份跑真库的集成测试放在同一个文件里。
 *
 * 判词的因果链,原样记在这里免得日后被人「优化」掉:
 *   库故障 → /api/health 回 503 → 平台的**重启**探针判定不健康 → 重启还活着的 Web →
 *   启动脚本再跑三轮迁移重试 → 再失败 → 再重启 …… 正好是本票要消灭的那个重启循环。
 * 所以:存活只回答「这个进程还答不答得出话」,别的一概不问。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@fikirtive/db", () => ({ prisma: { workerHeartbeat: { findMany: m.findMany } } }));

import { GET } from "../route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/health 在下游出事时(判官 r2 P1-2)", () => {
  it("数据库不可达 → 仍然 200,db 如实写 unknown", async () => {
    m.findMany.mockRejectedValue(new Error("connection refused"));
    const res = await GET();
    expect(res.status).toBe(200); // ← 整条判词的要害:绝不是 503
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, db: "unknown", worker: "unknown", workers: {} });
  });

  it("数据库挂住(不回话)→ 到点也回 200,不把探针一起拖到超时", async () => {
    m.findMany.mockImplementation(() => new Promise(() => {})); // 永不 settle
    const started = Date.now();
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).db).toBe("unknown");
    // 存活探针不许陪着下游一起卡住 —— 卡住和 503 对平台是同一个意思。
    expect(Date.now() - started).toBeLessThan(3000);
  }, 10_000);

  it("数据库正常 → 200 且 db 报 up(降级不是新常态)", async () => {
    m.findMany.mockResolvedValue([{ id: "worker-wait", at: new Date() }]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.db).toBe("up");
    expect(body.workers).toEqual({ "worker-wait": "up" });
  });
});
