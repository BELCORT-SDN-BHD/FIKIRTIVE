/**
 * health — /api/health 的纯逻辑(2026-07-04 盲区修复:监控服务的探测点)。
 * worker 心跳每 60s 一次;5 分钟无心跳 = stale(容忍部署重启窗口),无记录 = unknown。
 */
import { describe, it, expect } from "vitest";
import { workerStatus, workersHealth, WORKER_STALE_MS } from "../health";

describe("workerStatus", () => {
  const now = new Date("2026-07-04T12:00:00Z");

  it("unknown when no heartbeat row exists (fresh deploy, worker never started)", () => {
    expect(workerStatus(null, now)).toBe("unknown");
  });

  it("up when the heartbeat is fresh", () => {
    expect(workerStatus(new Date(now.getTime() - 60_000), now)).toBe("up");
  });

  it("up exactly at the stale boundary minus 1ms; stale at/after the boundary", () => {
    expect(workerStatus(new Date(now.getTime() - (WORKER_STALE_MS - 1)), now)).toBe("up");
    expect(workerStatus(new Date(now.getTime() - WORKER_STALE_MS), now)).toBe("stale");
    expect(workerStatus(new Date(now.getTime() - WORKER_STALE_MS * 10), now)).toBe("stale");
  });

  it("a clock-skewed FUTURE heartbeat still reads up (never false-alarm on skew)", () => {
    expect(workerStatus(new Date(now.getTime() + 60_000), now)).toBe("up");
  });
});

/** #796 判官 r1 P2-2 —— 拆成算力/等待两班之后,每班一行心跳。 */
describe("workersHealth", () => {
  const now = new Date("2026-08-11T12:00:00Z");
  const fresh = new Date(now.getTime() - 60_000);
  const old = new Date(now.getTime() - WORKER_STALE_MS - 1);

  it("没有任何一行 → unknown,而且不假装有班在跑", () => {
    expect(workersHealth([], now)).toEqual({ worker: "unknown", workers: {} });
  });

  it("逐班报活 —— 一班死了另一班盖不住它", () => {
    const out = workersHealth([{ id: "worker-compute", at: old }, { id: "worker-wait", at: fresh }], now);
    expect(out.workers).toEqual({ "worker-compute": "stale", "worker-wait": "up" });
  });

  it("顶层字段含义不变:至少一班活着就是 up", () => {
    // 取「最差」会在从 all 切到拆分之后永远报 stale(旧的 "worker" 行再没人写),
    // 那是一个纯粹的假警报。按班告警归 #793,数据在 workers 里已经摆好了。
    expect(workersHealth([{ id: "worker", at: old }, { id: "worker-wait", at: fresh }], now).worker).toBe("up");
    expect(workersHealth([{ id: "worker", at: old }], now).worker).toBe("stale");
  });
});
