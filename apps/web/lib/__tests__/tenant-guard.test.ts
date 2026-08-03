import { describe, it, expect } from "vitest";
const { prisma } = await import("@fikirtive/db");

describe("tenant-guard backstop (NODE_ENV=test → throws)", () => {
  it("throws on a tenant findMany with no ownerId filter", async () => {
    await expect(prisma.project.findMany({ where: { name: "x" } })).rejects.toThrow(/tenant-guard/);
  });
  it("allows a tenant findMany WITH an ownerId filter", async () => {
    await expect(prisma.project.findMany({ where: { ownerId: "founder" } })).resolves.toBeDefined();
  });
  it("requires ownerId for unique and aggregate reads too", async () => {
    await expect(prisma.genJob.findUnique({ where: { id: "missing" } })).rejects.toThrow(/tenant-guard/);
    await expect(prisma.genJob.aggregate({ _count: { _all: true } })).rejects.toThrow(/tenant-guard/);
    await expect(
      prisma.genJob.aggregate({ where: { ownerId: "founder" }, _count: { _all: true } }),
    ).resolves.toBeDefined();
  });
});
