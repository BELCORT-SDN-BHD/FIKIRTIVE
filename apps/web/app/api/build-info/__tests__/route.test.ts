/**
 * /api/build-info 集成测试(真库)——Codex 全 beta 审计 P1-012:发布身份。
 *
 * 与隔壁 /api/health、/api/ready 的集成测试同一个理由:这个端点直接读 `WorkerHeartbeat` 与
 * `_prisma_migrations`,拼装逻辑本身的每种组合已经在 `lib/__tests__/build-info.test.ts` 覆盖,
 * 这里只证「真的接上了真库」——种一行心跳,响应里就该看得到那一行;真测试库本身跑过
 * `prisma migrate deploy`,`_prisma_migrations` 里天然有已应用的迁移,`migrations.latest`
 * 不该是 null。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@fikirtive/db";
import { GET } from "../route";

beforeEach(async () => {
  await prisma.workerHeartbeat.deleteMany({});
});

describe("GET /api/build-info", () => {
  it("E2E-STG-VERSION: 没有心跳行 → worker 是空数组,响应仍是 200", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.worker).toEqual([]);
  });

  it("E2E-STG-VERSION: 种一行 WorkerHeartbeat → worker 数组恰好一行,role 是心跳行的 id", async () => {
    const at = new Date();
    await prisma.workerHeartbeat.create({
      data: { id: "worker", commitSha: "abc123def4567890", configFingerprint: "deadbeef", at },
    });
    const body = await (await GET()).json();
    expect(body.worker).toHaveLength(1);
    expect(body.worker[0]).toEqual({ role: "worker", sha: "abc123de", at: at.toISOString() });
  });

  it("E2E-STG-VERSION: 两班心跳都在 → worker 数组两行", async () => {
    await prisma.workerHeartbeat.createMany({
      data: [
        { id: "worker-compute", commitSha: "aaaaaaaa11111111", at: new Date() },
        { id: "worker-wait", commitSha: "bbbbbbbb22222222", at: new Date() },
      ],
    });
    const body = await (await GET()).json();
    expect(body.worker.map((w: { role: string }) => w.role).sort()).toEqual(["worker-compute", "worker-wait"]);
  });

  it("E2E-STG-VERSION: 迁移前沿读到真库的 _prisma_migrations,不是 null(测试库已跑过 migrate deploy)", async () => {
    const body = await (await GET()).json();
    expect(body.migrations.latest).not.toBeNull();
    expect(body.migrations.appliedAt).not.toBeNull();
  });

  /** 判官四轮 P1-1:`_prisma_migrations` 真实的 `migration_name` 天然带下划线(测试库跑过
   *  `20260903120000_org_home_layout` 这类迁移),这条断言证的是 route.ts 的
   *  `.replace(/_.*$/, "")` 真的接上了真库——去掉那次 replace,这条会看见下划线后半截人写的
   *  迁移描述,当场变红。 */
  it("E2E-STG-VERSION: migrations.latest 是裸迁移 id,不含下划线后缀(人写的迁移描述不外泄)", async () => {
    const body = await (await GET()).json();
    expect(body.migrations.latest).not.toBeNull();
    expect(body.migrations.latest).not.toContain("_");
    expect(body.migrations.latest).toMatch(/^\d+$/);
  });

  it("E2E-STG-VERSION: 本机测试环境没有平台注入的 sha → web.sha/ref 如实报 null,不假造", async () => {
    const body = await (await GET()).json();
    expect(body.web.sha).toBeNull();
    expect(body.web.ref).toBeNull();
    expect(typeof body.web.startedAt).toBe("string");
  });

  it("E2E-STG-VERSION: 响应键集合恰为约定的四个顶层键,不多不少", async () => {
    const body = await (await GET()).json();
    expect(Object.keys(body).sort()).toEqual(["generatedAt", "migrations", "web", "worker"]);
  });

  /** 零敏感字段:这是一个匿名端点(auth-wall-ledger.ts 已豁免),configFingerprint、env 变量名、
   *  路径都不该出现——即使 WorkerHeartbeat 那一行确实写了 configFingerprint。 */
  it("E2E-STG-VERSION: 不含 configFingerprint 或任何 env 变量名/路径,即使心跳行里有指纹", async () => {
    await prisma.workerHeartbeat.create({
      data: { id: "worker", commitSha: "abc123def4567890", configFingerprint: "deadbeef", at: new Date() },
    });
    const body = await (await GET()).json();
    const json = JSON.stringify(body);
    expect(json).not.toContain("configFingerprint");
    expect(json).not.toContain("deadbeef");
    expect(json).not.toContain("RAILWAY_");
    expect(json).not.toContain("DATABASE_URL");
  });
});
