import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  GEN_PRICE_USD_PER_IMAGE, GEN_IMAGE_MODEL_OPTIONS, HD_VIDEO_RESOLUTION, SELLABLE_VIDEO_RESOLUTIONS,
  activeVideoModel, buildGenRequestFromCard, displayCredits, pricedGenCredits, redactProviderNames,
  routeVideoModel, videoDefaults, type GenVideoModel,
} from "@fikirtive/core";
// I1: pure-helper tests import from propose.helpers — no DB mock needed for these
import {
  buildProposeCard, buildSpecChips, EXECUTED_SPEC, ProposeRefusal, VideoTierUnavailableError,
} from "./propose.helpers.js";
import { imageAspectHonoured, VIDEO_START_FRAME_CHIP } from "@fikirtive/core";
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
/** #774:归属查询同一趟读出来的元素身份 —— 名字与类型就是要被冻结到卡上的那一份。 */
const OWNED_ENTITY_1 = { id: "entity-1", type: "PRODUCT" as const, name: "the AeroBottle" };

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

    // count defaults to 1 for image. estimatedPriceUsd stays the record-only engine cost…
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
  // model, no picker — see review-fixes F1). #647 T6 改了这一条的后半段:关掉那台引擎
  // 不再「照铸不误、留给 spend 闸拦」,而是**根本铸不出卡**(空态见文件末尾的 T6 段)。
  // 这里留下的是仍然成立的那一半:别的输入组合都不会把选中的模型换掉。
  it("video model is locked to the active model (no picker — selection never varies with input)", () => {
    const baseInput = {
      kind: "video" as const,
      structuredPrompt: "A cat walks across a sunlit room",
      entityIds: [],
      variantSel: {},
    };

    const ctx = makeCtx({ disabledModels: [] });
    const { cardPayload: defaultCard } = buildProposeCard(baseInput, ctx, []);
    const { cardPayload: shapedCard } = buildProposeCard(
      { ...baseInput, desiredAspect: "9:16", desiredDuration: 10, desiredAudio: false },
      ctx,
      [],
    );

    expect(defaultCard.kind).toBe("video");
    expect(shapedCard.model).toBe(defaultCard.model);
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
    const { cardPayload } = buildProposeCard(input, ctx, [OWNED_ENTITY_1]);

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
    const { cardPayload } = buildProposeCard(input, ctx, [OWNED_ENTITY_1]);

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
      [OWNED_ENTITY_1],
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
      [OWNED_ENTITY_1],
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
    // foreign2 not in owned set
    const ownedEntities = [{ id: "owned1", type: "PRODUCT" as const, name: "Owned one" }];

    const { cardPayload } = buildProposeCard(input, ctx, ownedEntities);

    expect(cardPayload.entityIds).toEqual(["owned1"]);
    expect(cardPayload.variantSel).toEqual({ "owned1": "var-a" });
    expect((cardPayload.variantSel as Record<string, string>)["foreign2"]).toBeUndefined();
  });

  // ── #774 判官 r2 P1 —— 卡上冻结引擎会被告知的那几个名字 ────────────────────
  // 引擎认人那几句机器指令里的名字必须是**商家批准时看到的**那个。所以名字在铸卡这一刻
  // 就冻结在卡上,批准之后谁也改不动它(卡 payload 不可变),worker 只认这一份。
  describe("#774 判官 r2 P1 — the card freezes the names the engine will be told", () => {
    const ctx = () => makeCtx();
    const base = { kind: "image" as const, structuredPrompt: "A hero shot", variantSel: {} };

    it("freezes id + type + name, in entityIds order", () => {
      const { cardPayload } = buildProposeCard(
        { ...base, entityIds: ["e2", "e1"] },
        ctx(),
        [
          { id: "e1", type: "CHARACTER", name: "Mia" },
          { id: "e2", type: "PRODUCT", name: "the AeroBottle" },
        ],
      );
      expect(cardPayload.approvedEntities).toEqual([
        { id: "e2", type: "PRODUCT", name: "the AeroBottle" },
        { id: "e1", type: "CHARACTER", name: "Mia" },
      ]);
    });

    it("a foreign id never gets an identity on the card", () => {
      const { cardPayload } = buildProposeCard(
        { ...base, entityIds: ["owned1", "foreign2"] },
        ctx(),
        [{ id: "owned1", type: "PRODUCT", name: "Owned one" }],
      );
      expect(cardPayload.approvedEntities).toEqual([{ id: "owned1", type: "PRODUCT", name: "Owned one" }]);
    });

    it("an i2v plan drops its elements → no identities to approve", () => {
      const { cardPayload } = buildProposeCard(
        { ...base, kind: "video", entityIds: ["e1"] },
        makeCtx({ sourceGenerationId: "gen-abc123" }),
        [{ id: "e1", type: "CHARACTER", name: "Mia" }],
      );
      expect(cardPayload.entityIds).toEqual([]);
      expect(cardPayload.approvedEntities).toBeUndefined();
    });

    it("no elements → the field is absent, not an empty array (old-card shape)", () => {
      const { cardPayload } = buildProposeCard({ ...base, entityIds: [] }, ctx(), []);
      expect(cardPayload.approvedEntities).toBeUndefined();
      expect("approvedEntities" in cardPayload).toBe(false);
    });

    it("the name is frozen VERBATIM — the card never rewrites what the merchant typed", () => {
      const odd = "  Kopi  O   \n kaw ";
      const { cardPayload } = buildProposeCard(
        { ...base, entityIds: ["e1"] },
        ctx(),
        [{ id: "e1", type: "PRODUCT", name: odd }],
      );
      expect(cardPayload.approvedEntities?.[0]!.name).toBe(odd);
    });

    // 卡上冻结的这一份,就是付费请求会带走的那一份 —— 真的 buildGenRequestFromCard。
    it("the frozen identities are what the paid request carries (card-trusted)", () => {
      const { cardPayload } = buildProposeCard(
        { ...base, entityIds: ["e1"] },
        ctx(),
        [{ id: "e1", type: "PRODUCT", name: "the AeroBottle" }],
      );
      const built = buildGenRequestFromCard({
        cardPayload,
        projectId: "p1", threadId: "t1", cardId: "c1",
        prompt: cardPayload.structuredPrompt,
        entityIds: cardPayload.entityIds,
        variantSel: {},
      });
      expect((built as { ok: true; req: Record<string, unknown> }).req["approvedEntities"])
        .toEqual([{ id: "e1", type: "PRODUCT", name: "the AeroBottle" }]);
    });
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
    const minted = result as { cardId: string; shownPriceDisplay: number };
    expect(typeof minted.cardId).toBe("string");
    expect(minted.cardId.length).toBeGreaterThan(0);
    expect(result).toHaveProperty("shownPriceDisplay");
    expect(typeof minted.shownPriceDisplay).toBe("number");

    // M1: shownPriceDisplay must be positive (guards against regression to 0/NaN)
    expect(minted.shownPriceDisplay).toBeGreaterThan(0);
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

  // 复审抓到的实数缺陷:底图是 unshift 进去的,不占元素的 10 张名额
  // (apps/worker/src/jobs/gen.ts:650-659),所以带挂图时引擎真收到的是 11 张,
  // 商家给的也是 18 张 —— 卡面过去照旧只会说「10 of your 17」,两个数都不对。
  it("#619: attached base image + 17 element photos → 11 of 18, not 10 of 17", async () => {
    mockPrisma.entity.findMany.mockResolvedValue([{ id: "e1" }, { id: "e2" }]);
    mockPrisma.referenceImage.count.mockResolvedValueOnce(9).mockResolvedValueOnce(8);

    await executePropose(
      { kind: "image", structuredPrompt: "the whole cast, on this beach", entityIds: ["e1", "e2"], variantSel: {} },
      { context: makeCtx({ orgId: "org-cap", sourceGenerationId: "gen-1", sourceGenerationIds: ["gen-1"] }) },
    );

    const payload = persistedPayload();
    expect(payload["downgradeNote"]).toContain("This run will use 11 of your 18 reference photos.");
  });

  // 挂图 + 元素刚好压线:元素没被截,底图仍额外上车 —— 没有截断就不许编一句提醒。
  it("#619: attached base image + exactly 10 element photos → nothing is truncated, so nothing is claimed", async () => {
    mockPrisma.entity.findMany.mockResolvedValue([{ id: "e1" }, { id: "e2" }]);
    mockPrisma.referenceImage.count.mockResolvedValueOnce(5).mockResolvedValueOnce(5);

    await executePropose(
      { kind: "image", structuredPrompt: "both of them, on this beach", entityIds: ["e1", "e2"], variantSel: {} },
      { context: makeCtx({ orgId: "org-cap", sourceGenerationId: "gen-1", sourceGenerationIds: ["gen-1"] }) },
    );

    const payload = persistedPayload();
    expect(payload["downgraded"]).toBe(false);
    expect(payload["downgradeNote"]).toBeUndefined();
  });

  // #785:元素参考照现在真的进视频引擎了 —— 但只在**纯文生视频**那一档。整段参考视频是
  // 引擎的另一个场景,那一档一张元素照都带不了。#619 之前这里的规矩是「说不准就闭嘴」,
  // 现在数字算得准了,规矩回到本来那一条:**不许静默**,零也要说出零。
  it("#785: a reference-video card says none of the element photos ride along (instead of staying silent)", async () => {
    mockPrisma.entity.findMany.mockResolvedValue([{ id: "e1" }]);
    mockPrisma.referenceImage.count.mockResolvedValue(17);

    await executePropose(
      { kind: "video", structuredPrompt: "move like this", entityIds: ["e1"], variantSel: {} },
      { context: makeCtx({ orgId: "org-cap", referenceVideoGenerationId: "gen_vid" }) },
    );

    const payload = persistedPayload();
    expect(payload["kind"]).toBe("video");
    expect(payload["downgraded"]).toBe(true);
    // #979:「一张都不上车」要连着**为什么**一起说 —— 商家给的那条片子确实进引擎。
    expect(payload["downgradeNote"]).toContain(
      "The clip on this card is what this run follows — your 17 saved reference photos aren't sent alongside it.",
    );
    // 而且绝不能倒过来吹一个「用了 N 张」的规格条目。
    expect(payload["specChips"] as string[]).not.toContainEqual(expect.stringContaining("reference photos"));
    // 参考片不是首帧 —— 那一格不许出现在这张卡上。
    expect(payload["specChips"] as string[]).not.toContain(VIDEO_START_FRAME_CHIP);
  });

  // 判官 r1 P1 —— 首帧 i2v 是**同一档**的另一个场景(引擎只认首帧),照片同样一张都不带,
  // 可这一档此前卡面完全沉默:铸卡时 @元素先被清空,披露再去数清空后的卡,数到的是
  // 0 张里的 0 张 ⇒ 那句「一张都不会用上」永远不出现。分母必须来自商家真 @ 的那一份。
  it("#785: an i2v card says none of the @element photos ride along (the start frame takes those slots)", async () => {
    mockPrisma.entity.findMany.mockResolvedValue([{ id: "e1" }]);
    mockPrisma.referenceImage.count.mockResolvedValue(4);

    await executePropose(
      { kind: "video", structuredPrompt: "make her walk toward the camera", entityIds: ["e1"], variantSel: {} },
      { context: makeCtx({ orgId: "org-cap", sourceGenerationId: "gen_img" }) },
    );

    const payload = persistedPayload();
    expect(payload["kind"]).toBe("video");
    // 卡上照旧不带 @元素(worker 那一档也不会去取图)—— 变的只有「不再沉默」。
    expect(payload["entityIds"]).toEqual([]);
    expect(payload["downgraded"]).toBe(true);
    // #979(beta 录像 06:32 / 10:24)—— 这句话以前说到一半就停了:「None of your 4 reference
    // photos will be used」字面为真,读起来却是「你给的图我们一张都没用」,而对话里 Otto 同时
    // 说刚做好的那张会当首帧。同一次生成、两句相反的话。现在先说真会用上的那张。
    expect(payload["downgradeNote"]).toContain(
      "The picture on this card becomes the clip's first frame — your 4 saved reference photos aren't sent alongside it.",
    );
    // 而且绝不能倒过来吹一个「用了 N 张」的规格条目。
    expect(payload["specChips"] as string[]).not.toContainEqual(expect.stringContaining("reference photos"));
  });

  // #979 —— 卡面与对话不许对同一次生成给出两句相反的话。
  it("#979: an i2v card SAYS the picture becomes the first frame, on the chips and in the note", async () => {
    mockPrisma.entity.findMany.mockResolvedValue([{ id: "e1" }]);
    mockPrisma.referenceImage.count.mockResolvedValue(2);

    await executePropose(
      { kind: "video", structuredPrompt: "make her walk toward the camera", entityIds: ["e1"], variantSel: {} },
      { context: makeCtx({ orgId: "org-cap", sourceGenerationId: "gen_img" }) },
    );

    const payload = persistedPayload();
    const chips = payload["specChips"] as string[];
    // ① 肯定的那一半:这张图真的会被用上,卡面自己说出来(不再只有对话说)。
    expect(chips).toContain(VIDEO_START_FRAME_CHIP);
    // ② 否定的那一半照旧在,但它现在挂在肯定那一半后面,读不出「什么图都没用」。
    const note = payload["downgradeNote"] as string;
    expect(note).toContain("becomes the clip's first frame");
    expect(note).toContain("your 2 saved reference photos aren't sent alongside it");
    // ③ 那句会被误读成「一张图都不用」的旧话必须消失。
    expect(note).not.toContain("None of your 2 reference photos will be used");
  });

  // 单数照实说 —— 「your 1 saved reference photos」是一句一眼可见的机器话。
  it("#979: one photo is said in the singular", async () => {
    mockPrisma.entity.findMany.mockResolvedValue([{ id: "e1" }]);
    mockPrisma.referenceImage.count.mockResolvedValue(1);

    await executePropose(
      { kind: "video", structuredPrompt: "make her walk", entityIds: ["e1"], variantSel: {} },
      { context: makeCtx({ orgId: "org-cap", sourceGenerationId: "gen_img" }) },
    );

    expect(persistedPayload()["downgradeNote"]).toContain("your 1 saved reference photo isn't sent alongside it.");
  });

  // 归属过滤仍然排在披露前面:别人的元素不许进这句话的分母(也不许被数)。
  it("#785: the i2v sentence counts only the merchant's own @elements", async () => {
    mockPrisma.entity.findMany.mockResolvedValue([{ id: "e1" }]); // "foreign" 不属于这个 org
    mockPrisma.referenceImage.count.mockResolvedValue(4);

    await executePropose(
      { kind: "video", structuredPrompt: "make her walk", entityIds: ["e1", "foreign"], variantSel: { foreign: "var-x" } },
      { context: makeCtx({ orgId: "org-cap", sourceGenerationId: "gen_img" }) },
    );

    expect(mockPrisma.referenceImage.count).toHaveBeenCalledTimes(1);
    expect(mockPrisma.referenceImage.count).toHaveBeenCalledWith({
      where: { entityId: "e1", variantId: null, ownerId: "org-cap", deletedAt: null },
    });
    expect(persistedPayload()["downgradeNote"]).toContain(
      "The picture on this card becomes the clip's first frame — your 4 saved reference photos aren't sent alongside it.",
    );
  });

  // 反面:i2v 但商家一个元素都没 @ ⇒ 没有什么可披露的,不许编一句提醒。
  it("#785: an i2v card with no @elements stays quiet (nothing was dropped)", async () => {
    await executePropose(
      { kind: "video", structuredPrompt: "make it move", entityIds: [], variantSel: {} },
      { context: makeCtx({ orgId: "org-cap", sourceGenerationId: "gen_img" }) },
    );

    const payload = persistedPayload();
    expect(payload["downgraded"]).toBe(false);
    expect(payload["downgradeNote"]).toBeUndefined();
    expect(mockPrisma.referenceImage.count).not.toHaveBeenCalled();
  });

  // #785 的正面:纯文生视频 + @元素 ⇒ 照片真的上车,卡面在批准前就说出张数。
  it("#785: a text-to-video card with @elements says how many reference photos ride along", async () => {
    mockPrisma.entity.findMany.mockResolvedValue([{ id: "e1" }]);
    mockPrisma.referenceImage.count.mockResolvedValue(3);

    await executePropose(
      { kind: "video", structuredPrompt: "our product on a beach", entityIds: ["e1"], variantSel: {} },
      { context: makeCtx({ orgId: "org-cap" }) },
    );

    const payload = persistedPayload();
    expect(payload["kind"]).toBe("video");
    // 3 张全部在 9 张名额之内 ⇒ 没有截断,不许编一句提醒。
    expect(payload["downgraded"]).toBe(false);
    expect(payload["specChips"] as string[]).toContain("Uses 3 of your reference photos");
  });

  // 判官 r2 P1-b —— 商家指定了「红色那一款」时,卡面数的是**那个变体**的照片,而付费请求
  // 也带着同一个变体走(`GenJob.variantSel`,由 startGen 落库、worker 按它取图)。卡上这个
  // 数字与引擎实收的那一组照片必须同源,否则商家为一个他没选的形态付了钱。
  it("#785: a text-to-video card counts the picked variant's photos, and carries that pick to the paid request", async () => {
    mockPrisma.entity.findMany.mockResolvedValue([{ id: "e1" }]);
    mockPrisma.referenceImage.count.mockResolvedValue(2);

    await executePropose(
      { kind: "video", structuredPrompt: "our lipstick on a beach", entityIds: ["e1"], variantSel: { e1: "var_red" } },
      { context: makeCtx({ orgId: "org-cap" }) },
    );

    // 数的是变体那一组,不是 base(worker 查的是同一个 `variantId`)。
    expect(mockPrisma.referenceImage.count).toHaveBeenCalledWith({
      where: { entityId: "e1", variantId: "var_red", ownerId: "org-cap", deletedAt: null },
    });
    const payload = persistedPayload();
    expect(payload["specChips"] as string[]).toContain("Uses 2 of your reference photos");
    // 这张卡按下去时带走的就是这个变体 —— 卡面与付费输入同源。
    expect(payload["variantSel"]).toEqual({ e1: "var_red" });
  });

  // 名额压线:9 个 image_url 部件,纯文生视频没有帧占位 ⇒ 元素照上限就是 9。
  it("#785: a text-to-video card truncates element photos at the engine's image ceiling", async () => {
    mockPrisma.entity.findMany.mockResolvedValue([{ id: "e1" }]);
    mockPrisma.referenceImage.count.mockResolvedValue(12);

    await executePropose(
      { kind: "video", structuredPrompt: "everything we sell", entityIds: ["e1"], variantSel: {} },
      { context: makeCtx({ orgId: "org-cap" }) },
    );

    const payload = persistedPayload();
    expect(payload["downgraded"]).toBe(true);
    expect(payload["downgradeNote"]).toContain("This run will use 9 of your 12 reference photos.");
    expect(payload["specChips"] as string[]).toContain("Uses 9 of your reference photos");
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

  it("video: specChips carry shape, length, quality and sound — and no engine name", () => {
    const { cardPayload } = buildProposeCard(
      { kind: "video", structuredPrompt: "a 5s clip", entityIds: [], variantSel: {} },
      makeCtx(),
      [],
    );
    // #646 T5：声音接通执行层后多出这一格,措辞仍然不带引擎名。
    expect(cardPayload.specChips).toEqual(["16:9", "5s", "720p", "With sound"]);
    expect(cardPayload.specChips.join(" ")).not.toMatch(ENGINE_WORDS);
  });

  it("image: specChips report the size execution really produces, plus how many", () => {
    // #643 T2：卡上现在总带着一个形状（没提就是默认方图），所以形状也在卡面上说出口 ——
    // 商家在付费前看见的就是他会拿到的那一格。
    const one = buildProposeCard(
      { kind: "image", structuredPrompt: "a poster", entityIds: [], variantSel: {} },
      makeCtx(),
      [],
    ).cardPayload;
    expect(one.specChips).toEqual(["2048 × 2048", "1:1", "1 image"]);

    const pack = buildProposeCard(
      { kind: "image", structuredPrompt: "a poster", entityIds: [], variantSel: {}, count: 3 },
      makeCtx(),
      [],
    ).cardPayload;
    expect(pack.specChips).toEqual(["2048 × 2048", "1:1", "3 images"]);
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
    // #645 T4：7s / 1:1 现在都真给得了，所以要触发披露必须用引擎真做不到的值（30s / 2:3）。
    const { cardPayload } = buildProposeCard(
      { kind: "video", structuredPrompt: "a clip", entityIds: [], variantSel: {}, desiredDuration: 30, desiredAspect: "2:3" },
      makeCtx(),
      [],
    );
    expect(cardPayload.specChips.join(" ")).not.toMatch(ENGINE_WORDS);
    expect(cardPayload.downgradeNote).toBeDefined();
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

  it("图片(#643 T2)：商家要的画幅真的落到卡上、也真的进了付费请求体", () => {
    // T1 之后执行层已经认画幅（EXECUTED_SPEC.image.aspectHonoured=true）；T2 把 Otto 这条路
    // 上「选型那一步丢掉 desiredAspect」的断点接上。卡面的判据仍然是「这张卡真会交付什么」。
    const { cardPayload } = buildProposeCard(
      { kind: "image", structuredPrompt: "a poster", entityIds: [], variantSel: {}, desiredAspect: "9:16" },
      makeCtx(),
      [],
    );
    // 「做的」：付费请求体里逐字带着这个形状。
    const req = genRequestFor(cardPayload);
    expect(req.aspectRatio).toBe("9:16");
    expect(cardPayload.params.aspectRatio).toBe("9:16");
    // 「说的」：卡面报的是这一格真会产出的尺寸，并把形状说出口 —— 不再是写死的方图。
    expect(cardPayload.specChips).toContain("9:16");
    expect(cardPayload.specChips).toContain("1620 × 2880");
    // 兑现了就不是降级，不许无中生有地报警。
    expect(cardPayload.downgraded).toBe(false);
    expect(cardPayload.downgradeNote).toBeUndefined();
  });

  it("图片：商家要的画幅满足不了 —— 必须在付费前显式说出来(执行层翻真也不许把这句话弄丢)", () => {
    expect(EXECUTED_SPEC.image.aspectHonoured).toBe(true);
    // 5:7 不在引擎菜单上（八格之外），所以这一趟真会交付的是默认方图 —— 这句必须说出口。
    const { cardPayload } = buildProposeCard(
      { kind: "image", structuredPrompt: "a poster", entityIds: [], variantSel: {}, desiredAspect: "5:7" },
      makeCtx(),
      [],
    );
    expect(cardPayload.params.aspectRatio).toBe("1:1");
    expect(cardPayload.downgraded).toBe(true);
    expect(cardPayload.downgradeNote).toBe(
      "You asked for 5:7 — this will be a square 2048 × 2048 image.",
    );
  });

  it("图片(#643 T2)：商家的人话形状也一路落地(portrait ⇒ 9:16，卡面与请求体同口径)", () => {
    const { cardPayload } = buildProposeCard(
      { kind: "image", structuredPrompt: "a poster", entityIds: [], variantSel: {}, desiredAspect: "portrait" },
      makeCtx(),
      [],
    );
    expect(cardPayload.params.aspectRatio).toBe("9:16");
    expect(genRequestFor(cardPayload).aspectRatio).toBe("9:16");
    expect(cardPayload.specChips).toContain("9:16");
    expect(cardPayload.downgraded).toBe(false);
  });

  it("图片(#643 T2)：八格全通 —— 每一格都是卡面声称 = 请求体携带 = 那一格的确切尺寸", () => {
    for (const aspect of GEN_IMAGE_MODEL_OPTIONS.seedream.aspectRatios) {
      const { cardPayload } = buildProposeCard(
        { kind: "image", structuredPrompt: "a poster", entityIds: [], variantSel: {}, desiredAspect: aspect },
        makeCtx(),
        [],
      );
      const size = EXECUTED_SPEC.image.outputSizes[aspect as keyof typeof EXECUTED_SPEC.image.outputSizes];
      expect(cardPayload.params.aspectRatio, aspect).toBe(aspect);
      expect(genRequestFor(cardPayload).aspectRatio, aspect).toBe(aspect);
      expect(cardPayload.specChips, aspect).toEqual([`${size.width} × ${size.height}`, aspect, "1 image"]);
      expect(cardPayload.downgraded, aspect).toBe(false);
    }
  });

  // ── 正向锁(判官 r1 P2):披露**永不越过**接线事实 ──────────────────────────
  //
  // 反向(「没接通就不许承诺」)上面两条已经锁住。这一条锁正向:凡卡面声称兑现的,
  // 付费请求体里必须真有;凡请求体不带规格的,卡面必须不声称。两条一起构成双条件,
  // 于是 T2 把画幅接进 Otto 那天,这里会**自动**开始要求卡面说新话 —— 谁也不能只改
  // 一半(只改文案不接线,或只接线不改文案)。
  it("正向锁:穿过 card→request 全链 —— 卡面声称 ⟺ 请求体真带规格", () => {
    const ratioChip = (chips: string[]) => chips.find((chip) => /^\d+\s*:\s*\d+$/.test(chip)) ?? null;

    for (const desiredAspect of [undefined, "9:16", "4:3", "1:1"]) {
      const { cardPayload } = buildProposeCard(
        { kind: "image", structuredPrompt: "a poster", entityIds: [], variantSel: {}, desiredAspect },
        makeCtx(),
        [],
      );
      const req = genRequestFor(cardPayload);
      const claimed = ratioChip(cardPayload.specChips);
      const carried = typeof req.aspectRatio === "string" ? req.aspectRatio : null;

      // ① 声称了就必须真带,且逐字相同(不许卡面说 9:16、请求体发 1:1)。
      if (claimed !== null) {
        expect(carried, `卡面声称 ${claimed},请求体必须真带这个规格`).toBe(claimed);
      }
      // ② 请求体不带规格 ⇒ 卡面一个比例都不许出现。
      if (carried === null) {
        expect(claimed, "请求体没带规格,卡面就不许声称任何比例").toBeNull();
      }
      // ③ 商家提了、而这一趟交付不了 ⇒ 必须在付费前显式披露,绝不静默。
      if (desiredAspect && carried !== desiredAspect) {
        expect(cardPayload.downgraded, `${desiredAspect} 没兑现就必须披露`).toBe(true);
        expect(cardPayload.downgradeNote).toBeTruthy();
      }
    }
  });

  it("正向锁:现役适配器(发确切 WxH)下,卡面照实承诺", () => {
    const prev = process.env.GENERATION_PROVIDER;
    process.env.GENERATION_PROVIDER = "byteplus";
    try {
      expect(imageAspectHonoured()).toBe(true);
      expect(buildSpecChips("image", { aspectRatio: "9:16", count: 1 }, false))
        .toEqual(["1620 × 2880", "9:16", "1 image"]);
    } finally {
      if (prev === undefined) delete process.env.GENERATION_PROVIDER;
      else process.env.GENERATION_PROVIDER = prev;
    }
  });

  it("图片：一旦卡上真的带了商家要的画幅，卡面就照实承诺它，也不再报降级", () => {
    // T2 把 desiredAspect 接上之后走的就是这条路。这里直接喂一张带画幅的卡,
    // 证明文案层已经准备好说真话 —— 尺寸随画幅走,不再是写死的方图。
    expect(buildSpecChips("image", { aspectRatio: "9:16", count: 1 }, false))
      .toEqual(["1620 × 2880", "9:16", "1 image"]);
    expect(buildSpecChips("image", { aspectRatio: "21:9", count: 2 }, false))
      .toEqual(["3136 × 1344", "21:9", "2 images"]);
    // 卡面报的尺寸与适配器真发出去的 size 是同一份表。
    expect(buildSpecChips("image", { aspectRatio: "4:3", count: 1 }, false)[0])
      .toBe(`${EXECUTED_SPEC.image.outputSizes["4:3"].width} × ${EXECUTED_SPEC.image.outputSizes["4:3"].height}`);
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

  it("#646 T5 视频：声音开关接通执行层后，卡面照实说 With sound / No sound，也不再报降级", () => {
    expect(EXECUTED_SPEC.video.audioHonoured).toBe(true);
    const muted = buildProposeCard(
      { kind: "video", structuredPrompt: "a clip", entityIds: [], variantSel: {}, desiredAudio: false },
      makeCtx(),
      [],
    ).cardPayload;
    expect(muted.params.audio).toBe(false);
    expect(muted.specChips).toContain("No sound");
    // 商家要静音、执行层真会静音 —— 这不是降级,不许再报警。
    expect(muted.downgraded).toBe(false);
    expect(muted.downgradeNote).toBeUndefined();

    const loud = buildProposeCard(
      { kind: "video", structuredPrompt: "a clip", entityIds: [], variantSel: {}, desiredAudio: true },
      makeCtx(),
      [],
    ).cardPayload;
    expect(loud.specChips).toContain("With sound");
    expect(loud.downgraded).toBe(false);
  });

  it("视频：时长/画幅/清晰度/声音是真的会传到执行层的，所以卡面照旧承诺", () => {
    const { cardPayload } = buildProposeCard(
      { kind: "video", structuredPrompt: "a clip", entityIds: [], variantSel: {} },
      makeCtx(),
      [],
    );
    const req = genRequestFor(cardPayload);
    expect(req.aspectRatio).toBe(cardPayload.params.aspectRatio);
    expect(req.durationSeconds).toBe(cardPayload.params.durationSeconds);
    expect(req.resolution).toBe(cardPayload.params.resolution);
    expect(req.audio).toBe(cardPayload.params.audio);
    expect(cardPayload.specChips).toEqual([
      cardPayload.params.aspectRatio,
      `${cardPayload.params.durationSeconds}s`,
      cardPayload.params.resolution,
      cardPayload.params.audio ? "With sound" : "No sound",
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
    // #645 T4：7 秒现在是真给得了的一档，所以夹具换成引擎上限之外的 30 秒。
    const { cardPayload } = buildProposeCard(
      { kind: "video", structuredPrompt: "a 30s clip", entityIds: [], variantSel: {}, desiredDuration: 30 },
      makeCtx(),
      [],
    );
    expect(cardPayload.downgraded).toBe(true);
    expect(cardPayload.downgradeNote).toBe("You asked for 30s — this will be 5s.");
  });

  it("a shape we can't do is stated too", () => {
    // #645 T4：1:1 现在是菜单上的一格，所以夹具换成引擎给不了的 2:3。
    const { cardPayload } = buildProposeCard(
      { kind: "video", structuredPrompt: "a 2:3 clip", entityIds: [], variantSel: {}, desiredAspect: "2:3" },
      makeCtx(),
      [],
    );
    expect(cardPayload.downgraded).toBe(true);
    expect(cardPayload.downgradeNote).toBe("You asked for 2:3 — this will be 16:9.");
  });

  it("both at once read as one sentence", () => {
    const { cardPayload } = buildProposeCard(
      { kind: "video", structuredPrompt: "a 2:3 30s clip", entityIds: [], variantSel: {}, desiredDuration: 30, desiredAspect: "2:3" },
      makeCtx(),
      [],
    );
    expect(cardPayload.downgradeNote).toBe("You asked for 30s and 2:3 — this will be 5s and 16:9.");
  });

  it("#645 T4：7 秒 / 1:1 现在是真给得了的档 —— 一句降级都不该出现", () => {
    const { cardPayload } = buildProposeCard(
      { kind: "video", structuredPrompt: "a square 7s clip", entityIds: [], variantSel: {}, desiredDuration: 7, desiredAspect: "1:1" },
      makeCtx(),
      [],
    );
    expect(cardPayload.downgraded).toBe(false);
    expect(cardPayload.downgradeNote).toBeUndefined();
    expect(cardPayload.params.durationSeconds).toBe(7);
    expect(cardPayload.params.aspectRatio).toBe("1:1");
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

// ---------------------------------------------------------------------------
// #647 T6 —— 引擎被关掉时的诚实空态
//
// 在这之前:后台关掉唯一那台视频引擎,Otto 仍然铸出一张写着价钱、点得下去的 GEN_CARD;
// 商家点「确认」,spend 闸才把他打回来。卡是 $0 铸的,可它在商家眼里是一个承诺。
// 现在:铸不出来就说铸不出来 —— 一行英文人话,一张卡都不落库。
// ---------------------------------------------------------------------------
describe("#647 T6 唯一引擎被关掉 ⇒ 诚实空态,绝不落一张付费卡", () => {
  let mockPrisma: {
    entity: { findMany: ReturnType<typeof vi.fn> };
    chatMessage: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
    referenceImage: { count: ReturnType<typeof vi.fn> };
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import("@fikirtive/db");
    mockPrisma = db.prisma as unknown as typeof mockPrisma;
    (mockPrisma.entity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (mockPrisma.chatMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ seq: 5 });
    (mockPrisma.chatMessage.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (mockPrisma.referenceImage.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
  });

  it("纯层:视频引擎全被关 ⇒ buildProposeCard 抛 GenerationUnavailableError(造不出卡就不造)", async () => {
    const { GenerationUnavailableError } = await import("./propose.helpers.js");
    const { GEN_VIDEO_MODELS } = await import("@fikirtive/core");
    const ctx = makeCtx({ disabledModels: [...GEN_VIDEO_MODELS] });
    expect(() =>
      buildProposeCard({ kind: "video", structuredPrompt: "a cat walks", entityIds: [], variantSel: {} }, ctx, []),
    ).toThrow(GenerationUnavailableError);
  });

  it("纯层:图片引擎被关 ⇒ 同样抛(同一个 disabled,同一条规矩)", async () => {
    const { GenerationUnavailableError } = await import("./propose.helpers.js");
    const ctx = makeCtx({ disabledModels: ["seedream"] });
    expect(() =>
      buildProposeCard({ kind: "image", structuredPrompt: "a cat", entityIds: [], variantSel: {} }, ctx, []),
    ).toThrow(GenerationUnavailableError);
  });

  it("入口:executePropose 返回一句英文人话,并且**一张 GEN_CARD 都没落库**", async () => {
    const { GEN_VIDEO_MODELS } = await import("@fikirtive/core");
    const ctx = makeCtx({ disabledModels: [...GEN_VIDEO_MODELS] });
    const result = await executePropose(
      { kind: "video", structuredPrompt: "a cat walks", entityIds: [], variantSel: {} },
      { context: ctx },
    );
    expect(result).toEqual({ error: "Video generation is turned off right now." });
    expect(mockPrisma.chatMessage.create).not.toHaveBeenCalled();
  });

  it("入口:图片侧同样,措辞是 English sentence case,不出现引擎名", async () => {
    const ctx = makeCtx({ disabledModels: ["seedream"] });
    const result = await executePropose(
      { kind: "image", structuredPrompt: "a cat", entityIds: [], variantSel: {} },
      { context: ctx },
    );
    expect(result).toEqual({ error: "Image generation is turned off right now." });
    expect(mockPrisma.chatMessage.create).not.toHaveBeenCalled();
    // 引擎保密:空态文案里不许出现任何供应商/模型名
    expect(JSON.stringify(result)).not.toMatch(/seedream|seedance|byteplus|fal|kling|veo/iu);
  });

  it("入口:proposePack 整包一起空 —— 不许先落几张再半路报错", async () => {
    const { executeProposePack } = await import("./propose-pack.js");
    const { GEN_VIDEO_MODELS } = await import("@fikirtive/core");
    const ctx = makeCtx({ disabledModels: [...GEN_VIDEO_MODELS] });
    const result = await executeProposePack(
      {
        packTitle: "Launch pack",
        items: [
          { kind: "video", structuredPrompt: "a cat walks", entityIds: [], variantSel: {} },
          { kind: "video", structuredPrompt: "a dog runs", entityIds: [], variantSel: {} },
        ],
      },
      { context: ctx },
    );
    expect(result).toEqual({ error: "Video generation is turned off right now." });
    expect(mockPrisma.chatMessage.create).not.toHaveBeenCalled();
  });

  it("只关掉一台不影响另一台:视频关了,图片卡照铸", async () => {
    const { GEN_VIDEO_MODELS } = await import("@fikirtive/core");
    const ctx = makeCtx({ disabledModels: [...GEN_VIDEO_MODELS] });
    const result = await executePropose(
      { kind: "image", structuredPrompt: "a cat", entityIds: [], variantSel: {} },
      { context: ctx },
    );
    expect(result).toHaveProperty("cardId");
    expect(mockPrisma.chatMessage.create).toHaveBeenCalledTimes(1);
  });
});

describe("#777 卡面:一组连贯的图 vs 几张散图", () => {
  it("现役路 + 真成组 ⇒ 卡面照实说「一组」", () => {
    const prev = process.env.GENERATION_PROVIDER;
    process.env.GENERATION_PROVIDER = "byteplus";
    try {
      expect(buildSpecChips("image", { aspectRatio: "9:16", count: 4, coherentSet: true }, false))
        .toEqual(["1620 × 2880", "9:16", "4 images in one set"]);
    } finally {
      if (prev === undefined) delete process.env.GENERATION_PROVIDER;
      else process.env.GENERATION_PROVIDER = prev;
    }
  });

  it("散图照旧说「N 张」—— 这一格没有改变既有卡面的任何一个字", () => {
    expect(buildSpecChips("image", { aspectRatio: "9:16", count: 4 }, false))
      .toEqual(["1620 × 2880", "9:16", "4 images"]);
    expect(buildSpecChips("image", { aspectRatio: "9:16", count: 4, coherentSet: false }, false))
      .toEqual(["1620 × 2880", "9:16", "4 images"]);
    // 一张图不成组:即便调用方硬塞 true,卡面也不许说「一组」。
    expect(buildSpecChips("image", { aspectRatio: "9:16", count: 1, coherentSet: true }, false))
      .toEqual(["1620 × 2880", "9:16", "1 image"]);
  });

});

// ---------------------------------------------------------------------------
// Creation §5 2026-09-04(Founder 裁决「Otto 改档＝要，现在做」)
//
// 走查 P1-2 的另一半:`propose` 以前没有画质这个字段,所以「帮我改成 1080p」在提案层
// 就断了 —— 卡上照旧默认档,而 Otto 嘴上说改好了。这一组钉的是那条链的每一段:
// 商家点名 → 卡上带这一档 → 卡按这一档报价(取自单一价目源)→ 批准送出去的请求带同一档;
// 未定价/给不了的档 ⇒ 一张卡都不铸(拒绝、$0),绝不静默换一档。
// ---------------------------------------------------------------------------
describe("CREATE-A4 商家在对话里点名画质档", () => {
  const videoInput = {
    kind: "video" as const,
    structuredPrompt: "A slow push-in on the pandan kaya jar on a marble counter",
    entityIds: [] as string[],
    variantSel: {} as Record<string, string>,
  };

  /** 卡面价的期望值**自己算**(单一价目源),绝不手抄一个数字 —— 手抄的那一份改价时不会跟着变。 */
  function expectedCredits(model: string, resolution: string, seconds: number, audio: boolean): number {
    return displayCredits(
      pricedGenCredits({
        kind: "VIDEO",
        model,
        count: 1,
        referenceVideoGenerationId: null,
        videoOptions: { seconds, resolution, audio },
      }),
    );
  }

  it("CREATE-A4 商家说 1080p ⇒ 卡落高清档,params.resolution 就是 1080p", () => {
    const { cardPayload } = buildProposeCard(
      { ...videoInput, desiredResolution: HD_VIDEO_RESOLUTION },
      makeCtx(),
      [],
    );
    expect(cardPayload.params.resolution).toBe(HD_VIDEO_RESOLUTION);
    expect(cardPayload.model).toBe(routeVideoModel(HD_VIDEO_RESOLUTION).model);
    expect(cardPayload.downgraded).toBe(false);
  });

  it("CREATE-A4 商家说 480p ⇒ 卡落 480p,而且比 1080p 便宜(按档计价,不是同一个数)", () => {
    const cheap = buildProposeCard({ ...videoInput, desiredResolution: "480p" }, makeCtx(), []);
    const hd = buildProposeCard({ ...videoInput, desiredResolution: HD_VIDEO_RESOLUTION }, makeCtx(), []);
    expect(cheap.cardPayload.params.resolution).toBe("480p");
    expect(hd.cardPayload.params.resolution).toBe(HD_VIDEO_RESOLUTION);
    expect(cheap.cardPayload.estimatedCredits).toBeLessThan(hd.cardPayload.estimatedCredits);
  });

  it("CREATE-A4 每一个可售档:卡上的报价 == 单一价目源按**这一档**算出来的数", () => {
    for (const [slot, tiers] of Object.entries(SELLABLE_VIDEO_RESOLUTIONS)) {
      for (const tier of tiers) {
        const { cardPayload, shownPriceDisplay } = buildProposeCard(
          { ...videoInput, desiredResolution: tier },
          makeCtx(),
          [],
        );
        expect(cardPayload.model, tier).toBe(slot);
        expect(cardPayload.params.resolution, tier).toBe(tier);
        const want = expectedCredits(slot, tier, cardPayload.params.durationSeconds ?? 0, !!cardPayload.params.audio);
        expect(cardPayload.estimatedCredits, tier).toBe(want);
        // Otto 在对话里能说的那个数,与卡面是同一个 —— 两处报价不许分家。
        expect(shownPriceDisplay, tier).toBe(want);
      }
    }
  });

  it("CREATE-A1 确认卡的规格行**逐字**带着这一档(商家花钱前看得见)", () => {
    const { cardPayload } = buildProposeCard(
      { ...videoInput, desiredResolution: HD_VIDEO_RESOLUTION },
      makeCtx(),
      [],
    );
    // 确认位渲染的就是这个数组(OttoTurnCard 只 join,不二次推导)。
    expect(cardPayload.specChips).toContain(HD_VIDEO_RESOLUTION);
    expect(cardPayload.specChips.join(" · ")).not.toContain(cardPayload.model);
  });

  it("CREATE-A4 批准送出去的付费请求带的是**卡上那一档**(卡 → 请求同源)", () => {
    const { cardPayload } = buildProposeCard(
      { ...videoInput, desiredResolution: HD_VIDEO_RESOLUTION },
      makeCtx(),
      [],
    );
    const built = buildGenRequestFromCard({
      cardPayload,
      projectId: "proj-test",
      threadId: "thread-test",
      cardId: "card-hd",
      entityIds: [],
      variantSel: {},
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.req.resolution).toBe(HD_VIDEO_RESOLUTION);
    expect(built.req.model).toBe(cardPayload.model);
    expect(built.req.idempotencyKey).toBe("cowork:card-hd");
  });

  it("CREATE-A4 未定价的档(4k)⇒ 一张卡都不铸,拒绝而**不是**降级", () => {
    expect(() =>
      buildProposeCard({ ...videoInput, desiredResolution: "4k" }, makeCtx(), []),
    ).toThrow(VideoTierUnavailableError);
    // 拒绝的那句话里有他点的那一档、有能给的那几档,一个引擎名都没有。
    try {
      buildProposeCard({ ...videoInput, desiredResolution: "4k" }, makeCtx(), []);
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain("4k");
      expect(message.toLowerCase()).not.toContain("seedance");
      expect(redactProviderNames(message)).toBe(message);
    }
  });

  it("CREATE-A4 看不懂的档(8k / 空串 / 大小写不同)一律拒绝,绝不猜一个档去花钱", () => {
    for (const junk of ["8k", "1080P", "hd", "1080"]) {
      expect(() =>
        buildProposeCard({ ...videoInput, desiredResolution: junk }, makeCtx(), []),
      ).toThrow(VideoTierUnavailableError);
    }
  });

  it("CREATE-A4 拒绝走的是 ProposeRefusal 家族 —— 入口接得住,GEN_CARD 一行都不落库", () => {
    try {
      buildProposeCard({ ...videoInput, desiredResolution: "4k" }, makeCtx(), []);
      expect.unreachable("应该抛");
    } catch (e) {
      expect(e).toBeInstanceOf(ProposeRefusal);
    }
  });

  it("CREATE-A4 没点名画质 ⇒ 一格不动(默认档、默认价,旧行为逐字保留)", () => {
    const { cardPayload } = buildProposeCard(videoInput, makeCtx(), []);
    expect(cardPayload.params.resolution).toBe(videoDefaults(activeVideoModel() as GenVideoModel).resolution);
    expect(cardPayload.model).toBe(activeVideoModel());
    expect(cardPayload.downgraded).toBe(false);
  });

  it("CREATE-A4 追加改档:第二张卡带新档新价,老卡还是老档老价、老幂等键", () => {
    const first = buildProposeCard({ ...videoInput, desiredResolution: "720p" }, makeCtx(), []);
    const second = buildProposeCard({ ...videoInput, desiredResolution: HD_VIDEO_RESOLUTION }, makeCtx(), []);

    // 两张卡是两份不同的承诺 —— 档位与价格都不同。
    expect(first.cardPayload.params.resolution).toBe("720p");
    expect(second.cardPayload.params.resolution).toBe(HD_VIDEO_RESOLUTION);
    expect(second.cardPayload.estimatedCredits).not.toBe(first.cardPayload.estimatedCredits);

    // 身份跟着卡走:新卡 = 新 cardId = 新幂等键,所以改档不可能复用旧卡那一次授权。
    const oldReq = buildGenRequestFromCard({
      cardPayload: first.cardPayload, projectId: "proj-test", threadId: "thread-test",
      cardId: "card-720", entityIds: [], variantSel: {},
    });
    const newReq = buildGenRequestFromCard({
      cardPayload: second.cardPayload, projectId: "proj-test", threadId: "thread-test",
      cardId: "card-1080", entityIds: [], variantSel: {},
    });
    expect(oldReq.ok && newReq.ok).toBe(true);
    if (!oldReq.ok || !newReq.ok) return;
    expect(newReq.req.idempotencyKey).not.toBe(oldReq.req.idempotencyKey);
    // 老卡照旧只能被批成**它自己**那一档:它带不出新规格。
    expect(oldReq.req.resolution).toBe("720p");
    expect(newReq.req.resolution).toBe(HD_VIDEO_RESOLUTION);
  });

  it("CREATE-A4 高清槽位被后台关掉 ⇒ 说的是「这一档拿不到」,不是「视频全关」", () => {
    const ctx = makeCtx({ disabledModels: [routeVideoModel(HD_VIDEO_RESOLUTION).model] });
    expect(() =>
      buildProposeCard({ ...videoInput, desiredResolution: HD_VIDEO_RESOLUTION }, ctx, []),
    ).toThrow(VideoTierUnavailableError);
    // 默认档那条路照旧铸得出卡 —— 关掉的是一档,不是整类创作。
    expect(buildProposeCard(videoInput, ctx, []).cardPayload.model).toBe(activeVideoModel());
  });
});
