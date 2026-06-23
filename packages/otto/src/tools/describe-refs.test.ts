import { describe, it, expect, vi, beforeEach } from "vitest";
import { sanitizeRefDescription } from "./describe-refs.helpers.js";
import { executeDescribeRefs } from "./describe-refs.js";
import type { OttoContext } from "../context.js";

// ---------------------------------------------------------------------------
// Mock @fikirtive/db
// ---------------------------------------------------------------------------
vi.mock("@fikirtive/db", () => ({
  prisma: {
    entity: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    genJob: {
      create: vi.fn(),
    },
  },
  Prisma: {
    DbNull: "DbNull" as unknown, // sentinel value used in see-once predicate
  },
}));

// ---------------------------------------------------------------------------
// Shared test context factory
// ---------------------------------------------------------------------------
function makeCtx(overrides?: Partial<OttoContext>): OttoContext {
  return {
    orgId: "org-test",
    userId: "user-test",
    projectId: "proj-test",
    threadId: "thread-test",
    disabledModels: [],
    sourceGenerationId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Pure helper: sanitizeRefDescription
// ---------------------------------------------------------------------------

describe("sanitizeRefDescription — pure helper", () => {
  it("trims leading and trailing whitespace", () => {
    expect(sanitizeRefDescription("  hello  ")).toBe("hello");
  });

  it("strips control characters (\\x00, \\n, \\t, \\x1b)", () => {
    const result = sanitizeRefDescription("a\x00b\x1bc\nd\te");
    // control chars become spaces, then collapsed
    expect(result).not.toMatch(/[\x00-\x1f]/u);
  });

  it("collapses multiple whitespace into single spaces", () => {
    expect(sanitizeRefDescription("hello   world\t\tnow")).toBe("hello world now");
  });

  it("slices to 600 chars max", () => {
    const long = "a".repeat(700);
    const result = sanitizeRefDescription(long);
    expect(result.length).toBe(600);
  });

  it("returns empty string for all-control input", () => {
    expect(sanitizeRefDescription("\x00\x01\x02")).toBe("");
  });

  it("preserves normal text unchanged", () => {
    expect(sanitizeRefDescription("A cat with blue eyes")).toBe("A cat with blue eyes");
  });
});

// ---------------------------------------------------------------------------
// executeDescribeRefs — mock DB
// ---------------------------------------------------------------------------

describe("executeDescribeRefs — mock DB", () => {
  let mockPrisma: {
    entity: {
      findMany: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    genJob: { create: ReturnType<typeof vi.fn> };
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import("@fikirtive/db");
    mockPrisma = db.prisma as unknown as typeof mockPrisma;
    (mockPrisma.entity.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
  });

  it("resolves entity by name (strips leading @) and calls updateMany with see-once predicate", async () => {
    const ctx = makeCtx({ orgId: "org-A" });
    // Single entity found — should write
    (mockPrisma.entity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "ent-1" }]);

    const result = await executeDescribeRefs(
      { descriptions: [{ name: "@mascot", description: "A fluffy orange cat" }] },
      { context: ctx },
    );

    // findMany called with cleanName (no @) and owner scope
    expect(mockPrisma.entity.findMany).toHaveBeenCalledTimes(1);
    const findCall = (mockPrisma.entity.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      where: Record<string, unknown>;
    };
    expect(findCall.where["name"]).toBe("mascot");
    expect(findCall.where["ownerId"]).toBe("org-A");
    expect(findCall.where["deletedAt"]).toEqual(null);

    // updateMany called with see-once predicate
    expect(mockPrisma.entity.updateMany).toHaveBeenCalledTimes(1);
    const updateCall = (mockPrisma.entity.updateMany as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(updateCall.where["id"]).toBe("ent-1");
    expect(updateCall.where["ownerId"]).toBe("org-A");
    // see-once: descriptionJson must equal Prisma.DbNull (never overwrite)
    const descPredicate = updateCall.where["descriptionJson"] as Record<string, unknown>;
    expect(descPredicate["equals"]).toBe("DbNull"); // sentinel from mock
    // data must contain sanitized description
    const dataDescJson = updateCall.data["descriptionJson"] as Record<string, unknown>;
    expect(dataDescJson["text"]).toBe("A fluffy orange cat");

    // cached count = 1
    expect(result.cached).toBe(1);
  });

  it("see-once: entity found but description already exists (updateMany count:0) → cached stays 0", async () => {
    const ctx = makeCtx();
    (mockPrisma.entity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "ent-1" }]);
    // The see-once predicate suppresses the write because descriptionJson is already set →
    // updateMany affects 0 rows. `cached` must reflect ACTUAL writes, not names attempted.
    (mockPrisma.entity.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

    const result = await executeDescribeRefs(
      { descriptions: [{ name: "@mascot", description: "A new description" }] },
      { context: ctx },
    );

    // updateMany WAS attempted (the DB predicate is the real guard) but wrote nothing
    expect(mockPrisma.entity.updateMany).toHaveBeenCalledTimes(1);
    expect(result.cached).toBe(0);
  });

  it("skips names resolving to 0 entities — no updateMany called for that name", async () => {
    const ctx = makeCtx();
    (mockPrisma.entity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]); // 0 found

    const result = await executeDescribeRefs(
      { descriptions: [{ name: "unknown-ref", description: "A description" }] },
      { context: ctx },
    );

    expect(mockPrisma.entity.updateMany).not.toHaveBeenCalled();
    expect(result.cached).toBe(0);
  });

  it("skips names resolving to >1 entities (ambiguous) — no updateMany", async () => {
    const ctx = makeCtx();
    // Two entities with the same name (ambiguous)
    (mockPrisma.entity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "ent-1" },
      { id: "ent-2" },
    ]);

    const result = await executeDescribeRefs(
      { descriptions: [{ name: "ambiguous", description: "Some description" }] },
      { context: ctx },
    );

    expect(mockPrisma.entity.updateMany).not.toHaveBeenCalled();
    expect(result.cached).toBe(0);
  });

  it("owner scope: findMany uses ctx.orgId, not any value from input", async () => {
    const ctx = makeCtx({ orgId: "org-scoped" });
    (mockPrisma.entity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "ent-x" }]);

    await executeDescribeRefs(
      { descriptions: [{ name: "ref1", description: "A description" }] },
      { context: ctx },
    );

    const findCall = (mockPrisma.entity.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      where: Record<string, unknown>;
    };
    expect(findCall.where["ownerId"]).toBe("org-scoped");

    const updateCall = (mockPrisma.entity.updateMany as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      where: Record<string, unknown>;
    };
    expect(updateCall.where["ownerId"]).toBe("org-scoped");
  });

  it("skips items with empty description after sanitization", async () => {
    const ctx = makeCtx();
    (mockPrisma.entity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "ent-1" }]);

    const result = await executeDescribeRefs(
      { descriptions: [{ name: "ref1", description: "\x00\x01" }] }, // all control chars → empty after sanitize
      { context: ctx },
    );

    expect(mockPrisma.entity.updateMany).not.toHaveBeenCalled();
    expect(result.cached).toBe(0);
  });

  it("processes multiple descriptions and returns total cached count", async () => {
    const ctx = makeCtx({ orgId: "org-multi" });
    // First findMany → 1 result; second → 1 result; third → 0 results
    (mockPrisma.entity.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ id: "ent-1" }])
      .mockResolvedValueOnce([{ id: "ent-2" }])
      .mockResolvedValueOnce([]);

    const result = await executeDescribeRefs(
      {
        descriptions: [
          { name: "ref1", description: "First entity" },
          { name: "ref2", description: "Second entity" },
          { name: "ref3", description: "Third entity - missing" },
        ],
      },
      { context: ctx },
    );

    expect(mockPrisma.entity.updateMany).toHaveBeenCalledTimes(2);
    expect(result.cached).toBe(2);
  });

  it("never calls prisma.genJob.create ($0 tool)", async () => {
    const ctx = makeCtx();
    (mockPrisma.entity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await executeDescribeRefs(
      { descriptions: [{ name: "ref", description: "desc" }] },
      { context: ctx },
    );
    expect(mockPrisma.genJob.create).not.toHaveBeenCalled();
  });
});
