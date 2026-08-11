/**
 * /api/health 集成测试(真库)——外部监控的探测点(2026-07-04 盲区修复)。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@fikirtive/db";
import { WORKER_STALE_MS, BACKUP_STALE_MS } from "@/lib/health";
import { GET } from "../route";

beforeEach(async () => {
  await prisma.workerHeartbeat.deleteMany({});
  await prisma.backupRun.deleteMany({});
});

async function recordBackup(over: { status: "succeeded" | "failed"; finishedAt: Date }) {
  await prisma.backupRun.create({
    data: {
      status: over.status,
      trigger: "cron",
      credentialMode: "isolated",
      startedAt: new Date(over.finishedAt.getTime() - 30_000),
      finishedAt: over.finishedAt,
      key: over.status === "succeeded" ? "backups/db/fikirtive-2026-08-11.dump.gz" : null,
      durationMs: 30_000,
    },
  });
}

describe("GET /api/health", () => {
  it("db up + no heartbeat row → 200, worker unknown", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: "up", worker: "unknown", backup: "missing" });
  });

  it("fresh heartbeat → worker up", async () => {
    await prisma.workerHeartbeat.create({ data: { id: "worker", at: new Date() } });
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).worker).toBe("up");
  });

  it("stale heartbeat (worker died) → worker stale, still 200 (web itself is up)", async () => {
    await prisma.workerHeartbeat.create({ data: { id: "worker", at: new Date(Date.now() - WORKER_STALE_MS - 1000) } });
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).worker).toBe("stale");
  });

  /** #794 ③ — 备份新鲜度是外部监控能打到的一个词。 */
  describe("backup freshness", () => {
    it("no BackupRun row ever → backup missing", async () => {
      expect((await (await GET()).json()).backup).toBe("missing");
    });

    it("a recent successful backup → backup fresh", async () => {
      await recordBackup({ status: "succeeded", finishedAt: new Date(Date.now() - 9 * 3_600_000) });
      expect((await (await GET()).json()).backup).toBe("fresh");
    });

    it("the last success is past the window → backup stale", async () => {
      await recordBackup({ status: "succeeded", finishedAt: new Date(Date.now() - BACKUP_STALE_MS - 60_000) });
      expect((await (await GET()).json()).backup).toBe("stale");
    });

    it("a FAILED row is not freshness — a failed attempt never counts as a backup", async () => {
      await recordBackup({ status: "failed", finishedAt: new Date() });
      expect((await (await GET()).json()).backup).toBe("missing");
    });

    it("a later failure does not erase a still-fresh success", async () => {
      await recordBackup({ status: "succeeded", finishedAt: new Date(Date.now() - 9 * 3_600_000) });
      await recordBackup({ status: "failed", finishedAt: new Date() });
      expect((await (await GET()).json()).backup).toBe("fresh");
    });

    it("a stale backup does NOT change the HTTP status — existing uptime monitors are untouched", async () => {
      await recordBackup({ status: "succeeded", finishedAt: new Date(Date.now() - BACKUP_STALE_MS - 60_000) });
      const res = await GET();
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
    });

    it("exposes only the one word — no key, size, or timestamp on this unauthenticated route", async () => {
      await recordBackup({ status: "succeeded", finishedAt: new Date() });
      const body = await (await GET()).json();
      expect(Object.keys(body).sort()).toEqual(["backup", "db", "ok", "worker"]);
      expect(JSON.stringify(body)).not.toContain("backups/db/");
    });
  });
});
