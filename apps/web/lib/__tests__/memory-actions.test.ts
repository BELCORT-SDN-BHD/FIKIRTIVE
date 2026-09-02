import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRequireOwner, mockMemoryCreate, mockMemoryFindMany, mockMemoryUpdateMany, mockKitFindFirst, mockRuleFindMany, mockRecordFindMany } = vi.hoisted(() => ({
  mockRequireOwner: vi.fn(),
  mockMemoryCreate: vi.fn(),
  mockMemoryFindMany: vi.fn(),
  mockMemoryUpdateMany: vi.fn(),
  mockKitFindFirst: vi.fn(),
  mockRuleFindMany: vi.fn(),
  mockRecordFindMany: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    memory: { create: mockMemoryCreate, findMany: mockMemoryFindMany, updateMany: mockMemoryUpdateMany },
    brandKit: { findFirst: mockKitFindFirst },
    brandRule: { findMany: mockRuleFindMany },
    brandRecord: { findMany: mockRecordFindMany },
  },
}));
vi.mock("@fikirtive/core", async () => ({
  ...(await vi.importActual<typeof import("@fikirtive/core")>("@fikirtive/core")),
  newId: () => "m_1",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { addMemory, updateMemory, deleteMemory, restoreMemory, getBrandContextText, listMemory, listMyMemory } from "../memory-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOwner.mockResolvedValue({ ownerId: "o1" });
  // Default: no kit, no rules, no records (so existing tests are unaffected)
  mockKitFindFirst.mockResolvedValue(null);
  mockRuleFindMany.mockResolvedValue([]);
  mockRecordFindMany.mockResolvedValue([]);
});

describe("addMemory", () => {
  it("persists owner-scoped with source 'user'", async () => {
    mockMemoryCreate.mockResolvedValue({ id: "m_1" });
    const res = await addMemory({ category: "voice", content: "warm, family tone" });
    expect(res).toEqual({ ok: true, id: "m_1" });
    expect(mockMemoryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ ownerId: "o1", category: "voice", content: "warm, family tone", source: "user" }),
    });
  });

  it("returns error when category is missing", async () => {
    const res = await addMemory({ content: "something" });
    expect(res).toEqual({ error: expect.any(String) });
    expect(mockMemoryCreate).not.toHaveBeenCalled();
  });

  it("returns error when content is missing", async () => {
    const res = await addMemory({ category: "voice" });
    expect(res).toEqual({ error: expect.any(String) });
    expect(mockMemoryCreate).not.toHaveBeenCalled();
  });

  it("returns gate error when requireOwner fails", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authenticated." });
    const res = await addMemory({ category: "voice", content: "test" });
    expect(res).toEqual({ error: "Not authenticated." });
    expect(mockMemoryCreate).not.toHaveBeenCalled();
  });

  it("returns error on db failure", async () => {
    mockMemoryCreate.mockRejectedValue(new Error("db down"));
    const res = await addMemory({ category: "voice", content: "test" });
    expect(res).toEqual({ error: expect.any(String) });
  });
});

describe("updateMemory", () => {
  it("updates owner-scoped memory by id", async () => {
    mockMemoryUpdateMany.mockResolvedValue({ count: 1 });
    const res = await updateMemory({ id: "m_1", content: "new text" });
    expect(res).toEqual({ ok: true });
    expect(mockMemoryUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "m_1", ownerId: "o1" }),
      data: expect.objectContaining({ content: "new text" }),
    });
  });

  it("returns error when memory not found (count 0)", async () => {
    mockMemoryUpdateMany.mockResolvedValue({ count: 0 });
    const res = await updateMemory({ id: "m_1", content: "new text" });
    expect(res).toEqual({ error: expect.any(String) });
  });

  it("returns error for invalid input", async () => {
    const res = await updateMemory({ id: 123, content: "text" });
    expect(res).toEqual({ error: expect.any(String) });
    expect(mockMemoryUpdateMany).not.toHaveBeenCalled();
  });
});

describe("deleteMemory", () => {
  it("soft-deletes owner-scoped memory", async () => {
    mockMemoryUpdateMany.mockResolvedValue({ count: 1 });
    const res = await deleteMemory({ id: "m_1" });
    expect(res).toEqual({ ok: true });
    expect(mockMemoryUpdateMany).toHaveBeenCalledWith({
      where: { id: "m_1", ownerId: "o1" },
      data: expect.objectContaining({ deletedAt: expect.any(Date) }),
    });
  });

  it("is retry-safe because an already-deleted row still matches", async () => {
    mockMemoryUpdateMany.mockResolvedValue({ count: 1 });
    expect(await deleteMemory({ id: "m_1" })).toEqual({ ok: true });
    expect(mockMemoryUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "m_1", ownerId: "o1" },
    }));
  });

  it("returns error when memory not found (count 0)", async () => {
    mockMemoryUpdateMany.mockResolvedValue({ count: 0 });
    const res = await deleteMemory({ id: "m_1" });
    expect(res).toEqual({ error: expect.any(String) });
  });

  it("returns error for invalid id", async () => {
    const res = await deleteMemory({});
    expect(res).toEqual({ error: expect.any(String) });
    expect(mockMemoryUpdateMany).not.toHaveBeenCalled();
  });
});

describe("restoreMemory", () => {
  it("restores the original owner-scoped row and is safe to repeat", async () => {
    mockMemoryUpdateMany.mockResolvedValue({ count: 1 });
    expect(await restoreMemory({ id: "m_1" })).toEqual({ ok: true });
    expect(await restoreMemory({ id: "m_1" })).toEqual({ ok: true });
    expect(mockMemoryUpdateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "m_1", ownerId: "o1" },
      data: { deletedAt: null },
    });
  });

  it("returns a refusal when the row does not belong to this owner", async () => {
    mockMemoryUpdateMany.mockResolvedValue({ count: 0 });
    expect(await restoreMemory({ id: "missing" })).toEqual({ error: "Memory not found." });
  });
});

describe("getBrandContextText", () => {
  it("returns empty string when no memory", async () => {
    mockMemoryFindMany.mockResolvedValue([]);
    expect(await getBrandContextText("o1", null)).toBe("");
  });

  it("compiles grouped notes", async () => {
    mockMemoryFindMany.mockResolvedValue([{ category: "voice", content: "warm" }]);
    const result = await getBrandContextText("o1", null);
    expect(result).toContain("warm");
    // v2: legacy "voice" category is mapped to the "about" taxonomy section,
    // so the section label is "About the brand", not the raw category name.
    expect(result).toContain("About the brand");
  });

  it("groups multiple entries under the same category", async () => {
    mockMemoryFindMany.mockResolvedValue([
      { category: "voice", content: "warm" },
      { category: "voice", content: "friendly" },
      { category: "colors", content: "blue" },
    ]);
    const result = await getBrandContextText("o1", null);
    expect(result).toContain("warm");
    expect(result).toContain("friendly");
    expect(result).toContain("blue");
  });

  it("passes brandId through to the query", async () => {
    mockMemoryFindMany.mockResolvedValue([]);
    await getBrandContextText(undefined, "brand_1");
    expect(mockMemoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ brandId: "brand_1" }) })
    );
  });
});

// SECURITY (fix #1): listMemory / getBrandContextText are exported from a "use server"
// module → client-invocable. They MUST resolve the owner from the session and IGNORE any
// caller-supplied id. These tests are non-vacuous: the session owner differs from the id
// passed in, so a regression to `_ownerId ?? gate.ownerId` would FAIL here.
describe("tenant isolation — caller-supplied ownerId is ignored", () => {
  it("getBrandContextText queries the SESSION owner, never the forged arg", async () => {
    mockRequireOwner.mockResolvedValue({ ownerId: "session-org" });
    mockMemoryFindMany.mockResolvedValue([]);
    await getBrandContextText("attacker-org", "brand_1");
    expect(mockMemoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ ownerId: "session-org", brandId: "brand_1" }) })
    );
    expect(mockMemoryFindMany.mock.calls[0]![0].where.ownerId).not.toBe("attacker-org");
  });

  it("listMemory queries the SESSION owner, never the forged arg", async () => {
    mockRequireOwner.mockResolvedValue({ ownerId: "session-org" });
    mockMemoryFindMany.mockResolvedValue([]);
    await listMemory("attacker-org");
    expect(mockMemoryFindMany.mock.calls[0]![0].where.ownerId).toBe("session-org");
  });

  it("listMyMemory resolves the owner from the session and returns its rows", async () => {
    mockRequireOwner.mockResolvedValue({ ownerId: "session-org" });
    mockMemoryFindMany.mockResolvedValue([{ id: "m1", category: "voice", content: "warm", source: "user", pinned: true, updatedAt: new Date() }]);
    const rows = await listMyMemory();
    expect(rows).toHaveLength(1);
    expect(mockMemoryFindMany.mock.calls[0]![0].where.ownerId).toBe("session-org");
  });

  it("fail closed: unauthenticated → empty result, no query", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authenticated." });
    expect(await listMemory("anything")).toEqual([]);
    expect(await getBrandContextText("anything")).toBe("");
    expect(await listMyMemory()).toEqual([]);
    expect(mockMemoryFindMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getBrandContextText — brand kit + rule enrichment
// ---------------------------------------------------------------------------

describe("getBrandContextText — kit + rule enrichment", () => {
  it("returns empty string when no memory, no kit, no rules", async () => {
    mockMemoryFindMany.mockResolvedValue([]);
    // mockKitFindFirst and mockRuleFindMany already return null/[] in beforeEach
    expect(await getBrandContextText()).toBe("");
  });

  it("includes kit name, fonts, tone, styleGuide, colorsJson in output", async () => {
    mockMemoryFindMany.mockResolvedValue([]);
    mockKitFindFirst.mockResolvedValue({
      name: "Acme Brand",
      colorsJson: { primary: "#ff0000" },
      fonts: ["Inter", "Playfair Display"],
      tone: "warm and friendly",
      styleGuide: "Always use full sentences.",
    });
    const result = await getBrandContextText();
    expect(result).toContain("Brand kit:");
    expect(result).toContain("Acme Brand");
    expect(result).toContain("Inter");
    expect(result).toContain("warm and friendly");
    expect(result).toContain("Always use full sentences.");
    expect(result).toContain("#ff0000");
  });

  it("includes active brand rules grouped by kind", async () => {
    mockMemoryFindMany.mockResolvedValue([]);
    mockRuleFindMany.mockResolvedValue([
      { kind: "always", text: "use bold headings" },
      { kind: "never", text: "use Comic Sans" },
      { kind: "always", text: "include a call to action" },
    ]);
    const result = await getBrandContextText();
    expect(result).toContain("Brand rules:");
    expect(result).toContain("ALWAYS:");
    expect(result).toContain("use bold headings");
    expect(result).toContain("include a call to action");
    expect(result).toContain("NEVER:");
    expect(result).toContain("use Comic Sans");
  });

  it("omits kit block when kit is null", async () => {
    mockMemoryFindMany.mockResolvedValue([{ category: "voice", content: "warm" }]);
    mockKitFindFirst.mockResolvedValue(null);
    const result = await getBrandContextText();
    expect(result).not.toContain("Brand kit:");
    expect(result).toContain("warm");
  });

  it("omits rules block when no active rules returned", async () => {
    mockMemoryFindMany.mockResolvedValue([{ category: "voice", content: "warm" }]);
    mockRuleFindMany.mockResolvedValue([]);
    const result = await getBrandContextText();
    expect(result).not.toContain("Brand rules:");
    expect(result).toContain("warm");
  });

  it("queries active rules only (where.active = true passed to brandRule.findMany)", async () => {
    mockMemoryFindMany.mockResolvedValue([]);
    mockRuleFindMany.mockResolvedValue([]);
    await getBrandContextText(undefined, "brand_1");
    expect(mockRuleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ ownerId: "o1", brandId: "brand_1", active: true }) }),
    );
  });

  it("includes both memory notes and kit + rules when all are present", async () => {
    mockMemoryFindMany.mockResolvedValue([{ category: "voice", content: "playful" }]);
    mockKitFindFirst.mockResolvedValue({ name: "Acme", colorsJson: null, fonts: [], tone: "fun", styleGuide: null });
    mockRuleFindMany.mockResolvedValue([{ kind: "never", text: "avoid jargon" }]);
    const result = await getBrandContextText();
    expect(result).toContain("playful");
    expect(result).toContain("Brand kit:");
    expect(result).toContain("Brand rules:");
    expect(result).toContain("avoid jargon");
  });
});

describe("getBrandContextText v2 — sections + records", () => {
  it("rules come first and survive when other sections are huge", async () => {
    mockMemoryFindMany.mockResolvedValue(
      Array.from({ length: 80 }, (_, i) => ({ category: "Brand", content: `note ${i} ${"x".repeat(50)}` })),
    );
    mockRuleFindMany.mockResolvedValue([{ kind: "never", text: "no competitor names" }]);
    const text = await getBrandContextText();
    expect(text.startsWith("Brand rules:")).toBe(true);
    expect(text).toContain("no competitor names");
  });

  it("injects active segments and offers, excludes expired offers", async () => {
    mockMemoryFindMany.mockResolvedValue([]);
    mockRecordFindMany.mockResolvedValue([
      { kind: "segment", data: { name: "Young working moms", who: "25-38 urban" }, status: "active", startsAt: null, endsAt: null, pinned: false },
      { kind: "offer", data: { title: "Raya sale", code: "RAYA20" }, status: "active", startsAt: null, endsAt: new Date("2099-01-01"), pinned: false },
      { kind: "offer", data: { title: "Dead promo" }, status: "active", startsAt: null, endsAt: new Date("2020-01-01"), pinned: false },
    ]);
    const text = await getBrandContextText();
    expect(text).toContain("Young working moms");
    expect(text).toContain("Raya sale");
    expect(text).not.toContain("Dead promo");
  });

  it("products: summary + top list, archived excluded, lookup hint when >10", async () => {
    mockMemoryFindMany.mockResolvedValue([]);
    const product = (name: string, pinned = false, status = "active") =>
      ({ kind: "product", data: { name, price: "RM 9" }, status, startsAt: null, endsAt: null, pinned });
    mockRecordFindMany.mockResolvedValue([
      product("Pinned One", true), ...Array.from({ length: 12 }, (_, i) => product(`P${i}`)),
      product("Gone", false, "archived"),
    ]);
    const text = await getBrandContextText();
    expect(text).toMatch(/Your products: 13 total \(1 pinned\)/);
    expect(text).toContain("Pinned One");
    expect(text).not.toContain("Gone");
    expect(text).toContain("lookupProducts");
  });

  it("legacy Audience facts appear under Your customers", async () => {
    mockMemoryFindMany.mockResolvedValue([{ category: "Audience", content: "mostly KL urbanites" }]);
    const text = await getBrandContextText();
    expect(text).toContain("Your customers");
    expect(text).toContain("mostly KL urbanites");
  });

  it("products injection includes [category] per line and a Categories summary", async () => {
    mockMemoryFindMany.mockResolvedValue([]);
    mockRecordFindMany.mockResolvedValue([
      { kind: "product", data: { name: "Latte Blend", category: "Coffee" }, status: "active", startsAt: null, endsAt: null, pinned: false },
      { kind: "product", data: { name: "Tote Bag", category: "Merch" }, status: "active", startsAt: null, endsAt: null, pinned: false },
      { kind: "product", data: { name: "Mystery" }, status: "active", startsAt: null, endsAt: null, pinned: false },
    ]);
    const text = await getBrandContextText();
    expect(text).toContain("[Coffee]");
    expect(text).toMatch(/Categories: Coffee, Merch/);
  });
});
