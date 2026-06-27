import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockRequireOwner,
  mockAssetFindFirst,
  mockKitFindFirst,
  mockKitCreate,
  mockKitUpdate,
  mockRuleFindMany,
  mockRuleCreate,
  mockRuleUpdateMany,
  mockRuleDeleteMany,
} = vi.hoisted(() => ({
  mockRequireOwner: vi.fn(),
  mockAssetFindFirst: vi.fn(),
  mockKitFindFirst: vi.fn(),
  mockKitCreate: vi.fn(),
  mockKitUpdate: vi.fn(),
  mockRuleFindMany: vi.fn(),
  mockRuleCreate: vi.fn(),
  mockRuleUpdateMany: vi.fn(),
  mockRuleDeleteMany: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    asset: {
      findFirst: mockAssetFindFirst,
    },
    brandKit: {
      findFirst: mockKitFindFirst,
      create: mockKitCreate,
      update: mockKitUpdate,
    },
    brandRule: {
      findMany: mockRuleFindMany,
      create: mockRuleCreate,
      updateMany: mockRuleUpdateMany,
      deleteMany: mockRuleDeleteMany,
    },
  },
}));
vi.mock("@fikirtive/core", () => ({ newId: () => "new-id-1" }));

import {
  getBrandKit,
  saveBrandKit,
  listBrandRules,
  addBrandRule,
  setBrandRuleActive,
  deleteBrandRule,
} from "../brand-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOwner.mockResolvedValue({ ownerId: "o1", email: "a@b.c" });
});

// ---------------------------------------------------------------------------
// getBrandKit
// ---------------------------------------------------------------------------

describe("getBrandKit", () => {
  it("queries using session ownerId (never caller-supplied)", async () => {
    mockKitFindFirst.mockResolvedValue(null);
    await getBrandKit("brand_1");
    expect(mockKitFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: "o1", brandId: "brand_1" } }),
    );
  });

  it("returns null when no kit exists", async () => {
    mockKitFindFirst.mockResolvedValue(null);
    expect(await getBrandKit()).toBeNull();
  });

  it("returns the kit when present", async () => {
    const kit = { id: "k1", brandId: null, name: "Acme", colorsJson: {}, fonts: [], tone: null, styleGuide: null, logoAssetId: null, updatedAt: new Date() };
    mockKitFindFirst.mockResolvedValue(kit);
    expect(await getBrandKit()).toEqual(kit);
  });

  it("returns error when unauthenticated", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authorized." });
    expect(await getBrandKit()).toEqual({ error: "Not authorized." });
    expect(mockKitFindFirst).not.toHaveBeenCalled();
  });

  it("scopes to null brandId by default", async () => {
    mockKitFindFirst.mockResolvedValue(null);
    await getBrandKit();
    expect(mockKitFindFirst.mock.calls[0]![0].where.brandId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// saveBrandKit — upsert path
// ---------------------------------------------------------------------------

describe("saveBrandKit", () => {
  it("creates a new kit when none exists (ownerId in create data)", async () => {
    mockKitFindFirst.mockResolvedValue(null);
    mockKitCreate.mockResolvedValue({ id: "new-id-1" });
    const result = await saveBrandKit({ name: "Acme", fonts: ["Inter"] });
    expect(result).toEqual({ id: "new-id-1" });
    expect(mockKitCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ownerId: "o1", name: "Acme", fonts: ["Inter"] }),
      }),
    );
  });

  it("updates existing kit using the existing id (no ownerId forgery)", async () => {
    mockKitFindFirst.mockResolvedValue({ id: "k-existing" });
    mockKitUpdate.mockResolvedValue({ id: "k-existing" });
    const result = await saveBrandKit({ name: "New Name" });
    expect(result).toEqual({ id: "k-existing" });
    expect(mockKitUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "k-existing" }, data: expect.objectContaining({ name: "New Name" }) }),
    );
    // create must NOT be called when updating
    expect(mockKitCreate).not.toHaveBeenCalled();
  });

  it("returns error when unauthenticated", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authorized." });
    expect(await saveBrandKit({ name: "x" })).toEqual({ error: "Not authorized." });
    expect(mockKitCreate).not.toHaveBeenCalled();
  });

  it("returns error on db failure", async () => {
    mockKitFindFirst.mockRejectedValue(new Error("db down"));
    expect(await saveBrandKit({ name: "x" })).toEqual({ error: expect.any(String) });
  });

  it("nulls logoAssetId when the asset is not owned by the caller", async () => {
    mockAssetFindFirst.mockResolvedValue(null); // not owned
    mockKitFindFirst.mockResolvedValue(null);   // no existing kit
    mockKitCreate.mockResolvedValue({ id: "k1" });
    await saveBrandKit({ logoAssetId: "asset-foreign" });
    expect(mockKitCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ logoAssetId: null }) }),
    );
  });

  it("keeps logoAssetId when the asset is owned", async () => {
    mockAssetFindFirst.mockResolvedValue({ id: "asset-mine" });
    mockKitFindFirst.mockResolvedValue(null);
    mockKitCreate.mockResolvedValue({ id: "k1" });
    await saveBrandKit({ logoAssetId: "asset-mine" });
    expect(mockKitCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ logoAssetId: "asset-mine" }) }),
    );
  });
});

// ---------------------------------------------------------------------------
// listBrandRules
// ---------------------------------------------------------------------------

describe("listBrandRules", () => {
  it("queries using session ownerId", async () => {
    mockRuleFindMany.mockResolvedValue([]);
    await listBrandRules("brand_1");
    expect(mockRuleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: "o1", brandId: "brand_1" } }),
    );
  });

  it("returns all rules for the owner/brand", async () => {
    const rule = { id: "r1", brandId: null, kind: "always", text: "use bold", active: true, createdAt: new Date() };
    mockRuleFindMany.mockResolvedValue([rule]);
    const result = await listBrandRules();
    expect(result).toEqual([rule]);
  });

  it("returns error when unauthenticated", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authorized." });
    expect(await listBrandRules()).toEqual({ error: "Not authorized." });
    expect(mockRuleFindMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// addBrandRule
// ---------------------------------------------------------------------------

describe("addBrandRule", () => {
  it("creates rule scoped to session ownerId", async () => {
    mockRuleCreate.mockResolvedValue({ id: "new-id-1" });
    const result = await addBrandRule({ kind: "always", text: "use bold headings" });
    expect(result).toEqual({ id: "new-id-1" });
    expect(mockRuleCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ownerId: "o1", kind: "always", text: "use bold headings", active: true }),
      }),
    );
  });

  it("rejects invalid kind", async () => {
    const result = await addBrandRule({ kind: "bad", text: "something" });
    expect(result).toEqual({ error: expect.any(String) });
    expect(mockRuleCreate).not.toHaveBeenCalled();
  });

  it("rejects empty text", async () => {
    const result = await addBrandRule({ kind: "always", text: "   " });
    expect(result).toEqual({ error: expect.any(String) });
    expect(mockRuleCreate).not.toHaveBeenCalled();
  });

  it("returns error when unauthenticated", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authorized." });
    expect(await addBrandRule({ kind: "always", text: "x" })).toEqual({ error: "Not authorized." });
    expect(mockRuleCreate).not.toHaveBeenCalled();
  });

  it("accepts all valid kinds", async () => {
    mockRuleCreate.mockResolvedValue({ id: "new-id-1" });
    for (const kind of ["always", "never", "tone", "color"]) {
      const result = await addBrandRule({ kind, text: "rule text" });
      expect(result).toEqual({ id: "new-id-1" });
    }
  });
});

// ---------------------------------------------------------------------------
// setBrandRuleActive
// ---------------------------------------------------------------------------

describe("setBrandRuleActive", () => {
  it("updates only the owner's rule (ownerId in where)", async () => {
    mockRuleUpdateMany.mockResolvedValue({ count: 1 });
    const result = await setBrandRuleActive("r1", false);
    expect(result).toEqual({ ok: true });
    expect(mockRuleUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "r1", ownerId: "o1" }, data: { active: false } }),
    );
  });

  it("returns error when rule not found (count 0 — non-owner rejected)", async () => {
    mockRuleUpdateMany.mockResolvedValue({ count: 0 });
    expect(await setBrandRuleActive("r-other", true)).toEqual({ error: expect.any(String) });
  });

  it("returns error when unauthenticated", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authorized." });
    expect(await setBrandRuleActive("r1", true)).toEqual({ error: "Not authorized." });
    expect(mockRuleUpdateMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// deleteBrandRule
// ---------------------------------------------------------------------------

describe("deleteBrandRule", () => {
  it("deletes only the owner's rule (ownerId in where)", async () => {
    mockRuleDeleteMany.mockResolvedValue({ count: 1 });
    const result = await deleteBrandRule("r1");
    expect(result).toEqual({ ok: true });
    expect(mockRuleDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "r1", ownerId: "o1" } }),
    );
  });

  it("returns error when rule not found (count 0 — non-owner rejected)", async () => {
    mockRuleDeleteMany.mockResolvedValue({ count: 0 });
    expect(await deleteBrandRule("r-other")).toEqual({ error: expect.any(String) });
  });

  it("returns error when unauthenticated", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authorized." });
    expect(await deleteBrandRule("r1")).toEqual({ error: "Not authorized." });
    expect(mockRuleDeleteMany).not.toHaveBeenCalled();
  });
});
