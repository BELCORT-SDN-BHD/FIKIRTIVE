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

  it("FRONT-A10 the page is bounded and hands back a cursor when there is more", async () => {
    const first = await searchReferences(orgA, { query: "", limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await searchReferences(orgA, { query: "", limit: 1, cursor: first.nextCursor });
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });
});
