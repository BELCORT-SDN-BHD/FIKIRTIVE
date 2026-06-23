/**
 * Integration tests for the @fikirtive/db credit service.
 * Runs against a real Postgres DB (must be a *_test database — enforced by setup.ts).
 *
 * TDD cases from otto-task-1.3-brief.md.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma, reserveCredits, settleCredits, refundReservation, InsufficientCredits } from "./index.js";
import { seedOrg } from "../test/setup.js";

const ORG = "test-org-1";
const REF = "ref-aaa-001";

// Helper: read the current account state.
async function account(orgId: string) {
  return prisma.creditAccount.findUniqueOrThrow({ where: { orgId } });
}

// Helper: read all ledger rows for an org, ordered by creation.
async function ledger(orgId: string) {
  return prisma.creditLedger.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
}

// Helper: sum balanceDelta or reservedDelta across all ledger rows.
function sumBalance(rows: { balanceDelta: number }[]): number {
  return rows.reduce((acc, r) => acc + r.balanceDelta, 0);
}
function sumReserved(rows: { reservedDelta: number }[]): number {
  return rows.reduce((acc, r) => acc + r.reservedDelta, 0);
}

beforeEach(async () => {
  await seedOrg(ORG, 1000);
});

// ── Case 1: harness smoke ───────────────────────────────────────────────────
describe("case 1 — harness smoke", () => {
  it("seeds an org and reads back the balance", async () => {
    const acc = await account(ORG);
    expect(acc.balance).toBe(1000);
    expect(acc.reserved).toBe(0);
  });
});

// ── Case 2: reserve then settle full (no actualInternal) ───────────────────
describe("case 2 — settle full (GEN path, no actualInternal)", () => {
  it("balance=0 reserved=0 after settle; SETTLE row balanceDelta=0 reservedDelta=-1000", async () => {
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 1000 }));

    const afterReserve = await account(ORG);
    expect(afterReserve.balance).toBe(0);
    expect(afterReserve.reserved).toBe(1000);

    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId: REF }));

    const afterSettle = await account(ORG);
    expect(afterSettle.balance).toBe(0);
    expect(afterSettle.reserved).toBe(0);

    const rows = await ledger(ORG);
    const settleRow = rows.find((r) => r.kind === "SETTLE");
    expect(settleRow).toBeDefined();
    expect(settleRow!.balanceDelta).toBe(0);
    expect(settleRow!.reservedDelta).toBe(-1000);
  });
});

// ── Case 3: variable settle actual < reserved ──────────────────────────────
describe("case 3 — variable settle actual < reserved", () => {
  it("charges 300, refunds 700; invariants balance==Σ balanceDelta, reserved==Σ reservedDelta", async () => {
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 1000 }));
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId: REF, actualInternal: 300 }));

    const acc = await account(ORG);
    expect(acc.balance).toBe(700); // 1000 - 1000 (reserve) + 700 (refund via settle) = 700
    expect(acc.reserved).toBe(0);

    const rows = await ledger(ORG);
    const settleRow = rows.find((r) => r.kind === "SETTLE");
    expect(settleRow).toBeDefined();
    expect(settleRow!.balanceDelta).toBe(700);   // B - A = 1000 - 300
    expect(settleRow!.reservedDelta).toBe(-1000); // -B

    // Invariants: balance == Σ balanceDelta, reserved == Σ reservedDelta
    // Starting balance (from seedOrg) is not a ledger row — the seed inserts directly.
    // The invariant here is: net ledger deltas = net change to account from initial seeded values.
    // Initial: balance=1000, reserved=0. Current: balance=700, reserved=0.
    // Net change: balance=-300, reserved=0.
    // Σ balanceDelta = -1000 (RESERVE) + 700 (SETTLE) = -300 ✓
    // Σ reservedDelta = +1000 (RESERVE) - 1000 (SETTLE) = 0 ✓
    expect(sumBalance(rows)).toBe(acc.balance - 1000); // -300
    expect(sumReserved(rows)).toBe(acc.reserved);       // 0
  });
});

// ── Case 4: idempotent double settle ──────────────────────────────────────
describe("case 4 — idempotent double settle", () => {
  it("second settle is a no-op; exactly one SETTLE row; balance unchanged", async () => {
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 1000 }));
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId: REF, actualInternal: 300 }));
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId: REF, actualInternal: 300 }));

    const acc = await account(ORG);
    expect(acc.balance).toBe(700);
    expect(acc.reserved).toBe(0);

    const rows = await ledger(ORG);
    const settleRows = rows.filter((r) => r.kind === "SETTLE");
    expect(settleRows).toHaveLength(1);
  });
});

// ── Case 5: clamp actual > reserved ───────────────────────────────────────
describe("case 5 — clamp actual > reserved", () => {
  it("actualInternal=5000 with reserve=1000 charges exactly 1000, never more", async () => {
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 1000 }));
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId: REF, actualInternal: 5000 }));

    const acc = await account(ORG);
    expect(acc.balance).toBe(0);   // charged exactly 1000 (the full reserve, clamped from 5000)
    expect(acc.reserved).toBe(0);

    const rows = await ledger(ORG);
    const settleRow = rows.find((r) => r.kind === "SETTLE");
    expect(settleRow!.balanceDelta).toBe(0);    // B - A = 1000 - 1000 = 0
    expect(settleRow!.reservedDelta).toBe(-1000);
  });
});

// ── Case 6: clamp negative actual ─────────────────────────────────────────
describe("case 6 — clamp negative actual", () => {
  it("actualInternal=-50 charges 0; full balance restored", async () => {
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 1000 }));
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId: REF, actualInternal: -50 }));

    const acc = await account(ORG);
    expect(acc.balance).toBe(1000); // A=0, B-A=1000 refunded, net balance back to start
    expect(acc.reserved).toBe(0);

    const rows = await ledger(ORG);
    const settleRow = rows.find((r) => r.kind === "SETTLE");
    expect(settleRow!.balanceDelta).toBe(1000);   // B - A = 1000 - 0
    expect(settleRow!.reservedDelta).toBe(-1000);
  });
});

// ── Case 7: finalizer mutual-exclusion (refund wins over settle) ───────────
describe("case 7 — finalizer mutual-exclusion: refund wins", () => {
  it("settle after refund is a no-op; balance fully restored; exactly one finalizer row (REFUND)", async () => {
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 1000 }));
    await prisma.$transaction((tx) => refundReservation(tx, { orgId: ORG, refId: REF }));
    // Settle AFTER refund — should no-op (refund already holds the finalizer slot)
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId: REF, actualInternal: 300 }));

    const acc = await account(ORG);
    expect(acc.balance).toBe(1000); // fully restored by refund
    expect(acc.reserved).toBe(0);

    const rows = await ledger(ORG);
    const finalizerRows = rows.filter((r) => r.kind === "SETTLE" || r.kind === "REFUND");
    expect(finalizerRows).toHaveLength(1);
    expect(finalizerRows.at(0)?.kind).toBe("REFUND");
  });
});

// ── Case 8: reserve guard — never-negative ────────────────────────────────
describe("case 8 — reserve guard: InsufficientCredits on underfunded reserve", () => {
  it("seed balance=100, reserve 500 → InsufficientCredits; balance unchanged", async () => {
    // Override with a lower balance (beforeEach already seeded 1000; truncate+reseed)
    await prisma.$executeRawUnsafe(`TRUNCATE "CreditLedger", "CreditAccount", "Organization" RESTART IDENTITY CASCADE`);
    await seedOrg(ORG, 100);

    await expect(
      prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 500 })),
    ).rejects.toThrow(InsufficientCredits);

    const acc = await account(ORG);
    expect(acc.balance).toBe(100);
    expect(acc.reserved).toBe(0);
  });
});
