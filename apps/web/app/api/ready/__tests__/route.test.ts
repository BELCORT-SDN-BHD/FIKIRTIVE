/**
 * /api/ready 集成测试(真库)—— #796 判官 r1 P1-2。
 *
 * 判词的要害:r1 让迁移失败的容器照样回 200「健康」,于是滚动发布时平台会把流量从好用的
 * 旧容器切给跑在旧结构上的新代码。存活(还答不答得出话)与就绪(该不该接流量)必须分开。
 *
 * 这个端点就是那道闸:迁移没跑成 ⇒ 503 ⇒ 新容器不接流量,旧部署继续承载。
 */
import { describe, it, expect, afterEach } from "vitest";
import { MIGRATION_STATUS_ENV } from "@/lib/boot-status";
import { GET } from "../route";

afterEach(() => {
  delete process.env[MIGRATION_STATUS_ENV];
});

describe("GET /api/ready", () => {
  it("迁移已就位 + DB 可达 → 200 ready", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ready: true, db: "up", migrations: "applied" });
  });

  it("迁移没跑成 → 503,带上说得清的原因", async () => {
    // 这一条就是整个 P1-2:平台看到 503 就不会把流量切给这个容器,旧部署继续承载,
    // 而站点本身仍然活着(/api/health 照样 200)—— 既没有 crash loop,也没有用坏代码顶掉好代码。
    process.env[MIGRATION_STATUS_ENV] = "failed";
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ready).toBe(false);
    expect(body.reason).toBe("migrations-not-applied");
    expect(body.migrations).toBe("failed");
  });

  it("认不出的值按已就位处理 —— 缺省不制造假的 503", async () => {
    process.env[MIGRATION_STATUS_ENV] = "maybe";
    expect((await GET()).status).toBe(200);
  });

  it("回的东西里没有任何商家数据(免鉴权端点)", async () => {
    process.env[MIGRATION_STATUS_ENV] = "failed";
    const body = await (await GET()).json();
    expect(Object.keys(body).sort()).toEqual(["db", "migrations", "ready", "reason"]);
  });
});
