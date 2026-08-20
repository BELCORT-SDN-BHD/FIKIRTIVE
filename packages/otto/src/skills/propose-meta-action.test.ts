import { it, expect } from "vitest";
import { CONNECTION_BLOCKER_COPY } from "@fikirtive/core";
import { proposeMetaActionSkill, executeProposeMetaAction, proposeMetaActionInput } from "./propose-meta-action.js";

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

it("invalidSteps (missing-amount) → friendly 'need a daily budget amount' message", async () => {
  const ctx = { metaPropose: async () => ({ invalidSteps: [{ targetId: "s1", reason: "missing-amount" }] }) };
  const res: any = await executeProposeMetaAction(
    { planTitle: "p", steps: [{ op: "set_budget", targetId: "s1", intent: {} }] },
    { context: ctx as any },
  );
  expect(JSON.stringify(res)).toMatch(/budget amount/i);
});

it("invalidSteps (not-a-daily-budget-object) → friendly 'can't set a budget' message", async () => {
  const ctx = { metaPropose: async () => ({ invalidSteps: [{ targetId: "a1", reason: "not-a-daily-budget-object" }] }) };
  const res: any = await executeProposeMetaAction(
    { planTitle: "p", steps: [{ op: "set_budget", targetId: "a1", intent: { dailyBudgetMinor: 2000 } }] },
    { context: ctx as any },
  );
  expect(JSON.stringify(res)).toMatch(/can't set a daily budget|isn't a daily-budget/i);
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
});

// #767:以前这三条只断言文本含 `connect`,而「还没连过」与「连着但过期」两句都含 `connect`
// —— 答错了也绿。改成各钉各的那一句。
it("notConnected → 说的就是「还没连过」,且不算 blocked", async () => {
  const ctx = { metaPropose: async () => ({ notConnected: true as const }) };
  const res: any = await executeProposeMetaAction(
    { planTitle: "p", steps: [{ op: "pause", targetId: "s1", intent: {} }] },
    { context: ctx as any },
  );
  expect(res.blocked).toBeUndefined();
  expect(res.message).toMatch(/Meta isn't connected yet/);
});

it("needsReconnect → 共享的「连着但过期」文案,不是「还没连过」", async () => {
  const ctx = { metaPropose: async () => ({ needsReconnect: true as const }) };
  const res: any = await executeProposeMetaAction(
    { planTitle: "p", steps: [{ op: "pause", targetId: "s1", intent: {} }] },
    { context: ctx as any },
  );
  expect(res.blocked).toBe("needs_reconnect");
  expect(res.message).toContain(CONNECTION_BLOCKER_COPY.needs_reconnect.status);
  expect(res.message).not.toMatch(/isn't connected yet/i);
});

it("missing port → friendly not-connected message", async () => {
  const res: any = await executeProposeMetaAction(
    { planTitle: "p", steps: [{ op: "pause", targetId: "s1", intent: {} }] },
    { context: {} as any },
  );
  expect(res.message).toMatch(/Meta isn't connected yet/);
});
