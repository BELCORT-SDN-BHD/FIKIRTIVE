import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRequireOwner, mockFindMany, mockFindFirst, mockCreate, mockUpdateMany } = vi.hoisted(() => ({
  mockRequireOwner: vi.fn(),
  mockFindMany: vi.fn(),
  mockFindFirst: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdateMany: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    brandRecord: { findMany: mockFindMany, findFirst: mockFindFirst, create: mockCreate, updateMany: mockUpdateMany },
    // FRONT-A8:写路径现在还会读 User(「谁改的」)与写 BrandContextRevision(改动史)。
    brandContextRevision: { create: vi.fn().mockResolvedValue({}) },
    memory: { findFirst: vi.fn().mockResolvedValue(null) },
    user: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { listMyBrandRecords, saveBrandRecord, deleteBrandRecord, restoreBrandRecord } from "../brand-record-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOwner.mockResolvedValue({ ownerId: "o1", email: "merchant@fikirtive.test" });
});

describe("saveBrandRecord — create", () => {
  it("creates an owner-scoped product with nameKey and source user", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({});
    const res = await saveBrandRecord({ kind: "product", data: { name: "Latte  Blend", price: "RM 49" } });
    expect(res).toHaveProperty("ok", true);
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerId: "o1", kind: "product", nameKey: "latte blend", source: "user", status: "active",
        data: { name: "Latte  Blend", price: "RM 49" },
      }),
    });
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
  it("updates data/nameKey owner-scoped and flips source to user", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    const res = await saveBrandRecord({ id: "r1", kind: "product", data: { name: "Latte Blend", price: "RM 55" } });
    expect(res).toEqual({ ok: true, id: "r1" });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "r1", ownerId: "o1", deletedAt: null },
      data: expect.objectContaining({ nameKey: "latte blend", source: "user" }),
    });
  });
  it("errors when not found", async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });
    expect(await saveBrandRecord({ id: "nope", kind: "product", data: { name: "X" } })).toHaveProperty("error");
  });
});

describe("delete / restore", () => {
  it("soft-deletes owner-scoped", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    expect(await deleteBrandRecord({ id: "r1" })).toEqual({ ok: true });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "r1", ownerId: "o1" },
      // FRONT-A8:删除/恢复也是一次「谁动的」,所以同一笔写盖上作者。
      data: { deletedAt: expect.any(Date), updatedById: null },
    });
  });
  it("soft-delete is safe to repeat after an uncertain response", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    expect(await deleteBrandRecord({ id: "r1" })).toEqual({ ok: true });
    expect(await deleteBrandRecord({ id: "r1" })).toEqual({ ok: true });
    expect(mockUpdateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "r1", ownerId: "o1" },
      // FRONT-A8:删除/恢复也是一次「谁动的」,所以同一笔写盖上作者。
      data: { deletedAt: expect.any(Date), updatedById: null },
    });
  });
  it("restore clears deletedAt", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    expect(await restoreBrandRecord({ id: "r1" })).toEqual({ ok: true });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "r1", ownerId: "o1" },
      data: { deletedAt: null, updatedById: null },
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
