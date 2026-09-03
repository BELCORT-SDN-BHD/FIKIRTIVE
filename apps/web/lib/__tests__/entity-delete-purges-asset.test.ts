/**
 * 2026-09-03 staging 走查 S4(Founder 裁「现在就修」;登记 creation-engine.md §5 2026-09-03,
 * 非新验收编号)—— 真库集成测试,不 mock Prisma、不 mock storage:mock 只能证明代码「摆对了
 * 形状」,证明不了字节真的从磁盘上消失。这份测试跑的是真实 Postgres + 真实 LocalDiskStorage
 * (STORAGE_DRIVER 未设 → local,见 apps/web/.env.local)。
 *
 * 覆盖 asset-purge.ts 的判据(独占才真删,共享只解引用),分别验:
 *   · 删演员 ⇒ 该演员独占的参考照 Asset.deletedAt 被标记、存储对象物理消失;
 *   · 同一张照片(同一 Asset)被另一个还活着的实体引用 ⇒ 只解引用,对象保留,直到最后一个
 *     引用者也被删掉;
 *   · 同一张照片被一个 Generation 引用过(哪怕那个 Generation 后来被软删)⇒ 永不真删——
 *     Generation 历史「不可变，永不物理删」的合同压在 Asset 这个墓碑上,不容打破;
 *   · 双租户(P2-3:判官第一轮复审——两个方向都验,原稿只验了一个方向):B 不能删 A 的演员,
 *     A 不能删 B 的演员,softDeleteReferenceImage 跨租户同样被挡;
 *   · softDeleteReferenceImage(单张参考图删除,Otto 用的就是这一个)同样真删独占资产;
 *   · P1-1/P1-2(判官第一轮复审):锁 + 真删前二次核验的变异测试——用「复活场景」证明,见文末。
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

const mockOwner = vi.fn();

vi.mock("../auth-guard", async () => ({
  requireOwner: mockOwner,
  resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { prisma } = await import("@fikirtive/db");
const { storage } = await import("../storage");
const { storageKey } = await import("@fikirtive/core");
const { softDeleteEntity, softDeleteReferenceImage } = await import("../actions");
const { purgeOrphanedReferenceAssets, purgeAssetStorage } = await import("../asset-purge");

const OWNER_A = `org-castpurge-a-${randomUUID().slice(0, 8)}`;
const OWNER_B = `org-castpurge-b-${randomUUID().slice(0, 8)}`;
const PROJECT_A = `proj-${randomUUID()}`;

/** Writes real bytes through the real storage driver and creates the matching Asset row —
 *  mirrors how content-addressed upload actually works, so `storage.exists` is a genuine
 *  filesystem check, not a fixture. */
async function putAsset(ownerId: string, seed: string): Promise<{ assetId: string; key: string }> {
  const bytes = new TextEncoder().encode(`castpurge-${seed}-${randomUUID()}`);
  const { contentHash, key } = await storage.put(ownerId, bytes, "png");
  const assetId = `ast-${randomUUID()}`;
  await prisma.asset.create({
    data: {
      id: assetId, ownerId, contentHash, ext: "png", mime: "image/png",
      sizeBytes: BigInt(bytes.byteLength), originalFilename: "ref.png", source: "UPLOAD",
    },
  });
  return { assetId, key };
}

async function createEntityRow(ownerId: string, name: string): Promise<string> {
  const id = `ent-${randomUUID()}`;
  await prisma.entity.create({ data: { id, ownerId, type: "CHARACTER", name } });
  return id;
}

async function attachRef(ownerId: string, entityId: string, assetId: string, position = 0): Promise<string> {
  const id = `ri-${randomUUID()}`;
  await prisma.referenceImage.create({ data: { id, ownerId, entityId, assetId, position } });
  return id;
}

beforeAll(async () => {
  await prisma.organization.create({ data: { id: OWNER_A, name: "Cast purge shop A" } });
  await prisma.organization.create({ data: { id: OWNER_B, name: "Cast purge shop B" } });
  await prisma.project.create({ data: { id: PROJECT_A, ownerId: OWNER_A, name: "Cast purge project" } });
});

afterAll(async () => {
  for (const owner of [OWNER_A, OWNER_B]) {
    await prisma.referenceImage.deleteMany({ where: { ownerId: owner } });
    await prisma.generation.deleteMany({ where: { ownerId: owner } });
    await prisma.entity.deleteMany({ where: { ownerId: owner } });
    const leftoverAssets = await prisma.asset.findMany({ where: { ownerId: owner }, select: { ownerId: true, contentHash: true, ext: true } });
    await prisma.asset.deleteMany({ where: { ownerId: owner } });
    await prisma.project.deleteMany({ where: { ownerId: owner } });
    await prisma.actionEvent.deleteMany({ where: { ownerId: owner } });
    await prisma.organization.deleteMany({ where: { id: owner } });
    // best-effort disk cleanup for anything this file's assertions left behind on purpose
    // (the Generation-protected asset, and any asset a failed run didn't get to purge)
    for (const a of leftoverAssets) {
      await storage.deleteObject(storageKey(a.ownerId, a.contentHash, a.ext)).catch(() => {});
    }
  }
});

describe("softDeleteEntity purges the storage bytes of assets it made orphan (2026-09-03 S4 变更登记, creation-engine.md §5 — 非新验收编号)", () => {
  it("an entity's EXCLUSIVE reference photo: Asset.deletedAt set AND the object is physically gone", async () => {
    mockOwner.mockResolvedValue({ ownerId: OWNER_A, email: "a@castpurge.test" });
    const entityId = await createEntityRow(OWNER_A, "Solo Cast");
    const { assetId, key } = await putAsset(OWNER_A, "exclusive");
    await attachRef(OWNER_A, entityId, assetId);

    expect(await storage.exists(key)).toBe(true);

    const res = await softDeleteEntity(entityId);
    expect(res).toEqual({ ok: true, shotRefs: 0 });

    const [entity, ref, asset] = await Promise.all([
      prisma.entity.findFirst({ where: { id: entityId, ownerId: OWNER_A } }),
      prisma.referenceImage.findFirst({ where: { entityId, ownerId: OWNER_A } }),
      prisma.asset.findFirst({ where: { id: assetId, ownerId: OWNER_A } }),
    ]);
    expect(entity?.deletedAt).not.toBeNull();
    expect(ref?.deletedAt).not.toBeNull();
    expect(asset?.deletedAt).not.toBeNull(); // real deletion, not just a hidden row

    expect(await storage.exists(key)).toBe(false); // the byte-level assertion the Founder asked for
  });

  it("a photo SHARED by another still-live entity: reference is dropped, the object survives until the last one goes", async () => {
    mockOwner.mockResolvedValue({ ownerId: OWNER_A, email: "a@castpurge.test" });
    const entity1 = await createEntityRow(OWNER_A, "Shared Cast 1");
    const entity2 = await createEntityRow(OWNER_A, "Shared Cast 2");
    const { assetId, key } = await putAsset(OWNER_A, "shared");
    await attachRef(OWNER_A, entity1, assetId);
    await attachRef(OWNER_A, entity2, assetId);

    // deleting entity1 must NOT touch the object — entity2 still points at the same asset
    const res1 = await softDeleteEntity(entity1);
    expect(res1).toEqual({ ok: true, shotRefs: 0 });
    let asset = await prisma.asset.findFirst({ where: { id: assetId, ownerId: OWNER_A } });
    expect(asset?.deletedAt).toBeNull();
    expect(await storage.exists(key)).toBe(true);

    // now the LAST live reference goes — the asset finally becomes exclusive-to-nothing
    const res2 = await softDeleteEntity(entity2);
    expect(res2).toEqual({ ok: true, shotRefs: 0 });
    asset = await prisma.asset.findFirst({ where: { id: assetId, ownerId: OWNER_A } });
    expect(asset?.deletedAt).not.toBeNull();
    expect(await storage.exists(key)).toBe(false);
  });

  it("a photo used by a Generation — even a SOFT-DELETED one — is never purged: Generation history is never physically deleted", async () => {
    mockOwner.mockResolvedValue({ ownerId: OWNER_A, email: "a@castpurge.test" });
    const entityId = await createEntityRow(OWNER_A, "Generation-linked Cast");
    const { assetId, key } = await putAsset(OWNER_A, "gen-linked");
    await attachRef(OWNER_A, entityId, assetId);
    const genId = `gen-${randomUUID()}`;
    await prisma.generation.create({
      data: {
        id: genId, ownerId: OWNER_A, projectId: PROJECT_A, assetId, source: "UPLOAD",
        entitySnapshot: { entities: [] },
        deletedAt: new Date(), // soft-deleted generation — still counts, per the contract
      },
    });

    const res = await softDeleteEntity(entityId);
    expect(res).toEqual({ ok: true, shotRefs: 0 });

    const asset = await prisma.asset.findFirst({ where: { id: assetId, ownerId: OWNER_A } });
    expect(asset?.deletedAt).toBeNull(); // NOT purged — a Generation still references it
    expect(await storage.exists(key)).toBe(true);
  });

  it("tenant isolation: org B cannot delete org A's entity, and A's data (row + asset + storage) is untouched", async () => {
    const entityId = await createEntityRow(OWNER_A, "A's Cast");
    const { assetId, key } = await putAsset(OWNER_A, "tenant-a-only");
    await attachRef(OWNER_A, entityId, assetId);

    mockOwner.mockResolvedValue({ ownerId: OWNER_B, email: "b@castpurge.test" });
    const res = await softDeleteEntity(entityId);
    expect(res).toEqual({ error: "Entity not found." });

    const [entity, asset] = await Promise.all([
      prisma.entity.findFirst({ where: { id: entityId, ownerId: OWNER_A } }),
      prisma.asset.findFirst({ where: { id: assetId, ownerId: OWNER_A } }),
    ]);
    expect(entity?.deletedAt).toBeNull();
    expect(asset?.deletedAt).toBeNull();
    expect(await storage.exists(key)).toBe(true);

    // cleanup as A, since B's attempt correctly did nothing
    mockOwner.mockResolvedValue({ ownerId: OWNER_A, email: "a@castpurge.test" });
    await softDeleteEntity(entityId);
  });

  it("P2-3(判官第一轮复审,补另一个方向): org A cannot delete org B's entity, and B's data (row + asset + storage) is untouched", async () => {
    mockOwner.mockResolvedValue({ ownerId: OWNER_B, email: "b@castpurge.test" });
    const entityId = await createEntityRow(OWNER_B, "B's Cast");
    const { assetId, key } = await putAsset(OWNER_B, "tenant-b-only");
    await attachRef(OWNER_B, entityId, assetId);

    mockOwner.mockResolvedValue({ ownerId: OWNER_A, email: "a@castpurge.test" });
    const res = await softDeleteEntity(entityId);
    expect(res).toEqual({ error: "Entity not found." });

    const [entity, asset] = await Promise.all([
      prisma.entity.findFirst({ where: { id: entityId, ownerId: OWNER_B } }),
      prisma.asset.findFirst({ where: { id: assetId, ownerId: OWNER_B } }),
    ]);
    expect(entity?.deletedAt).toBeNull();
    expect(asset?.deletedAt).toBeNull();
    expect(await storage.exists(key)).toBe(true);

    // cleanup as B, since A's attempt correctly did nothing
    mockOwner.mockResolvedValue({ ownerId: OWNER_B, email: "b@castpurge.test" });
    await softDeleteEntity(entityId);
  });
});

describe("softDeleteReferenceImage (the single-photo removal Otto's port calls) purges the same way", () => {
  it("removing the ONLY live reference of a still-live entity purges its now-orphaned asset", async () => {
    mockOwner.mockResolvedValue({ ownerId: OWNER_A, email: "a@castpurge.test" });
    const entityId = await createEntityRow(OWNER_A, "Single-ref Cast");
    const { assetId, key } = await putAsset(OWNER_A, "single-ref");
    const refId = await attachRef(OWNER_A, entityId, assetId);

    const res = await softDeleteReferenceImage(refId);
    expect(res).toEqual({ ok: true });

    const asset = await prisma.asset.findFirst({ where: { id: assetId, ownerId: OWNER_A } });
    expect(asset?.deletedAt).not.toBeNull();
    expect(await storage.exists(key)).toBe(false);
  });

  it("removing one of TWO references on the same entity keeps the other photo's asset alive", async () => {
    mockOwner.mockResolvedValue({ ownerId: OWNER_A, email: "a@castpurge.test" });
    const entityId = await createEntityRow(OWNER_A, "Two-ref Cast");
    const first = await putAsset(OWNER_A, "two-ref-1");
    const second = await putAsset(OWNER_A, "two-ref-2");
    const refFirst = await attachRef(OWNER_A, entityId, first.assetId, 0);
    await attachRef(OWNER_A, entityId, second.assetId, 1);

    const res = await softDeleteReferenceImage(refFirst);
    expect(res).toEqual({ ok: true });

    const [assetFirst, assetSecond] = await Promise.all([
      prisma.asset.findFirst({ where: { id: first.assetId, ownerId: OWNER_A } }),
      prisma.asset.findFirst({ where: { id: second.assetId, ownerId: OWNER_A } }),
    ]);
    expect(assetFirst?.deletedAt).not.toBeNull();
    expect(await storage.exists(first.key)).toBe(false);
    expect(assetSecond?.deletedAt).toBeNull(); // the entity is still live and still shows this photo
    expect(await storage.exists(second.key)).toBe(true);
  });

  it("P2-3(判官第一轮复审): softDeleteReferenceImage is tenant-scoped too — org B cannot remove org A's reference image", async () => {
    mockOwner.mockResolvedValue({ ownerId: OWNER_A, email: "a@castpurge.test" });
    const entityId = await createEntityRow(OWNER_A, "Cross-tenant ref-delete Cast");
    const { assetId, key } = await putAsset(OWNER_A, "cross-tenant-ref");
    const refId = await attachRef(OWNER_A, entityId, assetId);

    mockOwner.mockResolvedValue({ ownerId: OWNER_B, email: "b@castpurge.test" });
    const res = await softDeleteReferenceImage(refId);
    expect(res).toEqual({ error: "Reference image not found." });

    const [ref, asset] = await Promise.all([
      prisma.referenceImage.findFirst({ where: { id: refId, ownerId: OWNER_A } }),
      prisma.asset.findFirst({ where: { id: assetId, ownerId: OWNER_A } }),
    ]);
    expect(ref?.deletedAt).toBeNull();
    expect(asset?.deletedAt).toBeNull();
    expect(await storage.exists(key)).toBe(true);

    // cleanup as A
    mockOwner.mockResolvedValue({ ownerId: OWNER_A, email: "a@castpurge.test" });
    await softDeleteReferenceImage(refId);
  });
});

describe("P1-2(判官第一轮复审)变异测试 —— 真删存储对象前的二次核验", () => {
  /**
   * 「复活场景」:模拟并发窗口里真实会发生的事——purgeOrphanedReferenceAssets 判定独占、
   * 打了墓碑之后,提交与真删存储对象之间,同一 owner/内容哈希的一次重新上传通过
   * assetUpsert(actions.ts)把这一行的 deletedAt 改回 null(唯一能这么做的路径)。这里直接
   * 手工把 deletedAt 拨回 null 来复现那个时间点——不需要真的起两个并发事务,结果完全等价:
   * purgeAssetStorage 拿到的 `purged` 数组和事务提交时判定的一样(合法,那一刻确实独占),
   * 但真删前重读一次这一行,应发现它已经被复活,从而跳过。
   *
   * 变异证据:把 asset-purge.ts 的 purgeAssetStorage 改回旧版(不重读 deletedAt,拿到 purged
   * 数组就直接删)会让下面「字节仍在」的断言从 true 变成 false,直接转红。
   */
  it("an asset resurrected between commit and physical delete keeps its bytes — the re-check catches it", async () => {
    mockOwner.mockResolvedValue({ ownerId: OWNER_A, email: "a@castpurge.test" });
    const entityId = await createEntityRow(OWNER_A, "Resurrection Cast");
    const { assetId, key } = await putAsset(OWNER_A, "resurrection");
    await attachRef(OWNER_A, entityId, assetId);

    const purged = await prisma.$transaction(async (tx) => {
      await tx.referenceImage.updateMany({ where: { entityId, ownerId: OWNER_A, deletedAt: null }, data: { deletedAt: new Date() } });
      return purgeOrphanedReferenceAssets(tx, OWNER_A, [assetId]);
    });
    expect(purged).toHaveLength(1); // legitimately exclusive at commit time — matches production

    const tombstoned = await prisma.asset.findFirst({ where: { id: assetId, ownerId: OWNER_A } });
    expect(tombstoned?.deletedAt).not.toBeNull();

    // the race: a same-content re-upload's assetUpsert() resurrects the row before the
    // storage delete runs — the ONLY path that can flip deletedAt back to null.
    await prisma.asset.update({ where: { id_ownerId: { id: assetId, ownerId: OWNER_A } }, data: { deletedAt: null } });

    await purgeAssetStorage(purged);

    expect(await storage.exists(key)).toBe(true); // resurrected — the bytes must survive
    const finalAsset = await prisma.asset.findFirst({ where: { id: assetId, ownerId: OWNER_A } });
    expect(finalAsset?.deletedAt).toBeNull(); // still revived, untouched by the purge attempt

    // cleanup
    await softDeleteEntity(entityId).catch(() => {});
  });
});

describe("P2-5(判官第二轮复审) —— purgeAssetStorage 的真删前重读自己失败,不该把商家已经成功的删除动作变成一次失败", () => {
  it("a transient DB error on the pre-delete re-check is caught: softDeleteEntity still returns ok, and the object is left for the leftover sweep to retry", async () => {
    mockOwner.mockResolvedValue({ ownerId: OWNER_A, email: "a@castpurge.test" });
    const entityId = await createEntityRow(OWNER_A, "Re-check DB blip Cast");
    const { assetId, key } = await putAsset(OWNER_A, "recheck-db-blip");
    await attachRef(OWNER_A, entityId, assetId);

    // vi.spyOn on the tenant-guard-extended prisma client's model delegate does not survive
    // mockRestore() cleanly (the extension wraps model accessors, and restoring the original
    // descriptor leaves findFirst undefined — reproduced while writing this test) — so instead
    // of spy+restore, temporarily replace the bound method and put the SAME reference back by
    // hand, which is safe here because Object.getOwnPropertyDescriptor confirms `findFirst` is
    // a plain own, writable property on `prisma.asset` (not a getter/proxy trap).
    const originalFindFirst = prisma.asset.findFirst;
    let calls = 0;
    prisma.asset.findFirst = ((...args: Parameters<typeof originalFindFirst>) => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error("simulated: too many database connections"));
      return originalFindFirst.apply(prisma.asset, args);
    }) as typeof originalFindFirst;

    const res = await softDeleteEntity(entityId);
    expect(res).toEqual({ ok: true, shotRefs: 0 }); // the DB-side tombstone genuinely committed — this must still read as success

    prisma.asset.findFirst = originalFindFirst;

    const [entity, ref, asset] = await Promise.all([
      prisma.entity.findFirst({ where: { id: entityId, ownerId: OWNER_A } }),
      prisma.referenceImage.findFirst({ where: { entityId, ownerId: OWNER_A } }),
      prisma.asset.findFirst({ where: { id: assetId, ownerId: OWNER_A } }),
    ]);
    expect(entity?.deletedAt).not.toBeNull();
    expect(ref?.deletedAt).not.toBeNull();
    expect(asset?.deletedAt).not.toBeNull(); // DB tombstone is real and unaffected by the re-check's own failure

    // the re-check couldn't confirm it was safe, so the byte delete was skipped this round —
    // the object is still there, left for scripts/tools/purge-deleted-entity-assets.ts's
    // leftover sweep (same predicate: deletedAt set + object still present) to retry.
    expect(await storage.exists(key)).toBe(true);

    // cleanup: purge it for real now that the re-check can succeed
    await purgeAssetStorage([{ id: assetId, ownerId: OWNER_A, contentHash: (await prisma.asset.findFirst({ where: { id: assetId, ownerId: OWNER_A } }))!.contentHash, ext: "png" }]);
  });
});
