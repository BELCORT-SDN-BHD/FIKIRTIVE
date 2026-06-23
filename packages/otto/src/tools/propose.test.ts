import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  GEN_PRICE_USD_PER_IMAGE,
  displayCredits,
  CREDITS_PER_USD,
} from "@fikirtive/core";
// I1: pure-helper tests import from propose.helpers — no DB mock needed for these
import { buildProposeCard } from "./propose.helpers.js";
// executePropose (DB-side) still imported from propose.ts
import { executePropose } from "./propose.js";
import type { OttoContext } from "../context.js";

// ---------------------------------------------------------------------------
// Mock @fikirtive/db so execute tests never hit a real DB.
// ---------------------------------------------------------------------------
vi.mock("@fikirtive/db", () => ({
  prisma: {
    entity: {
      findMany: vi.fn(),
    },
    chatMessage: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    // must NEVER be called — no GenJob creation in propose
    genJob: {
      create: vi.fn(),
    },
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
// Pure helper: buildProposeCard (no DB, no SDK — imported from propose.helpers)
// ---------------------------------------------------------------------------

describe("buildProposeCard — pure helper", () => {
  // Test 1: image proposal — kind, model, price, shownPriceDisplay
  it("image proposal → cardPayload.kind 'image', model 'seedream', correct price and display", () => {
    const ctx = makeCtx();
    const input = {
      kind: "image" as const,
      structuredPrompt: "A cat sitting on a throne",
      entityIds: [],
      variantSel: {},
    };
    const { cardPayload, shownPriceDisplay } = buildProposeCard(input, ctx, []);

    expect(cardPayload.kind).toBe("image");
    expect(cardPayload.model).toBe("seedream");

    // count defaults to 1 for image
    const expectedPrice = GEN_PRICE_USD_PER_IMAGE * 1;
    expect(cardPayload.estimatedPriceUsd).toBeCloseTo(expectedPrice);

    const expectedDisplay = displayCredits(Math.round(expectedPrice * CREDITS_PER_USD));
    expect(shownPriceDisplay).toBe(expectedDisplay);

    // M1: price must be positive (guards against regression to 0/NaN)
    expect(shownPriceDisplay).toBeGreaterThan(0);
  });

  // Test 2: disabled filtering — M3: non-vacuous assertion
  // First compute what model is chosen with NO disabled models, then assert
  // that disabling THAT specific model makes buildProposeCard pick something different.
  it("disabled filtering: disabling the default video model forces a different model to be chosen", () => {
    const baseInput = {
      kind: "video" as const,
      structuredPrompt: "A cat walks across a sunlit room",
      entityIds: [],
      variantSel: {},
    };

    // Capture the default model (no disabled list)
    const defaultCtx = makeCtx({ disabledModels: [] });
    const { cardPayload: defaultCard } = buildProposeCard(baseInput, defaultCtx, []);
    const defaultModel = defaultCard.model;

    // Now disable that exact default model
    const disabledCtx = makeCtx({ disabledModels: [defaultModel] });
    const { cardPayload: disabledCard } = buildProposeCard(baseInput, disabledCtx, []);

    expect(disabledCard.kind).toBe("video");
    // The selected model must be different from the disabled one
    expect(disabledCard.model).not.toBe(defaultModel);
    // Sanity: the disabled model itself should not appear
    expect(disabledCard.model).not.toBe(defaultModel);
  });

  // Test 3: cardPayload does not carry ownerId/threadId from ctx (these are identity fields
  // that live on the DB row, not in the payload)
  it("cardPayload does not expose orgId/threadId (identity lives on the DB row, not payload)", () => {
    const ctx = makeCtx({ orgId: "org-real", threadId: "thread-real" });
    const input = {
      kind: "image" as const,
      structuredPrompt: "An abstract painting",
      entityIds: [],
      variantSel: {},
    };
    const { cardPayload } = buildProposeCard(input, ctx, []);

    // The payload carries gen params only — no ownerId/threadId leak
    expect((cardPayload as Record<string, unknown>)["ownerId"]).toBeUndefined();
    expect((cardPayload as Record<string, unknown>)["threadId"]).toBeUndefined();
    // Confirm correct kind was computed
    expect(cardPayload.kind).toBe("image");
  });

  // Test 4: i2v coercion — sourceGenerationId forces video, drops entityIds
  it("i2v coercion: sourceGenerationId forces kind=video, entityIds=[], sourceGenerationId in payload", () => {
    const ctx = makeCtx({ sourceGenerationId: "gen-abc123" });
    const input = {
      kind: "image" as const, // user said image, but we have a source frame
      structuredPrompt: "Animate this",
      entityIds: ["entity-1"],
      variantSel: { "entity-1": "variant-1" },
    };
    const { cardPayload } = buildProposeCard(input, ctx, ["entity-1"]);

    expect(cardPayload.kind).toBe("video");
    expect(cardPayload.entityIds).toEqual([]);
    expect(cardPayload.variantSel).toEqual({});
    expect((cardPayload as Record<string, unknown>)["sourceGenerationId"]).toBe("gen-abc123");
  });

  // Test 5: entityId scoping — foreign ids are dropped silently
  it("entityId scoping: foreign ids dropped, variantSel for dropped ids removed", () => {
    const ctx = makeCtx();
    const input = {
      kind: "image" as const,
      structuredPrompt: "Brand shoot",
      entityIds: ["owned1", "foreign2"],
      variantSel: { "owned1": "var-a", "foreign2": "var-b" },
    };
    const ownedEntityIds = ["owned1"]; // foreign2 not in owned set

    const { cardPayload } = buildProposeCard(input, ctx, ownedEntityIds);

    expect(cardPayload.entityIds).toEqual(["owned1"]);
    expect(cardPayload.variantSel).toEqual({ "owned1": "var-a" });
    expect((cardPayload.variantSel as Record<string, string>)["foreign2"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Execute (integration) — mock prisma
// ---------------------------------------------------------------------------

describe("executePropose — mock DB", () => {
  let mockPrisma: {
    entity: { findMany: ReturnType<typeof vi.fn> };
    chatMessage: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
    genJob: { create: ReturnType<typeof vi.fn> };
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import("@fikirtive/db");
    mockPrisma = db.prisma as unknown as typeof mockPrisma;

    // default mock state: no entities, last seq = 5
    (mockPrisma.entity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (mockPrisma.chatMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ seq: 5 });
    (mockPrisma.chatMessage.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  // Test 6: execute persists GEN_CARD with correct shape, returns cardId + shownPriceDisplay
  it("persists a GEN_CARD row with ownerId=ctx.orgId, correct threadId, seq=last+1", async () => {
    const ctx = makeCtx({ orgId: "org-exec", threadId: "thread-exec" });
    const runContext = { context: ctx };

    const result = await executePropose(
      {
        kind: "image",
        structuredPrompt: "A cat on a throne",
        entityIds: [],
        variantSel: {},
      },
      runContext,
    );

    // create was called exactly once
    expect(mockPrisma.chatMessage.create).toHaveBeenCalledTimes(1);
    const createArg = (mockPrisma.chatMessage.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(createArg.data["ownerId"]).toBe("org-exec");
    expect(createArg.data["threadId"]).toBe("thread-exec");
    expect(createArg.data["kind"]).toBe("GEN_CARD");
    expect(createArg.data["role"]).toBe("AGENT");
    expect(createArg.data["seq"]).toBe(6); // last=5 → 6

    // return value has the right shape
    expect(result).toHaveProperty("cardId");
    expect(typeof result.cardId).toBe("string");
    expect(result.cardId.length).toBeGreaterThan(0);
    expect(result).toHaveProperty("shownPriceDisplay");
    expect(typeof result.shownPriceDisplay).toBe("number");

    // M1: shownPriceDisplay must be positive (guards against regression to 0/NaN)
    expect(result.shownPriceDisplay).toBeGreaterThan(0);
  });

  // Test 7: genJob.create is NEVER called
  it("never calls prisma.genJob.create (propose is $0 — no spend)", async () => {
    const ctx = makeCtx();
    const runContext = { context: ctx };

    await executePropose(
      {
        kind: "image",
        structuredPrompt: "A cat on a throne",
        entityIds: [],
        variantSel: {},
      },
      runContext,
    );

    expect(mockPrisma.genJob.create).not.toHaveBeenCalled();
  });

  // Test 8 (I2): anti-spoof guarantee — identity comes ONLY from run context
  // The input schema has no orgId/threadId by design — this test proves ctx is the sole source.
  it("I2 anti-spoof: ownerId and threadId on the persisted row come exclusively from ctx, not tool input", async () => {
    const ctx = makeCtx({ orgId: "org-A", threadId: "thread-from-ctx" });
    const runContext = { context: ctx };

    await executePropose(
      {
        kind: "image",
        structuredPrompt: "A product shot",
        entityIds: [],
        variantSel: {},
        // no orgId or threadId in input — the schema does not allow them
      },
      runContext,
    );

    expect(mockPrisma.chatMessage.create).toHaveBeenCalledTimes(1);
    const createArg = (mockPrisma.chatMessage.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };

    // Identity MUST come from ctx.orgId and ctx.threadId exclusively
    expect(createArg.data["ownerId"]).toBe("org-A");
    expect(createArg.data["threadId"]).toBe("thread-from-ctx");
  });
});
