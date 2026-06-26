/**
 * generate.test.ts — money-machine tests for the generate tool
 *
 * Tests #1–9 from the Task 1.5 brief. Mock @fikirtive/db and inject a mock ctx.startGen.
 * Every money-safety property is asserted independently.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { generate, generateInput, executeGenerate } from "./generate.js";
import type { OttoContext } from "../context.js";

// ---------------------------------------------------------------------------
// Mock @fikirtive/db — no real DB
// ---------------------------------------------------------------------------
vi.mock("@fikirtive/db", () => ({
  prisma: {
    chatMessage: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    genJob: {
      findFirst: vi.fn(),
    },
  },
}));

// ---------------------------------------------------------------------------
// Shared test context + card fixture
// ---------------------------------------------------------------------------

const CARD_ID = "card-abc123";
const ORG_ID = "org-test";

function makeCtx(overrides?: Partial<OttoContext>): OttoContext {
  return {
    orgId: ORG_ID,
    userId: "user-test",
    projectId: "proj-test",
    threadId: "thread-test",
    disabledModels: [],
    sourceGenerationId: null,
    startGen: vi.fn().mockResolvedValue({ id: "job-new" }),
    ...overrides,
  };
}

/** A minimal image card payload that passes coworkProposalSchema validation.
 *  desiredAspect/desiredDuration/desiredAudio must be undefined (not null) for the
 *  .optional() fields in coworkProposalSchema. */
function makeImageCardPayload(overrides?: Record<string, unknown>) {
  return {
    kind: "image",
    model: "seedream",
    structuredPrompt: "A bright product shot",
    entityIds: [],
    variantSel: {},
    // desiredAspect, desiredDuration, desiredAudio intentionally omitted (undefined = optional)
    params: { count: 1 },
    ...overrides,
  };
}

function makeCard(payloadOverrides?: Record<string, unknown>) {
  return {
    id: CARD_ID,
    threadId: "thread-test",
    payload: makeImageCardPayload(payloadOverrides),
    thread: {
      projectId: "proj-test",
      deletedAt: null,
      ownerId: ORG_ID,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getPrisma() {
  const db = await import("@fikirtive/db");
  return db.prisma as unknown as {
    chatMessage: {
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    genJob: {
      findFirst: ReturnType<typeof vi.fn>;
    };
  };
}

// ---------------------------------------------------------------------------
// Test 1: needsApproval is the LITERAL `true` (async () => true, not () => false)
//
// The SDK normalizes boolean `needsApproval` to an async function that returns the value.
// Passing `true` → async () => true. Passing `0`, `undefined`, or omitting it → async () => false.
// We call the function and assert it resolves to `true`. A numeric predicate would resolve
// to `false` (fail-open — approve nothing is blocked, everything runs).
// ---------------------------------------------------------------------------

describe("Test 1 — needsApproval resolves to literal true", () => {
  it("generate.needsApproval() resolves to true (not false/undefined)", async () => {
    // The SDK wraps boolean into: async () => typeof v === 'boolean' ? v : false
    // So true → resolves true; 0 or undefined → resolves false (fail-open).
    // We call the function (it's always async after SDK normalization).
    const result = await (generate.needsApproval as () => Promise<boolean>)();
    expect(result).toBe(true);
    // Extra: the field must exist and be truthy (guards against accidental removal)
    expect(generate.needsApproval).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Test 2: input schema only accepts cardId — spend params are ignored/rejected
// (We test using the exported generateInput Zod schema directly, since the built
// tool's .parameters is a JSON Schema object, not the Zod schema.)
// ---------------------------------------------------------------------------

describe("Test 2 — input is only cardId; spend params stripped", () => {
  it("schema strips unknown spend params (model, count, kind) from input", () => {
    const raw = { cardId: CARD_ID, model: "gpt-5", count: 9, kind: "video" };
    const parsed = generateInput.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const data = parsed.data as Record<string, unknown>;
      expect(data["cardId"]).toBe(CARD_ID);
      // spend params must NOT surface in the parsed input
      expect(data["model"]).toBeUndefined();
      expect(data["count"]).toBeUndefined();
      expect(data["kind"]).toBeUndefined();
    }
  });

  it("schema rejects missing cardId", () => {
    const parsed = generateInput.safeParse({});
    expect(parsed.success).toBe(false);
  });

  it("schema rejects empty string cardId", () => {
    const parsed = generateInput.safeParse({ cardId: "" });
    expect(parsed.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 3: server-derived / anti-flip — card payload dictates kind/model
// ---------------------------------------------------------------------------

describe("Test 3 — server-derived / anti-flip", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const p = await getPrisma();
    p.chatMessage.findFirst.mockResolvedValue(makeCard());
    p.genJob.findFirst.mockResolvedValue(null);
    p.chatMessage.update.mockResolvedValue({});
  });

  it("request kind and model come from the card payload, not from input", async () => {
    // The card is an IMAGE card with model=seedream.
    // Even if we somehow passed model/kind in input (schema strips them), the built
    // request must reflect the card's values.
    const ctx = makeCtx();
    const result = await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(result).not.toHaveProperty("error");
    // startGen was called; inspect what it was called with
    const startGenMock = ctx.startGen as ReturnType<typeof vi.fn>;
    expect(startGenMock).toHaveBeenCalledTimes(1);
    const req = startGenMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(req["kind"]).toBe("image");
    expect(req["model"]).toBe("seedream");
  });

  it("buildGenRequestFromCard is called with overrides: undefined (anti-flip)", async () => {
    // The generate tool must pass overrides: undefined — the model cannot inject params.
    // We verify this indirectly: the built request's model must equal the card's model.
    const ctx = makeCtx();
    await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    const startGenMock = ctx.startGen as ReturnType<typeof vi.fn>;
    const req = startGenMock.mock.calls[0]![0] as Record<string, unknown>;
    // With overrides:undefined, chosenModel = card's model (seedream).
    expect(req["model"]).toBe("seedream");
  });
});

// ---------------------------------------------------------------------------
// Test 4: startGen called with idempotencyKey = cowork:<cardId>
// ---------------------------------------------------------------------------

describe("Test 4 — startGen receives idempotencyKey cowork:<cardId>", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const p = await getPrisma();
    p.chatMessage.findFirst.mockResolvedValue(makeCard());
    p.genJob.findFirst.mockResolvedValue(null);
    p.chatMessage.update.mockResolvedValue({});
  });

  it("startGen is called with idempotencyKey=cowork:<cardId>", async () => {
    const ctx = makeCtx();
    await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    const startGenMock = ctx.startGen as ReturnType<typeof vi.fn>;
    expect(startGenMock).toHaveBeenCalledTimes(1);
    const req = startGenMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(req["idempotencyKey"]).toBe(`cowork:${CARD_ID}`);
    // Also confirm card's model/kind are in the request
    expect(req["kind"]).toBe("image");
    expect(req["model"]).toBe("seedream");
  });
});

// ---------------------------------------------------------------------------
// Test 5: exactly-once re-spend guard — existing job → startGen NOT called
// ---------------------------------------------------------------------------

describe("Test 5 — exactly-once re-spend guard", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const p = await getPrisma();
    p.chatMessage.findFirst.mockResolvedValue(makeCard());
    p.chatMessage.update.mockResolvedValue({});
  });

  it("when genJob exists for this card, returns existing job WITHOUT calling startGen", async () => {
    const p = await getPrisma();
    p.genJob.findFirst.mockResolvedValue({ id: "existing-job-id", status: "DONE" });

    const ctx = makeCtx();
    const result = await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    // Returns existing job
    expect(result).toEqual({ genJobId: "existing-job-id", status: "DONE" });

    // startGen must NOT have been called — no re-charge
    const startGenMock = ctx.startGen as ReturnType<typeof vi.fn>;
    expect(startGenMock).not.toHaveBeenCalled();
  });

  it("re-spend guard queries by orgId + idempotencyKey=cowork:<cardId>", async () => {
    const p = await getPrisma();
    const orgId = "org-check";
    // Card thread.ownerId must match ctx.orgId or the card-not-found guard fires first
    p.chatMessage.findFirst.mockResolvedValue({
      ...makeCard(),
      thread: { projectId: "proj-test", deletedAt: null, ownerId: orgId },
    });
    p.genJob.findFirst.mockResolvedValue({ id: "job-x", status: "QUEUED" });

    const ctx = makeCtx({ orgId });
    await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(p.genJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ownerId: orgId,
          idempotencyKey: `cowork:${CARD_ID}`,
        }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Test 6: owner scope — cross-tenant card rejected; ownerId on query = ctx.orgId
// ---------------------------------------------------------------------------

describe("Test 6 — owner scope", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const p = await getPrisma();
    p.genJob.findFirst.mockResolvedValue(null);
    p.chatMessage.update.mockResolvedValue({});
  });

  it("chatMessage.findFirst is called with ownerId=ctx.orgId", async () => {
    const p = await getPrisma();
    p.chatMessage.findFirst.mockResolvedValue(makeCard());

    const ctx = makeCtx({ orgId: "org-scoped" });
    await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(p.chatMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: CARD_ID,
          ownerId: "org-scoped",
          kind: "GEN_CARD",
        }),
      }),
    );
  });

  it("cross-tenant card (thread.ownerId !== ctx.orgId) → error, no spend", async () => {
    const p = await getPrisma();
    // Card exists but thread.ownerId is a different org
    p.chatMessage.findFirst.mockResolvedValue({
      ...makeCard(),
      thread: { projectId: "proj-test", deletedAt: null, ownerId: "org-OTHER" },
    });

    const ctx = makeCtx({ orgId: "org-scoped" });
    const result = await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(result).toHaveProperty("error");
    const startGenMock = ctx.startGen as ReturnType<typeof vi.fn>;
    expect(startGenMock).not.toHaveBeenCalled();
  });

  it("card not found (null) → error, no spend", async () => {
    const p = await getPrisma();
    p.chatMessage.findFirst.mockResolvedValue(null);

    const ctx = makeCtx();
    const result = await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(result).toHaveProperty("error");
    const startGenMock = ctx.startGen as ReturnType<typeof vi.fn>;
    expect(startGenMock).not.toHaveBeenCalled();
  });

  it("soft-deleted thread → error, no spend", async () => {
    const p = await getPrisma();
    p.chatMessage.findFirst.mockResolvedValue({
      ...makeCard(),
      thread: { projectId: "proj-test", deletedAt: new Date(), ownerId: ORG_ID },
    });

    const ctx = makeCtx();
    const result = await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(result).toHaveProperty("error");
    const startGenMock = ctx.startGen as ReturnType<typeof vi.fn>;
    expect(startGenMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 6b: thread/project scope — Fix 1 (P1-a)
// ---------------------------------------------------------------------------

describe("Test 6b — thread/project scope (Fix 1 / P1-a)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const p = await getPrisma();
    p.genJob.findFirst.mockResolvedValue(null);
    p.chatMessage.update.mockResolvedValue({});
  });

  it("card.threadId !== ctx.threadId → error, no startGen call", async () => {
    const p = await getPrisma();
    // Card belongs to a different thread than ctx
    p.chatMessage.findFirst.mockResolvedValue({
      ...makeCard(),
      threadId: "thread-OTHER",
    });

    const ctx = makeCtx({ threadId: "thread-test" });
    const result = await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(result).toHaveProperty("error");
    const startGenMock = ctx.startGen as ReturnType<typeof vi.fn>;
    expect(startGenMock).not.toHaveBeenCalled();
  });

  it("card.thread.projectId !== ctx.projectId → error, no startGen call", async () => {
    const p = await getPrisma();
    // Card belongs to a different project
    p.chatMessage.findFirst.mockResolvedValue({
      ...makeCard(),
      thread: { projectId: "proj-OTHER", deletedAt: null, ownerId: ORG_ID },
    });

    const ctx = makeCtx({ projectId: "proj-test" });
    const result = await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(result).toHaveProperty("error");
    const startGenMock = ctx.startGen as ReturnType<typeof vi.fn>;
    expect(startGenMock).not.toHaveBeenCalled();
  });

  it("card with matching threadId and projectId → startGen called (happy path)", async () => {
    const p = await getPrisma();
    // Card matches both ctx.threadId and ctx.projectId
    p.chatMessage.findFirst.mockResolvedValue(makeCard());

    const ctx = makeCtx({ threadId: "thread-test", projectId: "proj-test" });
    const result = await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(result).not.toHaveProperty("error");
    const startGenMock = ctx.startGen as ReturnType<typeof vi.fn>;
    expect(startGenMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Test 7: disabled model → error, startGen NOT called
// ---------------------------------------------------------------------------

describe("Test 7 — disabled model check", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const p = await getPrisma();
    p.genJob.findFirst.mockResolvedValue(null);
    p.chatMessage.update.mockResolvedValue({});
  });

  it("model in ctx.disabledModels → error response, startGen NOT called", async () => {
    const p = await getPrisma();
    // Card uses "seedream"
    p.chatMessage.findFirst.mockResolvedValue(makeCard({ model: "seedream" }));

    const ctx = makeCtx({ disabledModels: ["seedream"] });
    const result = await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(result).toHaveProperty("error");
    const startGenMock = ctx.startGen as ReturnType<typeof vi.fn>;
    expect(startGenMock).not.toHaveBeenCalled();
  });

  it("non-disabled model → startGen IS called", async () => {
    const p = await getPrisma();
    p.chatMessage.findFirst.mockResolvedValue(makeCard({ model: "seedream" }));

    const ctx = makeCtx({ disabledModels: ["some-other-model"] });
    const result = await executeGenerate({ cardId: CARD_ID }, { context: ctx });

    expect(result).not.toHaveProperty("error");
    const startGenMock = ctx.startGen as ReturnType<typeof vi.fn>;
    expect(startGenMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Test 8: missing startGen port → throws (fail loud, never silent no-op)
// ---------------------------------------------------------------------------

describe("Test 8 — missing startGen port throws", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const p = await getPrisma();
    p.chatMessage.findFirst.mockResolvedValue(makeCard());
    p.genJob.findFirst.mockResolvedValue(null);
    p.chatMessage.update.mockResolvedValue({});
  });

  it("ctx.startGen undefined → throws 'startGen port required'", async () => {
    const ctx = makeCtx({ startGen: undefined });
    await expect(executeGenerate({ cardId: CARD_ID }, { context: ctx })).rejects.toThrow(
      "startGen port required",
    );
  });
});

// ---------------------------------------------------------------------------
// Test 9: import audit — generate.ts does NOT bypass startGen
// ---------------------------------------------------------------------------

describe("Test 9 — import audit: no direct spend bypass in generate.ts", () => {
  it("generate.ts source does not import fal provider, create GenJob directly, or import from apps/*", () => {
    // Read the source file and assert forbidden patterns are absent.
    const src = readFileSync(
      new URL("./generate.ts", import.meta.url),
      "utf8",
    );

    // Must NOT directly call/import the fal provider
    expect(src).not.toMatch(/from\s+['"]@fal-ai\//);
    expect(src).not.toMatch(/from\s+['"]fal['"]/);

    // Must NOT create a GenJob directly (only startGen does this)
    expect(src).not.toMatch(/genJob\.create/);

    // Must NOT import startGen or gen-actions from apps/* (boundary violation)
    expect(src).not.toMatch(/from\s+['"][^'"]*apps\//);
    expect(src).not.toMatch(/from\s+['"][^'"]*gen-actions/);

    // Must use ctx.startGen as the ONLY spend path
    expect(src).toMatch(/ctx\.startGen/);

    // Must NOT call reserveCredits as a function call (import or call expression)
    // We check for it as a function call pattern, not as a comment word
    expect(src).not.toMatch(/reserveCredits\s*\(/);
  });
});
