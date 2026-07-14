/**
 * Tenant-guard unit tests: verify that TENANT_MODELS membership is enforced.
 *
 * These tests run under vitest with NODE_ENV=test, which makes the guard throw
 * (strict mode) rather than warn. A real DB connection is required because the
 * guard is an extension applied to the live PrismaClient.
 */
import { describe, it, expect } from "vitest";
import { prisma } from "../index.js";

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
});
