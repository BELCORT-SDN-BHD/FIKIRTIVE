/**
 * heartbeat.test.ts — #797。心跳是整个部署指纹的唯一写入点,没有它 admin 那一行永远是空的。
 *
 * 三件事必须成立:两列真的写进去、写失败不许把 worker 拖下水、平台没注入 sha 时写 null 而
 * 不是编一个。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { configFingerprint } from "@fikirtive/core/env-contract";

const m = vi.hoisted(() => {
  const upsert = vi.fn();
  return { upsert, prisma: { workerHeartbeat: { upsert } } };
});

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma }));
// runAsSystem 在真实实现里挂上命名系统身份(#463)。这里只需要它把回调跑起来。
vi.mock("@fikirtive/db/principal", () => ({
  runAsSystem: (_reason: string, fn: () => Promise<unknown>) => fn(),
}));

import { beatOnce, startHeartbeat, HEARTBEAT_INTERVAL_MS } from "./heartbeat.js";
import { workerPlan } from "./plan.js";

beforeEach(() => vi.clearAllMocks());

const ENV = {
  RAILWAY_GIT_COMMIT_SHA: "1234567890abcdef",
  TOKEN_ENCRYPTION_KEY: "a".repeat(64),
  MEDIA_PROXY_SECRET: "b".repeat(64),
  STORAGE_DRIVER: "r2",
  R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
  R2_BUCKET: "fikirtive-prod",
} as unknown as NodeJS.ProcessEnv;

describe("beatOnce (#797)", () => {
  it("writes the deploy identity on both the create and the update path", async () => {
    m.upsert.mockResolvedValue({});
    await beatOnce(ENV);

    const args = m.upsert.mock.calls[0]?.[0];
    expect(args.where).toEqual({ id: "worker" });
    expect(args.create.commitSha).toBe("1234567890abcdef");
    expect(args.update.commitSha).toBe("1234567890abcdef");
    // 指纹与 core 的计算逐字相同——web 拿自己的那份来比,两边算法必须是同一个。
    expect(args.create.configFingerprint).toBe(configFingerprint(ENV));
    expect(args.update.configFingerprint).toBe(configFingerprint(ENV));
  });

  /**
   * 合并 origin/main(#796 worker 拆分)时,per-role 行 id 与本票的部署身份两列撞在同一段代码上。
   * 两者都必须活下来:丢了 id,拆开的两班共用一行,活着的那半替死掉的那半刷新 /api/health;
   * 丢了那两列,admin 的部署身份永远是空的。这条用例把合并结果本身钉住。
   */
  it("writes the role's own row id — a split deployment must not share one row (#796)", async () => {
    m.upsert.mockResolvedValue({});
    await beatOnce(ENV, "worker-compute");

    const args = m.upsert.mock.calls[0]?.[0];
    expect(args.where).toEqual({ id: "worker-compute" });
    expect(args.create.id).toBe("worker-compute");
    // 而且部署身份仍然跟着写 —— 两个改动不是二选一。
    expect(args.create.commitSha).toBe("1234567890abcdef");
    expect(args.update.configFingerprint).toBe(configFingerprint(ENV));
  });

  it("writes null for the commit sha when the platform injected none — never a fabricated one", async () => {
    m.upsert.mockResolvedValue({});
    await beatOnce({} as NodeJS.ProcessEnv);
    const args = m.upsert.mock.calls[0]?.[0];
    expect(args.create.commitSha).toBeNull();
    expect(args.update.commitSha).toBeNull();
  });

  it("never stores a raw secret — only the 8-hex digest", async () => {
    m.upsert.mockResolvedValue({});
    await beatOnce(ENV);
    const serialized = JSON.stringify(m.upsert.mock.calls[0]?.[0]);
    expect(serialized).not.toContain("a".repeat(64));
    expect(serialized).not.toContain("b".repeat(64));
    expect(m.upsert.mock.calls[0]?.[0].create.configFingerprint).toMatch(/^[0-9a-f]{8}$/);
  });

  it("a failed write is swallowed — health degrading to \"stale\" IS the signal, a crashed worker is not", async () => {
    m.upsert.mockRejectedValue(new Error("connection terminated unexpectedly"));
    await expect(beatOnce(ENV)).resolves.not.toThrow();
  });
});

/**
 * 判官 r3 P2 —— 这一组测的是**真实接线**,不是零件。
 *
 * 在此之前:`beatOnce(ENV, "worker-compute")` 有测、`heartbeatIdFor` 的映射有测,唯独没有任何
 * 用例走过「plan 的角色 id 真的被传进了那两次 beatOnce」这一步。把参数删掉,两班都写回旧的
 * `"worker"` 行 —— 拆分部署的按班可见性当场失效,而两套测试全绿。所以下面每一条都从
 * `workerPlan(env)` 出发,一路走到 upsert 的 `where.id`,中间不许有手写字面量。
 */
describe("startHeartbeat — the real wiring from plan to row id (#797 判官 r3 P2)", () => {
  const withFakeTimers = async (run: () => Promise<void>) => {
    vi.useFakeTimers();
    try {
      await run();
    } finally {
      vi.useRealTimers();
    }
  };

  const roleCases = [
    { label: "compute", role: "compute", expectedId: "worker-compute" },
    { label: "wait", role: "wait", expectedId: "worker-wait" },
    // 不设 WORKER_ROLE = 今天的单服务,必须仍然写 `"worker"` 那一行(#796 判官 r1 P0)。
    { label: "unset (the single service today)", role: undefined, expectedId: "worker" },
  ] as const;

  for (const c of roleCases) {
    it(`role ${c.label} → both the boot beat and the interval beat write "${c.expectedId}"`, async () => {
      m.upsert.mockResolvedValue({});
      const env = { ...ENV, ...(c.role ? { WORKER_ROLE: c.role } : {}) } as NodeJS.ProcessEnv;
      const plan = workerPlan(env);

      await withFakeTimers(async () => {
        const timer = startHeartbeat(plan, env);
        try {
          // 开机那一次:立刻写,不等满第一分钟。
          await vi.advanceTimersByTimeAsync(0);
          expect(m.upsert).toHaveBeenCalledTimes(1);
          expect(m.upsert.mock.calls[0]?.[0].where).toEqual({ id: c.expectedId });

          // 定时那一次:同一个 id,同样带部署身份两列。
          await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
          expect(m.upsert).toHaveBeenCalledTimes(2);
          expect(m.upsert.mock.calls[1]?.[0].where).toEqual({ id: c.expectedId });
          expect(m.upsert.mock.calls[1]?.[0].create.id).toBe(c.expectedId);
          expect(m.upsert.mock.calls[1]?.[0].update.configFingerprint).toBe(configFingerprint(env));
        } finally {
          clearInterval(timer);
        }
      });
    });
  }

  it("the two split roles never write the same row — that is the whole point of per-role ids", async () => {
    m.upsert.mockResolvedValue({});
    const ids: string[] = [];
    for (const role of ["compute", "wait"] as const) {
      const env = { ...ENV, WORKER_ROLE: role } as NodeJS.ProcessEnv;
      await withFakeTimers(async () => {
        const timer = startHeartbeat(workerPlan(env), env);
        await vi.advanceTimersByTimeAsync(0);
        clearInterval(timer);
      });
      ids.push(m.upsert.mock.calls.at(-1)?.[0].where.id);
    }
    expect(new Set(ids).size).toBe(2);
  });
});
