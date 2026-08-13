/**
 * #794 ③ — 备份新鲜度真的出现在 admin 读模型里,而且说的是 DB 里那一行的事实。
 *
 * 上面几层(纯函数 tone/文案、DB 约束、/api/health)各自有测试。这一层测的是把它们串起来的
 * 那一段:`getAdminV2Data()` 会不会真的去查 `BackupRun`、会不会把结果放进 System health
 * 面板和首页 risk signals。少了这一段,前面全绿也可能是「面板上根本没有这一格」。
 *
 * 只 mock 角色闸;Prisma、租户守卫、读模型全真跑(与 admin-routes-load.test.ts 同一形态)。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-guard", () => ({
  requireRole: vi.fn(async () => ({
    email: "founder@fikirtive.test",
    roles: ["super-admin"],
    role: "super-admin",
  })),
  requireOwner: vi.fn(async () => ({ email: "founder@fikirtive.test", ownerId: "founder" })),
}));

const { prisma } = await import("@fikirtive/db");
const { getAdminV2Data } = await import("@/lib/admin-v2");

const HOUR = 3_600_000;

beforeEach(async () => {
  // TRUNCATE: BackupRun is append-only — the trigger rejects row-level DELETE (#794 judge r2 P2).
  await prisma.$executeRawUnsafe('TRUNCATE "BackupRun"');
});

async function record(over: {
  status: "succeeded" | "failed";
  finishedAt: Date;
  credentialMode?: string;
  error?: string;
}) {
  await prisma.backupRun.create({
    data: {
      status: over.status,
      trigger: "cron",
      credentialMode: over.credentialMode ?? "isolated",
      startedAt: new Date(over.finishedAt.getTime() - 47_000),
      finishedAt: over.finishedAt,
      key: over.status === "succeeded" ? "backups/db/fikirtive-2026-08-11.dump.gz" : null,
      sizeBytes: over.status === "succeeded" ? BigInt(42_000_000) : null,
      durationMs: 47_000,
      error: over.error ?? null,
    },
  });
}

const backupIncident = (data: Awaited<ReturnType<typeof getAdminV2Data>>) =>
  data.systemIncidents.find((row) => row.id === "backup-freshness");
const backupRisk = (data: Awaited<ReturnType<typeof getAdminV2Data>>) =>
  data.riskSignals.find((row) => row.id === "backup-freshness");

describe("#794 — admin surfaces database backup freshness", () => {
  it("with no backup ever recorded, the panel says so loudly instead of staying silent", async () => {
    const data = await getAdminV2Data();
    const incident = backupIncident(data);
    expect(incident).toBeDefined();
    expect(incident!.area).toBe("Database backup");
    expect(incident!.status).toBe("never run");
    expect(incident!.tone).toBe("danger");

    const risk = backupRisk(data);
    expect(risk).toBeDefined();
    expect(risk!.value).toBe("never");
    expect(risk!.href).toBe("/admin/system");
  });

  it("a fresh isolated-credential backup reads green, with the real size and trigger", async () => {
    await record({ status: "succeeded", finishedAt: new Date(Date.now() - 9 * HOUR) });
    const incident = backupIncident(await getAdminV2Data())!;
    expect(incident.status).toBe("fresh");
    expect(incident.tone).toBe("success");
    expect(incident.count).toBe(9);
    expect(incident.detail).toContain("40 MB");
    expect(incident.detail).toContain("cron trigger");
    expect(incident.detail).toContain("isolated backup credential");
  });

  it("a backup older than the window reads danger on the home page too", async () => {
    await record({ status: "succeeded", finishedAt: new Date(Date.now() - 40 * HOUR) });
    const data = await getAdminV2Data();
    expect(backupIncident(data)!.status).toBe("stale");
    expect(backupRisk(data)!.tone).toBe("danger");
    expect(backupRisk(data)!.value).toBe("40h ago");
  });

  it("a failure after a fresh success is shown without hiding the success", async () => {
    await record({ status: "succeeded", finishedAt: new Date(Date.now() - 9 * HOUR) });
    await record({ status: "failed", finishedAt: new Date(Date.now() - HOUR), error: "R2 PutObject 403" });
    const incident = backupIncident(await getAdminV2Data())!;
    expect(incident.status).toBe("retry failed");
    expect(incident.detail).toContain("Last backup 9h ago");
    expect(incident.detail).toContain("R2 PutObject 403");
  });

  it("a fresh backup on the SHARED content credential is a warning, not green", async () => {
    await record({ status: "succeeded", finishedAt: new Date(Date.now() - 9 * HOUR), credentialMode: "shared" });
    const incident = backupIncident(await getAdminV2Data())!;
    expect(incident.tone).toBe("warning");
    expect(incident.detail).toContain("shared content credential (not isolated)");
  });
});
