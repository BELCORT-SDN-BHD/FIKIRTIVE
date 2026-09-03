/**
 * library-tenant-isolation-seg2a —— **另一个商家的东西永远不出现在我的 Library 里**
 * (前端基线规格 `docs/specs/frontend-baseline.md` §7.1 段② / 验收行 FRONT-A5;
 *  租户口径来自 `.claude/CLAUDE.md`「Tenant isolation」与 `patterns/library/backend-handoff-contract.md` §4)。
 *
 * 硬口径:**真数据库、真 Prisma、真 `requireOwner`、真存储字节**。只有会话被 mock ——
 * 因为要证的正是「身份只来自服务端 principal」,所以身份那一处必须能换人,别的都不许假。
 * 两个 org 的行在同一张表里挨着躺,查询靠 `ownerId` 分开;这份文件用两条真实读取
 * 交叉验一遍:A 的读里没有 B 的任何一行,反之亦然。
 *
 * 顺带钉住段②新接的两条真实契约,因为它们都是「筛选必须落在服务端」的证据:
 *   · `Generation.source` 区分 Uploads 与 Generation history(不是靠文件名猜);
 *   · Elements 的 Official avatars 是 `Entity.catalogKey` 标出来的那几行(演员库)。
 *
 * 变异自查(逐一实做,做完还原,红→绿):
 *   · 把 `getGenerationHistory` 的 where 去掉 `ownerId` ⇒ 「互不可见」当场红;
 *   · 把 `librarySourceWhere` 的 upload 分支改成 `{}` ⇒ 「Uploads 只有上传」红;
 *   · 把 `libraryElementKind` 的 catalogKey 判断去掉 ⇒ 「演员库落在 Official avatars」红。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import path from "node:path";

const mockAuth = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({
  auth: mockAuth,
  isImpersonating: vi.fn(async () => false),
}));
vi.mock("@/lib/allowlist", () => {
  function allowed(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = `${process.env.AUTH_ALLOWED_EMAILS ?? ""}`.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  return { allowed, isFounderAdmin: () => false, isAllowedEmail: allowed };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireOwner } = await import("@/lib/auth-guard");
const { getGenerationHistory } = await import("@/lib/library-actions");
const { getLibraryElements } = await import("@/lib/library-elements");
const { storage } = await import("@/lib/storage");
const { prisma } = await import("@fikirtive/db");
const { newId } = await import("@fikirtive/core");

const REPO_ROOT = path.join(process.cwd(), "..", "..");

const EMAIL_A = `lib-a-${randomUUID()}@fikirtive.test`;
const EMAIL_B = `lib-b-${randomUUID()}@fikirtive.test`;
let ownerA: string;
let ownerB: string;

/** 让下一次 `requireOwner()` 以这个人的身份跑。真守卫、真引导。 */
async function signInAs(email: string): Promise<string> {
  mockAuth.mockResolvedValue({ user: { email } });
  const gate = await requireOwner();
  if ("error" in gate) throw new Error(gate.error);
  return gate.ownerId;
}

/** 一张真的躺在存储里的一像素图 + 它的 Asset / Generation 行。 */
async function seedGeneration(
  ownerId: string,
  projectId: string,
  opts: { label: string; source: "UPLOAD" | "RENDER"; filename?: string },
): Promise<string> {
  // 内容各不相同 —— 存储是内容寻址的,同样的字节在两个 org 里会是同一个 hash。
  const bytes = new TextEncoder().encode(`fikirtive-test-${ownerId}-${opts.label}`);
  const { contentHash, key } = await storage.put(ownerId, bytes, "png");
  expect(await storage.exists(key)).toBe(true);
  const asset = await prisma.asset.upsert({
    where: { ownerId_contentHash: { ownerId, contentHash } },
    update: {},
    create: {
      id: newId(),
      ownerId,
      contentHash,
      ext: "png",
      mime: "image/png",
      sizeBytes: BigInt(bytes.byteLength),
      originalFilename: opts.filename ?? "",
      source: opts.source,
      width: 8,
      height: 10,
    },
  });
  const generation = await prisma.generation.create({
    data: {
      id: newId(),
      ownerId,
      projectId,
      assetId: asset.id,
      source: opts.source,
      promptText: opts.label,
      entitySnapshot: { entities: [] },
    },
  });
  return generation.id;
}

async function seedProject(ownerId: string, name: string): Promise<string> {
  const project = await prisma.project.create({ data: { id: newId(), ownerId, name } });
  return project.id;
}

let genA: string;
let uploadA: string;
let genB: string;

beforeAll(async () => {
  process.env.AUTH_ALLOWED_EMAILS = `${EMAIL_A},${EMAIL_B}`;
  for (const email of [EMAIL_A, EMAIL_B]) {
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: { id: `usr_${randomUUID()}`, email },
    });
  }
  ownerA = await signInAs(EMAIL_A);
  ownerB = await signInAs(EMAIL_B);

  const projectA = await seedProject(ownerA, "Hari Raya gifting");
  const projectB = await seedProject(ownerB, "Weekend tea launch");
  genA = await seedGeneration(ownerA, projectA, { label: "A storefront at dusk", source: "RENDER" });
  uploadA = await seedGeneration(ownerA, projectA, { label: "", source: "UPLOAD", filename: "a-raya.png" });
  genB = await seedGeneration(ownerB, projectB, { label: "B tea flatlay", source: "RENDER" });
}, 120_000);

afterAll(async () => {
  for (const ownerId of [ownerA, ownerB]) {
    if (!ownerId) continue;
    rmSync(path.join(REPO_ROOT, ".data", "storage", "u", ownerId), { recursive: true, force: true });
  }
});

describe("FRONT-A5 两个租户的 Library 互不可见", () => {
  it("A 的 Library 里只有 A 的东西,B 的一行都进不来", async () => {
    await signInAs(EMAIL_A);
    const page = await getGenerationHistory({ take: 100 });
    if ("error" in page) throw new Error(page.error);
    const ids = page.items.map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining([genA, uploadA]));
    expect(ids, "另一个商家的生成结果出现在了这个商家的素材库里").not.toContain(genB);
    expect(page.items.every((item) => item.url.includes(`/u/${ownerA}/`))).toBe(true);
  });

  it("B 的 Library 里只有 B 的东西,A 的一行都进不来", async () => {
    await signInAs(EMAIL_B);
    const page = await getGenerationHistory({ take: 100 });
    if ("error" in page) throw new Error(page.error);
    const ids = page.items.map((item) => item.id);
    expect(ids).toContain(genB);
    expect(ids, "另一个商家的生成结果出现在了这个商家的素材库里").not.toContain(genA);
    expect(ids).not.toContain(uploadA);
  });

  it("搜索也是租户内的 —— 拿对方的提示词也搜不出对方的东西", async () => {
    await signInAs(EMAIL_A);
    const page = await getGenerationHistory({ search: "tea flatlay", take: 100 });
    if ("error" in page) throw new Error(page.error);
    expect(page.items, "搜索绕过了租户约束").toEqual([]);
  });

  it("Elements 同样只返回自己这一家的 —— 演员库每租户各播各的", async () => {
    await signInAs(EMAIL_A);
    const a = await getLibraryElements();
    if ("error" in a) throw new Error(a.error);
    await signInAs(EMAIL_B);
    const b = await getLibraryElements();
    if ("error" in b) throw new Error(b.error);

    const aIds = new Set(a.map((element) => element.id));
    for (const element of b) {
      expect(aIds.has(element.id), "一个 org 的元素出现在了另一个 org 的 Elements 里").toBe(false);
    }
    // 演员库是引导时按 org 播的,所以两边各有自己的一套 Official avatars。
    const officialA = a.filter((element) => element.kind === "official-avatars");
    const officialB = b.filter((element) => element.kind === "official-avatars");
    expect(officialA.length).toBe(officialB.length);
    expect(officialA.map((element) => element.name).sort()).toEqual(
      officialB.map((element) => element.name).sort(),
    );
  });
});

describe("FRONT-A5 Uploads 与 Generation history 由真实来源列分开", () => {
  it("Uploads 只给上传的那一行,并带回商家自己的文件名", async () => {
    await signInAs(EMAIL_A);
    const page = await getGenerationHistory({ sources: ["upload"], take: 100 });
    if ("error" in page) throw new Error(page.error);
    expect(page.items.map((item) => item.id)).toEqual([uploadA]);
    expect(page.items[0].source).toBe("upload");
    expect(page.items[0].filename).toBe("a-raya.png");
  });

  it("Generated 那一勾只给引擎产物", async () => {
    await signInAs(EMAIL_A);
    const page = await getGenerationHistory({ sources: ["generated"], take: 100 });
    if ("error" in page) throw new Error(page.error);
    const ids = page.items.map((item) => item.id);
    expect(ids).toContain(genA);
    expect(ids, "上传的那一行漏进了生成结果").not.toContain(uploadA);
  });

  it("两个来源都不勾时一条都不返回 —— 不是悄悄给整库", async () => {
    await signInAs(EMAIL_A);
    const page = await getGenerationHistory({ sources: [], take: 100 });
    if ("error" in page) throw new Error(page.error);
    expect(page.items).toEqual([]);
  });
});
