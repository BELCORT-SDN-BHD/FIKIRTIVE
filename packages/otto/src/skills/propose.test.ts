import { describe, it, expect, vi, beforeEach } from "vitest";
import { GEN_PRICE_USD_PER_IMAGE, buildGenRequestFromCard } from "@fikirtive/core";
// I1: pure-helper tests import from propose.helpers — no DB mock needed for these
import { buildProposeCard, EXECUTED_SPEC } from "./propose.helpers.js";
// executePropose (DB-side) still imported from propose.ts
import { executePropose, proposeSkill } from "./propose.js";
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
    // #619 E-5: the pre-spend reference-budget count (read-only)
    referenceImage: {
      count: vi.fn(),
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

    // count defaults to 1 for image. estimatedPriceUsd stays the record-only fal cost…
    const expectedPrice = GEN_PRICE_USD_PER_IMAGE * 1;
    expect(cardPayload.estimatedPriceUsd).toBeCloseTo(expectedPrice);

    // …but the CARD now quotes the real charge in credits (pricedGenCredits = 1 credit/image),
    // the same value startGen reserves — so the quote equals what leaves the balance.
    expect(cardPayload.estimatedCredits).toBe(1);
    expect(shownPriceDisplay).toBe(1);

    // M1: price must be positive (guards against regression to 0/NaN)
    expect(shownPriceDisplay).toBeGreaterThan(0);
  });

  // Ad pack: count>1 scales the image price linearly and freezes the count on the
  // card (params.count). This is the reserve==settle guarantee — the displayed price
  // must equal unit × count, the same count the worker generates.
  it("ad-pack count: image count=4 → params.count 4 and price = unit × 4", () => {
    const ctx = makeCtx();
    const { cardPayload } = buildProposeCard(
      { kind: "image", structuredPrompt: "A sneaker on a plinth", entityIds: [], variantSel: {}, count: 4 },
      ctx,
      [],
    );
    expect(cardPayload.params.count).toBe(4);
    expect(cardPayload.estimatedPriceUsd).toBeCloseTo(GEN_PRICE_USD_PER_IMAGE * 4);
  });

  // count is clamped to the spend bound — an over-cap request never inflates the charge.
  it("ad-pack count: image count=99 is clamped to MAX_GEN_COUNT (4)", () => {
    const ctx = makeCtx();
    const { cardPayload } = buildProposeCard(
      { kind: "image", structuredPrompt: "A watch, four angles", entityIds: [], variantSel: {}, count: 99 },
      ctx,
      [],
    );
    expect(cardPayload.params.count).toBe(4);
    expect(cardPayload.estimatedPriceUsd).toBeCloseTo(GEN_PRICE_USD_PER_IMAGE * 4);
  });

  // Video ignores count — a clip is always single (price must not scale by count).
  it("ad-pack count: video ignores count → params.count stays 1", () => {
    const ctx = makeCtx();
    const { cardPayload } = buildProposeCard(
      { kind: "video", structuredPrompt: "A cat walks across a sunlit room", entityIds: [], variantSel: {}, count: 4 },
      ctx,
      [],
    );
    expect(cardPayload.params.count).toBe(1);
  });

  // Test 2: video-model is locked to the single active model (product decision: one video
  // model, no picker — see review-fixes F1). suggestModel ignores the `disabled` set for
  // SELECTION; admin-disable is still enforced at spend time (assertSpendableModel /
  // isModelDisabled in startGen), not by swapping the proposed model.
  it("video model is locked to the active model regardless of the disabled set", () => {
    const baseInput = {
      kind: "video" as const,
      structuredPrompt: "A cat walks across a sunlit room",
      entityIds: [],
      variantSel: {},
    };

    // Capture the active model (no disabled list)
    const defaultCtx = makeCtx({ disabledModels: [] });
    const { cardPayload: defaultCard } = buildProposeCard(baseInput, defaultCtx, []);
    const defaultModel = defaultCard.model;

    // Disabling that model does NOT change the proposed model — selection is locked to the
    // single active video model; the disabled gate fires later, at the spend boundary.
    const disabledCtx = makeCtx({ disabledModels: [defaultModel] });
    const { cardPayload: disabledCard } = buildProposeCard(baseInput, disabledCtx, []);

    expect(disabledCard.kind).toBe("video");
    expect(disabledCard.model).toBe(defaultModel);
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

  // Test 4a: i2v — a VIDEO plan + reference conditions on the start frame (entities dropped)
  it("i2v: kind=video + sourceGenerationId → video, entityIds=[], sourceGenerationId in payload", () => {
    const ctx = makeCtx({ sourceGenerationId: "gen-abc123" });
    const input = {
      kind: "video" as const, // user wants to animate the reference
      structuredPrompt: "Animate this into a 5s clip",
      entityIds: ["entity-1"],
      variantSel: { "entity-1": "variant-1" },
    };
    const { cardPayload } = buildProposeCard(input, ctx, ["entity-1"]);

    expect(cardPayload.kind).toBe("video");
    expect(cardPayload.entityIds).toEqual([]);
    expect(cardPayload.variantSel).toEqual({});
    expect((cardPayload as Record<string, unknown>)["sourceGenerationId"]).toBe("gen-abc123");
  });

  // Test 4b (#619, Founder 决议 2026-08-02): 挂图 + 要图片 = 引擎真收到这张图。
  //
  // 这条断言过去锁的是相反的语义（"sourceGenerationId NOT in payload"）—— 界面对商家说
  // "Tell Otto what to do with this image"，付费请求里却没有那张图。决议推翻它：kind 仍由
  // 商家的话决定（挂图不再强制变视频、@ 的元素照旧保留），但那张图必须随卡走，
  // 下游（gen-from-card → GenJob → worker → 引擎请求体）本来就无条件透传。
  it("#619: kind=image + sourceGenerationId → stays image, entities kept, sourceGenerationId IS in payload", () => {
    const ctx = makeCtx({ sourceGenerationId: "gen-abc123" });
    const input = {
      kind: "image" as const, // user wants an image built from the reference
      structuredPrompt: "A product shot in this style",
      entityIds: ["entity-1"],
      variantSel: { "entity-1": "variant-1" },
    };
    const { cardPayload } = buildProposeCard(input, ctx, ["entity-1"]);

    expect(cardPayload.kind).toBe("image");
    expect(cardPayload.entityIds).toEqual(["entity-1"]);
    expect(cardPayload.variantSel).toEqual({ "entity-1": "variant-1" });
    expect((cardPayload as Record<string, unknown>)["sourceGenerationId"]).toBe("gen-abc123");
    // image tier pricing (1 credit/image), not video — carrying the reference costs nothing extra
    expect(cardPayload.estimatedCredits).toBe(1);
  });

  // 卡面披露（E-4）：带图这件事必须在批准前看得见，而且只在真带图时出现。
  it("#619: an image card that carries the attached reference says so on its face", () => {
    const withRef = buildProposeCard(
      { kind: "image", structuredPrompt: "swap the background for a beach", entityIds: [], variantSel: {} },
      makeCtx({ sourceGenerationId: "gen-abc123" }),
      [],
    ).cardPayload;
    expect(withRef.specChips).toContain("Uses your attached image");

    const withoutRef = buildProposeCard(
      { kind: "image", structuredPrompt: "a poster", entityIds: [], variantSel: {} },
      makeCtx(),
      [],
    ).cardPayload;
    expect(withoutRef.specChips).not.toContain("Uses your attached image");
  });

  // 说的与做的同步（F 断言 1+2）：卡上写的那张图，执行层组请求体时必须原样拿到。
  it("#619: the attached image survives into the paid request the execution layer builds", () => {
    const { cardPayload } = buildProposeCard(
      { kind: "image", structuredPrompt: "keep the product, beach background", entityIds: [], variantSel: {} },
      makeCtx({ sourceGenerationId: "gen-abc123" }),
      [],
    );
    const built = buildGenRequestFromCard({
      cardPayload,
      projectId: "proj-test",
      threadId: "thread-test",
      cardId: "card_1",
      prompt: "keep the product, beach background",
      entityIds: [],
      variantSel: {},
    });
    expect(built.ok).toBe(true);
    expect((built as { ok: true; req: Record<string, unknown> }).req["sourceGenerationId"]).toBe("gen-abc123");
  });

  // 挂了图但要视频的既有语义不动：图仍是 i2v 起始帧，元素照旧清空。
  it("#619 does not disturb the video path: an attached image is still the i2v start frame", () => {
    const { cardPayload } = buildProposeCard(
      { kind: "video", structuredPrompt: "animate this", entityIds: ["entity-1"], variantSel: {} },
      makeCtx({ sourceGenerationId: "gen-abc123" }),
      ["entity-1"],
    );
    expect(cardPayload.kind).toBe("video");
    expect(cardPayload.entityIds).toEqual([]);
    expect((cardPayload as Record<string, unknown>)["sourceGenerationId"]).toBe("gen-abc123");
    expect(cardPayload.specChips).not.toContain("Uses your attached image");
  });

  it("reference video: kind=video + referenceVideoGenerationId → present in payload, image tier untouched", () => {
    const ctx = makeCtx({ referenceVideoGenerationId: "gen_vid" });
    const { cardPayload } = buildProposeCard(
      { kind: "video", structuredPrompt: "move like this", entityIds: [], variantSel: {}, desiredDuration: 10 }, ctx, []);
    expect(cardPayload.kind).toBe("video");
    expect((cardPayload as Record<string, unknown>)["referenceVideoGenerationId"]).toBe("gen_vid");
    expect(cardPayload.params.durationSeconds).toBe(5);
    expect(cardPayload.estimatedCredits).toBe(16);
  });

  it("reference video takes precedence over source image for the paid video payload", () => {
    const ctx = makeCtx({ sourceGenerationId: "gen_img", referenceVideoGenerationId: "gen_vid" });
    const { cardPayload } = buildProposeCard(
      { kind: "video", structuredPrompt: "move like this", entityIds: ["entity-1"], variantSel: { "entity-1": "variant-1" } },
      ctx,
      ["entity-1"],
    );

    expect(cardPayload.kind).toBe("video");
    expect((cardPayload as Record<string, unknown>)["referenceVideoGenerationId"]).toBe("gen_vid");
    expect((cardPayload as Record<string, unknown>)["sourceGenerationId"]).toBeUndefined();
  });

  it("reference video: kind=image ignores referenceVideoGenerationId (not in payload)", () => {
    const ctx = makeCtx({ referenceVideoGenerationId: "gen_vid" });
    const { cardPayload } = buildProposeCard(
      { kind: "image", structuredPrompt: "a poster", entityIds: [], variantSel: {} }, ctx, []);
    expect(cardPayload.kind).toBe("image");
    expect((cardPayload as Record<string, unknown>)["referenceVideoGenerationId"]).toBeUndefined();
    expect(cardPayload.estimatedCredits).toBe(1); // image tier unchanged
  });

  // Test forVideo: image with forVideo=true → videoStep.estimatedCredits is positive,
  // estimatedCredits (image) is unchanged/smaller
  it("forVideo=true on image → cardPayload.videoStep.estimatedCredits is a positive number, estimatedCredits (image) unchanged", () => {
    const ctx = makeCtx();
    const input = {
      kind: "image" as const,
      structuredPrompt: "A hero shot of the mascot",
      entityIds: [],
      variantSel: {},
      forVideo: true,
    };
    const { cardPayload } = buildProposeCard(input, ctx, []);

    // The image step's real charge is unaffected
    expect(cardPayload.kind).toBe("image");
    expect(cardPayload.estimatedCredits).toBe(1); // 1 credit/image unchanged

    // videoStep is set and its estimate is a positive number
    expect(cardPayload.videoStep).toBeDefined();
    expect(typeof cardPayload.videoStep!.estimatedCredits).toBe("number");
    expect(cardPayload.videoStep!.estimatedCredits).toBeGreaterThan(0);

    // The video step estimate should be larger than the image step (video costs more)
    expect(cardPayload.videoStep!.estimatedCredits).toBeGreaterThan(cardPayload.estimatedCredits);
  });

  // Test forVideo: image WITHOUT forVideo → videoStep is undefined
  it("forVideo omitted on image → videoStep is undefined", () => {
    const ctx = makeCtx();
    const input = {
      kind: "image" as const,
      structuredPrompt: "A product shot",
      entityIds: [],
      variantSel: {},
      // no forVideo
    };
    const { cardPayload } = buildProposeCard(input, ctx, []);

    expect(cardPayload.videoStep).toBeUndefined();
  });

  // Test forVideo: a normal video card is unaffected by the forVideo flag
  it("forVideo has no effect on a video card — videoStep is undefined and kind stays video", () => {
    const ctx = makeCtx();
    const input = {
      kind: "video" as const,
      structuredPrompt: "A sweeping aerial shot",
      entityIds: [],
      variantSel: {},
      forVideo: true, // irrelevant on a video card
    };
    const { cardPayload } = buildProposeCard(input, ctx, []);

    expect(cardPayload.kind).toBe("video");
    expect(cardPayload.videoStep).toBeUndefined();
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
    referenceImage: { count: ReturnType<typeof vi.fn> };
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
    (mockPrisma.referenceImage.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
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

  // -------------------------------------------------------------------------
  // #619 E-5 —— 截断必须在**花钱之前**出现在卡面上。
  // 引擎一次只收 MAX_CONDITIONING_IMAGES 张 @元素参考照；过去是静默截断，商家批准、
  // 扣完钱，才在详情页发现有元素根本没上车。
  // -------------------------------------------------------------------------

  /** 取这一次 create 写进去的 payload。 */
  function persistedPayload(): Record<string, unknown> {
    const createArg = (mockPrisma.chatMessage.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      data: { payload: Record<string, unknown> };
    };
    return createArg.data.payload;
  }

  it("#619: 17 live reference photos on a 10-image engine → the card says so BEFORE approval", async () => {
    mockPrisma.entity.findMany.mockResolvedValue([{ id: "e1" }, { id: "e2" }]);
    // two @mentioned elements carrying 9 + 8 live photos = 17
    mockPrisma.referenceImage.count
      .mockResolvedValueOnce(9)
      .mockResolvedValueOnce(8);

    await executePropose(
      { kind: "image", structuredPrompt: "the whole cast on a beach", entityIds: ["e1", "e2"], variantSel: {} },
      { context: makeCtx({ orgId: "org-cap" }) },
    );

    const payload = persistedPayload();
    expect(payload["downgraded"]).toBe(true);
    expect(payload["downgradeNote"]).toContain("This run will use 10 of your 17 reference photos.");
  });

  it("#619: within the engine limit → no truncation sentence is invented", async () => {
    mockPrisma.entity.findMany.mockResolvedValue([{ id: "e1" }]);
    mockPrisma.referenceImage.count.mockResolvedValue(3);

    await executePropose(
      { kind: "image", structuredPrompt: "a hero shot", entityIds: ["e1"], variantSel: {} },
      { context: makeCtx({ orgId: "org-cap" }) },
    );

    const payload = persistedPayload();
    expect(payload["downgraded"]).toBe(false);
    expect(payload["downgradeNote"]).toBeUndefined();
  });

  it("#619: the count follows the worker — a @mentioned variant is counted, not the base", async () => {
    mockPrisma.entity.findMany.mockResolvedValue([{ id: "e1" }]);
    mockPrisma.referenceImage.count.mockResolvedValue(2);

    await executePropose(
      { kind: "image", structuredPrompt: "her, on a beach", entityIds: ["e1"], variantSel: { e1: "var-1" } },
      { context: makeCtx({ orgId: "org-var" }) },
    );

    expect(mockPrisma.referenceImage.count).toHaveBeenCalledWith({
      where: { entityId: "e1", variantId: "var-1", ownerId: "org-var", deletedAt: null },
    });
  });

  it("#619: several attached images → the card names which one is the base, and still carries it", async () => {
    await executePropose(
      { kind: "image", structuredPrompt: "like these, but on a beach", entityIds: [], variantSel: {} },
      {
        context: makeCtx({
          sourceGenerationId: "gen-1",
          sourceGenerationIds: ["gen-1", "gen-2", "gen-3"],
        }),
      },
    );

    const payload = persistedPayload();
    expect(payload["sourceGenerationId"]).toBe("gen-1");
    expect(payload["downgraded"]).toBe(true);
    expect(payload["downgradeNote"]).toContain("You attached 3 images");
    expect(payload["specChips"]).toContain("Uses your attached image");
  });
});

describe("propose requires-gate + goal", () => {
  it("proposeSkill declares a goal requirement", () => {
    expect(proposeSkill.requires.map((r) => r.field)).toContain("goal");
  });

  it("proposeInput accepts an optional goal and still parses without it", async () => {
    const { proposeInput } = await import("./propose.helpers.js");
    expect(proposeInput.safeParse({ kind: "image", structuredPrompt: "x" }).success).toBe(true);
    const withGoal = proposeInput.safeParse({ kind: "image", structuredPrompt: "x", goal: "drive signups" });
    expect(withGoal.success).toBe(true);
  });

  it("executePropose persists goal onto the GEN_CARD payload", async () => {
    const db = await import("@fikirtive/db");
    const mockPrisma = db.prisma as unknown as {
      entity: { findMany: ReturnType<typeof vi.fn> };
      chatMessage: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
    };
    mockPrisma.entity.findMany.mockResolvedValue([]);
    mockPrisma.chatMessage.findFirst.mockResolvedValue({ seq: 5 });
    mockPrisma.chatMessage.create.mockClear();
    mockPrisma.chatMessage.create.mockResolvedValue({});

    const ctx = makeCtx({ orgId: "org-goal", threadId: "thread-goal" });
    await executePropose(
      { kind: "image", structuredPrompt: "A hero shot", entityIds: [], variantSel: {}, goal: "launch teaser" },
      { context: ctx },
    );
    const createArg = (mockPrisma.chatMessage.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      data: { payload: Record<string, unknown> };
    };
    expect(createArg.data.payload["goal"]).toBe("launch teaser");
  });
});

// ---------------------------------------------------------------------------
// #580 §2 — the card must be able to show the FULL spec without ever naming the
// engine, and a downgrade must never be silent.
// ---------------------------------------------------------------------------

describe("#580 card spec chips — engine-free by construction", () => {
  const ENGINE_WORDS = /seedance|seedream|veo|kling|ltx|pixverse|grok|wan|hailuo/i;

  it("video: specChips carry shape, length and quality — and no engine name", () => {
    const { cardPayload } = buildProposeCard(
      { kind: "video", structuredPrompt: "a 5s clip", entityIds: [], variantSel: {} },
      makeCtx(),
      [],
    );
    expect(cardPayload.specChips).toEqual(["16:9", "5s", "720p"]);
    expect(cardPayload.specChips.join(" ")).not.toMatch(ENGINE_WORDS);
  });

  it("image: specChips report the size execution really produces, plus how many", () => {
    const one = buildProposeCard(
      { kind: "image", structuredPrompt: "a poster", entityIds: [], variantSel: {} },
      makeCtx(),
      [],
    ).cardPayload;
    expect(one.specChips).toEqual(["2048 × 2048", "1 image"]);

    const pack = buildProposeCard(
      { kind: "image", structuredPrompt: "a poster", entityIds: [], variantSel: {}, count: 3 },
      makeCtx(),
      [],
    ).cardPayload;
    expect(pack.specChips).toEqual(["2048 × 2048", "3 images"]);
    expect(pack.specChips.join(" ")).not.toMatch(ENGINE_WORDS);
  });

  // This is exactly WHY specChips exist: `reason` is the audit note and it DOES
  // name the engine, so a card that rendered `reason` would leak it. If this ever
  // stops holding, the sanitized field can be revisited — but never the other way.
  it("reason still names the engine (audit-only) — which is why the card renders specChips", () => {
    const { cardPayload } = buildProposeCard(
      { kind: "video", structuredPrompt: "a clip", entityIds: [], variantSel: {} },
      makeCtx(),
      [],
    );
    expect(cardPayload.reason).toMatch(ENGINE_WORDS);
    expect(cardPayload.specChips.join(" ")).not.toMatch(ENGINE_WORDS);
  });

  it("no engine name reaches any merchant-facing field of the payload", () => {
    const { cardPayload } = buildProposeCard(
      { kind: "video", structuredPrompt: "a clip", entityIds: [], variantSel: {}, desiredDuration: 7, desiredAspect: "1:1" },
      makeCtx(),
      [],
    );
    expect(cardPayload.specChips.join(" ")).not.toMatch(ENGINE_WORDS);
    expect(cardPayload.downgradeNote).not.toMatch(ENGINE_WORDS);
  });
});

// ---------------------------------------------------------------------------
// #580 复审 r1 P1-2 —— 卡面必须从执行层真会用的规格派生。
//
// 下面这组不是「再断言一遍文案」，而是把卡面和执行层放在同一条链上跑：
//   真 buildProposeCard → 真 buildGenRequestFromCard（执行层拿到的请求体）
//                       → provider 源码（真正发出去的东西）
// 任何一环开始各说各话，这里就红。
// ---------------------------------------------------------------------------

describe("#580 P1-2 卡面规格 = 执行规格（跨层机器闸）", () => {
  const REQ = { projectId: "proj-test", threadId: "thread-test", cardId: "card_1", prompt: "a poster" };

  function genRequestFor(cardPayload: unknown): Record<string, unknown> {
    const built = buildGenRequestFromCard({ cardPayload, ...REQ, entityIds: [], variantSel: {} });
    expect(built.ok, "the execution builder must accept the card this proposal just froze").toBe(true);
    return (built as { ok: true; req: Record<string, unknown> }).req;
  }

  it("图片：画幅根本进不了执行层，所以卡面一个比例都不许承诺", () => {
    const { cardPayload } = buildProposeCard(
      { kind: "image", structuredPrompt: "a poster", entityIds: [], variantSel: {}, desiredAspect: "9:16" },
      makeCtx(),
      [],
    );
    // 执行层拿到的请求体里没有画幅 —— 这就是「做的」。
    const req = genRequestFor(cardPayload);
    expect(req).not.toHaveProperty("aspectRatio");
    expect(EXECUTED_SPEC.image.aspectHonoured).toBe(false);
    // 于是「说的」也不许出现比例。
    expect(cardPayload.specChips.some((chip) => /\d+\s*:\s*\d+/.test(chip))).toBe(false);
    expect(cardPayload.specChips).toContain("2048 × 2048");
  });

  it("图片：商家要的画幅满足不了 —— 必须在付费前显式说出来", () => {
    const { cardPayload } = buildProposeCard(
      { kind: "image", structuredPrompt: "a poster", entityIds: [], variantSel: {}, desiredAspect: "9:16" },
      makeCtx(),
      [],
    );
    expect(cardPayload.downgraded).toBe(true);
    expect(cardPayload.downgradeNote).toBe(
      "You asked for 9:16 — this will be a square 2048 × 2048 image.",
    );
  });

  it("图片：没提画幅就不是降级 —— 不许无中生有地报警", () => {
    const { cardPayload } = buildProposeCard(
      { kind: "image", structuredPrompt: "a poster", entityIds: [], variantSel: {} },
      makeCtx(),
      [],
    );
    expect(cardPayload.downgraded).toBe(false);
    expect(cardPayload.downgradeNote).toBeUndefined();
  });

  it("视频：声音开关没接到执行层，卡面既不说 With sound 也不说 No sound", () => {
    const { cardPayload } = buildProposeCard(
      { kind: "video", structuredPrompt: "a clip", entityIds: [], variantSel: {}, desiredAudio: false },
      makeCtx(),
      [],
    );
    expect(EXECUTED_SPEC.video.audioHonoured).toBe(false);
    expect(cardPayload.specChips.join(" ")).not.toMatch(/sound/i);
    // 商家明确提了声音，而这个开关到不了执行层 —— 是降级，必须说出口。
    expect(cardPayload.downgraded).toBe(true);
    expect(cardPayload.downgradeNote).toMatch(/Sound isn't something I can set here yet/);
  });

  it("视频：时长/画幅/清晰度是真的会传到执行层的，所以卡面照旧承诺", () => {
    const { cardPayload } = buildProposeCard(
      { kind: "video", structuredPrompt: "a clip", entityIds: [], variantSel: {} },
      makeCtx(),
      [],
    );
    const req = genRequestFor(cardPayload);
    expect(req.aspectRatio).toBe(cardPayload.params.aspectRatio);
    expect(req.durationSeconds).toBe(cardPayload.params.durationSeconds);
    expect(req.resolution).toBe(cardPayload.params.resolution);
    expect(cardPayload.specChips).toEqual([
      cardPayload.params.aspectRatio,
      `${cardPayload.params.durationSeconds}s`,
      cardPayload.params.resolution,
    ]);
  });

  // 最后一环 —— provider 真正发出去的请求体 —— 不在这个包里断言。
  // 上一版在这里扫 `packages/generation` 的源码字符串,那只证明源码里有那几个字,不证明
  // 适配器真发了什么(改个变量名就能骗过它)。真闸在
  // `packages/generation/src/byteplus.test.ts`:stub 掉 fetch、调真适配器、把它真正发出去
  // 的 JSON 整体断言,并逐字比对 `EXECUTED_SPEC`(现住 @fikirtive/core,两边同一份声明)。
});

describe("#580 downgrade disclosure — never silent", () => {
  it("a length we can't do is stated in the merchant's own terms", () => {
    const { cardPayload } = buildProposeCard(
      { kind: "video", structuredPrompt: "a 7s clip", entityIds: [], variantSel: {}, desiredDuration: 7 },
      makeCtx(),
      [],
    );
    expect(cardPayload.downgraded).toBe(true);
    expect(cardPayload.downgradeNote).toBe("You asked for 7s — this will be 5s.");
  });

  it("a shape we can't do is stated too", () => {
    const { cardPayload } = buildProposeCard(
      { kind: "video", structuredPrompt: "a square clip", entityIds: [], variantSel: {}, desiredAspect: "1:1" },
      makeCtx(),
      [],
    );
    expect(cardPayload.downgraded).toBe(true);
    expect(cardPayload.downgradeNote).toBe("You asked for 1:1 — this will be 16:9.");
  });

  it("both at once read as one sentence", () => {
    const { cardPayload } = buildProposeCard(
      { kind: "video", structuredPrompt: "a square 7s clip", entityIds: [], variantSel: {}, desiredDuration: 7, desiredAspect: "1:1" },
      makeCtx(),
      [],
    );
    expect(cardPayload.downgradeNote).toBe("You asked for 7s and 1:1 — this will be 5s and 16:9.");
  });

  it("a plan that honours the request carries no note at all", () => {
    const { cardPayload } = buildProposeCard(
      { kind: "video", structuredPrompt: "a 10s clip", entityIds: [], variantSel: {}, desiredDuration: 10, desiredAspect: "9:16" },
      makeCtx(),
      [],
    );
    expect(cardPayload.downgraded).toBe(false);
    expect(cardPayload.downgradeNote).toBeUndefined();
    expect(cardPayload.params.durationSeconds).toBe(10);
    expect(cardPayload.params.aspectRatio).toBe("9:16");
  });

  it("a reference-video plan that silently clamps the length says so", () => {
    const { cardPayload } = buildProposeCard(
      { kind: "video", structuredPrompt: "move like this", entityIds: [], variantSel: {}, desiredDuration: 10 },
      makeCtx({ referenceVideoGenerationId: "gen_vid" }),
      [],
    );
    expect(cardPayload.params.durationSeconds).toBe(5);
    expect(cardPayload.downgraded).toBe(true);
    expect(cardPayload.downgradeNote).toBe("You asked for 10s — this will be 5s.");
  });

  it("downgraded is never flagged without a sentence to explain it", async () => {
    const { buildDowngradeNote } = await import("./propose.helpers.js");
    // No identifiable mismatch (the honest fallback) — still a sentence, never silence.
    expect(buildDowngradeNote("video", {}, { count: 1 }, false)).toBe(
      "Some of what you asked for isn't available here — the details above are what you'll get.",
    );
  });
});
