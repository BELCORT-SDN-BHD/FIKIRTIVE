/**
 * /api/health 集成测试(真库)——外部监控的探测点(2026-07-04 盲区修复)。
 *
 * #796 判官 r1 之后这里守两件新事:
 *   - 存活端点即使在迁移失败时也回 200(它答得出话就是活着),但 body 里如实说 —— 做
 *     「切不切流量」判断的是 /api/ready,那一头的测试在隔壁 ready/__tests__。
 *   - 拆成算力/等待两班之后,每班一行心跳;顶层 `worker` 字段的含义仍是「至少一班活着」。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@fikirtive/db";
import { WORKER_STALE_MS, BACKUP_STALE_MS } from "@/lib/health";
import { MIGRATION_STATUS_ENV } from "@/lib/boot-status";
import { GET } from "../route";

const stale = () => new Date(Date.now() - WORKER_STALE_MS - 1000);

beforeEach(async () => {
  await prisma.workerHeartbeat.deleteMany({});
  // TRUNCATE: BackupRun is append-only — the trigger rejects row-level DELETE (#794 judge r2 P2).
  await prisma.$executeRawUnsafe('TRUNCATE "BackupRun"');
});
afterEach(() => {
  delete process.env[MIGRATION_STATUS_ENV];
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
    expect(await res.json()).toEqual({
      ok: true,
      db: "up",
      worker: "unknown",
      workers: {},
      backup: "missing",
      migrations: "applied",
    });
  });

  // #796: the web container now starts even when `prisma migrate deploy` could not run, because
  // an old-schema site beats a crash loop. Liveness stays 200 — the process really is alive — and
  // /api/ready is what keeps traffic off it. This field is how a human/monitor sees the state.
  it("boot said the migrations failed → still 200 (liveness), but the body says so", async () => {
    process.env[MIGRATION_STATUS_ENV] = "failed";
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).migrations).toBe("failed");
  });

  it("fresh heartbeat → worker up", async () => {
    await prisma.workerHeartbeat.create({ data: { id: "worker", at: new Date() } });
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).worker).toBe("up");
  });

  it("stale heartbeat (worker died) → worker stale, still 200 (web itself is up)", async () => {
    await prisma.workerHeartbeat.create({ data: { id: "worker", at: stale() } });
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
      expect(Object.keys(body).sort()).toEqual(["backup", "db", "migrations", "ok", "worker", "workers"]);
      expect(JSON.stringify(body)).not.toContain("backups/db/");
    });
  });

  // #796 判官 r1 P2-2 —— 拆分之后的三条断言。
  describe("拆成两班之后(判官 P2-2)", () => {
    it("两班都活着 → 每班一行,各自 up", async () => {
      await prisma.workerHeartbeat.createMany({
        data: [{ id: "worker-compute", at: new Date() }, { id: "worker-wait", at: new Date() }],
      });
      const body = await (await GET()).json();
      expect(body.worker).toBe("up");
      expect(body.workers).toEqual({ "worker-compute": "up", "worker-wait": "up" });
    });

    it("算力班死了 —— 等待班的心跳不再把它盖住", async () => {
      // 这就是 P2-2 的整个理由:共用一行时,活着的那一班会让 /api/health 一直说 "up",
      // 而商家那边视频再也出不来,没有任何地方看得见。
      await prisma.workerHeartbeat.createMany({
        data: [{ id: "worker-compute", at: stale() }, { id: "worker-wait", at: new Date() }],
      });
      const body = await (await GET()).json();
      expect(body.workers["worker-compute"]).toBe("stale");
      expect(body.workers["worker-wait"]).toBe("up");
    });

    it("从 all 切到拆分后,没人再写的旧 \"worker\" 行不会把顶层字段拖成 stale", async () => {
      // 顶层字段的含义没变(至少一班活着)。取「最差」会在切换后永远报 stale —— 一个纯假警报。
      await prisma.workerHeartbeat.createMany({
        data: [{ id: "worker", at: stale() }, { id: "worker-wait", at: new Date() }, { id: "worker-compute", at: new Date() }],
      });
      const body = await (await GET()).json();
      expect(body.worker).toBe("up");
      expect(body.workers.worker).toBe("stale");
    });
  });
});
