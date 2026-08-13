/**
 * #794 ③ — admin 上那一格备份新鲜度说什么话、什么颜色。
 *
 * 这里盯的不是措辞,是三条会让面板变成噪音或谎言的规则:
 *   1. 一次失败绝不能把「上一次成功在什么时候」从面板上抹掉;
 *   2. 已经被后续成功覆盖的旧失败绝不能继续挂着(训练人忽略这一格 = 面板等于没有);
 *   3. 备份新鲜但仍与内容共用钥匙,不能显示成一片绿 —— 那正是债 #2 的一半。
 */
import { describe, it, expect } from "vitest";
import { buildBackupSignal } from "../backup-signal";

const NOW = new Date("2026-08-11T12:00:00Z");
const HOUR = 3_600_000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

const success = (over: Partial<{ finishedAt: Date; sizeBytes: number | null; durationMs: number | null; trigger: string; credentialMode: string }> = {}) => ({
  finishedAt: over.finishedAt ?? ago(9),
  key: "backups/db/fikirtive-2026-08-11.dump.gz",
  sizeBytes: over.sizeBytes === undefined ? 42_000_000 : over.sizeBytes,
  durationMs: over.durationMs === undefined ? 47_000 : over.durationMs,
  trigger: over.trigger ?? "cron",
  credentialMode: over.credentialMode ?? "isolated",
});

describe("buildBackupSignal", () => {
  it("never run → danger, and says plainly that nothing can be restored", () => {
    const s = buildBackupSignal({ lastSuccess: null, lastFailure: null, now: NOW });
    expect(s.freshness).toBe("missing");
    expect(s.status).toBe("never run");
    expect(s.tone).toBe("danger");
    expect(s.detail).toMatch(/Nothing here can be restored yet/);
  });

  it("never run, with a failed attempt → the failure detail is carried, still danger", () => {
    const s = buildBackupSignal({
      lastSuccess: null,
      lastFailure: { finishedAt: ago(2), error: "pg_dump exited with code 1" },
      now: NOW,
    });
    expect(s.status).toBe("never run");
    expect(s.tone).toBe("danger");
    expect(s.detail).toMatch(/pg_dump exited with code 1/);
  });

  it("last night's backup on an isolated credential → success, with size/duration/trigger", () => {
    const s = buildBackupSignal({ lastSuccess: success(), lastFailure: null, now: NOW });
    expect(s.freshness).toBe("fresh");
    expect(s.status).toBe("fresh");
    expect(s.tone).toBe("success");
    expect(s.count).toBe(9);
    expect(s.detail).toContain("Last backup 9h ago");
    expect(s.detail).toContain("40 MB");
    expect(s.detail).toContain("47s to write");
    expect(s.detail).toContain("cron trigger");
    expect(s.detail).toContain("isolated backup credential");
  });

  it("fresh but still on the SHARED content credential → warning, not green", () => {
    // 债 #2 的一半:备份和它要保护的东西挂在同一把钥匙上。备份存在,但不算安全。
    const s = buildBackupSignal({ lastSuccess: success({ credentialMode: "shared" }), lastFailure: null, now: NOW });
    expect(s.freshness).toBe("fresh");
    expect(s.tone).toBe("warning");
    expect(s.detail).toContain("shared content credential (not isolated)");
  });

  it("past the staleness window → danger, and the last SUCCESS is still visible", () => {
    const s = buildBackupSignal({ lastSuccess: success({ finishedAt: ago(50) }), lastFailure: null, now: NOW });
    expect(s.freshness).toBe("stale");
    expect(s.status).toBe("stale");
    expect(s.tone).toBe("danger");
    expect(s.count).toBe(50);
    expect(s.updatedAt).toBe(ago(50).toISOString());
  });

  it("a failure AFTER the last success is surfaced without hiding the success", () => {
    const s = buildBackupSignal({
      lastSuccess: success({ finishedAt: ago(9) }),
      lastFailure: { finishedAt: ago(2), error: "R2 PutObject 403" },
      now: NOW,
    });
    expect(s.freshness).toBe("fresh"); // yesterday's dump is still restorable
    expect(s.status).toBe("retry failed");
    expect(s.tone).toBe("warning");
    expect(s.detail).toContain("Last backup 9h ago");
    expect(s.detail).toContain("R2 PutObject 403");
  });

  it("a failure BEFORE the last success is not mentioned — it was already resolved", () => {
    const s = buildBackupSignal({
      lastSuccess: success({ finishedAt: ago(9) }),
      lastFailure: { finishedAt: ago(33), error: "pg_dump timed out" },
      now: NOW,
    });
    expect(s.status).toBe("fresh");
    expect(s.tone).toBe("success");
    expect(s.detail).not.toContain("pg_dump timed out");
  });

  it("stale beats a later failure — the worst true statement wins the tone", () => {
    const s = buildBackupSignal({
      lastSuccess: success({ finishedAt: ago(60) }),
      lastFailure: { finishedAt: ago(2), error: "R2 PutObject 403" },
      now: NOW,
    });
    expect(s.status).toBe("stale");
    expect(s.tone).toBe("danger");
    expect(s.detail).toContain("R2 PutObject 403");
  });

  it("survives a row with no size/duration recorded (older rows, partial writes)", () => {
    const s = buildBackupSignal({
      lastSuccess: success({ sizeBytes: null, durationMs: null }),
      lastFailure: null,
      now: NOW,
    });
    expect(s.tone).toBe("success");
    expect(s.detail).toContain("Last backup 9h ago");
    expect(s.detail).not.toContain("undefined");
    expect(s.detail).not.toContain("NaN");
  });

  it("formats byte sizes without pretending to precision it does not have", () => {
    expect(buildBackupSignal({ lastSuccess: success({ sizeBytes: 900 }), lastFailure: null, now: NOW }).detail).toContain("900 B");
    expect(buildBackupSignal({ lastSuccess: success({ sizeBytes: 5_368_709_120 }), lastFailure: null, now: NOW }).detail).toContain("5.0 GB");
  });
});
