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
