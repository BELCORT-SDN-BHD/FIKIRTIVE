/**
 * #794 ③ — BackupRun 的形状由**数据库**说了算,不是由写入方的自觉说了算。
 *
 * 这张表存在的唯一理由是回答一个问题:「昨晚的备份成功了吗」。所以能毁掉它的方式只有两种,
 * 两种都由约束挡住,而不是由约定挡住:
 *   ① 写进一个没人认识的 status/credentialMode(面板从此不知道该信哪一行);
 *   ② 写进一条「成功了,但说不出什么时候完成、传的是哪个对象」的成功行 ——
 *      那正是这张票要消灭的形状:一个说自己成功但拿不出证据的备份。
 *
 * 零钱路:只碰 BackupRun 一张表。
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { prisma } from "../index.js";

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});

beforeEach(async () => {
  await prisma.backupRun.deleteMany({});
});

const succeeded = {
  status: "succeeded",
  trigger: "cron",
  credentialMode: "isolated",
  finishedAt: new Date(),
  key: "backups/db/fikirtive-2026-08-11.dump.gz",
  sizeBytes: 42_000_000n,
  durationMs: 47_000,
};

describe("BackupRun — the database enforces what a backup record may say", () => {
  it("accepts a complete successful run", async () => {
    const row = await prisma.backupRun.create({ data: succeeded });
    expect(row.status).toBe("succeeded");
    expect(row.sizeBytes).toBe(42_000_000n);
  });

  it("accepts a failed run with no key and no finishedAt evidence", async () => {
    const row = await prisma.backupRun.create({
      data: { status: "failed", trigger: "cron", credentialMode: "shared", error: "pg_dump exited with code 1" },
    });
    expect(row.status).toBe("failed");
    expect(row.key).toBeNull();
  });

  it("accepts every trigger and credential mode the writers actually produce", async () => {
    for (const trigger of ["cron", "worker-timer", "manual"]) {
      for (const credentialMode of ["isolated", "shared"]) {
        await expect(
          prisma.backupRun.create({ data: { ...succeeded, trigger, credentialMode } }),
        ).resolves.toBeTruthy();
      }
    }
  });

  it("REFUSES a status outside {succeeded, failed}", async () => {
    await expect(prisma.backupRun.create({ data: { ...succeeded, status: "running" } })).rejects.toThrow();
    await expect(prisma.backupRun.create({ data: { ...succeeded, status: "SUCCEEDED" } })).rejects.toThrow();
  });

  it("REFUSES a credentialMode outside {isolated, shared}", async () => {
    await expect(prisma.backupRun.create({ data: { ...succeeded, credentialMode: "unknown" } })).rejects.toThrow();
  });

  it("REFUSES a success that cannot say WHEN it finished", async () => {
    await expect(prisma.backupRun.create({ data: { ...succeeded, finishedAt: null } })).rejects.toThrow();
  });

  it("REFUSES a success that cannot say WHICH object it wrote", async () => {
    await expect(prisma.backupRun.create({ data: { ...succeeded, key: null } })).rejects.toThrow();
  });

  it("the freshness query reads the last SUCCESS, never the last row", async () => {
    // 这是 /api/health 与 admin 用的那条查询。一次失败绝不能把上一次成功从面板上抹掉。
    const lastSuccessAt = new Date(Date.now() - 9 * 3_600_000);
    await prisma.backupRun.create({ data: { ...succeeded, finishedAt: lastSuccessAt } });
    await prisma.backupRun.create({
      data: { status: "failed", trigger: "cron", credentialMode: "isolated", finishedAt: new Date(), error: "R2 PutObject 403" },
    });

    const latest = await prisma.backupRun.findFirst({
      where: { status: "succeeded" },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    });
    expect(latest?.finishedAt?.toISOString()).toBe(lastSuccessAt.toISOString());
  });
});
