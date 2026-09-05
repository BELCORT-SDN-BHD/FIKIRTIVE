/**
 * FRONT-A10 —— 消息保存类型化引用 ID 并可回链(规格 `docs/specs/frontend-baseline.md` §7.3③
 * 第③刀),外加「七类」在服务端搜索这一侧逐类各命中一条。
 *
 * 真 Postgres、真 Prisma、两个真 org。两条主张,两个方向:
 *  ① 写:落库前每一个 id 按 owner 解析,别家的 id 一个都进不来,而且拒绝的说法对「别家的」
 *    与「自己删掉的」一模一样 —— 它不能当存在性问答机用。
 *  ② 读:存下来的那一行能解回名字与地址(回链),而且是按**当前** owner 解的。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";

const { prisma } = await import("@fikirtive/db");
const { newId, formatReferenceRef } = await import("@fikirtive/core");
const { resolveOwnedReferenceRefs, resolveReferenceLinks } = await import("@/lib/reference-refs");
const { resolveCoworkMessageReferences } = await import("@/lib/data");
const { searchReferences } = await import("@/lib/reference-search");

const orgA = newId();
const orgB = newId();

const HASH_UPLOAD = "c".repeat(64);
const HASH_GEN = "d".repeat(64);

let projectAId = "";
let threadAId = "";
let aProductId = "";
let aCharacterId = "";
let aAvatarId = "";
let aLocationId = "";
let aBrandmarkId = "";
let aUploadAssetId = "";
let aGenerationId = "";
let aDeletedProductId = "";
let bProductId = "";

async function makeOrg(id: string, name: string) {
  await prisma.organization.create({ data: { id, name } });
}

beforeAll(async () => {
  await makeOrg(orgA, "Teratak Kopi (message refs A)");
  await makeOrg(orgB, "Teratak Kopi (message refs B)");

  projectAId = (await prisma.project.create({
    data: { id: `prj_${randomUUID()}`, ownerId: orgA, name: "Raya launch" },
  })).id;

  const entity = async (name: string, type: "PRODUCT" | "CHARACTER" | "LOCATION" | "BRANDMARK", extra = {}) =>
    (await prisma.entity.create({
      data: { id: `ent_${randomUUID()}`, ownerId: orgA, name, type, ...extra },
    })).id;

  aProductId = await entity("Kopi cendol tin", "PRODUCT");
  aCharacterId = await entity("Cendol Farid the barista", "CHARACTER");
  aAvatarId = await entity("Cendol Nadia", "CHARACTER", { catalogKey: `actor-nadia-${randomUUID()}` });
  aLocationId = await entity("Cendol corner shop", "LOCATION");
  aBrandmarkId = await entity("Cendol wordmark", "BRANDMARK");
  aDeletedProductId = await entity("Cendol retired tin", "PRODUCT", { deletedAt: new Date() });

  const uploadAsset = await prisma.asset.create({
    data: {
      id: `ast_${randomUUID()}`, ownerId: orgA, contentHash: HASH_UPLOAD, ext: "png", mime: "image/png",
      sizeBytes: BigInt(10), source: "UPLOAD", originalFilename: "cendol-shelf.png",
    },
  });
  aUploadAssetId = uploadAsset.id;
  await prisma.generation.create({
    data: {
      id: `gen_${randomUUID()}`, ownerId: orgA, projectId: projectAId, assetId: uploadAsset.id,
      source: "UPLOAD", promptText: "", entitySnapshot: {},
    },
  });

  const genAsset = await prisma.asset.create({
    data: {
      id: `ast_${randomUUID()}`, ownerId: orgA, contentHash: HASH_GEN, ext: "png", mime: "image/png",
      sizeBytes: BigInt(10), source: "GENERATED", originalFilename: "out.png",
    },
  });
  aGenerationId = (await prisma.generation.create({
    data: {
      id: `gen_${randomUUID()}`, ownerId: orgA, projectId: projectAId, assetId: genAsset.id,
      source: "GENERATED", promptText: "Cendol hero shot on a warm shelf", entitySnapshot: {},
    },
  })).id;

  threadAId = (await prisma.chatThread.create({
    data: { id: `thr_${randomUUID()}`, ownerId: orgA, projectId: projectAId, title: "Raya campaign" },
  })).id;

  bProductId = (await prisma.entity.create({
    data: { id: `ent_${randomUUID()}`, ownerId: orgB, name: "Cendol tin (other shop)", type: "PRODUCT" },
  })).id;
});

/** 本轮 C1 的那一半:商家能 `@` 到的类型,服务端逐类都答得出来。 */
describe("FRONT-A10 — 七类在服务端各命中一条", () => {
  it("FRONT-A10 each contract type production can answer returns its own row", async () => {
    const page = await searchReferences(orgA, { query: "cendol", limit: 8 });
    const byType = new Map(page.items.map((item) => [item.type, item.id]));
    expect(byType.get("product")).toBe(aProductId);
    expect(byType.get("character")).toBe(aCharacterId);
    expect(byType.get("official-avatar")).toBe(aAvatarId);
    expect(byType.get("location")).toBe(aLocationId);
    expect(byType.get("brandmark")).toBe(aBrandmarkId);
    // 媒体两型按各自的名字命中(生成按提示词,上传按文件名),同一个查询词。
    expect(byType.get("generation")).toBe(aGenerationId);
    expect(byType.get("upload")).toBe(aUploadAssetId);
  });

  it("FRONT-A10 clothes is understood and never returned — production has no clothes record", async () => {
    const page = await searchReferences(orgA, { query: "", types: ["clothes"], limit: 8 });
    expect(page.items).toHaveLength(0);
  });

  it("FRONT-A10 tenant isolation — org B never sees org A's rows of any type", async () => {
    const page = await searchReferences(orgB, { query: "cendol", limit: 8 });
    const ids = page.items.map((item) => item.id);
    for (const mine of [aProductId, aCharacterId, aAvatarId, aLocationId, aBrandmarkId, aGenerationId, aUploadAssetId]) {
      expect(ids).not.toContain(mine);
    }
    expect(ids).toContain(bProductId);
  });
});

describe("FRONT-A10 — 消息保存类型化引用 ID(落库前按 owner 校验)", () => {
  it("FRONT-A10 every offered type resolves to a typed ref this owner really owns", async () => {
    const submitted = [
      formatReferenceRef({ type: "product", id: aProductId }),
      formatReferenceRef({ type: "character", id: aCharacterId }),
      formatReferenceRef({ type: "official-avatar", id: aAvatarId }),
      formatReferenceRef({ type: "location", id: aLocationId }),
      formatReferenceRef({ type: "brandmark", id: aBrandmarkId }),
      formatReferenceRef({ type: "generation", id: aGenerationId }),
      formatReferenceRef({ type: "upload", id: aUploadAssetId }),
    ];
    const resolved = await resolveOwnedReferenceRefs(orgA, submitted);
    expect(resolved.unresolved).toBe(0);
    expect(resolved.wire).toEqual(submitted);
    expect(resolved.links.map((link) => link.name)).toEqual([
      "Kopi cendol tin",
      "Cendol Farid the barista",
      "Cendol Nadia",
      "Cendol corner shop",
      "Cendol wordmark",
      "Cendol hero shot on a warm shelf",
      "cendol-shelf.png",
    ]);
  });

  it("FRONT-A10 another shop's id never resolves — and answers exactly like a deleted one of your own", async () => {
    const foreign = await resolveOwnedReferenceRefs(orgA, [
      formatReferenceRef({ type: "product", id: bProductId }),
    ]);
    const deletedOwn = await resolveOwnedReferenceRefs(orgA, [
      formatReferenceRef({ type: "product", id: aDeletedProductId }),
    ]);
    expect(foreign.refs).toHaveLength(0);
    expect(foreign.links).toHaveLength(0);
    expect(foreign.wire).toHaveLength(0);
    // 同一个数字、同一份形状:回答里没有任何一格能把「别家有这一行」与「我自己删了」分开。
    expect(foreign).toEqual(deletedOwn);
  });

  it("FRONT-A10 a foreign id mixed into a good list does not sneak through with it", async () => {
    const resolved = await resolveOwnedReferenceRefs(orgA, [
      formatReferenceRef({ type: "product", id: aProductId }),
      formatReferenceRef({ type: "product", id: bProductId }),
    ]);
    expect(resolved.unresolved).toBe(1);
    expect(resolved.wire).toEqual([formatReferenceRef({ type: "product", id: aProductId })]);
  });

  it("FRONT-A10 a claimed type that is not the row's real type is refused", async () => {
    // 自己的产品谎报成官方演员 —— 若放行,商家会在自己还能编辑的行上读到一枚 read-only 徽章。
    const lie = await resolveOwnedReferenceRefs(orgA, [
      formatReferenceRef({ type: "official-avatar", id: aProductId }),
      // 自己的角色谎报成官方演员:同一张表、同一个 EntityType,判据是 entityOrigin。
      formatReferenceRef({ type: "official-avatar", id: aCharacterId }),
    ]);
    expect(lie.refs).toHaveLength(0);
    expect(lie.unresolved).toBe(2);
  });

  it("FRONT-A10 clothes and malformed refs count as unresolved, never as silently dropped", async () => {
    const resolved = await resolveOwnedReferenceRefs(orgA, [
      `clothes:${aProductId}`,
      aProductId, // 裸 id:没有类型,解不出来
      "not-a-type:xyz",
    ]);
    expect(resolved.refs).toHaveLength(0);
    expect(resolved.unresolved).toBe(3);
  });

  it("FRONT-A10 picking the same object twice is one reference, not a rejected turn", async () => {
    const ref = formatReferenceRef({ type: "product", id: aProductId });
    const resolved = await resolveOwnedReferenceRefs(orgA, [ref, ref]);
    expect(resolved.unresolved).toBe(0);
    expect(resolved.wire).toEqual([ref]);
  });
});

describe("FRONT-A10 — 消息回链(从存下来的那一行点回对象)", () => {
  it("FRONT-A10 a stored message links back to the Library object it named", async () => {
    const wire = [
      formatReferenceRef({ type: "product", id: aProductId }),
      formatReferenceRef({ type: "generation", id: aGenerationId }),
      formatReferenceRef({ type: "upload", id: aUploadAssetId }),
    ];
    const messageId = `msg_${randomUUID()}`;
    await prisma.chatMessage.create({
      data: {
        id: messageId, threadId: threadAId, ownerId: orgA, role: "USER", kind: "TEXT",
        seq: 1, text: "@Kopi cendol tin on the shelf", referenceRefs: wire,
      },
    });

    const row = await prisma.chatMessage.findFirstOrThrow({
      where: { id: messageId, ownerId: orgA },
      select: { id: true, referenceRefs: true },
    });
    expect(row.referenceRefs).toEqual(wire);

    const byMessage = await resolveCoworkMessageReferences(orgA, [{ messages: [row] }]);
    const links = byMessage.get(messageId) ?? [];
    expect(links.map((link) => link.type)).toEqual(["product", "generation", "upload"]);
    // 实体回链落到它所在的那一栏(Library 今天没有按元素 id 的深链;登记在规格 §5)。
    expect(links[0].href).toBe("/library?view=elements&element=products");
    // 媒体回链是逐个对象的深链:Library 详情面要 generationId + projectId 两个 id。
    expect(links[1].href).toBe(`/library?asset=${aGenerationId}&project=${projectAId}`);
    // 上传存的是 Asset id,回链走的是摄取它的那一行 Generation —— 所以地址里不是 Asset id。
    expect(links[2].href).toContain(`&project=${projectAId}`);
    expect(links[2].href).not.toContain(aUploadAssetId);
  });

  it("FRONT-A10 the read path is owner-scoped too — org B reads no links off org A's row", async () => {
    const wire = [formatReferenceRef({ type: "product", id: aProductId })];
    expect(await resolveReferenceLinks(orgB, wire)).toEqual([]);
    expect((await resolveReferenceLinks(orgA, wire)).map((link) => link.id)).toEqual([aProductId]);
  });

  it("FRONT-A10 a reference whose object was deleted since renders no chip at all", async () => {
    const messageId = `msg_${randomUUID()}`;
    await prisma.chatMessage.create({
      data: {
        id: messageId, threadId: threadAId, ownerId: orgA, role: "USER", kind: "TEXT",
        seq: 2, text: "@Cendol retired tin", referenceRefs: [formatReferenceRef({ type: "product", id: aDeletedProductId })],
      },
    });
    const byMessage = await resolveCoworkMessageReferences(orgA, [
      { messages: [{ id: messageId, referenceRefs: [formatReferenceRef({ type: "product", id: aDeletedProductId })] }] },
    ]);
    expect(byMessage.get(messageId)).toBeUndefined();
  });
});
