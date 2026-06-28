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
