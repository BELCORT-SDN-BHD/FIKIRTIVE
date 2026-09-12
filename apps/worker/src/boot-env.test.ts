/**
 * boot-env.test.ts — RELY-A10(docs/specs/fail-closed-reliability.md §2,issue #1384)。
 *
 * 病因(判官前瞻雷,PR #1397 P2):给备份 cron 接上 `assertWorkerEnv` 之后,它与 worker 主进程
 * 共用同一份 `surface: "worker"` 契约——而 RELY-A4 把 GENERATION_PROVIDER 在 worker 面收成
 * 生产必填。备份 cron 永远不碰生成引擎,却会因为缺这个用不到的变量在开机那一刻 exit(1),
 * 生产夜间备份因此静默停摆。这份测试钉住三件事:
 *   ① 备份 cron 真正需要的变量缺了 ⇒ 照常拒绝启动、点名缺项(不能因为加了豁免就顺手松了别的)。
 *   ② GENERATION_PROVIDER 缺了,但传的是 `{ process: "backup-cron" }` ⇒ 正常启动 —— 这正是
 *      本票要修的洞。
 *   ③ 同样缺 GENERATION_PROVIDER,但走 worker 主进程默认路径(不传 process,或传 "worker")
 *      ⇒ 仍然拒绝启动 —— 证明豁免没有泄漏到它不该覆盖的进程。
 */
import { describe, it, expect, vi } from "vitest";
import { assertWorkerEnv } from "./boot-env.js";

/** backup-cron 真正会读到的最小生产 env(§文件头 C3 注释里点名的那个子集),刻意不含
 *  GENERATION_PROVIDER —— 这个进程从不碰生成引擎。 */
function backupCronEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://u:p@host:5432/db",
    STORAGE_DRIVER: "r2",
    R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
    R2_ACCESS_KEY_ID: "id",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_BUCKET: "fikirtive-prod",
    SENTRY_DSN: "https://key@o1.ingest.sentry.io/2",
    ...overrides,
  };
}

/** worker 主进程真正会读到的最小生产 env —— 与上面的唯一差别就是 GENERATION_PROVIDER 那一对。 */
function workerMainEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    ...backupCronEnv(),
    GENERATION_PROVIDER: "byteplus",
    BYTEPLUS_API_KEY: "ark-test",
    ...overrides,
  };
}

/** `assertWorkerEnv` 在硬错误时调用 `process.exit(1)` —— 用一个抛出的假实现拦住控制流,
 *  这样断言既能看到「确实调用过 exit(1)」,也不必真的杀掉测试进程。 */
function spyOnExit() {
  return vi.spyOn(process, "exit").mockImplementation(((_code?: number) => {
    throw new Error("process.exit called");
  }) as never);
}

describe("RELY-A10 §2 — 备份 cron 缺必需 env 时退出码非 0 并点名缺项;补齐后照常完成当日备份", () => {
  it("① 备份 cron 真正需要的变量缺了(DATABASE_URL)⇒ 拒绝启动并点名它", () => {
    const exit = spyOnExit();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { DATABASE_URL: _dropped, ...env } = backupCronEnv();
    try {
      expect(() => assertWorkerEnv(env, { process: "backup-cron" })).toThrow("process.exit called");
      expect(exit).toHaveBeenCalledWith(1);
      const logged = err.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain("DATABASE_URL");
    } finally {
      exit.mockRestore();
      err.mockRestore();
    }
  });

  it("② GENERATION_PROVIDER 缺了,但这是备份 cron({ process: \"backup-cron\" })⇒ 正常启动 — 这正是本票要修的洞", () => {
    const exit = spyOnExit();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // backupCronEnv() 本身就不含 GENERATION_PROVIDER —— 这就是备份 cron 的真实生产形状。
      expect(() => assertWorkerEnv(backupCronEnv(), { process: "backup-cron" })).not.toThrow();
      expect(exit).not.toHaveBeenCalled();
      expect(err).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
      warn.mockRestore();
      err.mockRestore();
    }
  });

  it("③ 同样缺 GENERATION_PROVIDER,但走 worker 主进程默认路径 ⇒ 仍然拒绝启动 — 豁免没有泄漏", () => {
    const exit = spyOnExit();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // 不传第二个参数 == 主进程今天调用 assertWorkerEnv() 的逐字方式(apps/worker/src/index.ts)。
      expect(() => assertWorkerEnv(backupCronEnv())).toThrow("process.exit called");
      expect(exit).toHaveBeenCalledWith(1);
      const logged = err.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain("GENERATION_PROVIDER");
    } finally {
      exit.mockRestore();
      err.mockRestore();
    }
  });

  it("④ 明写 process: \"worker\" 与不传是同一件事(默认值不是靠巧合成立的)", () => {
    const exit = spyOnExit();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => assertWorkerEnv(backupCronEnv(), { process: "worker" })).toThrow("process.exit called");
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      exit.mockRestore();
      err.mockRestore();
    }
  });

  it("⑤ 补齐后(worker 主进程形状,含 GENERATION_PROVIDER)⇒ 两种 process 都正常启动", () => {
    const exit = spyOnExit();
    try {
      expect(() => assertWorkerEnv(workerMainEnv(), { process: "worker" })).not.toThrow();
      expect(() => assertWorkerEnv(workerMainEnv(), { process: "backup-cron" })).not.toThrow();
      expect(exit).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
    }
  });

  it("⑥ cronExempt 只免掉存在性判定 —— 备份 cron 意外带着一个形状不对的 GENERATION_PROVIDER 仍然被拦下", () => {
    const exit = spyOnExit();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // Railway 的共享变量组可能意外把它也带给了 cron 服务;"设了但不是合法枚举值" 与
      // "根本没设" 是两回事,cronExempt 只免第二种。
      expect(() => assertWorkerEnv(backupCronEnv({ GENERATION_PROVIDER: "not-a-real-provider" }), { process: "backup-cron" })).toThrow(
        "process.exit called",
      );
      expect(exit).toHaveBeenCalledWith(1);
      const logged = err.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain("GENERATION_PROVIDER");
    } finally {
      exit.mockRestore();
      err.mockRestore();
    }
  });

  it("⑦ 非生产(dev/CI)缺 GENERATION_PROVIDER 与缺 DATABASE_URL 一样,只 warn,两种 process 都不退出", () => {
    const exit = spyOnExit();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { NODE_ENV: _dropped, DATABASE_URL: _d2, ...env } = backupCronEnv();
      assertWorkerEnv(env, { process: "backup-cron" });
      assertWorkerEnv(env, { process: "worker" });
      expect(exit).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
      warn.mockRestore();
    }
  });
});
