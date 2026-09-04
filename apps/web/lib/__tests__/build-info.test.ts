/**
 * buildBuildInfoResponse — E2E-STG-VERSION(Codex 全 beta 审计 P1-012:发布身份)。
 *
 * 纯函数测试:数据库/环境的「读不到」由调用方(route.ts)的 bestEffort 处理,传进来的
 * 已经是 `null` 或一份行数组——这里只覆盖拼装本身的每一种组合。
 */
import { describe, it, expect } from "vitest";
import { buildBuildInfoResponse } from "@/lib/build-info";

const NOW = new Date("2026-09-04T12:00:00.000Z");
const STARTED = new Date("2026-09-04T09:00:00.000Z");

describe("buildBuildInfoResponse(E2E-STG-VERSION P1-012)", () => {
  it("E2E-STG-VERSION: 平台注入了 env → web 报短 sha/ref,外加进程启动时刻", () => {
    const body = buildBuildInfoResponse({
      env: { RAILWAY_GIT_COMMIT_SHA: "abc123def4567890", RAILWAY_GIT_BRANCH: "main" },
      processStartedAt: STARTED,
      now: NOW,
      heartbeatRows: [],
      latestMigration: null,
    });
    expect(body.web).toEqual({ sha: "abc123de", ref: "main", startedAt: STARTED.toISOString() });
  });

  it("E2E-STG-VERSION: 本机没有平台注入 → web sha/ref 都是 null,绝不假造", () => {
    const body = buildBuildInfoResponse({
      env: {},
      processStartedAt: STARTED,
      now: NOW,
      heartbeatRows: [],
      latestMigration: null,
    });
    expect(body.web.sha).toBeNull();
    expect(body.web.ref).toBeNull();
  });

  it("E2E-STG-VERSION: 心跳行缺失(读不到 / 没有 worker)→ worker 报空数组,不是假造一行", () => {
    const body = buildBuildInfoResponse({
      env: {},
      processStartedAt: STARTED,
      now: NOW,
      heartbeatRows: null,
      latestMigration: null,
    });
    expect(body.worker).toEqual([]);
  });

  it("E2E-STG-VERSION: 一班 worker 心跳 → worker 数组一行,role 取心跳行的 id,sha 缩短", () => {
    const at = new Date("2026-09-04T11:59:00.000Z");
    const body = buildBuildInfoResponse({
      env: {},
      processStartedAt: STARTED,
      now: NOW,
      heartbeatRows: [{ id: "worker-compute", commitSha: "fedcba9876543210", at }],
      latestMigration: null,
    });
    expect(body.worker).toEqual([{ role: "worker-compute", sha: "fedcba98", at: at.toISOString() }]);
  });

  it("E2E-STG-VERSION: 两班心跳 → 两行,各自角色各自 sha", () => {
    const at1 = new Date("2026-09-04T11:59:00.000Z");
    const at2 = new Date("2026-09-04T11:58:00.000Z");
    const body = buildBuildInfoResponse({
      env: {},
      processStartedAt: STARTED,
      now: NOW,
      heartbeatRows: [
        { id: "worker-compute", commitSha: "aaaaaaaa11111111", at: at1 },
        { id: "worker-wait", commitSha: null, at: at2 },
      ],
      latestMigration: null,
    });
    expect(body.worker).toEqual([
      { role: "worker-compute", sha: "aaaaaaaa", at: at1.toISOString() },
      { role: "worker-wait", sha: null, at: at2.toISOString() },
    ]);
  });

  /** 判官四轮 P1-1:route.ts 在读出 `_prisma_migrations` 时已经把下划线后面那半截人写的
   *  迁移描述剥掉,传进这个纯函数的 `latestMigration.name` 本来就已经是裸 id——这里的
   *  夹具改成裸 id 形状,和真实调用方一致(剥离本身的红线在真库测试
   *  app/api/build-info/__tests__/route.test.ts,那里去掉 `.replace()` 才会让断言变红)。 */
  it("E2E-STG-VERSION: 迁移前沿读到了 → migrations.latest 是迁移 id(裸时间戳,不带名字后缀),appliedAt 是完成时刻", () => {
    const finishedAt = new Date("2026-09-03T12:00:00.000Z");
    const body = buildBuildInfoResponse({
      env: {},
      processStartedAt: STARTED,
      now: NOW,
      heartbeatRows: [],
      latestMigration: { name: "20260903120000", finishedAt },
    });
    expect(body.migrations).toEqual({
      latest: "20260903120000",
      appliedAt: finishedAt.toISOString(),
    });
  });

  it("E2E-STG-VERSION: 迁移前沿读不到 → migrations 两格都是 null,不假造", () => {
    const body = buildBuildInfoResponse({
      env: {},
      processStartedAt: STARTED,
      now: NOW,
      heartbeatRows: [],
      latestMigration: null,
    });
    expect(body.migrations).toEqual({ latest: null, appliedAt: null });
  });

  it("E2E-STG-VERSION: generatedAt 取响应生成时刻", () => {
    const body = buildBuildInfoResponse({
      env: {},
      processStartedAt: STARTED,
      now: NOW,
      heartbeatRows: [],
      latestMigration: null,
    });
    expect(body.generatedAt).toBe(NOW.toISOString());
  });

  /** 响应形状必须恰好是约定的四个顶层键,worker 行里不带 configFingerprint —— 这是一个
   *  匿名端点,零敏感字段。 */
  it("E2E-STG-VERSION: 响应键集合恰为约定,不多不少;worker 行不含 configFingerprint 或其他字段", () => {
    const body = buildBuildInfoResponse({
      env: { RAILWAY_GIT_COMMIT_SHA: "abc123def4567890" },
      processStartedAt: STARTED,
      now: NOW,
      heartbeatRows: [{ id: "worker", commitSha: "abc123def4567890", at: NOW }],
      latestMigration: { name: "20260903120000", finishedAt: NOW },
    });
    expect(Object.keys(body).sort()).toEqual(["generatedAt", "migrations", "web", "worker"]);
    expect(Object.keys(body.web).sort()).toEqual(["ref", "sha", "startedAt"]);
    expect(Object.keys(body.worker[0]).sort()).toEqual(["at", "role", "sha"]);
    expect(Object.keys(body.migrations).sort()).toEqual(["appliedAt", "latest"]);
    expect(JSON.stringify(body)).not.toContain("configFingerprint");
  });
});
