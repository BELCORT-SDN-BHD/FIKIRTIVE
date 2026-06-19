import { describe, it, expect } from "vitest";
const { prisma } = await import("@artlio/db");

describe("tenant-guard backstop (NODE_ENV=test → throws)", () => {
  it("throws on a tenant findMany with no ownerId filter", async () => {
    await expect(prisma.project.findMany({ where: { name: "x" } })).rejects.toThrow(/tenant-guard/);
  });
  it("allows a tenant findMany WITH an ownerId filter", async () => {
    await expect(prisma.project.findMany({ where: { ownerId: "founder" } })).resolves.toBeDefined();
  });
  it("exempts findUnique / aggregate (admin + unique-key access)", async () => {
    await expect(prisma.genJob.aggregate({ _count: { _all: true } })).resolves.toBeDefined();
  });
});
