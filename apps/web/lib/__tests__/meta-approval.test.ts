import { describe, it, expect } from "vitest";
import { hashSteps, buildApproval, verifyApproval } from "../meta-approval";

const steps = [{ index: 0, op: "budget_up" as const, targetId: "s1", targetValue: { dailyBudgetMinor: 2000 } }];

it("hash is stable regardless of key order / number formatting", () => {
  const a = hashSteps(steps);
  const b = hashSteps([{ index: 0, op: "budget_up", targetId: "s1", targetValue: { dailyBudgetMinor: 2000.0 } } as any]);
  expect(a).toBe(b);
});
it("verify ok for the bound steps + actor within ttl", () => {
  const ap = buildApproval(steps, "org1", "2026-06-28T00:00:00Z", 60_000);
  expect(verifyApproval(ap, steps, "org1", "2026-06-28T00:00:30Z")).toEqual({ ok: true });
});
it("rejects edited steps (hash mismatch)", () => {
  const ap = buildApproval(steps, "org1", "2026-06-28T00:00:00Z", 60_000);
  const edited = [{ ...steps[0], targetValue: { dailyBudgetMinor: 9999 } }];
  expect(verifyApproval(ap, edited, "org1", "2026-06-28T00:00:30Z")).toEqual({ ok: false, reason: "hash" });
});
it("rejects expired", () => {
  const ap = buildApproval(steps, "org1", "2026-06-28T00:00:00Z", 60_000);
  expect(verifyApproval(ap, steps, "org1", "2026-06-28T00:02:00Z")).toEqual({ ok: false, reason: "expired" });
});
it("rejects consumed + wrong actor", () => {
  const ap = buildApproval(steps, "org1", "2026-06-28T00:00:00Z", 60_000);
  expect(verifyApproval({ ...ap, consumedAt: "x" }, steps, "org1", "2026-06-28T00:00:30Z")).toEqual({ ok: false, reason: "consumed" });
  expect(verifyApproval(ap, steps, "EVIL", "2026-06-28T00:00:30Z")).toEqual({ ok: false, reason: "actor" });
});
