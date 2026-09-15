/**
 * PRODID-A4 —— 「Library 与 Brand 从此同一张图」(规格 `docs/specs/brand-product-identity.md` §5;
 * Founder 2026-09-15 裁决)。
 *
 * ── 裁决(原话) ────────────────────────────────────────────────────────────
 * 「未钉封面时的显示规则:挂上第一张参考图时自动设为封面并写回 `Entity.baseAssetId`,商家随时
 *   可换;存量数据一次补齐迁移;**Library 与 Brand 从此同一张图**。」
 *
 * 裁决之前这两条读路会给出**不同的答案**:`Entity.baseAssetId` 是 NULL 时,Library
 * (`lib/library-elements.ts`)沿用第一张参考图,而 Brand
 * (`packages/core/src/brand-records.ts:withProductIdentity`)当作没有主图。同一件产品于是
 * 在两个页面上长着两张脸。
 *
 * 这份文件把那句话变成一条**可执行的断言**:把一件产品推过它一生会经过的每一种状态,每一步
 * 都拿两条读路各读一次,逐字比同一个 assetId。哪一条读路将来又偷偷加回一个 `?? refs[0]`
 * 之类的兜底,这里就红。
 *
 * 硬口径照抄 `brand-product-identity.test.ts`:真数据库、真 Prisma、真 `requireOwner`、真存储
 * 字节。只有会话被 mock。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

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
const { listBrandRecords } = await import("@/lib/brand-record-actions");
const { softDeleteReferenceImage } = await import("@/lib/actions");
const { getLibraryElements } = await import("@/lib/library-elements");
const { setBaseAsset } = await import("@/lib/refgen-actions");
const { storage } = await import("@/lib/storage");
const { prisma, createProduct, reconcileEntityCover } = await import("@fikirtive/db");
const { newId } = await import("@fikirtive/core");

const EMAIL = `cover-parity-${randomUUID()}@fikirtive.test`;
let ownerId: string;

async function signIn(): Promise<string> {
  mockAuth.mockResolvedValue({ user: { email: EMAIL } });
  const gate = await requireOwner();
  if ("error" in gate) throw new Error(gate.error);
  return gate.ownerId;
}

/** 一张真的躺在存储里的图 + 它的 Asset 行(内容寻址,所以每个 label 的字节不同)。 */
async function seedAsset(label: string): Promise<string> {
  const bytes = new TextEncoder().encode(`fikirtive-cover-parity-${ownerId}-${label}`);
  const { contentHash } = await storage.put(ownerId, bytes, "png");
  const asset = await prisma.asset.upsert({
    where: { ownerId_contentHash: { ownerId, contentHash } },
    update: {},
    create: {
      id: newId(), ownerId, contentHash, ext: "png", mime: "image/png",
      sizeBytes: BigInt(bytes.byteLength), source: "UPLOAD", width: 8, height: 10,
    },
  });
  return asset.id;
}

/**
 * refgen 那条路挂图的形状(`apps/worker/src/jobs/refgen.ts:attachOutputs`):挂一条参考图,
 * 同一个事务里把封面调回不变量。裁决点名的正是这一条 —— 从前它一张都不钉。
 */
async function attachLikeRefgen(entityId: string, assetId: string, position: number): Promise<string> {
  const id = newId();
  await prisma.$transaction(async (tx) => {
    await tx.referenceImage.create({ data: { id, ownerId, entityId, assetId, position } });
    await reconcileEntityCover(tx, { ownerId, entityId });
  });
  return id;
}

/** Library 这条读路认的封面。 */
async function libraryCover(entityId: string): Promise<string | null> {
  const elements = await getLibraryElements();
  if (!Array.isArray(elements)) throw new Error(elements.error);
  const card = elements.find((e) => e.id === entityId);
  if (!card) throw new Error(`Library 里找不到 ${entityId}`);
  return card.baseAssetId ?? null;
}

/** Brand 这条读路认的主图(`withProductIdentity` 从身份补进 `data.imageAssetId`)。 */
async function brandCover(recordId: string): Promise<string | null> {
  const records = await listBrandRecords();
  const row = records.find((r) => r.id === recordId);
  if (!row) throw new Error(`Brand 里找不到 ${recordId}`);
  return ((row.data as { imageAssetId?: string }).imageAssetId) ?? null;
}

/** 两条读路各读一次,必须是同一个 assetId —— 裁决那句话的全部意思。 */
async function bothAgree(entityId: string, recordId: string): Promise<string | null> {
  const [lib, brand] = await Promise.all([libraryCover(entityId), brandCover(recordId)]);
  expect(lib).toBe(brand);
  return lib;
}

beforeAll(async () => {
  process.env.AUTH_ALLOWED_EMAILS = EMAIL;
  await prisma.user.upsert({
    where: { email: EMAIL }, update: {}, create: { id: `usr_${randomUUID()}`, email: EMAIL },
  });
  ownerId = await signIn();
});

afterAll(async () => {
  await prisma.$disconnect().catch(() => {});
});

describe("PRODID-A4 Library 与 Brand 同一张图", () => {
  it("PRODID-A4 一件产品的每一种状态下,两条读路都读出同一个 assetId", async () => {
    const name = `Kopi ${randomUUID().slice(0, 8)}`;

    // ── 状态①:只有名字与价格,一张图都没有 ────────────────────────────────
    // 裁决之前这一步两边就已经一致(都没有图),但它是后面每一步的基线。
    const made = (await createProduct({
      ownerId, data: { name, price: "RM 8" }, source: "user",
    })) as { created: true; id: string; entityId: string };
    expect(await bothAgree(made.entityId, made.id)).toBeNull();

    // ── 状态②:挂上第一张参考图(refgen REFSHEET 那条路) ──────────────────
    // **裁决点名的那一格**。从前:Library 画第一张、Brand 画空位 —— 两张脸。
    const first = await seedAsset("first");
    const firstRef = await attachLikeRefgen(made.entityId, first, 0);
    expect(await bothAgree(made.entityId, made.id)).toBe(first);

    // ── 状态③:再挂第二张 ⇒ 封面不动 ──────────────────────────────────────
    const second = await seedAsset("second");
    await attachLikeRefgen(made.entityId, second, 1);
    expect(await bothAgree(made.entityId, made.id)).toBe(first);

    // ── 状态④:商家亲手换封面(「商家随时可换」) ────────────────────────
    await expect(setBaseAsset(made.entityId, second)).resolves.toEqual({ ok: true });
    expect(await bothAgree(made.entityId, made.id)).toBe(second);

    // ── 状态⑤:再挂第三张 ⇒ 盖不掉商家挑的那张 ────────────────────────────
    const third = await seedAsset("third");
    await attachLikeRefgen(made.entityId, third, 2);
    expect(await bothAgree(made.entityId, made.id)).toBe(second);

    // ── 状态⑥:拔掉当封面的那一张 ⇒ 两边同时落到下一张 ────────────────────
    const secondRef = await prisma.referenceImage.findFirstOrThrow({
      where: { ownerId, entityId: made.entityId, assetId: second, deletedAt: null },
      select: { id: true },
    });
    await expect(softDeleteReferenceImage(secondRef.id)).resolves.toEqual({ ok: true });
    // 落到剩下那两张里最早的一张(position 0 的 first)。两边必须同时落,不能一个落一个不落。
    expect(await bothAgree(made.entityId, made.id)).toBe(first);

    // ── 状态⑦:把图全部拔光 ⇒ 两边同时变回「没有图」 ──────────────────────
    await expect(softDeleteReferenceImage(firstRef)).resolves.toEqual({ ok: true });
    const thirdRef = await prisma.referenceImage.findFirstOrThrow({
      where: { ownerId, entityId: made.entityId, assetId: third, deletedAt: null },
      select: { id: true },
    });
    await expect(softDeleteReferenceImage(thirdRef.id)).resolves.toEqual({ ok: true });
    expect(await bothAgree(made.entityId, made.id)).toBeNull();
  }, 120_000);

  it("PRODID-A4 没钉封面的存量身份:Library 不再拿第一张冒充(与 Brand 逐字一致)", async () => {
    // 裁决之前的存量形状:挂着图,但 `baseAssetId` 是 NULL(绕过写路直接造出来)。
    const name = `Teh ${randomUUID().slice(0, 8)}`;
    const made = (await createProduct({
      ownerId, data: { name, price: "RM 5" }, source: "user",
    })) as { created: true; id: string; entityId: string };
    const asset = await seedAsset("legacy");
    await prisma.referenceImage.create({
      data: { id: newId(), ownerId, entityId: made.entityId, assetId: asset, position: 0 },
    });
    await prisma.entity.updateMany({
      where: { id: made.entityId, ownerId }, data: { baseAssetId: null },
    });

    // 读路一律只认钉着的那一张:这一刻没钉过 ⇒ 两边都是「没有图」。
    // (存量数据由迁移 20260915120000_entity_cover_autopin 一次补齐,那一半在
    //  `packages/db/src/__tests__/entity-cover-autopin.test.ts` 里验。)
    expect(await bothAgree(made.entityId, made.id)).toBeNull();

    // 补齐之后,两边同时有了同一张图。
    await reconcileEntityCover(prisma, { ownerId, entityId: made.entityId });
    expect(await bothAgree(made.entityId, made.id)).toBe(asset);
  }, 120_000);
});
