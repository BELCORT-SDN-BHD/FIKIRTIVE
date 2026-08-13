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
  // TRUNCATE, not deleteMany: the append-only trigger rejects row-level DELETE
  // (judge r2 P2). TRUNCATE is a table-level operation and does not fire it.
  await prisma.$executeRawUnsafe('TRUNCATE "BackupRun"');
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

  it("REFUSES a trigger outside {cron, worker-timer, manual} (judge r1 P2)", async () => {
    await expect(prisma.backupRun.create({ data: { ...succeeded, trigger: "timer" } })).rejects.toThrow();
    await expect(prisma.backupRun.create({ data: { ...succeeded, trigger: "CRON" } })).rejects.toThrow();
  });

  it("REFUSES a success that cannot say WHEN it finished", async () => {
    await expect(prisma.backupRun.create({ data: { ...succeeded, finishedAt: null } })).rejects.toThrow();
  });

  it("REFUSES a success that cannot say WHICH object it wrote", async () => {
    await expect(prisma.backupRun.create({ data: { ...succeeded, key: null } })).rejects.toThrow();
  });

  it("is append-only: UPDATE is rejected by the database (judge r1 P2)", async () => {
    // 改写一条记录才能伪造新鲜度(把 failed 改成 succeeded、挪 finishedAt),所以 UPDATE 被拦。
    const row = await prisma.backupRun.create({ data: succeeded });
    await expect(
      prisma.backupRun.update({ where: { id: row.id }, data: { error: "rewritten after the fact" } }),
    ).rejects.toThrow(/append-only|not permitted/i);
    // 未被改动:原样读回。
    const after = await prisma.backupRun.findUnique({ where: { id: row.id } });
    expect(after?.error).toBeNull();
  });

  it("is append-only: DELETE is rejected too (judge r2 P2)", async () => {
    // 删除一样能伪造新鲜度:admin 只在「最近一次失败发生在最近一次成功之后」时把那一格
    // 降成 retry failed,所以删掉那条失败行,面板就变回一片绿。
    const row = await prisma.backupRun.create({ data: succeeded });
    await expect(prisma.backupRun.delete({ where: { id: row.id } })).rejects.toThrow(/append-only|not permitted/i);
    await expect(prisma.backupRun.deleteMany({})).rejects.toThrow(/append-only|not permitted/i);
    expect(await prisma.backupRun.findUnique({ where: { id: row.id } })).not.toBeNull();
  });

  it("a post-success failure row cannot be erased — the exact panel-forging move (judge r2 P2)", async () => {
    const successAt = new Date(Date.now() - 9 * 3_600_000);
    await prisma.backupRun.create({ data: { ...succeeded, id: "s1", finishedAt: successAt } });
    const failure = await prisma.backupRun.create({
      data: { id: "f1", status: "failed", trigger: "cron", credentialMode: "isolated", finishedAt: new Date(), error: "R2 PutObject 403" },
    });
    // 这一条正是把面板从 "retry failed" 变回 "fresh/green" 的那一步 —— 数据库拒绝它。
    await expect(prisma.backupRun.delete({ where: { id: failure.id } })).rejects.toThrow(/append-only|not permitted/i);
    const stillThere = await prisma.backupRun.findFirst({ where: { status: "failed" }, orderBy: { finishedAt: "desc" } });
    expect(stillThere?.error).toBe("R2 PutObject 403");
  });

  it("TRUNCATE still works — the cleanup path tests use (table-level, no row trigger)", async () => {
    await prisma.backupRun.create({ data: succeeded });
    await expect(prisma.$executeRawUnsafe('TRUNCATE "BackupRun"')).resolves.toBeDefined();
    expect(await prisma.backupRun.findFirst({})).toBeNull();
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
