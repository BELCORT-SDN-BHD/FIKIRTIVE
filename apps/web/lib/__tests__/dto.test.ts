import { describe, it, expect, vi } from "vitest";

// dto.ts is `import "server-only"` and pulls in storage; stub both so we can unit-test the
// pure DTO mapping (toChatMessageDTO) without the server runtime.
vi.mock("server-only", () => ({}));
vi.mock("../storage", () => ({
  storage: { url: () => "https://example.test/asset" },
  kindOf: () => "image",
}));

import { toChatMessageDTO } from "../dto";

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
