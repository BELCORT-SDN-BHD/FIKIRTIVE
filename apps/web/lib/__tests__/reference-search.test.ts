/**
 * FRONT-A10 — the one server-side reference search (spec `docs/specs/frontend-baseline.md` §7.3③).
 *
 * Real Postgres through the real Prisma client, two real orgs. The two-way tenant assertions are
 * the point of the file: a picker that leaks is worse than a picker that is missing, because the
 * merchant cannot tell.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";

const { prisma } = await import("@fikirtive/db");
const { newId } = await import("@fikirtive/core");
const { searchReferences, recentReferences } = await import("@/lib/reference-search");
const { REFERENCE_PAGE_LIMIT } = await import("@/lib/reference-search-model");

// Real `newId()` ids and real shop names. An org whose NAME is its own id is exactly what
// `app/admin/__tests__/admin-identity-truth.test.ts` exists to catch, and rows a test leaves behind
// are visible to every other test file on the same database.
const orgA = newId();
const orgB = newId();

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

let aProductId = "";
let aAvatarId = "";
let aCharacterId = "";
let aUploadAssetId = "";
let aGenerationId = "";
let bProductId = "";
/** 服务端上限围栏用的行数:必须 > REFERENCE_PAGE_LIMIT,否则「被截断了」证明不了自己。 */
const PROBE_ROWS = 12;

async function makeOrg(id: string, name: string) {
  await prisma.organization.create({ data: { id, name } });
}

beforeAll(async () => {
  await makeOrg(orgA, "Kaia Cafe (reference search A)");
  await makeOrg(orgB, "Kaia Cafe (reference search B)");

  const projectA = await prisma.project.create({
    data: { id: `prj_${randomUUID()}`, ownerId: orgA, name: "Hari Raya gifting" },
  });

  aProductId = (await prisma.entity.create({
    data: { id: `ent_${randomUUID()}`, ownerId: orgA, name: "Jasmine gift box", type: "PRODUCT" },
  })).id;
  aCharacterId = (await prisma.entity.create({
    data: { id: `ent_${randomUUID()}`, ownerId: orgA, name: "Aisyah the shopkeeper", type: "CHARACTER" },
  })).id;
  aAvatarId = (await prisma.entity.create({
    data: {
      id: `ent_${randomUUID()}`,
      ownerId: orgA,
      name: "Alya",
      type: "CHARACTER",
      catalogKey: `actor-alya-${randomUUID()}`,
    },
  })).id;
  await prisma.entity.create({
    data: { id: `ent_${randomUUID()}`, ownerId: orgA, name: "Deleted jasmine", type: "PRODUCT", deletedAt: new Date() },
  });

  const uploadAsset = await prisma.asset.create({
    data: {
      id: `ast_${randomUUID()}`, ownerId: orgA, contentHash: HASH_A, ext: "png", mime: "image/png",
      sizeBytes: BigInt(10), source: "UPLOAD", originalFilename: "jasmine-shelf.png",
    },
  });
  aUploadAssetId = uploadAsset.id;
  // upload-actions writes one Generation row per uploaded file, with source = UPLOAD
  await prisma.generation.create({
    data: {
      id: `gen_${randomUUID()}`, ownerId: orgA, projectId: projectA.id, assetId: uploadAsset.id,
      source: "UPLOAD", promptText: "", entitySnapshot: {},
    },
  });
  // a second Generation row over the SAME asset — re-uploading identical bytes reuses the Asset
  await prisma.generation.create({
    data: {
      id: `gen_${randomUUID()}`, ownerId: orgA, projectId: projectA.id, assetId: uploadAsset.id,
      source: "UPLOAD", promptText: "", entitySnapshot: {},
    },
  });

  const genAsset = await prisma.asset.create({
    data: {
      id: `ast_${randomUUID()}`, ownerId: orgA, contentHash: HASH_B, ext: "png", mime: "image/png",
      sizeBytes: BigInt(10), source: "GENERATED", originalFilename: "out.png",
    },
  });
  aGenerationId = (await prisma.generation.create({
    data: {
      id: `gen_${randomUUID()}`, ownerId: orgA, projectId: projectA.id, assetId: genAsset.id,
      source: "GENERATED", promptText: "Jasmine hero shot on a warm shelf", entitySnapshot: {},
    },
  })).id;

  bProductId = (await prisma.entity.create({
    data: { id: `ent_${randomUUID()}`, ownerId: orgB, name: "Jasmine gift box", type: "PRODUCT" },
  })).id;

  // 服务端上限那条围栏的料:同一个 org 下多于一页的行。名字刻意不含字母 a、不含
  // "jasmine"、不含 "shelf" —— 上面每一条既有断言都是按这三个词命中的,这批行不许挤进
  // 它们的结果里去改变名次。
  for (let i = 0; i < PROBE_ROWS; i += 1) {
    await prisma.entity.create({
      data: {
        id: `ent_${randomUUID()}`,
        ownerId: orgA,
        name: `Probe reference ${String(i).padStart(2, "0")}`,
        type: "CHARACTER",
      },
    });
  }
});

describe("FRONT-A10 — 引用选择器来自服务器:统一 reference search", () => {
  it("FRONT-A10 returns typed IDs across Entity, Generation and Asset in one query", async () => {
    const page = await searchReferences(orgA, { query: "jasmine", limit: 8 });
    const kinds = new Set(page.items.map((item) => item.type));
    expect(page.items.some((item) => item.type === "product" && item.id === aProductId)).toBe(true);
    expect(page.items.some((item) => item.type === "upload" && item.id === aUploadAssetId)).toBe(true);
    expect(page.items.some((item) => item.type === "generation" && item.id === aGenerationId)).toBe(true);
    expect(kinds.size).toBeGreaterThanOrEqual(3);
    // every row is a typed ID, never a bare string (contract §4)
    for (const item of page.items) expect(item.id.length).toBeGreaterThan(0);
  });

  it("FRONT-A10 an official avatar is its own type, a merchant's own character is not", async () => {
    const page = await searchReferences(orgA, { query: "a", limit: 8 });
    const avatar = page.items.find((item) => item.id === aAvatarId);
    const character = page.items.find((item) => item.id === aCharacterId);
    expect(avatar?.type).toBe("official-avatar");
    expect(avatar?.source).toBe("Official avatar · Read only");
    expect(character?.type).toBe("character");
  });

  it("FRONT-A10 one underlying object appears once however many rows point at it", async () => {
    const page = await searchReferences(orgA, { query: "jasmine-shelf", limit: 8 });
    const uploads = page.items.filter((item) => item.type === "upload" && item.id === aUploadAssetId);
    expect(uploads).toHaveLength(1);
  });

  it("FRONT-A10 soft-deleted references are never offered", async () => {
    const page = await searchReferences(orgA, { query: "Deleted jasmine", limit: 8 });
    expect(page.items.every((item) => item.name !== "Deleted jasmine")).toBe(true);
  });

  it("FRONT-A10 a category filter returns only that type", async () => {
    const page = await searchReferences(orgA, { query: "", types: ["product"], limit: 8 });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((item) => item.type === "product")).toBe(true);
  });

  it("FRONT-A10 bare @ returns at most five recent references", async () => {
    const items = await recentReferences(orgA);
    expect(items.length).toBeLessThanOrEqual(5);
  });

  it("FRONT-A10 tenant isolation — org B never sees org A's references", async () => {
    const page = await searchReferences(orgB, { query: "jasmine", limit: 8 });
    expect(page.items.some((item) => item.id === aProductId)).toBe(false);
    expect(page.items.some((item) => item.id === aUploadAssetId)).toBe(false);
    expect(page.items.some((item) => item.id === aGenerationId)).toBe(false);
    expect(page.items.some((item) => item.id === bProductId)).toBe(true);
  });

  it("FRONT-A10 tenant isolation — org A never sees org B's identically named product", async () => {
    const page = await searchReferences(orgA, { query: "jasmine gift box", limit: 8 });
    expect(page.items.some((item) => item.id === bProductId)).toBe(false);
    expect(page.items.some((item) => item.id === aProductId)).toBe(true);
  });

  /**
   * 判官 #1158 P2-J1 —— 客户端那道 8 行截断有测试,服务端这道没有。缺的正是要紧的那一半:
   * 菜单只画 8 行,但一个 `limit: 32` 的请求如果真回 32 行,多出来的 24 行已经查过库、
   * 已经过了缩略图那一程,只是没人画。收口在 `lib/reference-search.ts` 的 `Math.min(..., 
   * REFERENCE_PAGE_LIMIT)`,这条钉的就是它:上限由**服务端**说了算,不由调用方说了算。
   */
  it("FRONT-A10 the server caps one page at its own row limit — a caller asking for 32 still gets that cap", async () => {
    const page = await searchReferences(orgA, { query: "probe", limit: 32 });
    // 料先要够:少于一页的候选行,截断与不截断长得一样,这条会变成恒绿的空断言。
    expect(PROBE_ROWS).toBeGreaterThan(REFERENCE_PAGE_LIMIT);
    expect(page.items).toHaveLength(REFERENCE_PAGE_LIMIT);
    // 剩下的行没有被丢掉,只是要按 cursor 取 —— 上限是分页,不是审查。
    expect(page.nextCursor).not.toBeNull();
    const second = await searchReferences(orgA, { query: "probe", limit: 32, cursor: page.nextCursor });
    expect(second.items.length).toBeGreaterThan(0);
    expect(second.items.length).toBeLessThanOrEqual(REFERENCE_PAGE_LIMIT);
    const firstIds = new Set(page.items.map((item) => item.id));
    expect(second.items.every((item) => !firstIds.has(item.id))).toBe(true);
  });

  it("FRONT-A10 the page is bounded and hands back a cursor when there is more", async () => {
    const first = await searchReferences(orgA, { query: "", limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await searchReferences(orgA, { query: "", limit: 1, cursor: first.nextCursor });
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });
});
