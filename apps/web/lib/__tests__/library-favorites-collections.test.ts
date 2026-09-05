/**
 * 素材库的收藏与合集 —— 打**真库**的行为测试(前端基线规格
 * `docs/specs/frontend-baseline.md` §7.3② 段②;验收 FRONT-A5 / FRONT-A6 / FRONT-A7)。
 *
 * 为什么是真库而不是 mock:这一段的全部主张都压在数据库自己身上 —— 唯一约束保证幂等、
 * 复合外键保证跨租户的合集连查都拼不出来、软删保证「删合集不删素材」。把 prisma mock 掉,
 * 剩下的只是「我调了我以为会成功的那句话」,而那正是这三条验收要证伪的东西。
 *
 * 两个租户各自登录、各自播种,每一条跨租户主张都**双向**验(A 看不见 B、B 看不见 A);
 * 单向验只能证明其中一半,而漏掉的那一半正是真事故的形状。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

// 与 isolation.test.ts 同一套:`requireOwner` 从 better-auth compat 读会话、从 allowlist
// 读邀请名单。两者都 mock —— 会话逐条可控,名单走环境变量(不碰库)。
const mockAuth = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({ auth: mockAuth }));
vi.mock("@/lib/allowlist", () => {
  function allowed(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = `${process.env.FOUNDER_ADMIN_EMAILS ?? ""},${process.env.AUTH_ALLOWED_EMAILS ?? ""}`
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  function isFounderAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = (process.env.FOUNDER_ADMIN_EMAILS ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  return { allowed, isFounderAdmin, isAllowedEmail: allowed };
});

const A_EMAIL = `libA-${randomUUID()}@fikirtive.test`;
const B_EMAIL = `libB-${randomUUID()}@fikirtive.test`;
beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = `${A_EMAIL},${B_EMAIL}`;
  process.env.FOUNDER_ADMIN_EMAILS = "noone@fikirtive.test";
});

const { requireOwner } = await import("@/lib/auth-guard");
const { prisma } = await import("@fikirtive/db");
const { storage } = await import("@/lib/storage");
const {
  setLibraryFavorite,
  listLibraryFavorites,
  listFavoriteKeys,
} = await import("@/lib/library-favorites");
const {
  addToCollection,
  createCollection,
  deleteCollection,
  getCollection,
  listCollectionMemberships,
  listCollections,
  removeFromCollection,
  renameCollection,
} = await import("@/lib/library-collections");
const { getGenerationHistory } = await import("@/lib/library-actions");
const { createCanvasNode } = await import("@/lib/canvas-actions");

function asUser(email: string) {
  mockAuth.mockResolvedValue({ user: { email } });
}

async function ensureUser(email: string) {
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { id: `usr_${randomUUID()}`, email },
  });
}

/** 播一件**真**素材:字节落到本地存储,行落到 Asset + Generation(读模型会检查文件在不在)。 */
async function seedGeneration(
  ownerId: string,
  projectId: string,
  opts: { source: "GENERATED" | "UPLOAD"; prompt: string; filename?: string },
) {
  const bytes = new Uint8Array(Buffer.from(`fikirtive-test-${randomUUID()}`));
  const { contentHash } = await storage.put(ownerId, bytes, "png");
  const asset = await prisma.asset.create({
    data: {
      id: `ast_${randomUUID()}`,
      ownerId,
      contentHash,
      ext: "png",
      mime: "image/png",
      sizeBytes: BigInt(bytes.byteLength),
      originalFilename: opts.filename ?? "",
      source: opts.source,
    },
  });
  const generation = await prisma.generation.create({
    data: {
      id: `gen_${randomUUID()}`,
      ownerId,
      projectId,
      assetId: asset.id,
      source: opts.source,
      promptText: opts.prompt,
      entitySnapshot: {},
    },
  });
  return generation.id;
}

let orgA: string;
let orgB: string;
let aProjectId: string;
let bProjectId: string;
let aGenerated: string;
let aUpload: string;
let aSecond: string;
let bGenerated: string;

beforeAll(async () => {
  await ensureUser(A_EMAIL);
  await ensureUser(B_EMAIL);

  asUser(A_EMAIL);
  const a = await requireOwner();
  if ("error" in a) throw new Error(a.error);
  orgA = a.ownerId;

  asUser(B_EMAIL);
  const b = await requireOwner();
  if ("error" in b) throw new Error(b.error);
  orgB = b.ownerId;
  expect(orgA).not.toBe(orgB);

  aProjectId = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id: aProjectId, ownerId: orgA, name: "A canvas" } });
  bProjectId = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id: bProjectId, ownerId: orgB, name: "B canvas" } });

  aGenerated = await seedGeneration(orgA, aProjectId, { source: "GENERATED", prompt: "raya storefront" });
  aUpload = await seedGeneration(orgA, aProjectId, {
    source: "UPLOAD",
    prompt: "",
    filename: "shopfront.png",
  });
  aSecond = await seedGeneration(orgA, aProjectId, { source: "GENERATED", prompt: "jasmine bottle" });
  bGenerated = await seedGeneration(orgB, bProjectId, { source: "GENERATED", prompt: "B only" });
});

describe("FRONT-A5:收藏来自服务器,刷新仍在", () => {
  it("FRONT-A5:收藏一件生成结果后,它出现在收藏列表里;取消之后消失,而素材本身仍在历史里", async () => {
    asUser(A_EMAIL);
    expect(await setLibraryFavorite("generation", aGenerated, true)).toEqual({ favorite: true });

    const favorites = await listLibraryFavorites();
    if ("error" in favorites) throw new Error(favorites.error);
    expect(favorites.items.map((item) => item.subjectId)).toContain(aGenerated);

    expect(await setLibraryFavorite("generation", aGenerated, false)).toEqual({ favorite: false });
    const after = await listLibraryFavorites();
    if ("error" in after) throw new Error(after.error);
    expect(after.items.map((item) => item.subjectId)).not.toContain(aGenerated);

    // 取消收藏删的是**链接**,不是素材 —— 它仍然在 canonical 的生成历史里。
    const history = await getGenerationHistory({ take: 60 });
    if ("error" in history) throw new Error(history.error);
    expect(history.items.map((item) => item.id)).toContain(aGenerated);
  });

  it("FRONT-A5:重复收藏同一件素材是幂等的 —— 收藏表里只有一行", async () => {
    asUser(A_EMAIL);
    await setLibraryFavorite("generation", aUpload, true);
    await setLibraryFavorite("generation", aUpload, true);
    const rows = await prisma.favorite.count({
      where: { ownerId: orgA, subjectType: "generation", subjectId: aUpload },
    });
    expect(rows).toBe(1);
    await setLibraryFavorite("generation", aUpload, false);
  });

  it("FRONT-A5:上传与生成结果混在同一个收藏列表里,按收藏时间倒序", async () => {
    asUser(A_EMAIL);
    await setLibraryFavorite("generation", aGenerated, true);
    await setLibraryFavorite("generation", aUpload, true);

    const favorites = await listLibraryFavorites();
    if ("error" in favorites) throw new Error(favorites.error);
    const ids = favorites.items.map((item) => item.subjectId);
    expect(ids.slice(0, 2)).toEqual([aUpload, aGenerated]);
    // 两类素材各自的身份没有丢 —— Uploads 是自己的一格,不是「另一种生成」。
    const sources = new Map(favorites.items.map((item) => [item.subjectId, item.source]));
    expect(sources.get(aUpload)).toBe("upload");
    expect(sources.get(aGenerated)).toBe("generated");

    await setLibraryFavorite("generation", aGenerated, false);
    await setLibraryFavorite("generation", aUpload, false);
  });

  it("FRONT-A5:收藏页游标分页不跳行也不重复", async () => {
    asUser(A_EMAIL);
    await setLibraryFavorite("generation", aGenerated, true);
    await setLibraryFavorite("generation", aUpload, true);
    await setLibraryFavorite("generation", aSecond, true);

    const first = await listLibraryFavorites({ take: 2 });
    if ("error" in first) throw new Error(first.error);
    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);

    const second = await listLibraryFavorites({ take: 2, cursor: first.nextCursor });
    if ("error" in second) throw new Error(second.error);
    const all = [...first.items, ...second.items].map((item) => item.subjectId);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toEqual(expect.arrayContaining([aGenerated, aUpload, aSecond]));
  });

  it("FRONT-A5:标记网格用的收藏集合只回这个租户自己的收藏", async () => {
    asUser(A_EMAIL);
    const keys = await listFavoriteKeys([
      { subjectType: "generation", subjectId: aGenerated },
      { subjectType: "generation", subjectId: bGenerated },
    ]);
    if ("error" in keys) throw new Error(keys.error);
    expect(keys.keys).toContain(`generation:${aGenerated}`);
    expect(keys.keys).not.toContain(`generation:${bGenerated}`);
  });

  it("FRONT-A5:两个租户互相看不见对方的收藏,也收藏不了对方的素材(双向)", async () => {
    asUser(B_EMAIL);
    // B 收藏 A 的素材:目标在 B 的租户里根本不存在,一律 Not found —— 不区分
    // 「不属于你」和「已删除」,因为这两者的区别本身就是跨租户的信息。
    expect(await setLibraryFavorite("generation", aGenerated, true)).toEqual({ error: "Not found." });
    const bFavorites = await listLibraryFavorites();
    if ("error" in bFavorites) throw new Error(bFavorites.error);
    expect(bFavorites.items.map((item) => item.subjectId)).not.toContain(aGenerated);

    asUser(A_EMAIL);
    expect(await setLibraryFavorite("generation", bGenerated, true)).toEqual({ error: "Not found." });
    const aFavorites = await listLibraryFavorites();
    if ("error" in aFavorites) throw new Error(aFavorites.error);
    expect(aFavorites.items.map((item) => item.subjectId)).not.toContain(bGenerated);

    await setLibraryFavorite("generation", aGenerated, false);
    await setLibraryFavorite("generation", aUpload, false);
    await setLibraryFavorite("generation", aSecond, false);
  });

  it("FRONT-A5:未登录 / 不在名单上的会话读不到任何收藏", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await listLibraryFavorites()).toHaveProperty("error");
    expect(await setLibraryFavorite("generation", aGenerated, true)).toHaveProperty("error");
  });
});

describe("FRONT-A6:合集增删改跨刷新成立,跨租户不可见", () => {
  it("FRONT-A6:建合集、加入一件生成结果与一件上传、移除一项、删除合集 —— 每一步都落库", async () => {
    asUser(A_EMAIL);
    const created = await createCollection("Raya launch");
    if ("error" in created) throw new Error(created.error);

    const added = await addToCollection(created.id, [
      { subjectType: "generation", subjectId: aGenerated },
      { subjectType: "generation", subjectId: aUpload },
    ]);
    expect(added).toEqual({ added: 2, skipped: 0, unavailable: 0 });

    // 「刷新之后仍然成立」= 重新读一次服务端,而不是看内存里那个 setState。
    const detail = await getCollection(created.id);
    if ("error" in detail) throw new Error(detail.error);
    expect(detail.collection.itemCount).toBe(2);
    expect(detail.collection.items.map((item) => item.subjectId).sort()).toEqual(
      [aGenerated, aUpload].sort(),
    );

    expect(await removeFromCollection(created.id, "generation", aUpload)).toEqual({ removed: 1 });
    const afterRemove = await getCollection(created.id);
    if ("error" in afterRemove) throw new Error(afterRemove.error);
    expect(afterRemove.collection.itemCount).toBe(1);

    // 移除的是链接:被移出去的那件素材仍然在 Library 的 canonical 视图里。
    const history = await getGenerationHistory({ take: 60 });
    if ("error" in history) throw new Error(history.error);
    expect(history.items.map((item) => item.id)).toContain(aUpload);

    expect(await deleteCollection(created.id)).toEqual({ ok: true });
    const list = await listCollections();
    if ("error" in list) throw new Error(list.error);
    expect(list.collections.map((collection) => collection.id)).not.toContain(created.id);

    // 删掉合集之后,它的成员对象一件都没少(验收行明写的那一句)。
    const afterDelete = await getGenerationHistory({ take: 60 });
    if ("error" in afterDelete) throw new Error(afterDelete.error);
    expect(afterDelete.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([aGenerated, aUpload]),
    );
  });

  it("FRONT-A6:同一件素材重复加入同一个合集只有一行;可以同时属于两个合集", async () => {
    asUser(A_EMAIL);
    const first = await createCollection("Evergreen");
    const second = await createCollection("Weekend");
    if ("error" in first) throw new Error(first.error);
    if ("error" in second) throw new Error(second.error);

    await addToCollection(first.id, [{ subjectType: "generation", subjectId: aGenerated }]);
    expect(
      await addToCollection(first.id, [{ subjectType: "generation", subjectId: aGenerated }]),
    ).toEqual({ added: 0, skipped: 1, unavailable: 0 });
    await addToCollection(second.id, [{ subjectType: "generation", subjectId: aGenerated }]);

    const memberships = await listCollectionMemberships([
      { subjectType: "generation", subjectId: aGenerated },
    ]);
    if ("error" in memberships) throw new Error(memberships.error);
    expect(memberships.memberships[`generation:${aGenerated}`]?.sort()).toEqual(
      [first.id, second.id].sort(),
    );

    await deleteCollection(first.id);
    await deleteCollection(second.id);
  });

  it("FRONT-A6:目标里有一件已经不在了时,加入不会假装全成 —— unavailable 单独数出来", async () => {
    // 商家选了两件、其中一件在他按下去之前刚被删掉。旧口径下这一次与「两件全成功」返回
    // 的东西一模一样(`filterVisibleSubjects` 丢掉的那件既不进 added 也不进 skipped),
    // 屏幕上就没有任何地方能说出那件的下落。三个数分开之后,弹层才有话可说。
    asUser(A_EMAIL);
    const doomed = await seedGeneration(orgA, aProjectId, {
      source: "GENERATED",
      prompt: "about to be deleted",
    });
    // `updateMany` + ownerId:运行时租户守卫拒绝没有 ownerId 过滤的写(测试里也不给例外)。
    await prisma.generation.updateMany({
      where: { id: doomed, ownerId: orgA },
      data: { deletedAt: new Date() },
    });

    const created = await createCollection("Partly gone");
    if ("error" in created) throw new Error(created.error);
    expect(
      await addToCollection(created.id, [
        { subjectType: "generation", subjectId: aSecond },
        { subjectType: "generation", subjectId: doomed },
      ]),
    ).toEqual({ added: 1, skipped: 0, unavailable: 1 });

    // 真进去的只有活着的那一件 —— 数字不是算出来的,是重新读服务端读回来的。
    const detail = await getCollection(created.id);
    if ("error" in detail) throw new Error(detail.error);
    expect(detail.collection.items.map((item) => item.subjectId)).toEqual([aSecond]);

    // 别人家的素材走的也是同一条路:不可用,而不是悄悄成功。
    expect(
      await addToCollection(created.id, [{ subjectType: "generation", subjectId: aSecond }, { subjectType: "generation", subjectId: bGenerated }]),
    ).toEqual({ added: 0, skipped: 1, unavailable: 1 });

    await deleteCollection(created.id);
  });

  it("FRONT-A6:改名落库;空名字被拒,不会把合集改成没有名字", async () => {
    asUser(A_EMAIL);
    const created = await createCollection("Draft name");
    if ("error" in created) throw new Error(created.error);
    expect(await renameCollection(created.id, "  Hari Raya  ")).toEqual({ name: "Hari Raya" });
    expect(await renameCollection(created.id, "   ")).toHaveProperty("error");

    const list = await listCollections();
    if ("error" in list) throw new Error(list.error);
    expect(list.collections.find((collection) => collection.id === created.id)?.name).toBe("Hari Raya");
    await deleteCollection(created.id);
  });

  it("FRONT-A6:两个租户互相看不见、也改不动对方的合集(双向)", async () => {
    asUser(A_EMAIL);
    const aCollection = await createCollection("A private");
    if ("error" in aCollection) throw new Error(aCollection.error);
    await addToCollection(aCollection.id, [{ subjectType: "generation", subjectId: aGenerated }]);

    asUser(B_EMAIL);
    const bList = await listCollections();
    if ("error" in bList) throw new Error(bList.error);
    expect(bList.collections.map((collection) => collection.id)).not.toContain(aCollection.id);
    expect(await getCollection(aCollection.id)).toEqual({ error: "Not found." });
    expect(await renameCollection(aCollection.id, "hijacked")).toEqual({ error: "Not found." });
    expect(await deleteCollection(aCollection.id)).toEqual({ error: "Not found." });
    expect(
      await addToCollection(aCollection.id, [{ subjectType: "generation", subjectId: bGenerated }]),
    ).toEqual({ error: "Not found." });

    const bCollection = await createCollection("B private");
    if ("error" in bCollection) throw new Error(bCollection.error);

    asUser(A_EMAIL);
    const aList = await listCollections();
    if ("error" in aList) throw new Error(aList.error);
    expect(aList.collections.map((collection) => collection.id)).not.toContain(bCollection.id);
    expect(await getCollection(bCollection.id)).toEqual({ error: "Not found." });
    // A 的合集**没有**被 B 那几次尝试改动过。
    const stillMine = await getCollection(aCollection.id);
    if ("error" in stillMine) throw new Error(stillMine.error);
    expect(stillMine.collection.name).toBe("A private");
    expect(stillMine.collection.itemCount).toBe(1);
    await deleteCollection(aCollection.id);

    asUser(B_EMAIL);
    await deleteCollection(bCollection.id);
  });

  it("FRONT-A6:合集里放不进别人家的素材 —— 目标的租户归属每次写入前重新校验", async () => {
    asUser(A_EMAIL);
    const created = await createCollection("Cross tenant probe");
    if ("error" in created) throw new Error(created.error);
    expect(
      await addToCollection(created.id, [{ subjectType: "generation", subjectId: bGenerated }]),
    ).toEqual({ error: "Not found." });
    const detail = await getCollection(created.id);
    if ("error" in detail) throw new Error(detail.error);
    expect(detail.collection.itemCount).toBe(0);
    await deleteCollection(created.id);
  });

  it("FRONT-A6:未登录 / 不在名单上的会话既列不出也建不了合集", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await listCollections()).toHaveProperty("error");
    expect(await createCollection("nope")).toHaveProperty("error");
  });
});

describe("FRONT-A7:Library 的 Use in canvas 落节点到当前项目与租户", () => {
  it("FRONT-A7:把自己的一件素材送进自己的画布,节点归属当前项目与租户", async () => {
    asUser(A_EMAIL);
    const node = await createCanvasNode({
      projectId: aProjectId,
      type: "image",
      x: 0,
      y: 0,
      w: 320,
      h: 400,
      generationId: aGenerated,
      status: "done",
    });
    if ("error" in node) throw new Error(node.error);
    const row = await prisma.canvasNode.findFirst({ where: { id: node.id, ownerId: orgA } });
    expect(row?.ownerId).toBe(orgA);
    expect(row?.projectId).toBe(aProjectId);
    expect(row?.generationId).toBe(aGenerated);
  });

  it("FRONT-A7:别人家的画布进不去,别人家的素材也带不进来(双向)", async () => {
    asUser(B_EMAIL);
    expect(
      await createCanvasNode({
        projectId: aProjectId,
        type: "image",
        x: 0,
        y: 0,
        w: 320,
        h: 400,
        generationId: aGenerated,
        status: "done",
      }),
    ).toEqual({ error: "Project not found." });

    asUser(A_EMAIL);
    // A 自己的画布 + B 家的素材:画布过关,素材不过关 —— 节点建得出来,但那条引用
    // **被丢成 null**,而不是把 B 的素材偷渡进 A 的画布。
    const node = await createCanvasNode({
      projectId: aProjectId,
      type: "image",
      x: 10,
      y: 10,
      w: 320,
      h: 400,
      generationId: bGenerated,
      status: "done",
    });
    if ("error" in node) throw new Error(node.error);
    const row = await prisma.canvasNode.findFirst({ where: { id: node.id, ownerId: orgA } });
    expect(row?.generationId).toBeNull();
  });
});
