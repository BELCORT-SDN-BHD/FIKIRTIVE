import { it, expect } from "vitest";
import { buildMetaPlanCard } from "../meta-plan-card";
import type { MetaAdObject } from "../meta-objects";

const objects: MetaAdObject[] = [{ id: "s1", level: "adset", name: "Set 1", status: "ACTIVE", dailyBudgetMinor: 1000, currency: "USD", accountId: "act_1" }];

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

// ── FIX A backstop: buildMetaPlanCard must NEVER produce a {} budget targetValue ──
it("throws on a set_budget with NO amount (never auto-zeroes a budget)", () => {
  expect(() => buildMetaPlanCard(
    { planTitle: "p", steps: [{ op: "set_budget", targetId: "s1", intent: {} }] },
    objects, "AUTO", "org1", "2026-06-28T00:00:00Z")).toThrow(/budget/i);
});

it("throws on a set_budget against an object with no daily budget (ad/lifetime)", () => {
  const adObjects: MetaAdObject[] = [{ id: "a1", level: "ad", name: "Ad", status: "ACTIVE", currency: "USD", accountId: "act_1" }];
  expect(() => buildMetaPlanCard(
    { planTitle: "p", steps: [{ op: "set_budget", targetId: "a1", intent: { dailyBudgetMinor: 2000 } }] },
    adObjects, "ASK", "org1", "2026-06-28T00:00:00Z")).toThrow(/budget/i);
});

it("totalSpendImpactDisplay uses MYR currency and major units for a budget_up step", () => {
  const myrObjects: MetaAdObject[] = [{ id: "s2", level: "adset", name: "MYR Set", status: "ACTIVE", dailyBudgetMinor: 1000, currency: "MYR", accountId: "act_2" }];
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

// ── FIX B guard: an empty/invalid currency must NEVER throw (Intl rejects "") ──
it("does not throw when the object currency is empty — falls back to a plain number", () => {
  const noCur: MetaAdObject[] = [{ id: "s3", level: "adset", name: "No-cur Set", status: "ACTIVE", dailyBudgetMinor: 1000, currency: "", accountId: "act_3" }];
  let card: ReturnType<typeof buildMetaPlanCard>;
  expect(() => {
    card = buildMetaPlanCard(
      { planTitle: "p", steps: [{ op: "set_budget", targetId: "s3", intent: { dailyBudgetMinor: 2000 } }] },
      noCur, "ASK", "org1", "2026-06-28T00:00:00Z");
  }).not.toThrow();
  // delta is 10.00 major units — shown as a plain number when currency is unusable
  expect(card!.totalSpendImpactDisplay).toMatch(/10/);
});

it("totalSpendImpactDisplay shows no added spend text (no hardcoded $) when there are no spend steps", () => {
  const card = buildMetaPlanCard(
    { planTitle: "p", steps: [{ op: "pause", targetId: "s1", intent: {} }] },
    objects, "ASK", "org1", "2026-06-28T00:00:00Z");
  // No spend steps → should not show a hardcoded dollar amount
  expect(card.totalSpendImpactDisplay).not.toMatch(/^\+\$/);
});

// ── FIX E: a `resume` of a budgeted campaign restarts its daily spend → counts as spend impact ──
it("totalSpendImpactDisplay includes a resume's current daily budget (not 'no added spend')", () => {
  // A PAUSED campaign carrying a daily budget; resuming it restarts that daily spend.
  const pausedBudgeted: MetaAdObject[] = [{ id: "c9", level: "campaign", name: "Paused Camp", status: "PAUSED", dailyBudgetMinor: 3000, currency: "MYR", accountId: "act_9" }];
  const card = buildMetaPlanCard(
    { planTitle: "p", steps: [{ op: "resume", targetId: "c9", intent: {} }] },
    pausedBudgeted, "ASK", "org1", "2026-06-28T00:00:00Z");
  // Resume is a spend op; the daily budget (3000 minor = 30.00) is the resumed spend.
  expect(card.totalSpendImpactDisplay).not.toMatch(/no added spend/i);
  expect(card.totalSpendImpactDisplay).toMatch(/MYR|RM/);
  expect(card.totalSpendImpactDisplay).toMatch(/30/);
});
