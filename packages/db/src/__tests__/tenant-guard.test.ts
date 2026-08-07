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

/**
 * #698 — Prisma names a compound unique key by joining its field names with "_"
 * (`@@unique([ownerId, contentHash])` → `ownerId_contentHash`), so the tenant column
 * arrives NESTED inside that key object instead of at the top level of `where`.
 * A guard that only reads the top level called the merchant's own upload a cross-tenant
 * leak. Reading the nested tenant must not soften the boundary: a compound key naming a
 * FOREIGN tenant is still refused, and a key carrying no tenant at all is still refused.
 */
describe("tenant-guard — compound unique keys", () => {
  it("accepts an unframed compound unique key that names the tenant inside it", async () => {
    await expect(
      prisma.asset.findUnique({
        where: { ownerId_contentHash: { ownerId: "o1", contentHash: "h1" } },
      }),
    ).resolves.toBeNull();
  });

  it("accepts the id+owner compound key too (same nesting, different key)", async () => {
    await expect(
      prisma.asset.findUnique({ where: { id_ownerId: { id: "missing", ownerId: "o1" } } }),
    ).resolves.toBeNull();
  });

  it("still rejects a unique key that carries no tenant at all", async () => {
    await expect(prisma.asset.findUnique({ where: { id: "missing" } })).rejects.toThrow(
      /tenant-guard/,
    );
  });

  it("still rejects a compound key whose nested ownerId is empty", async () => {
    await expect(
      prisma.asset.findUnique({
        where: { ownerId_contentHash: { ownerId: "", contentHash: "h1" } },
      }),
    ).rejects.toThrow(/tenant-guard/);
  });

  it("rejects a compound key naming another tenant while a tenant frame is active", async () => {
    await expect(
      runAsTenant("o1", async () =>
        prisma.asset.findUnique({
          where: { ownerId_contentHash: { ownerId: "o2", contentHash: "h1" } },
        }),
      ),
    ).rejects.toThrow(/outside the active tenant/);
  });

  it("allows a compound key naming the active tenant", async () => {
    await expect(
      runAsTenant("o1", async () =>
        prisma.asset.findUnique({
          where: { ownerId_contentHash: { ownerId: "o1", contentHash: "h1" } },
        }),
      ),
    ).resolves.toBeNull();
  });
});
