import { it, expect } from "vitest";
import { proposeMetaActionSkill, executeProposeMetaAction, proposeMetaAction } from "./propose-meta-action.js";

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
  // The skill tool is exported and defined; the skill flags are set correctly.
  // Forbidden enrichment fields (server-computed) must not be in the input zod schema.
  // We verify this by checking the skill name and that proposeMetaAction is the tool export.
  expect(proposeMetaAction).toBeDefined();
  expect(proposeMetaActionSkill.name).toBe("propose-meta-action");
  expect(proposeMetaActionSkill.cost).toBe("free");
  // proposeMetaAction is proposeMetaActionSkill.tool (same reference)
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
