/**
 * 2026-09-03 staging 走查 S4(Founder 裁「现在就修」)—— 真库集成测试,不 mock Prisma、不 mock
 * storage:mock 只能证明代码「摆对了形状」,证明不了字节真的从磁盘上消失。这份测试跑的是
 * 真实 Postgres + 真实 LocalDiskStorage(STORAGE_DRIVER 未设 → local,见 apps/web/.env.local)。
 *
 * 覆盖 asset-purge.ts 的判据(独占才真删,共享只解引用),分别验:
 *   · 删演员 ⇒ 该演员独占的参考照 Asset.deletedAt 被标记、存储对象物理消失;
 *   · 同一张照片(同一 Asset)被另一个还活着的实体引用 ⇒ 只解引用,对象保留,直到最后一个
 *     引用者也被删掉;
 *   · 同一张照片被一个 Generation 引用过(哪怕那个 Generation 后来被软删)⇒ 永不真删——
 *     Generation 历史「不可变，永不物理删」的合同压在 Asset 这个墓碑上,不容打破;
 *   · 双租户:B 不能删 A 的演员,A 的 Entity/ReferenceImage/Asset/存储对象原样不动;
 *   · softDeleteReferenceImage(单张参考图删除,Otto 用的就是这一个)同样真删独占资产。
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

describe("softDeleteEntity purges the storage bytes of assets it made orphan", () => {
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
});
