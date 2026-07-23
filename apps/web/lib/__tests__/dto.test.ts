import { describe, it, expect, vi } from "vitest";

// dto.ts is `import "server-only"` and pulls in storage; stub both so we can unit-test the
// pure DTO mapping (toChatMessageDTO) without the server runtime.
vi.mock("server-only", () => ({}));
vi.mock("../storage", () => ({
  storage: { url: () => "https://example.test/asset" },
  kindOf: () => "image",
}));

import { toChatMessageDTO } from "../dto";

describe("toChatMessageDTO — generation provider secrecy", () => {
  it("keeps GEN_CARD grouping fields but strips server-only model selection fields", () => {
    const dto = toChatMessageDTO({
      id: "gen-card-1",
      role: "AGENT",
      kind: "GEN_CARD",
      seq: 1,
      text: "",
      genJobId: null,
      createdAt: new Date("2026-07-24T00:00:00Z"),
      payload: {
        kind: "image",
        structuredPrompt: "A product hero",
        entityIds: [],
        variantSel: {},
        model: "seedream",
        params: { count: 1 },
        reason: "Selected by the generation provider",
        packId: "pack-1",
        packTitle: "Launch pack",
        storyboardCardId: "storyboard-1",
        estimatedCredits: 1,
      },
    } as never, new Map());

    const payload = dto.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      kind: "image",
      packId: "pack-1",
      packTitle: "Launch pack",
      storyboardCardId: "storyboard-1",
      estimatedCredits: 1,
    });
    expect(payload).not.toHaveProperty("model");
    expect(payload).not.toHaveProperty("params");
    expect(payload).not.toHaveProperty("reason");
    expect(JSON.stringify(payload)).not.toMatch(/seedance|seedream|byteplus|bytedance|jimeng|即梦|\bfal\b|anthropic|claude/iu);
  });

  it("does not return a GEN_RESULT model field", () => {
    const dto = toChatMessageDTO({
      id: "gen-result-1",
      role: "AGENT",
      kind: "GEN_RESULT",
      seq: 2,
      text: "",
      genJobId: "job-1",
      createdAt: new Date("2026-07-24T00:00:00Z"),
      payload: { kind: "image", model: "seedream", costCredits: 1 },
    } as never, new Map());

    expect(dto.payload).not.toHaveProperty("model");
    expect(JSON.stringify(dto.payload)).not.toContain("seedream");
  });
});

// ── FIX G: the ACTION_CARD client DTO must NOT leak approval internals ──
describe("toChatMessageDTO — ACTION_CARD client safety", () => {
  function actionCardMessage(payloadExtra: Record<string, unknown> = {}) {
    return {
      id: "m1",
      role: "AGENT",
      kind: "ACTION_CARD",
      seq: 1,
      text: "",
      genJobId: null,
      createdAt: new Date("2026-06-28T00:00:00Z"),
      payload: {
        planTitle: "Pause underperformers",
        steps: [{ index: 0, op: "pause", targetId: "s1", targetName: "Set 1", currentValue: {}, targetValue: {}, moneyClass: "safe" }],
        totalSpendImpactDisplay: "no added spend",
        autoEligible: false,
        approval: {
          paramHash: "deadbeefdeadbeef",
          boundActor: "org-internal-owner-id-123",
          expiresAt: "2026-06-28T00:10:00Z",
          consumedAt: undefined,
        },
        ...payloadExtra,
      },
    } as never;
  }

  it("strips approval.boundActor and approval.paramHash from the client payload", () => {
    const dto = toChatMessageDTO(actionCardMessage(), new Map());
    const p = dto.payload as { approval?: Record<string, unknown> };
    expect(p.approval).toBeDefined();
    expect(p.approval).not.toHaveProperty("boundActor");
    expect(p.approval).not.toHaveProperty("paramHash");
    // the internal owner id must not appear ANYWHERE in the serialized client payload
    expect(JSON.stringify(dto.payload)).not.toContain("org-internal-owner-id-123");
    expect(JSON.stringify(dto.payload)).not.toContain("deadbeefdeadbeef");
  });

  it("keeps the fields the card actually renders (planTitle, steps, spend, expiresAt)", () => {
    const dto = toChatMessageDTO(actionCardMessage(), new Map());
    const p = dto.payload as { planTitle?: string; steps?: unknown[]; totalSpendImpactDisplay?: string; approval?: { expiresAt?: string } };
    expect(p.planTitle).toBe("Pause underperformers");
    expect(p.steps).toHaveLength(1);
    expect(p.totalSpendImpactDisplay).toBe("no added spend");
    expect(p.approval?.expiresAt).toBe("2026-06-28T00:10:00Z");
  });

  it("forwards autoOutcome so the card can render the real auto result", () => {
    const dto = toChatMessageDTO(actionCardMessage({ autoOutcome: { ran: true, state: "done" } }), new Map());
    const p = dto.payload as { autoOutcome?: { ran?: boolean; state?: string } };
    expect(p.autoOutcome).toMatchObject({ ran: true, state: "done" });
  });
});

// ── BUILD_CARD: client payload must NOT leak approval internals ──
describe("toChatMessageDTO — BUILD_CARD client safety", () => {
  function buildCardMessage(payloadExtra: Record<string, unknown> = {}) {
    return {
      id: "m2",
      role: "AGENT",
      kind: "BUILD_CARD",
      seq: 2,
      text: "",
      genJobId: null,
      createdAt: new Date("2026-06-29T00:00:00Z"),
      payload: {
        planTitle: "Build Meta ads",
        buildOutcome: null,
        approval: {
          paramHash: "cafebabecafebabe",
          boundActor: "org-internal-owner-id-456",
          expiresAt: "2026-06-29T00:10:00Z",
          consumedAt: undefined,
        },
        ...payloadExtra,
      },
    } as never;
  }

  it("strips approval.boundActor and approval.paramHash from the client payload", () => {
    const dto = toChatMessageDTO(buildCardMessage(), new Map());
    const p = dto.payload as { approval?: Record<string, unknown> };
    expect(p.approval).toBeDefined();
    expect(p.approval).not.toHaveProperty("boundActor");
    expect(p.approval).not.toHaveProperty("paramHash");
    expect(JSON.stringify(dto.payload)).not.toContain("org-internal-owner-id-456");
    expect(JSON.stringify(dto.payload)).not.toContain("cafebabecafebabe");
  });

  it("keeps display fields and expiresAt", () => {
    const dto = toChatMessageDTO(buildCardMessage(), new Map());
    const p = dto.payload as { planTitle?: string; approval?: { expiresAt?: string }; buildOutcome?: unknown };
    expect(p.planTitle).toBe("Build Meta ads");
    expect(p.approval?.expiresAt).toBe("2026-06-29T00:10:00Z");
    expect(p.buildOutcome).toBeNull();
  });

  it("forwards buildOutcome so the card can render the real build result", () => {
    const dto = toChatMessageDTO(buildCardMessage({ buildOutcome: { state: "done" } }), new Map());
    const p = dto.payload as { buildOutcome?: { state?: string } };
    expect(p.buildOutcome).toMatchObject({ state: "done" });
  });
});

// ── STORYBOARD_CARD: payload must survive the DTO so the card renders (live + reload) ──
describe("toChatMessageDTO — STORYBOARD_CARD payload passthrough", () => {
  function storyboardMessage() {
    return {
      id: "m3",
      role: "AGENT",
      kind: "STORYBOARD_CARD",
      seq: 3,
      text: "",
      genJobId: null,
      createdAt: new Date("2026-07-02T00:00:00Z"),
      payload: {
        storyboardTitle: "Raya ad",
        goal: "festive launch",
        shots: [
          { shotId: "s0", index: 0, firstFramePrompt: "family at the door", videoPrompt: "they wave" },
          { shotId: "s1", index: 1, firstFramePrompt: "close-up cookies", videoPrompt: "steam rises" },
        ],
      },
    } as never;
  }

  it("passes the storyboard payload through (shots survive) instead of nulling it", () => {
    const dto = toChatMessageDTO(storyboardMessage(), new Map());
    const p = dto.payload as { storyboardTitle?: string; shots?: { shotId?: string }[] };
    expect(dto.kind).toBe("STORYBOARD_CARD");
    expect(p.storyboardTitle).toBe("Raya ad");
    expect(p.shots).toHaveLength(2);
    expect(p.shots?.[0].shotId).toBe("s0");
  });
});

// ── PERFORMANCE_CARD (#128): reload/DTO hydration must keep the diagnosis payload ──
describe("toChatMessageDTO — PERFORMANCE_CARD payload passthrough", () => {
  function performanceMessage() {
    return {
      id: "m4",
      role: "AGENT",
      kind: "PERFORMANCE_CARD",
      seq: 4,
      text: "",
      genJobId: null,
      createdAt: new Date("2026-07-03T00:00:00Z"),
      payload: {
        datePreset: "last_30d",
        fetchedAt: "2026-07-03T00:00:00Z",
        truncated: false,
        metricUsed: "purchaseRoas",
        basis: "your own account average",
        note: null,
        verdicts: [
          { adId: "a1", adName: "Winner", verdict: "winner", reasons: [{ kind: "creative", text: "CTR above your average", grounded: true, citations: [] }] },
          { adId: "a2", adName: "Laggard", verdict: "loser", reasons: [{ kind: "creative", text: "CPC above your average", grounded: true, citations: [] }] },
        ],
        ads: [{ adId: "a1", imageUrl: null, isVideo: false }],
      },
    } as never;
  }

  it("passes the diagnosis payload through (verdicts survive) instead of nulling it", () => {
    const dto = toChatMessageDTO(performanceMessage(), new Map());
    const p = dto.payload as { datePreset?: string; metricUsed?: string; verdicts?: { adId?: string; verdict?: string }[] };
    expect(dto.kind).toBe("PERFORMANCE_CARD");
    expect(p.datePreset).toBe("last_30d");
    expect(p.metricUsed).toBe("purchaseRoas");
    expect(p.verdicts).toHaveLength(2);
    expect(p.verdicts?.[0].verdict).toBe("winner");
  });
});

describe("toChatMessageDTO — TURN_ERROR payload passthrough", () => {
  it("keeps the typed stream failure needed to rehydrate its notice", () => {
    const payload = {
      kind: "stream_run_error",
      userMessageId: "user_1",
      error: {
        kind: "insufficient_credits",
        text: "You're out of credits.",
      },
    };
    const dto = toChatMessageDTO({
      id: "error_1",
      role: "AGENT",
      kind: "TURN_ERROR",
      seq: 2,
      text: "You're out of credits.",
      genJobId: null,
      createdAt: new Date("2026-07-23T00:00:00Z"),
      payload,
    } as never, new Map());

    expect(dto.payload).toEqual(payload);
  });

  it("redacts provider names and URLs from a persisted stream error", () => {
    const dto = toChatMessageDTO({
      id: "error_2",
      role: "AGENT",
      kind: "TURN_ERROR",
      seq: 3,
      text: "",
      genJobId: null,
      createdAt: new Date("2026-07-24T00:00:00Z"),
      payload: {
        kind: "stream_run_error",
        error: {
          kind: "provider_error",
          text: "Claude via Anthropic failed at https://provider.example.test/private",
        },
      },
    } as never, new Map());

    const serialized = JSON.stringify(dto.payload);
    expect(serialized).not.toMatch(/anthropic|claude/iu);
    expect(serialized).not.toContain("provider.example.test");
  });
});
