/**
 * 判官第二轮(PR #1160)交回的 P1-1 回归测试:证明 purgeOrphanedReferenceAssets 的
 * `SELECT ... FOR UPDATE` 真的挡住并发的 ReferenceImage 外键插入。
 * 已验证:带锁 => insertAt 1536ms / commitAt 1535ms(绿);去掉 FOR UPDATE => insertAt 323ms(红)。
 * 放置位置建议: apps/web/lib/__tests__/asset-purge-lock.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

const { prisma } = await import("@fikirtive/db");
const { purgeOrphanedReferenceAssets } = await import("../asset-purge");

const OWNER = `org-purgelock-${randomUUID().slice(0, 8)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let assetId = "", entityA = "", entityB = "", refA = "";

beforeAll(async () => {
  await prisma.organization.create({ data: { id: OWNER, name: "Purge lock probe" } });
  assetId = `ast-${randomUUID()}`;
  await prisma.asset.create({
    data: { id: assetId, ownerId: OWNER, contentHash: randomUUID().replace(/-/g, "").padEnd(64, "0"),
            ext: "png", mime: "image/png", sizeBytes: BigInt(3), originalFilename: "p.png", source: "UPLOAD" },
  });
  entityA = `ent-${randomUUID()}`; entityB = `ent-${randomUUID()}`;
  await prisma.entity.create({ data: { id: entityA, ownerId: OWNER, type: "CHARACTER", name: "A" } });
  await prisma.entity.create({ data: { id: entityB, ownerId: OWNER, type: "CHARACTER", name: "B" } });
  refA = `ri-${randomUUID()}`;
  await prisma.referenceImage.create({ data: { id: refA, ownerId: OWNER, entityId: entityA, assetId, position: 0 } });
});

afterAll(async () => {
  await prisma.referenceImage.deleteMany({ where: { ownerId: OWNER } });
  await prisma.entity.deleteMany({ where: { ownerId: OWNER } });
  await prisma.asset.deleteMany({ where: { ownerId: OWNER } });
  await prisma.organization.deleteMany({ where: { id: OWNER } });
});

describe("P1-1: purgeOrphanedReferenceAssets 的 FOR UPDATE 挡住并发外键插入 (判官第二轮回归测试, 2026-09-03 S4 变更登记 — 非新验收编号)", () => {
  it("并发 ReferenceImage 插入必须等清理事务提交后才落地", async () => {
    const t0 = Date.now();
    let commitAt = 0, insertAt = 0, purgedCount = -1;

    const purgeTx = prisma.$transaction(async (tx) => {
      await tx.referenceImage.updateMany({ where: { id: refA, ownerId: OWNER }, data: { deletedAt: new Date() } });
      purgedCount = (await purgeOrphanedReferenceAssets(tx as never, OWNER, [assetId])).length;
      await sleep(1500); // 握住锁
    }, { timeout: 20_000 }).then(() => { commitAt = Date.now() - t0; });

    await sleep(300);
    const insert = prisma.referenceImage
      .create({ data: { id: `ri-${randomUUID()}`, ownerId: OWNER, entityId: entityB, assetId, position: 0 } })
      .then(() => { insertAt = Date.now() - t0; });

    await Promise.all([purgeTx, insert]);
    expect(purgedCount).toBe(1);
    expect(insertAt).toBeGreaterThanOrEqual(commitAt - 50); // 没有从事务中间挤进来
    expect(insertAt).toBeGreaterThan(1200);                 // 真的等满了 1.5s
  }, 40_000);
});
