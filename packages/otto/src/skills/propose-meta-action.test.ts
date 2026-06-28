import { it, expect } from "vitest";
import { proposeMetaActionSkill, executeProposeMetaAction, proposeMetaAction, proposeMetaActionInput } from "./propose-meta-action.js";

it("gate: free/write/internal → ungated", () => {
  expect(proposeMetaActionSkill.cost).toBe("free");
  expect(proposeMetaActionSkill.effect).toBe("write");
  expect(proposeMetaActionSkill.reach).toBe("internal");
  expect(proposeMetaActionSkill.needsApproval).toBe(false);
});

it("calls ctx.metaPropose and reports the cardId", async () => {
  const ctx = { metaPropose: async () => ({ cardId: "c1", autoEligible: false }) };
  const res: any = await executeProposeMetaAction(
    { planTitle: "p", steps: [{ op: "pause", targetId: "s1", intent: {} }] },
    { context: ctx as any },
  );
  expect(JSON.stringify(res)).toMatch(/c1|prepared|plan/i);
});

it("unknownTargets → friendly 'couldn't find' message, not a thrown error", async () => {
  const ctx = { metaPropose: async () => ({ unknownTargets: ["NOPE"] }) };
  const res: any = await executeProposeMetaAction(
    { planTitle: "p", steps: [{ op: "pause", targetId: "NOPE", intent: {} }] },
    { context: ctx as any },
  );
  expect(JSON.stringify(res)).toMatch(/find|NOPE/i);
});

it("input zod schema has no currentValue/moneyClass/approval keys (LLM can't set them)", () => {
  // Structurally verify the LLM-facing input schema exposes ONLY planTitle + steps.
  // moneyClass, currentValue, and approval are server-computed; the LLM must never set them.
  const topLevelKeys = Object.keys(proposeMetaActionInput.shape);
  expect(topLevelKeys).toEqual(["planTitle", "steps"]);
  // Confirm no forbidden enrichment fields appear at the top level
  expect(topLevelKeys).not.toContain("moneyClass");
  expect(topLevelKeys).not.toContain("currentValue");
  expect(topLevelKeys).not.toContain("approval");
  // proposeMetaAction is the bare tool export (same reference as the skill's .tool)
  expect(proposeMetaAction).toBe(proposeMetaActionSkill.tool);
});

it("notConnected → friendly message", async () => {
  const ctx = { metaPropose: async () => ({ notConnected: true as const }) };
  const res: any = await executeProposeMetaAction(
    { planTitle: "p", steps: [{ op: "pause", targetId: "s1", intent: {} }] },
    { context: ctx as any },
  );
  expect(JSON.stringify(res)).toMatch(/connect/i);
});

it("needsReconnect → friendly message", async () => {
  const ctx = { metaPropose: async () => ({ needsReconnect: true as const }) };
  const res: any = await executeProposeMetaAction(
    { planTitle: "p", steps: [{ op: "pause", targetId: "s1", intent: {} }] },
    { context: ctx as any },
  );
  expect(JSON.stringify(res)).toMatch(/connect/i);
});

it("missing port → friendly not-connected message", async () => {
  const res: any = await executeProposeMetaAction(
    { planTitle: "p", steps: [{ op: "pause", targetId: "s1", intent: {} }] },
    { context: {} as any },
  );
  expect(JSON.stringify(res)).toMatch(/connect/i);
});
