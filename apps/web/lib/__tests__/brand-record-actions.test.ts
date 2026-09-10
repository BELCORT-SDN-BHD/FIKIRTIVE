import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockRequireOwner, mockFindMany, mockFindFirst, mockCreate, mockUpdateMany,
  mockCreateProduct, mockUpdateProductRecord, mockEntityUpdateMany, mockRefFindMany, mockRefUpdateMany,
} = vi.hoisted(() => ({
  mockRequireOwner: vi.fn(),
  mockFindMany: vi.fn(),
  mockFindFirst: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockCreateProduct: vi.fn(),
  mockUpdateProductRecord: vi.fn(),
  mockEntityUpdateMany: vi.fn(),
  mockRefFindMany: vi.fn(),
  mockRefUpdateMany: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    // #1321 判官第 3 轮:删除与恢复现在一个事务里动价签与身份两张表(PRODID-A6)。
    // 假件把 tx 就当成 prisma 本身 —— 这个文件验的是「写了哪一句」,不是事务语义。
    $transaction: (fn: (tx: unknown) => unknown) => fn(prismaStub),
    brandRecord: { findMany: mockFindMany, findFirst: mockFindFirst, create: mockCreate, updateMany: mockUpdateMany },
    entity: { updateMany: mockEntityUpdateMany },
    referenceImage: { findMany: mockRefFindMany, findFirst: vi.fn().mockResolvedValue(null), updateMany: mockRefUpdateMany },
    // FRONT-A8:写路径现在还会读 User(「谁改的」)与写 BrandContextRevision(改动史)。
    brandContextRevision: { create: vi.fn().mockResolvedValue({}) },
    memory: { findFirst: vi.fn().mockResolvedValue(null) },
    user: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
  },
  // #1321:建产品走共享动作(身份 Entity ＋ 价签 BrandRecord 同事务),不再走 brandRecord.create。
  // segment / offer 没有身份那一半,仍走 create —— 下面两条测试就是这条分界线。
  createProduct: mockCreateProduct,
  confirmProductDraft: vi.fn(),
  // 改产品也走共享动作(名字与主图的唯一源是身份,PRODID-A4)。
  updateProductRecord: mockUpdateProductRecord,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/** `$transaction(fn)` 收到的 tx —— 与上面 `prisma` 的形状逐字相同。 */
const prismaStub = {
  brandRecord: { findMany: mockFindMany, findFirst: mockFindFirst, create: mockCreate, updateMany: mockUpdateMany },
  entity: { updateMany: mockEntityUpdateMany },
  referenceImage: { findMany: mockRefFindMany, findFirst: vi.fn().mockResolvedValue(null), updateMany: mockRefUpdateMany },
};

import { listMyBrandRecords, saveBrandRecord, deleteBrandRecord, restoreBrandRecord } from "../brand-record-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOwner.mockResolvedValue({ ownerId: "o1", email: "merchant@fikirtive.test" });
  mockFindFirst.mockResolvedValue(null);
  mockRefFindMany.mockResolvedValue([]);
  mockEntityUpdateMany.mockResolvedValue({ count: 0 });
  mockRefUpdateMany.mockResolvedValue({ count: 0 });
});

describe("saveBrandRecord — create", () => {
  it("creates an owner-scoped product with nameKey and source user", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreateProduct.mockResolvedValue({ created: true, id: "r-new", entityId: "e-new" });
    const res = await saveBrandRecord({ kind: "product", data: { name: "Latte  Blend", price: "RM 49" } });
    expect(res).toEqual({ ok: true, id: "r-new" });
    expect(mockCreateProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "o1", brandId: null, source: "user", status: "active",
        data: { name: "Latte  Blend", price: "RM 49" },
      }),
    );
    // 产品只有共享动作这一条写路 —— 这个文件自己的 create 分支只服务 segment / offer。
    expect(mockCreate).not.toHaveBeenCalled();
  });
  it("rejects invalid data (segment without who)", async () => {
    const res = await saveBrandRecord({ kind: "segment", data: { name: "Moms" } });
    expect(res).toHaveProperty("error");
    expect(mockCreate).not.toHaveBeenCalled();
  });
  it("stores offer dates as Date columns", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({});
    await saveBrandRecord({ kind: "offer", data: { title: "Raya sale" }, startsAt: "2026-07-01", endsAt: "2026-07-15" });
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ startsAt: new Date("2026-07-01"), endsAt: new Date("2026-07-15") }),
    });
  });
});

describe("saveBrandRecord — update by id", () => {
  it("PRODID-A4 改产品走共享动作:名字与主图的意图显式递给身份,不是这个文件自己的 updateMany", async () => {
    mockUpdateProductRecord.mockResolvedValue({ ok: true, id: "r1", entityId: "e1" });
    const res = await saveBrandRecord({
      id: "r1", kind: "product",
      data: { name: "Latte Blend", price: "RM 55", imageAssetId: "as_1" },
      // 整张产品表单是唯一同时编辑名字与主图的界面,所以它、也只有它交 `identity`。
      identity: { name: "Latte Blend", imageAssetId: "as_1" },
    });
    expect(res).toEqual({ ok: true, id: "r1" });
    // 这一面是商家亲手填的整张表单,所以两个意图都**显式**递下去 —— 共享动作不猜。
    expect(mockUpdateProductRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "o1", id: "r1", source: "user", name: "Latte Blend", imageAssetId: "as_1",
      }),
    );
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("PRODID-A4 Brand 页把主图栏空着 = 清空主图(显式 null,不是「这次不碰」)", async () => {
    mockUpdateProductRecord.mockResolvedValue({ ok: true, id: "r1", entityId: "e1" });
    await saveBrandRecord({
      id: "r1", kind: "product", data: { name: "Latte Blend", price: "RM 55" },
      identity: { name: "Latte Blend", imageAssetId: null },
    });
    expect(mockUpdateProductRecord).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Latte Blend", imageAssetId: null }),
    );
  });

  /**
   * PRODID-R6(规格 §5 登记)—— 判官 P2(PR #1337 → 票 #1322):归档、换封面、撤销一次 Otto
   * 改动这三条路,手里那份 `data` 是**读路补进去的客户端快照**(`withProductIdentity` 把身份的
   * 名字与主图盖进 `data` 才交给界面)。上一版无条件把 `data.name` 当改名意图递下去,于是
   * 「归档一件产品」会把一个可能已经过期的名字写回权威。判据改成「这一格有没有被提交」。
   */
  it("PRODID-R6 归档不交 identity:名字与主图两格一个都不递给共享动作(换封面不改名同理)", async () => {
    mockUpdateProductRecord.mockResolvedValue({ ok: true, id: "r1", entityId: "e1" });
    // 归档:界面把它读到的整行原样交回来(其中的 name 来自读路的身份 join),但不交 identity。
    await saveBrandRecord({
      id: "r1", kind: "product",
      data: { name: "过期的名字", price: "RM 55", imageAssetId: "as_stale" },
      status: "archived",
    });
    const call = mockUpdateProductRecord.mock.calls[0][0];
    expect(call).toMatchObject({ ownerId: "o1", id: "r1", status: "archived" });
    expect("name" in call).toBe(false);
    expect("imageAssetId" in call).toBe(false);
  });

  it("PRODID-R6 换封面只交主图这一格:改的是主图,名字一个字都不递", async () => {
    mockUpdateProductRecord.mockResolvedValue({ ok: true, id: "r1", entityId: "e1" });
    await saveBrandRecord({
      id: "r1", kind: "product",
      data: { name: "过期的名字", price: "RM 55" },
      identity: { imageAssetId: "as_new" },
    });
    const call = mockUpdateProductRecord.mock.calls[0][0];
    expect(call.imageAssetId).toBe("as_new");
    expect("name" in call).toBe(false);
  });
  it("updates data/nameKey owner-scoped and flips source to user(segment 仍走本文件的 updateMany)", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    const res = await saveBrandRecord({
      id: "r1", kind: "segment", data: { name: "Office crowd", who: "Office workers nearby" },
    });
    expect(res).toEqual({ ok: true, id: "r1" });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "r1", ownerId: "o1", deletedAt: null },
      data: expect.objectContaining({ nameKey: "office crowd", source: "user" }),
    });
  });
  it("errors when not found", async () => {
    mockUpdateProductRecord.mockResolvedValue({ ok: false, reason: "not-found" });
    expect(await saveBrandRecord({ id: "nope", kind: "product", data: { name: "X" } })).toHaveProperty("error");
  });
});

describe("delete / restore", () => {
  it("FRONT-A8 soft-deletes owner-scoped", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    // 回查这一行是什么 kind —— segment 就不去动身份那张表(PRODID-A6 只管产品)。
    mockFindFirst.mockResolvedValue({ kind: "segment", entityId: null });
    expect(await deleteBrandRecord({ id: "r1" })).toEqual({ ok: true });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      // 判官 P2-1:只有还在的行才删 —— 已经删掉的行不再被写第二次,改动史里就不会
      // 一行接一行 deleted。
      where: { id: "r1", ownerId: "o1", deletedAt: null },
      // FRONT-A8:删除/恢复也是一次「谁动的」。判官 P2-4:认得出人才写 —— 这一份的
      // fixture 查不到 User 行(userId 为 null),写进去等于把这一行已知的作者抹掉。
      data: { deletedAt: expect.any(Date) },
    });
  });
  it("FRONT-A8 soft-delete is safe to repeat after an uncertain response", async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    // 第一趟:回查 kind(segment,不动身份);第二趟:回查「它已经在删除态了」。
    mockFindFirst
      .mockResolvedValueOnce({ kind: "segment", entityId: null })
      .mockResolvedValue({ id: "r1" });
    expect(await deleteBrandRecord({ id: "r1" })).toEqual({ ok: true });
    expect(await deleteBrandRecord({ id: "r1" })).toEqual({ ok: true });
    expect(mockFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "r1", ownerId: "o1", deletedAt: { not: null } },
    }));
  });
  it("FRONT-A8 restore clears deletedAt", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    // 恢复先读这一行的 kind / nameKey / deletedAt,再确认名字槽位没被别人占走。
    mockFindFirst
      .mockResolvedValueOnce({ kind: "segment", brandId: null, nameKey: "x", entityId: null, deletedAt: new Date() })
      .mockResolvedValueOnce(null);
    expect(await restoreBrandRecord({ id: "r1" })).toEqual({ ok: true });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      // 判官 P2-1:镜像的那一半 —— 只有还在删除态的行才恢复。
      where: { id: "r1", ownerId: "o1", deletedAt: { not: null } },
      // FRONT-A8:删除/恢复也是一次「谁动的」。判官 P2-4:认得出人才写 —— 这一份的
      // fixture 查不到 User 行(userId 为 null),写进去等于把这一行已知的作者抹掉。
      data: { deletedAt: null },
    });
  });
  it("PRODID-A6 名字槽位被占时那一句人话按 kind 走:audience 不会被叫成 product", async () => {
    // 判官第 5 轮(PR #1337):这条恢复动作对 segment / offer 一样跑得到,而上一版无论恢复
    // 的是什么都回「You already have a product with that name」—— 商家读到的是一句关于
    // 另一种东西的话。
    mockFindFirst
      .mockResolvedValueOnce({ kind: "segment", brandId: null, nameKey: "x", entityId: null, deletedAt: new Date() })
      .mockResolvedValueOnce({ id: "r-other" });
    expect(await restoreBrandRecord({ id: "r1" })).toEqual({
      error: "You already have an audience with that name — rename that one first.",
    });
    mockFindFirst.mockReset();
    mockFindFirst
      .mockResolvedValueOnce({ kind: "product", brandId: null, nameKey: "x", entityId: null, deletedAt: new Date() })
      .mockResolvedValueOnce({ id: "r-other" });
    expect(await restoreBrandRecord({ id: "r1" })).toEqual({
      error: "You already have a product with that name — rename that one first.",
    });
  });
});

describe("listMyBrandRecords", () => {
  it("returns [] when not signed in", async () => {
    mockRequireOwner.mockResolvedValue({ error: "no" });
    expect(await listMyBrandRecords()).toEqual([]);
  });
  it("lists live rows owner-scoped, parsed shape", async () => {
    mockFindMany.mockResolvedValue([{
      id: "r1", kind: "product", data: { name: "A" }, status: "active",
      startsAt: null, endsAt: null, source: "otto", pinned: false, updatedAt: new Date(),
    }]);
    const rows = await listMyBrandRecords();
    expect(rows).toHaveLength(1);
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      // FRONT-A8:与 Memory 同一条纪律 —— 只有 Ready 是正式记录。
      where: { ownerId: "o1", brandId: null, deletedAt: null, contextStatus: "Ready" },
    }));
  });
});
