import { describe, it, expect, vi, beforeEach } from "vitest";

// Unit test (no DB): mock the resolver + the Prisma reads so the invariants —
// fail-closed, tenant-scoped, read-only, correct internal→displayed/USD mapping —
// are pinned deterministically. The 2-org isolation test (isolation.test.ts) already
// covers the resolver end-to-end against real Postgres.
const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
// account-actions imports the Better Auth server instance for signOutAction — stub it so the
// test never constructs the real auth (which pulls in server-only + the prisma adapter).
const mockSignOut = vi.fn();
vi.mock("@/lib/better-auth/server", () => ({ auth: { api: { signOut: mockSignOut } } }));
const mockHeaders = vi.fn();
vi.mock("next/headers", () => ({ headers: mockHeaders }));
const mockRedirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

// ONLY read methods are provided — a stray write (create/update/upsert) would throw
// "is not a function", so this also guards the read-only contract by construction.
const findUnique = vi.fn();
const organizationFindFirst = vi.fn();
const creditLedgerFindMany = vi.fn();
const genJobFindMany = vi.fn();
const refGenJobFindMany = vi.fn();
// #592 — readDisplayName (profile-names.ts) reads the merchant's own name through
// Membership, the same query getMyAccount now draws the sidebar's displayName from.
const membershipFindFirst = vi.fn();
vi.mock("@fikirtive/db", () => ({
  prisma: {
    organization: { findFirst: organizationFindFirst },
    creditAccount: { findUnique },
    creditLedger: { findMany: creditLedgerFindMany },
    genJob: { findMany: genJobFindMany },
    refGenJob: { findMany: refGenJobFindMany },
    membership: { findFirst: membershipFindFirst },
  },
}));

const { getMyAccount, signOutAction } = await import("@/lib/account-actions");

beforeEach(() => {
  mockRequireOwner.mockReset();
  mockSignOut.mockReset();
  mockHeaders.mockReset();
  mockRedirect.mockClear();
  findUnique.mockReset();
  organizationFindFirst.mockReset();
  creditLedgerFindMany.mockReset();
  genJobFindMany.mockReset();
  genJobFindMany.mockResolvedValue([]);
  refGenJobFindMany.mockReset();
  refGenJobFindMany.mockResolvedValue([]);
  membershipFindFirst.mockReset();
  membershipFindFirst.mockResolvedValue({ user: { name: null } }); // no display name set, by default
  organizationFindFirst.mockResolvedValue({ name: "Acme Studio" });
  mockHeaders.mockResolvedValue(new Headers({ cookie: "better-auth.session_token=test" }));
  mockSignOut.mockResolvedValue(undefined);
});

describe("getMyAccount", () => {
  it("fails closed when requireOwner errors, and never reads credits", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authorized." });
    const res = await getMyAccount();
    expect(res).toEqual({ error: "Not authorized." });
    expect(findUnique).not.toHaveBeenCalled();
    expect(organizationFindFirst).not.toHaveBeenCalled();
    expect(creditLedgerFindMany).not.toHaveBeenCalled();
    expect(genJobFindMany).not.toHaveBeenCalled();
    expect(membershipFindFirst).not.toHaveBeenCalled();
  });

  it("scopes both reads to the resolved ownerId and maps internal→displayed credits + USD", async () => {
    mockRequireOwner.mockResolvedValue({ email: "a@test", ownerId: "orgA" });
    membershipFindFirst.mockResolvedValue({ user: { name: "Nick QA" } });
    findUnique.mockResolvedValue({ balance: 9990, reserved: 100 }); // internal credits (1 internal = $0.01)
    // the query filters balanceDelta != 0 in the DB, so the mock returns only balance-moving rows
    creditLedgerFindMany.mockResolvedValue([
      { id: "l1", kind: "GRANT", source: "BETA", refId: null, balanceDelta: 10000, createdAt: new Date("2026-06-20T00:00:00Z") },
      { id: "l2", kind: "RESERVE", source: "SYSTEM", refId: "genjob_abc", balanceDelta: -10, createdAt: new Date("2026-06-20T01:00:00Z") },
      // an Otto conversation turn — refId "otto-..." → labeled "Chat", not a generation
      { id: "l3", kind: "RESERVE", source: "SYSTEM", refId: "otto-turn:thread1:3", balanceDelta: -35, createdAt: new Date("2026-06-20T02:00:00Z") },
      { id: "l4", kind: "RESERVE", source: "SYSTEM", refId: "genjob_video", balanceDelta: -70, createdAt: new Date("2026-06-20T03:00:00Z") },
    ]);
    genJobFindMany.mockResolvedValue([
      { id: "genjob_abc", kind: "IMAGE" },
      { id: "genjob_video", kind: "VIDEO" },
    ]);

    const res = await getMyAccount();
    if ("error" in res) throw new Error("unexpected error");

    // tenant scoping: never a constant — both reads filter by the resolver's ownerId,
    // and the ledger read excludes hold-only (balanceDelta 0) rows in the DB
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: "orgA" } }));
    expect(organizationFindFirst).toHaveBeenCalledWith({
      where: { id: "orgA", deletedAt: null },
      select: { name: true, settings: true },
    });
    expect(creditLedgerFindMany.mock.calls[0][0].where).toEqual({ orgId: "orgA", balanceDelta: { not: 0 } });
    expect(genJobFindMany.mock.calls[0][0].where).toEqual({ ownerId: "orgA", id: { in: ["genjob_abc", "genjob_video"] } });
    // #592 — the same tenant-scoped Membership query #574 introduced (profile-names.ts'
    // readDisplayName), not a second one that could drift or leak another org's name.
    expect(membershipFindFirst).toHaveBeenCalledWith({
      where: { orgId: "orgA", user: { email: "a@test" } },
      select: { user: { select: { name: true } } },
    });

    expect(res.email).toBe("a@test");
    expect(res.displayName).toBe("Nick QA");
    expect(res.organizationName).toBe("Acme Studio");
    expect(res.balance).toBe(999); // 9990 internal / 10 = 999 displayed
    expect(res.reserved).toBe(10); // 100 / 10
    expect(res.balanceUsd).toBeCloseTo(99.9); // 9990 / 100
    expect(res.recent.map((r) => r.id)).toEqual(["l1", "l2", "l3", "l4"]);
    // Labels come from the shared ledger wording (#683) — the same words /billing shows.
    expect(res.recent[0]).toMatchObject({ label: "Credits added", delta: 1000 });
    expect(res.recent[1]).toMatchObject({ label: "Image", delta: -1 }); // media reserve (genjob refId)
    expect(res.recent[2]).toMatchObject({ label: "Chat", delta: -3.5 }); // otto- refId → conversation cost
    expect(res.recent[3]).toMatchObject({ label: "Video", delta: -7 });
  });

  // #592 — displayName is "" (not null/undefined) when the merchant never set one, same
  // as #574's getMyProfileNames. The sidebar identity area's own fallback to email is
  // pinned separately, against sidebarIdentityLabel (global-navigation.test.ts).
  it("returns an empty displayName when the merchant never set one", async () => {
    mockRequireOwner.mockResolvedValue({ email: "a@test", ownerId: "orgA" });
    membershipFindFirst.mockResolvedValue({ user: { name: null } });
    findUnique.mockResolvedValue({ balance: 0, reserved: 0 });
    creditLedgerFindMany.mockResolvedValue([]);
    const res = await getMyAccount();
    if ("error" in res) throw new Error("unexpected error");
    expect(res.displayName).toBe("");
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

  // Decision ④ (issue #513 §C9): a hold + its settle/refund merge into ONE task row —
  // a merchant reads "what happened", not the RESERVE/SETTLE/REFUND ledger mechanics.
  it("merges an Otto turn's RESERVE + partial-refund SETTLE into one row with a used/refunded detail", async () => {
    mockRequireOwner.mockResolvedValue({ email: "a@test", ownerId: "orgA" });
    findUnique.mockResolvedValue({ balance: 1000, reserved: 0 });
    creditLedgerFindMany.mockResolvedValue([
      // RESERVE held 12.0 displayed credits (120 internal); SETTLE later refunds the
      // unspent 0.4 (4 internal) — actual usage was 11.6. Same refId ⇒ one task.
      { id: "settle1", kind: "SETTLE", source: "SYSTEM", refId: "otto-turn:t1:1", balanceDelta: 4, createdAt: new Date("2026-07-28T10:05:00Z") },
      { id: "reserve1", kind: "RESERVE", source: "SYSTEM", refId: "otto-turn:t1:1", balanceDelta: -120, createdAt: new Date("2026-07-28T10:00:00Z") },
    ]);
    const res = await getMyAccount();
    if ("error" in res) throw new Error("unexpected error");
    expect(res.recent).toHaveLength(1);
    expect(res.recent[0]).toMatchObject({
      id: "settle1", // the later (settling) row anchors the merged entry
      label: "Chat",
      delta: -11.6, // net: -12 + 0.4
      detail: "11.6 credits used · 0.4 refunded",
    });
    expect(res.recent[0].at).toBe("2026-07-28T10:05:00.000Z"); // latest event in the task
    expect(res.recent[0].atLabel).toMatch(/^Jul 28, \d{1,2}:\d{2} [AP]M$/); // fixed-locale, hydration-safe
  });

  // #521 P2: ledger times must follow the merchant's own workspace timezone (the
  // existing Schedule setting), not a hardcoded UTC clock they never chose.
  it("formats ledger times in the workspace's configured timezone, not UTC", async () => {
    mockRequireOwner.mockResolvedValue({ email: "a@test", ownerId: "orgA" });
    findUnique.mockResolvedValue({ balance: 1000, reserved: 0 });
    organizationFindFirst.mockResolvedValue({ name: "Acme Studio", settings: { timezone: "Asia/Tokyo" } }); // UTC+9
    creditLedgerFindMany.mockResolvedValue([
      { id: "g1", kind: "GRANT", reason: "beta signup grant", refId: null, balanceDelta: 100, createdAt: new Date("2026-07-28T20:00:00Z") },
    ]);
    const res = await getMyAccount();
    if ("error" in res) throw new Error("unexpected error");
    // 20:00 UTC + 9h = 05:00 the NEXT day in Asia/Tokyo — proves the tz is actually
    // applied (a UTC-only render would say "Jul 28, 8:00 PM").
    expect(res.recent[0].atLabel).toBe("Jul 29, 5:00 AM");
  });

  it("falls back to the default workspace timezone when settings is null (no crash, no UTC hardcode)", async () => {
    mockRequireOwner.mockResolvedValue({ email: "a@test", ownerId: "orgA" });
    findUnique.mockResolvedValue({ balance: 1000, reserved: 0 });
    organizationFindFirst.mockResolvedValue({ name: "Acme Studio", settings: null });
    creditLedgerFindMany.mockResolvedValue([
      { id: "g1", kind: "GRANT", reason: "beta signup grant", refId: null, balanceDelta: 100, createdAt: new Date("2026-07-28T20:00:00Z") },
    ]);
    const res = await getMyAccount();
    if ("error" in res) throw new Error("unexpected error");
    // DEFAULT_SETTINGS.timezone is "Asia/Kuala_Lumpur" (UTC+8): 20:00 UTC → 4:00 AM next day.
    expect(res.recent[0].atLabel).toBe("Jul 29, 4:00 AM");
  });

  it("merges a failed job's RESERVE + full REFUND into one net-zero row (not two confusing lines)", async () => {
    mockRequireOwner.mockResolvedValue({ email: "a@test", ownerId: "orgA" });
    findUnique.mockResolvedValue({ balance: 1000, reserved: 0 });
    creditLedgerFindMany.mockResolvedValue([
      { id: "refund1", kind: "REFUND", source: "SYSTEM", refId: "genjob_failed", balanceDelta: 20, createdAt: new Date("2026-07-28T11:01:00Z") },
      { id: "reserve2", kind: "RESERVE", source: "SYSTEM", refId: "genjob_failed", balanceDelta: -20, createdAt: new Date("2026-07-28T11:00:00Z") },
    ]);
    genJobFindMany.mockResolvedValue([{ id: "genjob_failed", kind: "IMAGE" }]);
    const res = await getMyAccount();
    if ("error" in res) throw new Error("unexpected error");
    expect(res.recent).toHaveLength(1);
    expect(res.recent[0]).toMatchObject({
      label: "Image",
      delta: 0,
      detail: "Held, then refunded in full",
    });
  });

  // #521 regression: getMyAccount fetches by TASK (refId), not by raw row count. A plain
  // "most recent 25 raw rows" query can put a REFUND inside that window while its paired
  // RESERVE — same refId, same task — sits behind 100+ unrelated rows and never gets
  // fetched at all. The old code then showed the REFUND as a standalone positive
  // "income" line instead of the task's real net (here: 0, refunded in full).
  it("still merges a task's RESERVE with its REFUND even when the RESERVE sits behind 100 unrelated rows", async () => {
    mockRequireOwner.mockResolvedValue({ email: "a@test", ownerId: "orgA" });
    findUnique.mockResolvedValue({ balance: 1000, reserved: 0 });

    const recentRefund = { id: "refund_recent", kind: "REFUND", reason: "", refId: "genjob_old_task", balanceDelta: 20, createdAt: new Date("2026-07-28T12:00:00Z") };
    // 100 unrelated single-row tasks (own null refId, so each is its own task) sitting
    // chronologically between the refund and its own RESERVE.
    const fillers = Array.from({ length: 100 }, (_, i) => ({
      id: `filler_${i}`,
      kind: "ADJUST",
      reason: "",
      refId: null as string | null,
      balanceDelta: 1,
      createdAt: new Date(Date.UTC(2026, 6, 28, 11, 0, 0, 999 - i)), // strictly older than recentRefund, newer than oldReserve (UTC-explicit — no runner-timezone flakiness)
    }));
    const oldReserve = { id: "reserve_old", kind: "RESERVE", reason: "", refId: "genjob_old_task", balanceDelta: -20, createdAt: new Date("2026-01-01T00:00:00Z") };
    const fullTable = [recentRefund, ...fillers, oldReserve]; // already newest-first, like a real `orderBy: createdAt desc`

    creditLedgerFindMany.mockImplementation(async (args: { where: { OR?: Array<{ refId?: { in: string[] }; id?: { in: string[] } }> }; take?: number }) => {
      if (args.where.OR) {
        // Pass 2: task-scoped fetch — must find a task's rows regardless of how far
        // back they sit, so no `take`/date bound here (mirrors the real Prisma query).
        const refIds = args.where.OR.find((o) => o.refId)?.refId?.in ?? [];
        const ids = args.where.OR.find((o) => o.id)?.id?.in ?? [];
        return fullTable.filter((r) => (r.refId && refIds.includes(r.refId)) || ids.includes(r.id));
      }
      // Pass 1: raw recency scan — genuinely bounded, like a real SQL LIMIT.
      return fullTable.slice(0, args.take);
    });

    const res = await getMyAccount();
    if ("error" in res) throw new Error("unexpected error");

    const task = res.recent.find((r) => r.id === "refund_recent" || r.detail === "Held, then refunded in full");
    expect(task).toBeDefined();
    expect(task).toMatchObject({ delta: 0, detail: "Held, then refunded in full" });
    // The old RESERVE must not appear as its own separate line, and the refund must
    // never show up as a standalone +20 "income" row.
    expect(res.recent.find((r) => r.id === "reserve_old")).toBeUndefined();
    expect(res.recent.find((r) => r.delta === 20)).toBeUndefined();
  });

  it("never merges rows across different refIds, or a null-refId GRANT with anything", async () => {
    mockRequireOwner.mockResolvedValue({ email: "a@test", ownerId: "orgA" });
    findUnique.mockResolvedValue({ balance: 1000, reserved: 0 });
    creditLedgerFindMany.mockResolvedValue([
      { id: "g1", kind: "GRANT", reason: "beta grant", refId: null, balanceDelta: 500, createdAt: new Date("2026-07-28T09:00:00Z") },
      { id: "r1", kind: "RESERVE", reason: "", refId: "genjob_1", balanceDelta: -5, createdAt: new Date("2026-07-28T09:01:00Z") },
      { id: "r2", kind: "RESERVE", reason: "", refId: "genjob_2", balanceDelta: -8, createdAt: new Date("2026-07-28T09:02:00Z") },
    ]);
    genJobFindMany.mockResolvedValue([
      { id: "genjob_1", kind: "IMAGE", count: 1, videoOptions: null },
      { id: "genjob_2", kind: "IMAGE", count: 1, videoOptions: null },
    ]);
    const res = await getMyAccount();
    if ("error" in res) throw new Error("unexpected error");
    expect(res.recent.map((r) => r.id)).toEqual(["g1", "r1", "r2"]);
    expect(res.recent.every((r) => r.detail === undefined)).toBe(true);
  });
});

describe("signOutAction", () => {
  it("clears the Better Auth session before redirecting to /login", async () => {
    await expect(signOutAction()).rejects.toThrow("NEXT_REDIRECT:/login");

    expect(mockHeaders).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledWith({ headers: await mockHeaders.mock.results[0].value });
    expect(mockRedirect).toHaveBeenCalledWith("/login");
    expect(mockSignOut.mock.invocationCallOrder[0]).toBeLessThan(mockRedirect.mock.invocationCallOrder[0]);
  });
});
