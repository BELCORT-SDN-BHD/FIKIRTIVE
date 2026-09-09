/**
 * Brand 产品身份 —— 写路与身份那一半(规格 `docs/specs/brand-product-identity.md`,票 #1321)。
 *
 * 规格 §0 那句话是这份文件要证的全部:「商家在 Brand 页、Library、Otto 对话或网站理解里建的
 * 产品,是同一件东西」。同一件东西 = **同一个 Entity id**。所以每条断言都落在 id 上,不落在
 * 「看起来一样」上。
 *
 * 硬口径:真数据库、真 Prisma、真 `requireOwner`、真存储字节。只有会话被 mock —— 要证的正是
 * 「ownerId 只来自服务端 principal」,身份那一处必须能换人,别的都不许假。
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
const { saveBrandRecord, listBrandRecords, deleteBrandRecord } = await import("@/lib/brand-record-actions");
const { createEntity } = await import("@/lib/actions");
const { getLibraryElements } = await import("@/lib/library-elements");
const { storage } = await import("@/lib/storage");
const { prisma } = await import("@fikirtive/db");
const { newId } = await import("@fikirtive/core");

const REPO_ROOT = path.join(process.cwd(), "..", "..");
const EMAIL_A = `prodid-a-${randomUUID()}@fikirtive.test`;
const EMAIL_B = `prodid-b-${randomUUID()}@fikirtive.test`;
let ownerA: string;
let ownerB: string;

async function signInAs(email: string): Promise<string> {
  mockAuth.mockResolvedValue({ user: { email } });
  const gate = await requireOwner();
  if ("error" in gate) throw new Error(gate.error);
  return gate.ownerId;
}

/** 一张真的躺在存储里的一像素图 + 它的 Asset 行(内容寻址,所以每个 org 的字节不同)。 */
async function seedAsset(ownerId: string, label: string): Promise<string> {
  const bytes = new TextEncoder().encode(`fikirtive-prodid-${ownerId}-${label}`);
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

async function ledgerRows(ownerId: string): Promise<number> {
  return prisma.creditLedger.count({ where: { orgId: ownerId } });
}

beforeAll(async () => {
  process.env.AUTH_ALLOWED_EMAILS = `${EMAIL_A},${EMAIL_B}`;
  for (const email of [EMAIL_A, EMAIL_B]) {
    await prisma.user.upsert({ where: { email }, update: {}, create: { id: `usr_${randomUUID()}`, email } });
  }
  ownerA = await signInAs(EMAIL_A);
  ownerB = await signInAs(EMAIL_B);
  expect(ownerA).not.toBe(ownerB);
}, 120_000);

afterAll(async () => {
  for (const ownerId of [ownerA, ownerB]) {
    if (!ownerId) continue;
    rmSync(path.join(REPO_ROOT, ".data", "storage", "u", ownerId), { recursive: true, force: true });
  }
});

describe("PRODID-A1 在 Brand 页新增产品 → Library Products 出现同一张卡、同一 id", () => {
  it("PRODID-A1 Brand 页建产品后,Library 那张卡的 id 就是该 BrandRecord 的 entityId", async () => {
    await signInAs(EMAIL_A);
    const assetId = await seedAsset(ownerA, "kopi");
    const name = `Kopi ais ${randomUUID().slice(0, 8)}`;

    const saved = await saveBrandRecord({
      kind: "product",
      data: { name, price: "RM 6.50", imageAssetId: assetId },
    });
    expect(saved).toEqual({ ok: true, id: expect.any(String) });
    const recordId = (saved as { ok: true; id: string }).id;

    const record = await prisma.brandRecord.findFirstOrThrow({
      where: { id: recordId, ownerId: ownerA },
      select: { entityId: true, ownerId: true, kind: true },
    });
    expect(record.kind).toBe("product");
    expect(record.ownerId).toBe(ownerA);
    expect(record.entityId).toBeTruthy();

    // 身份那一半:名字与主图只存在 Entity 上。
    const entity = await prisma.entity.findFirstOrThrow({
      where: { id: record.entityId!, ownerId: ownerA },
      select: { ownerId: true, type: true, name: true, baseAssetId: true, deletedAt: true },
    });
    expect(entity).toMatchObject({ ownerId: ownerA, type: "PRODUCT", name, baseAssetId: assetId, deletedAt: null });

    // Library Products 那一栏读的是 Entity —— 同一张卡、同一 id,没有第二份。
    const elements = await getLibraryElements();
    expect(Array.isArray(elements)).toBe(true);
    const cards = (elements as Awaited<ReturnType<typeof getLibraryElements>> & unknown[]).filter(
      (e: { name: string }) => e.name === name,
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: record.entityId, kind: "products", name });
    expect((cards[0] as { coverUrl: string | null }).coverUrl).toBeTruthy();
  }, 60_000);
});

describe("PRODID-A3 在 Library「新建元素 → 产品」→ Brand 页产品分区出现同一产品", () => {
  it("PRODID-A3 Library 建 PRODUCT 元素后,Brand 页有同一件产品,价格卖点为空待填", async () => {
    await signInAs(EMAIL_A);
    const name = `Teh tarik ${randomUUID().slice(0, 8)}`;
    const form = new FormData();
    form.set("name", name);
    form.set("type", "PRODUCT");

    const created = (await createEntity(form)) as { id?: string; error?: string };
    expect(created.error).toBeUndefined();
    expect(created.id).toBeTruthy();

    const records = await listBrandRecords();
    const row = records.filter((r) => r.kind === "product" && (r.data as { name?: string }).name === name);
    expect(row).toHaveLength(1);
    // 价格、卖点、分类是价签,Library 那条入口填不了 —— 建出来就该是空的。
    expect(row[0]!.data).toEqual({ name });

    const record = await prisma.brandRecord.findFirstOrThrow({
      where: { id: row[0]!.id, ownerId: ownerA },
      select: { entityId: true, ownerId: true },
    });
    expect(record.ownerId).toBe(ownerA);
    expect(record.entityId).toBe(created.id);
  }, 60_000);
});

describe("PRODID-A9 跨租户:找不到,写入被拒", () => {
  it("PRODID-A9 另一个租户既看不到这件产品,也无法把自己的价签挂到它的身份上", async () => {
    await signInAs(EMAIL_A);
    const name = `Nasi lemak ${randomUUID().slice(0, 8)}`;
    const saved = (await saveBrandRecord({ kind: "product", data: { name } })) as { ok: true; id: string };
    const aRecord = await prisma.brandRecord.findFirstOrThrow({
      where: { id: saved.id, ownerId: ownerA },
      select: { entityId: true },
    });
    const aEntityId = aRecord.entityId!;

    // ① 读:B 的 Library 与 Brand 页里没有 A 的这一行。
    await signInAs(EMAIL_B);
    const bElements = (await getLibraryElements()) as { id: string; name: string }[];
    expect(bElements.some((e) => e.id === aEntityId || e.name === name)).toBe(false);
    const bRecords = await listBrandRecords();
    expect(bRecords.some((r) => (r.data as { name?: string }).name === name)).toBe(false);

    // ② 写:直接构造一条指向 A 身份的 B 价签 —— 复合外键 (entityId, ownerId) 让数据库拒绝
    //    这条连线(ADR 0002 第五条),不靠调用处记得加 where。
    await expect(
      prisma.brandRecord.create({
        data: {
          id: newId(), ownerId: ownerB, brandId: null, kind: "product",
          nameKey: name.toLowerCase(), entityId: aEntityId,
          data: { name }, status: "active", source: "user", pinned: false,
        },
      }),
    ).rejects.toThrow();

    // 受害者的数据一个字节没动。
    await expect(
      prisma.brandRecord.count({ where: { ownerId: ownerB, entityId: aEntityId } }),
    ).resolves.toBe(0);
    await expect(
      prisma.entity.count({ where: { id: aEntityId, ownerId: ownerA, deletedAt: null } }),
    ).resolves.toBe(1);
  }, 60_000);

  it("PRODID-A9 没有身份的 product 行进不了库(CHECK BrandRecord_product_needs_entity)", async () => {
    await expect(
      prisma.brandRecord.create({
        data: {
          id: newId(), ownerId: ownerA, brandId: null, kind: "product",
          nameKey: `orphan ${randomUUID().slice(0, 8)}`,
          data: { name: "Orphan" }, status: "active", source: "user", pinned: false,
        },
      }),
    ).rejects.toThrow();
  }, 60_000);
});

/**
 * 读路改接(@ 菜单、Library / Brand 双向同步、删除恢复同步、理解草稿门)是 Brand②③ 的活
 * (票 #1322 / #1330)。占位在这里,好让验收表这五行有落点,S5 前由那两票转正 ——
 * 空着不写比写一条假绿的测试更诚实(M3 明确允许 it.todo 占位)。
 */
describe("PRODID-A2/A4/A5/A6/A7 读路与同步(Brand②③,票 #1322 / #1330)", () => {
  it.todo("PRODID-A2 @ 菜单来源标签为「Product」,选入确认卡后谱系指向同一个 Entity id");
  it.todo("PRODID-A4 Library 与 Brand 页任一边改名换主图,另一边同步显示(同一行 Entity)");
  it.todo("PRODID-A5 Library 元素页没有价格、卖点、分类的编辑入口");
  it.todo("PRODID-A6 Brand 页删除产品,Library 随之消失;任一边恢复,另一边跟着回来");
  it.todo("PRODID-A7 Otto「记下产品 X」两边出现;理解提取的草稿在确认前不进 Library 与 @ 菜单");
});

describe("PRODID-A10 建、改、删产品各一次:余额不变,账本零新行", () => {
  it("PRODID-A10 建改删三次动作之后,账本行数与余额逐字不变", async () => {
    await signInAs(EMAIL_A);
    const before = await prisma.creditAccount.findUniqueOrThrow({
      where: { orgId: ownerA },
      select: { balance: true, reserved: true },
    });
    const ledgerBefore = await ledgerRows(ownerA);

    const name = `Roti canai ${randomUUID().slice(0, 8)}`;
    const saved = (await saveBrandRecord({ kind: "product", data: { name } })) as { ok: true; id: string };
    expect(saved.ok).toBe(true);
    const edited = await saveBrandRecord({ id: saved.id, kind: "product", data: { name, price: "RM 2.00" } });
    expect(edited).toEqual({ ok: true, id: saved.id });
    await expect(deleteBrandRecord({ id: saved.id })).resolves.toEqual({ ok: true });

    const after = await prisma.creditAccount.findUniqueOrThrow({
      where: { orgId: ownerA },
      select: { balance: true, reserved: true },
    });
    expect(after).toEqual(before);
    expect(await ledgerRows(ownerA)).toBe(ledgerBefore);
  }, 60_000);
});
