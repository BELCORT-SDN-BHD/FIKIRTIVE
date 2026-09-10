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
const {
  saveBrandRecord, listBrandRecords, deleteBrandRecord, restoreBrandRecord,
  confirmBrandRecordDraft, discardBrandRecordDraft,
} = await import("@/lib/brand-record-actions");
const { createEntity, softDeleteEntity, softDeleteReferenceImage } = await import("@/lib/actions");
const { getLibraryElements } = await import("@/lib/library-elements");
const { searchReferences } = await import("@/lib/reference-search");
const { storage } = await import("@/lib/storage");
const { prisma, createProduct } = await import("@fikirtive/db");
const { newId, storageKey } = await import("@fikirtive/core");

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

/** 这张图的字节此刻还在不在存储桶里(真读,不看数据库那一行)。 */
async function bytesExist(ownerId: string, assetId: string): Promise<boolean> {
  const a = await prisma.asset.findFirstOrThrow({
    where: { id: assetId, ownerId },
    select: { ownerId: true, contentHash: true, ext: true },
  });
  return storage.exists(storageKey(a.ownerId, a.contentHash, a.ext.toLowerCase()));
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
    if (!Array.isArray(elements)) throw new Error(elements.error);
    const cards = elements.filter((e) => e.name === name);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: record.entityId, kind: "products", name });
    expect(cards[0]!.coverUrl).toBeTruthy();
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

    // CHECK 上唯一的口子是草稿(规格 §1.9 / PRODID-A7)—— 而且**只有**草稿:上面那一条
    // 同样没有身份、只差 contextStatus,它进不了库。
    await expect(
      prisma.brandRecord.create({
        data: {
          id: newId(), ownerId: ownerA, brandId: null, kind: "product",
          nameKey: `draft ${randomUUID().slice(0, 8)}`, contextStatus: "Draft",
          data: { name: "Draft" }, status: "active", source: "otto", pinned: false,
        },
      }),
    ).resolves.toBeTruthy();
  }, 60_000);
});

/**
 * PRODID-A7 的后半句(理解提取的草稿在确认前不进 Library 与 @ 菜单)在第 1 轮修复里落地了 ——
 * 判官指出把理解入口直接接到 `createProduct` 会让「AI 猜出来、商家没确认过的产品」当场进
 * Library 与 @ 菜单,那是把这条验收的结论**反着**实现。做法见 `packages/db/src/create-product.ts`
 * 顶部「草稿」一段:草稿那一刻根本没有身份,所以「不出现」由数据本身保证,而不是靠每一条读路
 * 各自记得过滤。确认转正那一半在判官第 2 轮补上(见下面「PRODID-A7 草稿转正」一节);
 * 前半句(Otto「记下产品 X」→ 两边出现)的单元覆盖在
 * `packages/otto/src/skills/_brand-record.test.ts`。
 */
describe("PRODID-A7 理解提取的产品先落草稿:确认前不进 Library 与 @ 菜单", () => {
  it("PRODID-A7 理解提取的产品只落价签、不建身份,Library 与 @ 菜单都找不到它", async () => {
    await signInAs(EMAIL_A);
    const name = `Mee goreng ${randomUUID().slice(0, 8)}`;
    // 理解 worker 那条入口逐字的调用形状(apps/worker/src/jobs/understand.ts)。
    const made = await createProduct({
      ownerId: ownerA, data: { name, price: "RM 8.00" }, source: "otto", contextStatus: "Draft",
    });
    expect(made).toMatchObject({ created: true, entityId: null });

    const row = await prisma.brandRecord.findFirstOrThrow({
      where: { id: (made as { id: string }).id, ownerId: ownerA },
      select: { entityId: true, contextStatus: true, kind: true },
    });
    expect(row).toMatchObject({ kind: "product", contextStatus: "Draft", entityId: null });
    // 身份那一半一条都没有 —— 「不出现」不是靠读路过滤,是根本没有可显示的行。
    await expect(
      prisma.entity.count({ where: { ownerId: ownerA, type: "PRODUCT", name } }),
    ).resolves.toBe(0);

    const elements = await getLibraryElements();
    if (!Array.isArray(elements)) throw new Error(elements.error);
    expect(elements.some((e) => e.name === name)).toBe(false);

    const menu = await searchReferences(ownerA, { query: name });
    expect(menu.items.some((i) => i.name === name)).toBe(false);
  }, 60_000);
});

/**
 * 读路改接(@ 菜单、Library / Brand 双向同步、删除恢复同步)是 Brand②③ 的活
 * (票 #1322 / #1330)。占位在这里,好让验收表这几行有落点,S5 前由那两票转正 ——
 * 空着不写比写一条假绿的测试更诚实(M3 明确允许 it.todo 占位)。
 */
describe("PRODID-A2/A4/A5/A6 读路与同步(Brand②③,票 #1322 / #1330)", () => {
  it.todo("PRODID-A2 @ 菜单来源标签为「Product」,选入确认卡后谱系指向同一个 Entity id");
  it.todo("PRODID-A4 Library 与 Brand 页任一边改名换主图,另一边同步显示(同一行 Entity)");
  it.todo("PRODID-A5 Library 元素页没有价格、卖点、分类的编辑入口");
  it.todo("PRODID-A6 Brand 页删除产品,Library 随之消失;任一边恢复,另一边跟着回来");
});

/**
 * PRODID-A7 的后半句「商家确认后才建身份」—— 判官第 2 轮 P0(PR #1337):第 1 轮只落了草稿
 * 那一半,转正那一半没落,于是草稿是一条**没有出口的死路**:它占住
 * `(ownerId, brandId, kind, nameKey)` 这个活跃唯一名字槽位,商家之后无论从哪条路建同名产品
 * 都会被查重转成对它的 update,「保存成功」而身份永远不存在。转正的唯一写路是共享动作
 * `confirmProductDraft`(packages/db/src/create-product.ts),下面三条把它的三个入口各钉一次。
 */
describe("PRODID-A7 草稿转正:确认之后才有身份", () => {
  it("PRODID-A7 Brand 页确认草稿:补上身份、抬成 Ready,Library 与 @ 菜单同时出现", async () => {
    await signInAs(EMAIL_A);
    const assetId = await seedAsset(ownerA, `draft-confirm-${randomUUID().slice(0, 8)}`);
    const name = `Laksa ${randomUUID().slice(0, 8)}`;
    const made = (await createProduct({
      ownerId: ownerA, data: { name, price: "RM 9.00", imageAssetId: assetId },
      source: "otto", contextStatus: "Draft",
    })) as { created: true; id: string; entityId: null };
    expect(made.entityId).toBeNull();

    await expect(confirmBrandRecordDraft({ id: made.id })).resolves.toEqual({ ok: true });

    const row = await prisma.brandRecord.findFirstOrThrow({
      where: { id: made.id, ownerId: ownerA },
      select: { entityId: true, contextStatus: true },
    });
    expect(row.contextStatus).toBe("Ready");
    expect(row.entityId).toBeTruthy();
    const entity = await prisma.entity.findFirstOrThrow({
      where: { id: row.entityId!, ownerId: ownerA },
      select: { type: true, name: true, baseAssetId: true, deletedAt: true },
    });
    expect(entity).toMatchObject({ type: "PRODUCT", name, baseAssetId: assetId, deletedAt: null });

    const elements = await getLibraryElements();
    if (!Array.isArray(elements)) throw new Error(elements.error);
    expect(elements.filter((e) => e.name === name).map((e) => e.id)).toEqual([row.entityId]);
    const menu = await searchReferences(ownerA, { query: name });
    expect(menu.items.some((i) => i.name === name)).toBe(true);
    // 转正之后它才是一条正式记录 —— 在 /brand/records 的列表里也才看得到、改得了。
    const records = await listBrandRecords();
    expect(records.some((r) => r.id === made.id)).toBe(true);
  }, 60_000);

  it("PRODID-A1 撞上同名草稿时,Brand 页新增产品是确认它 —— 不是静默写进一条没有身份的行", async () => {
    await signInAs(EMAIL_A);
    const name = `Kopi O ${randomUUID().slice(0, 8)}`;
    const draft = (await createProduct({
      ownerId: ownerA, data: { name, price: "RM 2.00" }, source: "otto", contextStatus: "Draft",
    })) as { created: true; id: string };

    // 商家在 Brand 页亲手新增同名产品:走的是「新增」,撞上的是那条草稿。
    const saved = await saveBrandRecord({ kind: "product", data: { name, price: "RM 2.50" } });
    expect(saved).toEqual({ ok: true, id: draft.id });

    const row = await prisma.brandRecord.findFirstOrThrow({
      where: { id: draft.id, ownerId: ownerA },
      select: { entityId: true, contextStatus: true, source: true, data: true },
    });
    expect(row.contextStatus).toBe("Ready");
    expect(row.entityId).toBeTruthy();
    expect(row.source).toBe("user");
    // 商家这次填的价格赢过草稿里模型猜的那个。
    expect((row.data as { price?: string }).price).toBe("RM 2.50");

    const elements = await getLibraryElements();
    if (!Array.isArray(elements)) throw new Error(elements.error);
    expect(elements.filter((e) => e.name === name).map((e) => e.id)).toEqual([row.entityId]);
    // 同名产品只有一件 —— 确认不是新建。
    await expect(
      prisma.brandRecord.count({ where: { ownerId: ownerA, kind: "product", deletedAt: null, entityId: { not: null }, nameKey: name.toLowerCase() } }),
    ).resolves.toBe(1);
  }, 60_000);

  it("PRODID-A3 撞上同名草稿时,Library 建产品也是确认它 —— 不是一句「已经有了」而库里查无此物", async () => {
    await signInAs(EMAIL_A);
    const name = `Char kuey teow ${randomUUID().slice(0, 8)}`;
    const draft = (await createProduct({
      ownerId: ownerA, data: { name, price: "RM 7.00" }, source: "otto", contextStatus: "Draft",
    })) as { created: true; id: string };

    const form = new FormData();
    form.set("name", name);
    form.set("type", "PRODUCT");
    const created = (await createEntity(form)) as { id?: string; error?: string };
    expect(created.error).toBeUndefined();

    const row = await prisma.brandRecord.findFirstOrThrow({
      where: { id: draft.id, ownerId: ownerA },
      select: { entityId: true, contextStatus: true, data: true },
    });
    expect(row.contextStatus).toBe("Ready");
    expect(row.entityId).toBe(created.id);
    // 草稿里模型读出来的价格没有被这条入口抹掉(Library 那一面填不了价签)。
    expect((row.data as { price?: string }).price).toBe("RM 7.00");
    const elements = await getLibraryElements();
    if (!Array.isArray(elements)) throw new Error(elements.error);
    expect(elements.filter((e) => e.name === name).map((e) => e.id)).toEqual([created.id]);
  }, 60_000);

  it("PRODID-A7 放弃草稿:行软删、名字槽位让出来,商家可以重新建同名产品", async () => {
    await signInAs(EMAIL_A);
    const name = `Cincau ${randomUUID().slice(0, 8)}`;
    const draft = (await createProduct({
      ownerId: ownerA, data: { name }, source: "otto", contextStatus: "Draft",
    })) as { created: true; id: string };

    await expect(discardBrandRecordDraft({ id: draft.id })).resolves.toEqual({ ok: true });
    const gone = await prisma.brandRecord.findFirstOrThrow({
      where: { id: draft.id, ownerId: ownerA }, select: { deletedAt: true, entityId: true },
    });
    expect(gone.deletedAt).not.toBeNull();
    expect(gone.entityId).toBeNull();

    // 名字槽位是「活跃唯一」的,所以放弃之后同名产品建得出来,而且是一条**新**行、有身份。
    const saved = (await saveBrandRecord({ kind: "product", data: { name } })) as { ok: true; id: string };
    expect(saved.id).not.toBe(draft.id);
    const fresh = await prisma.brandRecord.findFirstOrThrow({
      where: { id: saved.id, ownerId: ownerA }, select: { entityId: true, contextStatus: true },
    });
    expect(fresh).toMatchObject({ contextStatus: "Ready" });
    expect(fresh.entityId).toBeTruthy();
  }, 60_000);
});

/**
 * 判官第 2 轮 P1(PR #1337)—— 一条 fail-closed 的**不可逆删字节**顺序:①Brand 页删产品
 * (只软删价签,身份还留在 Library);②商家去 Library 把那张残留卡删掉,softDeleteEntity 顺手
 * 跑资产清理;③清理判据原先只认**活的**软指针,于是把价签还指着的字节真删出存储桶;
 * ④商家按提示恢复价签,`data.imageAssetId` 原样回来,而字节已经永远没了。
 * 行可恢复、字节不可恢复 —— 所以判据认账软删的软指针(`apps/web/lib/asset-purge.ts`)。
 */
describe("判官 P1 回归:软删的价签也算指针,恢复之后主图还在", () => {
  it("判官 P1 先删价签再删 Library 卡:字节还在,恢复价签之后主图指得到", async () => {
    await signInAs(EMAIL_A);
    const assetId = await seedAsset(ownerA, `p1-restore-${randomUUID().slice(0, 8)}`);
    const name = `Satay ${randomUUID().slice(0, 8)}`;
    const saved = (await saveBrandRecord({
      kind: "product", data: { name, imageAssetId: assetId },
    })) as { ok: true; id: string };
    const record = await prisma.brandRecord.findFirstOrThrow({
      where: { id: saved.id, ownerId: ownerA }, select: { entityId: true },
    });

    await expect(deleteBrandRecord({ id: saved.id })).resolves.toEqual({ ok: true });
    await expect(softDeleteEntity(record.entityId!)).resolves.toMatchObject({ ok: true });

    // 字节没被带走 —— 那条软删的价签随时可以恢复,而字节恢复不了。
    await expect(
      prisma.asset.count({ where: { id: assetId, ownerId: ownerA, deletedAt: null } }),
    ).resolves.toBe(1);
    expect(await bytesExist(ownerA, assetId)).toBe(true);

    await expect(restoreBrandRecord({ id: saved.id })).resolves.toEqual({ ok: true });
    const back = await prisma.brandRecord.findFirstOrThrow({
      where: { id: saved.id, ownerId: ownerA }, select: { data: true, deletedAt: true },
    });
    expect(back.deletedAt).toBeNull();
    expect((back.data as { imageAssetId?: string }).imageAssetId).toBe(assetId);
    expect(await bytesExist(ownerA, assetId)).toBe(true);
  }, 60_000);
});

/**
 * 判官第 1 轮 P0(PR #1337)。这一条不是验收表上的一行,是本 PR **新开**的一条不可逆删数据
 * 路径的回归测试:产品的主图从此同时是 Entity 的 ReferenceImage(硬引用)与价签的
 * `data.imageAssetId`(软指针)。资产「独占」判据(`apps/web/lib/asset-purge.ts`,7.3 单一
 * 权威)原本只认硬引用,于是商家在 Library 删掉那张产品卡、或只删掉那张照片,Brand 页价签
 * 还指着的字节就会被真删出存储桶,而价签本身还活着 —— 商家看到一张永远坏掉的图,且无法恢复。
 */
describe("判官 P0 回归:Library 删除不得毁掉 Brand 页价签还在用的主图字节", () => {
  it("判官 P0 Library 删掉产品卡:Brand 页价签还在,主图字节也还在", async () => {
    await signInAs(EMAIL_A);
    const assetId = await seedAsset(ownerA, `p0-entity-${randomUUID().slice(0, 8)}`);
    const name = `Roti bakar ${randomUUID().slice(0, 8)}`;
    const saved = (await saveBrandRecord({
      kind: "product", data: { name, imageAssetId: assetId },
    })) as { ok: true; id: string };
    const record = await prisma.brandRecord.findFirstOrThrow({
      where: { id: saved.id, ownerId: ownerA }, select: { entityId: true },
    });
    expect(await bytesExist(ownerA, assetId)).toBe(true);

    await expect(softDeleteEntity(record.entityId!)).resolves.toMatchObject({ ok: true });

    // 价签还活着,还指着这张图 —— 所以这张图的字节不是孤儿。
    const after = await prisma.brandRecord.findFirstOrThrow({
      where: { id: saved.id, ownerId: ownerA }, select: { data: true, deletedAt: true },
    });
    expect(after.deletedAt).toBeNull();
    expect((after.data as { imageAssetId?: string }).imageAssetId).toBe(assetId);
    await expect(
      prisma.asset.count({ where: { id: assetId, ownerId: ownerA, deletedAt: null } }),
    ).resolves.toBe(1);
    expect(await bytesExist(ownerA, assetId)).toBe(true);
  }, 60_000);

  it("判官 P0 Library 删掉那张唯一的照片:Brand 页价签还在,主图字节也还在", async () => {
    await signInAs(EMAIL_A);
    const assetId = await seedAsset(ownerA, `p0-ref-${randomUUID().slice(0, 8)}`);
    const name = `Cendol ${randomUUID().slice(0, 8)}`;
    const saved = (await saveBrandRecord({
      kind: "product", data: { name, imageAssetId: assetId },
    })) as { ok: true; id: string };
    const record = await prisma.brandRecord.findFirstOrThrow({
      where: { id: saved.id, ownerId: ownerA }, select: { entityId: true },
    });
    const ref = await prisma.referenceImage.findFirstOrThrow({
      where: { entityId: record.entityId!, ownerId: ownerA, assetId, deletedAt: null },
      select: { id: true },
    });

    await expect(softDeleteReferenceImage(ref.id)).resolves.toMatchObject({ ok: true });

    await expect(
      prisma.asset.count({ where: { id: assetId, ownerId: ownerA, deletedAt: null } }),
    ).resolves.toBe(1);
    expect(await bytesExist(ownerA, assetId)).toBe(true);
  }, 60_000);
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
