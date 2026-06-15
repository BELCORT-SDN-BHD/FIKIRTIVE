import { describe, expect, it } from "vitest";
import { coworkTurnSchema, parseCoworkTurn, mockPlannerReply, MAX_PLAN_STEPS } from "./cowork-planner.js";
import { MAX_GEN_PROMPT } from "./gen.js";

describe("coworkTurnSchema", () => {
  const refs = ["e1", "e2"];
  const ok = { planSteps: ["look at refs", "pick model"], reply: "On it.", proposal: { kind: "image", structuredPrompt: "a cat", entityIds: ["e1"], variantSel: { e1: "v1" } } };
  it("accepts a valid turn", () => {
    expect(parseCoworkTurn(JSON.stringify(ok), refs).proposal?.entityIds).toEqual(["e1"]);
  });
  it("drops entityIds not in availableRefs and variantSel keys not in entityIds", () => {
    const t = parseCoworkTurn(JSON.stringify({ ...ok, proposal: { ...ok.proposal, entityIds: ["e1", "ghost"], variantSel: { e1: "v1", ghost: "v9" } } }), refs);
    expect(t.proposal?.entityIds).toEqual(["e1"]);
    expect(Object.keys(t.proposal?.variantSel ?? {})).toEqual(["e1"]);
  });
  it("clamps structuredPrompt to MAX_GEN_PROMPT", () => {
    const t = parseCoworkTurn(JSON.stringify({ ...ok, proposal: { ...ok.proposal, structuredPrompt: "x".repeat(MAX_GEN_PROMPT + 500) } }), refs);
    expect((t.proposal?.structuredPrompt.length ?? 0) <= MAX_GEN_PROMPT).toBe(true);
  });
  it("caps planSteps and accepts a null proposal (talk-only turn)", () => {
    const t = parseCoworkTurn(JSON.stringify({ planSteps: Array(50).fill("s"), reply: "hi", proposal: null }), refs);
    expect(t.planSteps.length).toBeLessThanOrEqual(MAX_PLAN_STEPS);
    expect(t.proposal).toBeNull();
  });
  it("mockPlannerReply parses cleanly through parseCoworkTurn", () => {
    expect(() => parseCoworkTurn(mockPlannerReply("make a video of @mira"), refs)).not.toThrow();
  });
  it("recovers JSON wrapped in prose via the sliceJson fallback (model ignored json-mode)", () => {
    const t = parseCoworkTurn('Sure thing! {"reply":"hi","planSteps":["a"],"proposal":null} hope that helps', refs);
    expect(t.reply).toBe("hi");
    expect(t.proposal).toBeNull();
  });
  it("truncates an overlong single planStep instead of throwing (coerce-don't-reject boundary)", () => {
    const t = parseCoworkTurn(JSON.stringify({ planSteps: ["x".repeat(500)], reply: "hi", proposal: null }), refs);
    expect(t.planSteps[0]?.length).toBe(200);
  });
});
