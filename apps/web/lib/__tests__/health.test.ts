/**
 * health — /api/health 的纯逻辑(2026-07-04 盲区修复:监控服务的探测点)。
 * worker 心跳每 60s 一次;5 分钟无心跳 = stale(容忍部署重启窗口),无记录 = unknown。
 */
import { describe, it, expect } from "vitest";
import { workerStatus, WORKER_STALE_MS, backupFreshness, backupAgeHours, BACKUP_STALE_MS } from "../health";

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

/** #794 ③ — 备份新鲜度:每 KL 日一份,30 小时门槛(24 小时节拍 + 6 小时余量)。 */
describe("backupFreshness", () => {
  const now = new Date("2026-08-11T12:00:00Z");
  const HOUR = 3_600_000;

  it("missing when no backup has ever succeeded — the loudest state, not a kind of stale", () => {
    expect(backupFreshness(null, now)).toBe("missing");
  });

  it("fresh for last night's backup", () => {
    expect(backupFreshness(new Date(now.getTime() - 9 * HOUR), now)).toBe("fresh");
  });

  it("still fresh a full day later — 24h IS the cadence, not a failure", () => {
    expect(backupFreshness(new Date(now.getTime() - 24 * HOUR), now)).toBe("fresh");
    expect(backupFreshness(new Date(now.getTime() - 29 * HOUR), now)).toBe("fresh");
  });

  it("fresh 1ms before the boundary; stale at and after it", () => {
    expect(backupFreshness(new Date(now.getTime() - (BACKUP_STALE_MS - 1)), now)).toBe("fresh");
    expect(backupFreshness(new Date(now.getTime() - BACKUP_STALE_MS), now)).toBe("stale");
  });

  it("a whole missed night (48h) is comfortably past the threshold", () => {
    expect(backupFreshness(new Date(now.getTime() - 48 * HOUR), now)).toBe("stale");
  });

  it("a clock-skewed FUTURE timestamp reads fresh (same anti-skew rule as workerStatus)", () => {
    expect(backupFreshness(new Date(now.getTime() + HOUR), now)).toBe("fresh");
  });
});

describe("backupAgeHours", () => {
  const now = new Date("2026-08-11T12:00:00Z");

  it("null when nothing ever succeeded", () => {
    expect(backupAgeHours(null, now)).toBeNull();
  });

  it("floors to whole hours", () => {
    expect(backupAgeHours(new Date(now.getTime() - 90 * 60_000), now)).toBe(1);
    expect(backupAgeHours(new Date(now.getTime() - 26 * 3_600_000), now)).toBe(26);
  });

  it("never reports a negative age under clock skew", () => {
    expect(backupAgeHours(new Date(now.getTime() + 3_600_000), now)).toBe(0);
  });
});
