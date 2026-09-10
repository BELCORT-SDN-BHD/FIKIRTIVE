import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeLookupProducts, lookupProductsSkill } from "./lookup-products.js";
import type { OttoContext } from "../context.js";

vi.mock("@fikirtive/db", () => ({
  prisma: { brandRecord: { findMany: vi.fn() } },
}));

const ctx = { context: { orgId: "org-1" } as unknown as OttoContext };
const row = (name: string, extra: Record<string, unknown> = {}) => ({
  data: { name, ...extra }, status: "active", pinned: false, updatedAt: new Date(),
});

let db: { prisma: { brandRecord: { findMany: ReturnType<typeof vi.fn> } } };
beforeEach(async () => {
  vi.clearAllMocks();
  db = (await import("@fikirtive/db")) as unknown as typeof db;
});

describe("executeLookupProducts", () => {
  it("is free/read/internal, no approval", () => {
    expect(lookupProductsSkill.cost).toBe("free");
    expect(lookupProductsSkill.effect).toBe("read");
    expect(lookupProductsSkill.needsApproval).toBe(false);
  });
  it("matches name/description/tags case-insensitively, caps at 5", async () => {
    db.prisma.brandRecord.findMany.mockResolvedValue([
      row("Latte Blend"), row("Espresso Kit", { description: "strong latte-style shots" }),
      row("Tea Sampler", { tags: ["latte-alternative"] }), row("Mug"),
      row("Latte 2"), row("Latte 3"), row("Latte 4"), row("Latte 5"),
    ]);
    const res = await executeLookupProducts({ query: "LATTE" }, ctx);
    expect(res.matches.length).toBe(5);
    expect(res.matches.map((m) => m.name)).not.toContain("Mug");
    expect(db.prisma.brandRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerId: "org-1", kind: "product", deletedAt: null, status: "active" }),
    }));
  });
  it("PRODID-A7 lookupProducts 只取 Ready:确认前的草稿不进 Otto 的事实", async () => {
    // 规格 §1.9 第三句「Otto 在确认前不把草稿当事实」。判官第 2 轮 P1(PR #1337):这条读路
    // 读的是 BrandRecord(不是 Entity),所以「草稿没有身份」这条数据保证在这里不成立 ——
    // 必须显式过滤,否则理解 worker 猜出来的产品会被 Otto 拿去命名、定价、写文案。
    db.prisma.brandRecord.findMany.mockResolvedValue([row("Latte Blend")]);
    await executeLookupProducts({ query: "latte" }, ctx);
    expect(db.prisma.brandRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contextStatus: "Ready" }),
    }));
  });
  it("returns empty matches for no hit", async () => {
    db.prisma.brandRecord.findMany.mockResolvedValue([row("Mug")]);
    expect((await executeLookupProducts({ query: "latte" }, ctx)).matches).toEqual([]);
  });
  it("matches by category (type-to-create categories)", async () => {
    db.prisma.brandRecord.findMany.mockResolvedValue([
      row("Latte Blend", { category: "Coffee" }),
      row("Tote Bag", { category: "Merch" }),
    ]);
    const res = await executeLookupProducts({ query: "coffee" }, ctx);
    expect(res.matches.map((m) => m.name)).toEqual(["Latte Blend"]);
  });
});
