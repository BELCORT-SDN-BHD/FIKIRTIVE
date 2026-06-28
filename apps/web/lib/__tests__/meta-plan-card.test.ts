import { describe, it, expect } from "vitest";
import { buildMetaPlanCard } from "../meta-plan-card";

const objects = [{ id: "s1", level: "adset", name: "Set 1", status: "ACTIVE", dailyBudgetMinor: 1000, currency: "USD", accountId: "act_1" }] as any;

it("resolves set_budget→budget_up (spend) when target>current; → ask not auto even in AUTO", () => {
  const card = buildMetaPlanCard(
    { planTitle: "p", steps: [{ op: "set_budget", targetId: "s1", intent: { dailyBudgetMinor: 2000 } }] },
    objects, "AUTO", "org1", "2026-06-28T00:00:00Z");
  expect(card.steps[0].op).toBe("budget_up");
  expect(card.steps[0].moneyClass).toBe("spend");
  expect(card.autoEligible).toBe(false); // any spend step → whole plan asks
});

it("pause is safe → autoEligible true in AUTO", () => {
  const card = buildMetaPlanCard(
    { planTitle: "p", steps: [{ op: "pause", targetId: "s1", intent: {} }] },
    objects, "AUTO", "org1", "2026-06-28T00:00:00Z");
  expect(card.steps[0].op).toBe("pause");
  expect(card.steps[0].moneyClass).toBe("safe");
  expect(card.autoEligible).toBe(true);
  expect(card.approval.paramHash).toBeTruthy();
});

it("set_budget→budget_down is safe", () => {
  const card = buildMetaPlanCard(
    { planTitle: "p", steps: [{ op: "set_budget", targetId: "s1", intent: { dailyBudgetMinor: 500 } }] },
    objects, "AUTO", "org1", "2026-06-28T00:00:00Z");
  expect(card.steps[0].op).toBe("budget_down");
  expect(card.autoEligible).toBe(true);
});

it("unknown target id is dropped/flagged, never executable", () => {
  expect(() => buildMetaPlanCard(
    { planTitle: "p", steps: [{ op: "pause", targetId: "NOPE", intent: {} }] },
    objects, "ASK", "org1", "2026-06-28T00:00:00Z")).toThrow(/unknown target/i);
});

it("totalSpendImpactDisplay uses MYR currency and major units for a budget_up step", () => {
  const myrObjects = [{ id: "s2", level: "adset", name: "MYR Set", status: "ACTIVE", dailyBudgetMinor: 1000, currency: "MYR", accountId: "act_2" }] as any;
  const card = buildMetaPlanCard(
    { planTitle: "p", steps: [{ op: "set_budget", targetId: "s2", intent: { dailyBudgetMinor: 2000 } }] },
    myrObjects, "ASK", "org1", "2026-06-28T00:00:00Z");
  // Must contain "MYR" or "RM" (Intl formats MYR as "MYR" or "RM" depending on locale)
  expect(card.totalSpendImpactDisplay).toMatch(/MYR|RM/);
  // Must NOT contain a bare "$" (no hardcoded USD symbol)
  expect(card.totalSpendImpactDisplay).not.toMatch(/^\+\$/);
  // The delta is 10.00 major units (2000-1000 = 1000 minor = MYR 10.00)
  expect(card.totalSpendImpactDisplay).toMatch(/10/);
});

it("totalSpendImpactDisplay shows no added spend text (no hardcoded $) when there are no spend steps", () => {
  const card = buildMetaPlanCard(
    { planTitle: "p", steps: [{ op: "pause", targetId: "s1", intent: {} }] },
    objects, "ASK", "org1", "2026-06-28T00:00:00Z");
  // No spend steps → should not show a hardcoded dollar amount
  expect(card.totalSpendImpactDisplay).not.toMatch(/^\+\$/);
});
