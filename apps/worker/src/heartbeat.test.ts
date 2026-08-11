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

import { beatOnce } from "./heartbeat.js";

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
