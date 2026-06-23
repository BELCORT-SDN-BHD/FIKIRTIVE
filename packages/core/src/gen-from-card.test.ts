import { describe, expect, it } from "vitest";
import { buildGenRequestFromCard } from "./gen-from-card.js";

// A minimal valid coworkProposalSchema payload for an IMAGE card.
function imageCardPayload(overrides?: Record<string, unknown>) {
  return {
    kind: "image",
    structuredPrompt: "a bright sunny day",
    model: "seedream",
    params: { count: 2 },
    ...overrides,
  };
}

// A minimal valid coworkProposalSchema payload for a VIDEO card.
function videoCardPayload(overrides?: Record<string, unknown>) {
  return {
    kind: "video",
    structuredPrompt: "a bright sunny day",
    model: "kling",
    params: { durationSeconds: 5, resolution: null, aspectRatio: null, audio: null },
    ...overrides,
  };
}

const BASE_ARGS = {
  projectId: "proj_123",
  threadId: "thr_456",
  cardId: "card_789",
  prompt: "final composed prompt",
  entityIds: ["ent_1"],
  variantSel: {},
};

describe("buildGenRequestFromCard — image card, no overrides", () => {
  it("returns kind image, model from card, count from card, no video params", () => {
    const result = buildGenRequestFromCard({
      ...BASE_ARGS,
      cardPayload: imageCardPayload(),
      variantSel: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const req = result.req;
    expect(req.kind).toBe("image");
    expect(req.model).toBe("seedream");
    expect(req.count).toBe(2);
    expect(req.idempotencyKey).toBe("cowork:card_789");
    expect(req).not.toHaveProperty("durationSeconds");
    expect(req).not.toHaveProperty("resolution");
    expect(req).not.toHaveProperty("aspectRatio");
    expect(req).not.toHaveProperty("audio");
  });

  it("uses count=1 when params.count is absent", () => {
    const result = buildGenRequestFromCard({
      ...BASE_ARGS,
      cardPayload: imageCardPayload({ params: {} }),
      variantSel: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.req.count).toBe(1);
  });

  it("omits variantSel when it is empty", () => {
    const result = buildGenRequestFromCard({
      ...BASE_ARGS,
      cardPayload: imageCardPayload(),
      variantSel: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.req).not.toHaveProperty("variantSel");
  });

  it("includes variantSel when non-empty", () => {
    const result = buildGenRequestFromCard({
      ...BASE_ARGS,
      cardPayload: imageCardPayload(),
      variantSel: { ent_1: "var_a" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.req.variantSel).toEqual({ ent_1: "var_a" });
  });
});

describe("buildGenRequestFromCard — video card", () => {
  it("forces count=1 for video", () => {
    const result = buildGenRequestFromCard({
      ...BASE_ARGS,
      cardPayload: videoCardPayload({ params: { count: 3 } }),
      variantSel: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.req.count).toBe(1);
  });

  it("includes video params from card", () => {
    const result = buildGenRequestFromCard({
      ...BASE_ARGS,
      cardPayload: videoCardPayload({
        params: { durationSeconds: 10, resolution: "720p", aspectRatio: "16:9", audio: null },
      }),
      variantSel: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.req.durationSeconds).toBe(10);
    expect(result.req.resolution).toBe("720p");
    expect(result.req.aspectRatio).toBe("16:9");
  });

  it("includes audio field only for audio-toggle models (kling-2.6 has audioToggle:true)", () => {
    const result = buildGenRequestFromCard({
      ...BASE_ARGS,
      cardPayload: videoCardPayload({ model: "kling-2.6", params: { audio: true } }),
      variantSel: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.req).toHaveProperty("audio");
  });

  it("omits audio field for always-silent models (kling audioToggle:false)", () => {
    const result = buildGenRequestFromCard({
      ...BASE_ARGS,
      cardPayload: videoCardPayload({ model: "kling", params: { audio: null } }),
      variantSel: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.req).not.toHaveProperty("audio");
  });

  it("omits audio field for non-video-menu models (audio check skipped)", () => {
    // If someone persisted a card with a non-video model, audioToggle is false.
    // (startGen will reject the model mismatch anyway — builder stays pure.)
    const result = buildGenRequestFromCard({
      ...BASE_ARGS,
      cardPayload: videoCardPayload({ model: "not-a-real-model", params: {} }),
      variantSel: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.req).not.toHaveProperty("audio");
  });
});

describe("buildGenRequestFromCard — overrides applied (web path)", () => {
  it("overrides.model wins over card model", () => {
    // Use a video card (multiple video models exist) so override precedence is genuinely
    // exercised — GEN_MODELS has a single image model ("seedream"), which can't show it.
    const result = buildGenRequestFromCard({
      ...BASE_ARGS,
      cardPayload: videoCardPayload({ model: "kling" }),
      variantSel: {},
      overrides: { model: "veo3.1" }, // differs from the card → override must win
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.req.model).toBe("veo3.1");
  });

  it("overrides.count wins for image card", () => {
    const result = buildGenRequestFromCard({
      ...BASE_ARGS,
      cardPayload: imageCardPayload({ params: { count: 1 } }),
      variantSel: {},
      overrides: { count: 3 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.req.count).toBe(3);
  });

  it("overrides.durationSeconds wins for video card", () => {
    const result = buildGenRequestFromCard({
      ...BASE_ARGS,
      cardPayload: videoCardPayload({ model: "kling", params: { durationSeconds: 5 } }),
      variantSel: {},
      overrides: { durationSeconds: 10 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.req.durationSeconds).toBe(10);
  });

  it("overrides.resolution wins for video card", () => {
    const result = buildGenRequestFromCard({
      ...BASE_ARGS,
      cardPayload: videoCardPayload({ model: "kling-2.6", params: { resolution: null } }),
      variantSel: {},
      overrides: { resolution: null },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.req.resolution).toBeNull();
  });
});

describe("buildGenRequestFromCard — anti-flip", () => {
  it("kind always comes from card payload, not overrides (overrides has no kind field)", () => {
    // The function signature itself enforces no kind override — assert kind matches card.
    const result = buildGenRequestFromCard({
      ...BASE_ARGS,
      cardPayload: imageCardPayload(),
      variantSel: {},
      overrides: { model: "seedream" }, // overrides has no kind field — enforced by type
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.req.kind).toBe("image"); // must be card's kind
  });

  it("video card always produces kind=video regardless of any overrides", () => {
    const result = buildGenRequestFromCard({
      ...BASE_ARGS,
      cardPayload: videoCardPayload(),
      variantSel: {},
      overrides: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.req.kind).toBe("video");
  });
});

describe("buildGenRequestFromCard — error cases", () => {
  it("returns error for invalid card payload", () => {
    const result = buildGenRequestFromCard({
      ...BASE_ARGS,
      cardPayload: { kind: "invalid" },
      variantSel: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("This card is no longer valid.");
  });

  it("returns error for missing structuredPrompt (required by coworkProposalSchema)", () => {
    const result = buildGenRequestFromCard({
      ...BASE_ARGS,
      cardPayload: { kind: "image" }, // missing structuredPrompt
      variantSel: {},
    });
    expect(result.ok).toBe(false);
  });

  it("returns error for missing model", () => {
    const result = buildGenRequestFromCard({
      ...BASE_ARGS,
      cardPayload: imageCardPayload({ model: undefined }),
      variantSel: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("This card is missing a model.");
  });

  it("returns error when model is not a string (null)", () => {
    const result = buildGenRequestFromCard({
      ...BASE_ARGS,
      cardPayload: imageCardPayload({ model: null }),
      variantSel: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("This card is missing a model.");
  });
});

describe("buildGenRequestFromCard — byte-identical deep-equal test", () => {
  it("produces exact request shape matching what coworkGenerate assembles today", () => {
    // Mirror a real coworkGenerate call:
    // - image card, model=seedream, count=2, sourceGenerationId set
    // - entityIds=["ent_1"], variantSel={"ent_1":"var_a"}
    // - overrides: model=seedream, count=3, no video params
    const cardPayload = {
      kind: "image",
      structuredPrompt: "a sunny day",
      model: "seedream",
      params: { count: 2 },
      sourceGenerationId: "gen_abc",
      entityIds: ["ent_1"],
      variantSel: { ent_1: "var_a" },
    };
    const args = {
      cardPayload,
      projectId: "proj_001",
      threadId: "thr_002",
      cardId: "card_003",
      prompt: "final prompt after composition",
      entityIds: ["ent_1"],
      variantSel: { ent_1: "var_a" },
      overrides: {
        model: "seedream",
        count: 3,
        durationSeconds: undefined as undefined,
        resolution: undefined as undefined,
        aspectRatio: undefined as undefined,
        audio: undefined as undefined,
      },
    };

    const result = buildGenRequestFromCard(args);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // This is the exact object coworkGenerate lines 548-565 would produce
    // for the same inputs (hand-written expected):
    const expected = {
      projectId: "proj_001",
      threadId: "thr_002",
      prompt: "final prompt after composition",
      entityIds: ["ent_1"],
      variantSel: { ent_1: "var_a" },
      sourceGenerationId: "gen_abc",
      count: 3,
      kind: "image",
      model: "seedream",
      idempotencyKey: "cowork:card_003",
    };

    expect(result.req).toStrictEqual(expected);
  });

  it("produces exact request shape for a video card with audio toggle", () => {
    // kling-2.6 has audioToggle: true
    const cardPayload = {
      kind: "video",
      structuredPrompt: "a cinematic shot",
      model: "kling-2.6",
      params: { durationSeconds: 5, resolution: null, aspectRatio: null, audio: true },
      entityIds: [],
      variantSel: {},
    };
    const args = {
      cardPayload,
      projectId: "proj_v",
      threadId: "thr_v",
      cardId: "card_v",
      prompt: "composed video prompt",
      entityIds: [],
      variantSel: {},
      overrides: {},
    };

    const result = buildGenRequestFromCard(args);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const expected = {
      projectId: "proj_v",
      threadId: "thr_v",
      prompt: "composed video prompt",
      entityIds: [],
      count: 1,
      kind: "video",
      model: "kling-2.6",
      durationSeconds: 5,
      resolution: null,
      aspectRatio: null,
      audio: true,
      idempotencyKey: "cowork:card_v",
    };

    expect(result.req).toStrictEqual(expected);
  });
});
