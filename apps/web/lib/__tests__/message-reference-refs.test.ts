/**
 * FRONT-A10 —— 消息保存类型化引用 ID 并可回链(规格 `docs/specs/frontend-baseline.md` §7.3③
 * 第③刀),外加**生产答得出的那七型**在服务端搜索这一侧逐类各命中一条。
 *
 * 「七型」不是冻结契约 §4 的那七型。契约那份是 product／character／official-avatar／location／
 * **clothes**／generation／upload;生产这份把 `clothes` 换成了 `brandmark` —— `clothes` 在生产
 * 一条记录都没有(`lib/reference-search.ts` 对它一律返回空),按裁决九不画空壳,而 `brandmark`
 * 是 `EntityType` 早就有、今天就 `@` 得到的一型。两份都是七个,成员不一样;所以下面的用例
 * 逐型点名,并且单独钉一条「clothes 认得但永远返回空」。
 *
 * 真 Postgres、真 Prisma、两个真 org。两条主张,两个方向:
 *  ① 写:落库前每一个 id 按 owner 解析,别家的 id 一个都进不来,而且拒绝的说法对「别家的」
 *    与「自己删掉的」一模一样 —— 它不能当存在性问答机用。
 *  ② 读:存下来的那一行能解回名字与地址(回链),而且是按**当前** owner 解的。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";

const { prisma } = await import("@fikirtive/db");
const { newId, formatReferenceRef, MAX_TURN_REFERENCES } = await import("@fikirtive/core");
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
describe("FRONT-A10 — 生产答得出的七型各命中一条(契约七型里的 clothes 换成 brandmark)", () => {
  it("FRONT-A10 each of the seven types production can answer returns its own row — product, character, official-avatar, location, brandmark, generation, upload", async () => {
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

  it("FRONT-A10 clothes is the contract type production cannot answer — understood, always empty, so it is not one of the seven", async () => {
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
  it("FRONT-A10 all seven offered types resolve to a typed ref this owner really owns", async () => {
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

/**
 * 判官第二轮 P1-2 —— 读路径把「一轮最多 24 条」当成了**整页**上限。
 *
 * `MAX_TURN_REFERENCES` 是**写**侧的边界:一条消息最多带 24 个 `@`。可 `resolveCoworkMessageReferences`
 * 是一条对话一次解好的:它把整页每条消息的引用合成一份交给解析器,于是默认的 24 把整页截断了 ——
 * 第 25 个引用之后的每一枚小片静默消失,而且消失的是**最新**那几条消息(合成时按消息顺序)。
 * 商家看到的就是「聊到后面,引用不见了」,页面上没有任何提示。
 */
describe("FRONT-A10 — 一页的引用不被单轮上限截断", () => {
  it("FRONT-A10 a page carrying 30 references renders every one of them — the 24 cap is per message, not per page", async () => {
    // 30 件真对象、两条真消息:第一条带满 24 个(写侧的合法上限),第二条再带 6 个。
    const productIds: string[] = [];
    for (let i = 0; i < 30; i++) {
      productIds.push((await prisma.entity.create({
        data: { id: `ent_${randomUUID()}`, ownerId: orgA, name: `Cendol page tin ${i}`, type: "PRODUCT" },
      })).id);
    }
    const wireOf = (ids: string[]) => ids.map((id) => formatReferenceRef({ type: "product", id }));
    const firstWire = wireOf(productIds.slice(0, MAX_TURN_REFERENCES));
    const secondWire = wireOf(productIds.slice(MAX_TURN_REFERENCES));
    expect(secondWire.length).toBe(30 - MAX_TURN_REFERENCES);

    const firstId = `msg_${randomUUID()}`;
    const secondId = `msg_${randomUUID()}`;
    await prisma.chatMessage.create({
      data: {
        id: firstId, threadId: threadAId, ownerId: orgA, role: "USER", kind: "TEXT",
        seq: 10, text: "a full turn of references", referenceRefs: firstWire,
      },
    });
    await prisma.chatMessage.create({
      data: {
        id: secondId, threadId: threadAId, ownerId: orgA, role: "USER", kind: "TEXT",
        seq: 11, text: "and six more", referenceRefs: secondWire,
      },
    });

    const rows = await prisma.chatMessage.findMany({
      where: { id: { in: [firstId, secondId] }, ownerId: orgA },
      orderBy: { seq: "asc" },
      select: { id: true, referenceRefs: true },
    });
    const byMessage = await resolveCoworkMessageReferences(orgA, [{ messages: rows }]);

    // 每条消息各拿回自己那一份,一枚不少 —— 改回整页 24,第二条整条掉光(undefined),这条当场红。
    expect(byMessage.get(firstId)?.map((link) => link.id)).toEqual(productIds.slice(0, MAX_TURN_REFERENCES));
    expect(byMessage.get(secondId)?.map((link) => link.id)).toEqual(productIds.slice(MAX_TURN_REFERENCES));
  });

  it("FRONT-A10 the write side still stops at one turn's worth — the read fix does not widen what a turn may submit", async () => {
    // 同一批 id,这次走**写**侧:第 25 个起不该被悄悄放行,它算解不出来的那一类。
    const tooMany = Array.from({ length: MAX_TURN_REFERENCES + 1 }, () =>
      formatReferenceRef({ type: "product", id: aProductId }),
    );
    // 同一个对象重复挑不算失败(去重),所以这里用真的不同 id 才说明问题。
    const distinct = await Promise.all(
      Array.from({ length: MAX_TURN_REFERENCES + 1 }, async (_, i) =>
        formatReferenceRef({
          type: "product",
          id: (await prisma.entity.create({
            data: { id: `ent_${randomUUID()}`, ownerId: orgA, name: `Cendol cap tin ${i}`, type: "PRODUCT" },
          })).id,
        }),
      ),
    );
    expect(tooMany).toHaveLength(MAX_TURN_REFERENCES + 1);

    const resolved = await resolveOwnedReferenceRefs(orgA, distinct);
    expect(resolved.wire).toHaveLength(MAX_TURN_REFERENCES);
    // 被砍掉的那一个是「没解出来」,不是静默丢弃 —— 调用方据此整轮不发。
    expect(resolved.unresolved).toBe(1);
  });
});
