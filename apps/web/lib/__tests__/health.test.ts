/**
 * health — /api/health 的纯逻辑(2026-07-04 盲区修复:监控服务的探测点)。
 * worker 心跳每 60s 一次;5 分钟无心跳 = stale(容忍部署重启窗口),无记录 = unknown。
 */
import { describe, it, expect } from "vitest";
import { workerStatus, WORKER_STALE_MS } from "../health";

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
