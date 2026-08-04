/**
 * Tenant-guard unit tests: verify that TENANT_MODELS membership is enforced.
 *
 * These tests run under vitest with NODE_ENV=test, which makes the guard throw
 * (strict mode) rather than warn. A real DB connection is required because the
 * guard is an extension applied to the live PrismaClient.
 */
import { describe, it, expect } from "vitest";
import { prisma } from "../index.js";
import { runAsSystem, runAsTenant } from "../principal.js";

describe("tenant-guard", () => {
  it("tenant guard flags Memory.findMany without ownerId", async () => {
    await expect(prisma.memory.findMany({ where: {} as never })).rejects.toThrow(/tenant-guard/);
  });

  it("tenant guard flags GenerationBatch.findMany without ownerId", async () => {
    await expect(prisma.generationBatch.findMany({ where: {} as never })).rejects.toThrow(/tenant-guard/);
  });

  it("tenant guard flags Memory.findFirstOrThrow without ownerId", async () => {
    await expect(prisma.memory.findFirstOrThrow({ where: {} as never })).rejects.toThrow(/tenant-guard/);
  });

  it("tenant guard allows Memory.findMany with ownerId", async () => {
    // Should not throw — the guard only checks for missing ownerId.
    // The query will fail for other reasons (DB not seeded), but not tenant-guard.
    await expect(prisma.memory.findMany({ where: { ownerId: "o1", deletedAt: null } })).resolves.toBeDefined();
  });

  it("injects the ambient tenant into a query that omits ownerId", async () => {
    await expect(
      runAsTenant("o1", async () =>
        prisma.memory.findMany({ where: { deletedAt: null } }),
      ),
    ).resolves.toBeDefined();
  });

  it("rejects a caller trying to override the ambient tenant", async () => {
    await expect(
      runAsTenant("o1", async () =>
        prisma.memory.findMany({ where: { ownerId: "o2", deletedAt: null } }),
      ),
    ).rejects.toThrow(/outside the active tenant/);
  });

  it("rejects an unframed unique read without an explicit ownerId", async () => {
    await expect(
      prisma.memory.findUnique({ where: { id: "missing" } }),
    ).rejects.toThrow(/tenant-guard/);
  });

  it("rejects an unframed OR query when ownerId appears in only one branch", async () => {
    await expect(
      prisma.memory.findMany({
        where: {
          OR: [
            { ownerId: "o1" },
            { deletedAt: null },
          ],
        },
      }),
    ).rejects.toThrow(/tenant-guard/);
  });

  it("rejects an undefined top-level ownerId", async () => {
    await expect(
      prisma.memory.findMany({ where: { ownerId: undefined } }),
    ).rejects.toThrow(/tenant-guard/);
  });

  it("requires a tenant frame before a system write", async () => {
    await expect(
      runAsSystem("test-seed", async () =>
        prisma.memory.deleteMany({ where: { ownerId: "o1" } }),
      ),
    ).rejects.toThrow(/requires runAsTenant/);
  });
});
