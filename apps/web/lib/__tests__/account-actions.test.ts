import { describe, it, expect, vi, beforeEach } from "vitest";

// Unit test (no DB): mock the resolver + the Prisma reads so the invariants —
// fail-closed, tenant-scoped, read-only, correct internal→displayed/USD mapping —
// are pinned deterministically. The 2-org isolation test (isolation.test.ts) already
// covers the resolver end-to-end against real Postgres.
const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
// account-actions imports server `signOut` from "@/auth" (next-auth v5) — stub it so the
// test never loads next-auth (which imports next/server outside a Next.js runtime).
vi.mock("@/auth", () => ({ signOut: vi.fn() }));

// ONLY read methods are provided — a stray write (create/update/upsert) would throw
// "is not a function", so this also guards the read-only contract by construction.
const findUnique = vi.fn();
const findMany = vi.fn();
vi.mock("@fikirtive/db", () => ({
  prisma: { creditAccount: { findUnique }, creditLedger: { findMany } },
}));

const { getMyAccount } = await import("@/lib/account-actions");

beforeEach(() => {
  mockRequireOwner.mockReset();
  findUnique.mockReset();
  findMany.mockReset();
});

describe("getMyAccount", () => {
  it("fails closed when requireOwner errors, and never reads credits", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authorized." });
    const res = await getMyAccount();
    expect(res).toEqual({ error: "Not authorized." });
    expect(findUnique).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("scopes both reads to the resolved ownerId and maps internal→displayed credits + USD", async () => {
    mockRequireOwner.mockResolvedValue({ email: "a@test", ownerId: "orgA" });
    findUnique.mockResolvedValue({ balance: 9990, reserved: 100 }); // internal credits (1 internal = $0.01)
    // the query filters balanceDelta != 0 in the DB, so the mock returns only balance-moving rows
    findMany.mockResolvedValue([
      { id: "l1", kind: "GRANT", reason: "beta signup grant", balanceDelta: 10000, createdAt: new Date("2026-06-20T00:00:00Z") },
      { id: "l2", kind: "RESERVE", reason: "", balanceDelta: -10, createdAt: new Date("2026-06-20T01:00:00Z") },
    ]);

    const res = await getMyAccount();
    if ("error" in res) throw new Error("unexpected error");

    // tenant scoping: never a constant — both reads filter by the resolver's ownerId,
    // and the ledger read excludes hold-only (balanceDelta 0) rows in the DB
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: "orgA" } }));
    expect(findMany.mock.calls[0][0].where).toEqual({ orgId: "orgA", balanceDelta: { not: 0 } });

    expect(res.email).toBe("a@test");
    expect(res.balance).toBe(999); // 9990 internal / 10 = 999 displayed
    expect(res.reserved).toBe(10); // 100 / 10
    expect(res.balanceUsd).toBeCloseTo(99.9); // 9990 / 100
    expect(res.recent.map((r) => r.id)).toEqual(["l1", "l2"]);
    expect(res.recent[0]).toMatchObject({ label: "beta signup grant", delta: 1000 });
    expect(res.recent[1]).toMatchObject({ label: "Generation", delta: -1 });
  });

  it("treats a missing CreditAccount as zero (never throws)", async () => {
    mockRequireOwner.mockResolvedValue({ email: "a@test", ownerId: "orgA" });
    findUnique.mockResolvedValue(null);
    findMany.mockResolvedValue([]);
    const res = await getMyAccount();
    if ("error" in res) throw new Error("unexpected error");
    expect(res.balance).toBe(0);
    expect(res.balanceUsd).toBe(0);
    expect(res.recent).toEqual([]);
  });
});
