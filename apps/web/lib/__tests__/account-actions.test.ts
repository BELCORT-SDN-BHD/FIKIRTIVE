import { describe, it, expect, vi, beforeEach } from "vitest";

// Unit test (no DB): mock the resolver + the Prisma reads so the invariants —
// fail-closed, tenant-scoped, read-only, correct internal→displayed/USD mapping —
// are pinned deterministically. The 2-org isolation test (isolation.test.ts) already
// covers the resolver end-to-end against real Postgres.
const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
// account-actions imports the Better Auth server instance for signOutAction — stub it so the
// test never constructs the real auth (which pulls in server-only + the prisma adapter).
vi.mock("@/lib/better-auth/server", () => ({ auth: { api: { signOut: vi.fn() } } }));

// ONLY read methods are provided — a stray write (create/update/upsert) would throw
// "is not a function", so this also guards the read-only contract by construction.
const findUnique = vi.fn();
const creditLedgerFindMany = vi.fn();
const genJobFindMany = vi.fn();
vi.mock("@fikirtive/db", () => ({
  prisma: {
    creditAccount: { findUnique },
    creditLedger: { findMany: creditLedgerFindMany },
    genJob: { findMany: genJobFindMany },
  },
}));

const { getMyAccount } = await import("@/lib/account-actions");

beforeEach(() => {
  mockRequireOwner.mockReset();
  findUnique.mockReset();
  creditLedgerFindMany.mockReset();
  genJobFindMany.mockReset();
  genJobFindMany.mockResolvedValue([]);
});

describe("getMyAccount", () => {
  it("fails closed when requireOwner errors, and never reads credits", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authorized." });
    const res = await getMyAccount();
    expect(res).toEqual({ error: "Not authorized." });
    expect(findUnique).not.toHaveBeenCalled();
    expect(creditLedgerFindMany).not.toHaveBeenCalled();
    expect(genJobFindMany).not.toHaveBeenCalled();
  });

  it("scopes both reads to the resolved ownerId and maps internal→displayed credits + USD", async () => {
    mockRequireOwner.mockResolvedValue({ email: "a@test", ownerId: "orgA" });
    findUnique.mockResolvedValue({ balance: 9990, reserved: 100 }); // internal credits (1 internal = $0.01)
    // the query filters balanceDelta != 0 in the DB, so the mock returns only balance-moving rows
    creditLedgerFindMany.mockResolvedValue([
      { id: "l1", kind: "GRANT", reason: "beta signup grant", refId: null, balanceDelta: 10000, createdAt: new Date("2026-06-20T00:00:00Z") },
      { id: "l2", kind: "RESERVE", reason: "", refId: "genjob_abc", balanceDelta: -10, createdAt: new Date("2026-06-20T01:00:00Z") },
      // an Otto conversation turn — refId "otto-..." → labeled "Otto thinking", not "Generation"
      { id: "l3", kind: "RESERVE", reason: "", refId: "otto-turn:thread1:3", balanceDelta: -35, createdAt: new Date("2026-06-20T02:00:00Z") },
      { id: "l4", kind: "RESERVE", reason: "", refId: "genjob_video", balanceDelta: -70, createdAt: new Date("2026-06-20T03:00:00Z") },
    ]);
    genJobFindMany.mockResolvedValue([
      { id: "genjob_abc", kind: "IMAGE", count: 4, videoOptions: null },
      { id: "genjob_video", kind: "VIDEO", count: 1, videoOptions: { resolution: "720p" } },
    ]);

    const res = await getMyAccount();
    if ("error" in res) throw new Error("unexpected error");

    // tenant scoping: never a constant — both reads filter by the resolver's ownerId,
    // and the ledger read excludes hold-only (balanceDelta 0) rows in the DB
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: "orgA" } }));
    expect(creditLedgerFindMany.mock.calls[0][0].where).toEqual({ orgId: "orgA", balanceDelta: { not: 0 } });
    expect(genJobFindMany.mock.calls[0][0].where).toEqual({ ownerId: "orgA", id: { in: ["genjob_abc", "genjob_video"] } });

    expect(res.email).toBe("a@test");
    expect(res.balance).toBe(999); // 9990 internal / 10 = 999 displayed
    expect(res.reserved).toBe(10); // 100 / 10
    expect(res.balanceUsd).toBeCloseTo(99.9); // 9990 / 100
    expect(res.recent.map((r) => r.id)).toEqual(["l1", "l2", "l3", "l4"]);
    expect(res.recent[0]).toMatchObject({ label: "beta signup grant", delta: 1000 });
    expect(res.recent[1]).toMatchObject({ label: "Image generation - 4 images", delta: -1 }); // media reserve (genjob refId)
    expect(res.recent[2]).toMatchObject({ label: "Otto thinking", delta: -3.5 }); // otto- refId → conversation cost
    expect(res.recent[3]).toMatchObject({ label: "Video generation - 720p", delta: -7 });
  });

  it("treats a missing CreditAccount as zero (never throws)", async () => {
    mockRequireOwner.mockResolvedValue({ email: "a@test", ownerId: "orgA" });
    findUnique.mockResolvedValue(null);
    creditLedgerFindMany.mockResolvedValue([]);
    const res = await getMyAccount();
    if ("error" in res) throw new Error("unexpected error");
    expect(res.balance).toBe(0);
    expect(res.balanceUsd).toBe(0);
    expect(res.recent).toEqual([]);
  });
});
