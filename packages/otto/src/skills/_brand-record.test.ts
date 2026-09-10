import { describe, it, expect, vi, beforeEach } from "vitest";
import { upsertBrandRecordFromOtto } from "./_brand-record.js";
import { saveProductSkill } from "./save-product.js";
import { saveCustomerSegmentSkill } from "./save-customer-segment.js";
import { saveOfferSkill } from "./save-offer.js";
import type { OttoContext } from "../context.js";

vi.mock("@fikirtive/db", () => ({
  prisma: {
    brandRecord: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    genJob: { create: vi.fn() }, // must never be called — these are $0 skills
  },
  // 产品走共享动作(身份 ＋ 价签同事务),不再由这个文件自己 create —— 规格
  // docs/specs/brand-product-identity.md §1.4。segment / offer 仍走上面那条。
  createProduct: vi.fn(),
  // 撞上一条草稿产品时,Otto 说的「记下产品 X」就是确认它 —— 共享动作补身份、抬 Ready。
  confirmProductDraft: vi.fn(),
}));
vi.mock("@fikirtive/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fikirtive/core")>()),
  newId: vi.fn(() => "rec-id-1"),
}));

function makeCtx(): OttoContext {
  return {
    orgId: "org-test", userId: "user-test", projectId: "proj-test", threadId: "thread-test",
    disabledModels: [], sourceGenerationId: null,
  } as unknown as OttoContext;
}

let db: {
  prisma: {
    brandRecord: {
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    genJob: { create: ReturnType<typeof vi.fn> };
  };
  createProduct: ReturnType<typeof vi.fn>;
  confirmProductDraft: ReturnType<typeof vi.fn>;
};
beforeEach(async () => {
  vi.clearAllMocks();
  db = (await import("@fikirtive/db")) as unknown as typeof db;
});

describe("upsertBrandRecordFromOtto", () => {
  it("creates when no live row matches nameKey (source otto, ownerId from ctx)", async () => {
    db.prisma.brandRecord.findFirst.mockResolvedValue(null);
    db.createProduct.mockResolvedValue({ created: true, id: "rec-id-1", entityId: "ent-id-1" });
    const res = await upsertBrandRecordFromOtto(
      { kind: "product", fields: { name: "Latte Blend", price: "RM 49" } },
      { context: makeCtx() },
    );
    expect(res).toEqual({ ok: true, id: "rec-id-1", updated: false });
    // 建产品只有一条写路:共享动作。这个文件自己的 create 分支只服务 segment / offer。
    expect(db.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "org-test", brandId: null, source: "otto", status: "active",
        data: expect.objectContaining({ name: "Latte Blend", price: "RM 49" }),
      }),
    );
    expect(db.prisma.brandRecord.create).not.toHaveBeenCalled();
    expect(db.prisma.genJob.create).not.toHaveBeenCalled();
  });

  it("PRODID-A7 撞上同名草稿产品:走共享动作确认转正,不是往草稿上写 data", async () => {
    // 判官第 2 轮 P0(PR #1337):少了这一分流,Otto 回「saved」但身份不存在 —— Library 没有卡、
    // @ 菜单没有项,Otto 自己那条只读 Ready 的上下文也读不到它刚说保存过的产品。
    db.prisma.brandRecord.findFirst.mockResolvedValue({
      id: "r-draft", data: { name: "Kopi ais", price: "RM 3" }, contextStatus: "Draft",
    });
    db.confirmProductDraft.mockResolvedValue({ ok: true, id: "r-draft", entityId: "ent-draft-1" });
    const res = await upsertBrandRecordFromOtto(
      { kind: "product", fields: { name: "Kopi ais", price: "RM 4" } },
      { context: makeCtx() },
    );
    expect(res).toEqual({ ok: true, id: "r-draft", updated: true });
    expect(db.confirmProductDraft).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: "org-test", id: "r-draft", source: "otto",
      data: expect.objectContaining({ name: "Kopi ais", price: "RM 4" }),
    }));
    expect(db.prisma.brandRecord.update).not.toHaveBeenCalled();
  });

  it("PRODID-A7 撞上同名 Ready 产品:照旧 update,不重复建身份", async () => {
    db.prisma.brandRecord.findFirst.mockResolvedValue({
      id: "r-ready", data: { name: "Kopi ais", price: "RM 3" }, contextStatus: "Ready",
    });
    db.prisma.brandRecord.update.mockResolvedValue({});
    await upsertBrandRecordFromOtto(
      { kind: "product", fields: { name: "Kopi ais", price: "RM 4" } },
      { context: makeCtx() },
    );
    expect(db.confirmProductDraft).not.toHaveBeenCalled();
    expect(db.prisma.brandRecord.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "r-ready" } }));
  });

  it("merges fields into existing data on update (does not wipe unspecified fields)", async () => {
    db.prisma.brandRecord.findFirst.mockResolvedValue({
      id: "r-old", data: { name: "Young working moms", who: "25-38 urban", pains: "no time" },
    });
    db.prisma.brandRecord.update.mockResolvedValue({});
    const res = await upsertBrandRecordFromOtto(
      { kind: "segment", fields: { name: "Young working moms", channels: "IG Reels, XHS" } },
      { context: makeCtx() },
    );
    expect(res).toEqual({ ok: true, id: "r-old", updated: true });
    expect(db.prisma.brandRecord.update).toHaveBeenCalledWith({
      where: { id: "r-old" },
      data: expect.objectContaining({
        source: "otto",
        data: { name: "Young working moms", who: "25-38 urban", pains: "no time", channels: "IG Reels, XHS" },
      }),
    });
  });

  it("rejects when merged data fails the kind schema (create of segment without who)", async () => {
    db.prisma.brandRecord.findFirst.mockResolvedValue(null);
    await expect(
      upsertBrandRecordFromOtto({ kind: "segment", fields: { name: "Moms" } }, { context: makeCtx() }),
    ).rejects.toThrow(/who/i);
    expect(db.prisma.brandRecord.create).not.toHaveBeenCalled();
  });

  it("offer dates land in columns, not data", async () => {
    db.prisma.brandRecord.findFirst.mockResolvedValue(null);
    db.prisma.brandRecord.create.mockResolvedValue({});
    await upsertBrandRecordFromOtto(
      { kind: "offer", fields: { title: "Raya sale" }, startsAt: "2026-07-01", endsAt: "2026-07-15" },
      { context: makeCtx() },
    );
    const arg = db.prisma.brandRecord.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data.startsAt).toEqual(new Date("2026-07-01"));
    expect(arg.data.endsAt).toEqual(new Date("2026-07-15"));
    expect((arg.data.data as Record<string, unknown>).endsAt).toBeUndefined();
  });

  it("preserves UI-set imageAssetId when OTTO updates a product (merge keeps unknown-to-skill fields)", async () => {
    db.prisma.brandRecord.findFirst.mockResolvedValue({
      id: "r-img", data: { name: "Latte Blend", price: "RM 49", imageAssetId: "as_777" },
    });
    db.prisma.brandRecord.update.mockResolvedValue({});
    await upsertBrandRecordFromOtto(
      { kind: "product", fields: { name: "Latte Blend", price: "RM 55" } },
      { context: makeCtx() },
    );
    expect(db.prisma.brandRecord.update).toHaveBeenCalledWith({
      where: { id: "r-img" },
      data: expect.objectContaining({
        data: expect.objectContaining({ imageAssetId: "as_777", price: "RM 55" }),
      }),
    });
  });

  it("saveProduct threads category into data", async () => {
    db.prisma.brandRecord.findFirst.mockResolvedValue(null);
    db.createProduct.mockResolvedValue({ created: true, id: "rec-id-1", entityId: "ent-id-1" });
    await upsertBrandRecordFromOtto(
      { kind: "product", fields: { name: "Latte Blend", category: "Coffee" } },
      { context: makeCtx() },
    );
    const arg = db.createProduct.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data.category).toBe("Coffee");
  });
  it("OTTO update without category preserves the existing one (merge)", async () => {
    db.prisma.brandRecord.findFirst.mockResolvedValue({ id: "r1", data: { name: "Latte Blend", category: "Coffee" } });
    db.prisma.brandRecord.update.mockResolvedValue({});
    await upsertBrandRecordFromOtto(
      { kind: "product", fields: { name: "Latte Blend", price: "RM 55" } },
      { context: makeCtx() },
    );
    expect(db.prisma.brandRecord.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: expect.objectContaining({ data: expect.objectContaining({ category: "Coffee", price: "RM 55" }) }),
    });
  });
});

describe("skill classifications", () => {
  it.each([[saveProductSkill], [saveCustomerSegmentSkill], [saveOfferSkill]])(
    "%o is free/write/internal → no approval",
    (skill) => {
      expect(skill.cost).toBe("free");
      expect(skill.effect).toBe("write");
      expect(skill.reach).toBe("internal");
      expect(skill.needsApproval).toBe(false);
    },
  );
});
