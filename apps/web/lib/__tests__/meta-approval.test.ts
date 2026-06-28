import { describe, it, expect } from "vitest";
import { hashSteps, buildApproval, verifyApproval, canonicalizeSteps } from "../meta-approval";

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

// --- adversarial tests ---

it("nested-object key reorder hashes identically", () => {
  const s1 = [{ index: 0, op: "budget_up" as const, targetId: "s1", targetValue: { a: { x: 1, y: 2 } } }];
  const s2 = [{ index: 0, op: "budget_up" as const, targetId: "s1", targetValue: { a: { y: 2, x: 1 } } }];
  expect(hashSteps(s1)).toBe(hashSteps(s2));
});

it("step-array reorder CHANGES the hash", () => {
  const step0 = { index: 0, op: "budget_up" as const, targetId: "s1", targetValue: { dailyBudgetMinor: 100 } };
  const step1 = { index: 1, op: "budget_up" as const, targetId: "s2", targetValue: { dailyBudgetMinor: 200 } };
  expect(hashSteps([step0, step1])).not.toBe(hashSteps([step1, step0]));
});

it("adding a step CHANGES the hash", () => {
  const step0 = { index: 0, op: "budget_up" as const, targetId: "s1", targetValue: { dailyBudgetMinor: 100 } };
  const step1 = { index: 1, op: "budget_up" as const, targetId: "s2", targetValue: { dailyBudgetMinor: 200 } };
  expect(hashSteps([step0])).not.toBe(hashSteps([step0, step1]));
});

it("type-confusion: number vs string value produce DIFFERENT hashes", () => {
  const sNum = [{ index: 0, op: "budget_up" as const, targetId: "s1", targetValue: { v: 1 } }];
  const sStr = [{ index: 0, op: "budget_up" as const, targetId: "s1", targetValue: { v: "1" } }];
  expect(hashSteps(sNum)).not.toBe(hashSteps(sStr));
});

it("expiry by instant: same instant in +08:00 offset is still valid", () => {
  // Build at Z; verify with same instant expressed as +08:00 — lexically "greater" but same instant
  const ap = buildApproval(steps, "org1", "2026-06-28T00:00:00Z", 60_000);
  // nowIso = "2026-06-28T00:00:30Z" as +08:00 = "2026-06-28T08:00:30+08:00"
  // expiresAt = "2026-06-28T00:01:00.000Z" — lexically less than "2026-06-28T08:00:30+08:00"
  // but the real instant is 30s into the TTL, so it should be valid
  expect(verifyApproval(ap, steps, "org1", "2026-06-28T08:00:30+08:00")).toEqual({ ok: true });
});

it("expiry by instant: truly-past instant in offset form is rejected", () => {
  const ap = buildApproval(steps, "org1", "2026-06-28T00:00:00Z", 60_000);
  // "2026-06-28T08:02:00+08:00" = "2026-06-28T00:02:00Z" — 2 minutes after build, past the 1-min TTL
  expect(verifyApproval(ap, steps, "org1", "2026-06-28T08:02:00+08:00")).toEqual({ ok: false, reason: "expired" });
});

it("fail-closed: nowIso='not-a-date' returns expired", () => {
  const ap = buildApproval(steps, "org1", "2026-06-28T00:00:00Z", 60_000);
  expect(verifyApproval(ap, steps, "org1", "not-a-date")).toEqual({ ok: false, reason: "expired" });
});

it("verify precedence: wrong actor AND expired → reason:actor", () => {
  const ap = buildApproval(steps, "org1", "2026-06-28T00:00:00Z", 60_000);
  // Use a time well past expiry AND a wrong actor
  expect(verifyApproval(ap, steps, "EVIL", "2026-06-28T01:00:00Z")).toEqual({ ok: false, reason: "actor" });
});
