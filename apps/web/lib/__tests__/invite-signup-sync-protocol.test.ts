/**
 * invite-signup-sync-protocol.test.ts — #538 round 3.
 *
 * The admin can revoke a pending invite while the invited merchant is signing up. These are
 * two separate transactions, so wrapping either side in a read-then-write proves nothing at
 * Read Committed: "no membership yet" can be observed, the signup can commit, and the revoke
 * can still land — leaving a LIVE membership owned by an address marked `revoked`.
 *
 * The fix is a synchronization protocol on ONE row rather than an isolation level. Both sides
 * issue a CONDITIONAL update against the same AllowedEmail row:
 *
 *     signup  UPDATE … SET status='active'  WHERE email=… AND status='invited'
 *     revoke  UPDATE … SET status='revoked' WHERE email=… AND status='invited'
 *
 * Postgres locks the row per UPDATE and re-evaluates the WHERE against the newly committed
 * version, so exactly one of them can match. The loser sees the winner's state and yields:
 * signup aborts its whole provisioning tx (fail-closed), or revoke reports "no pending invite".
 *
 * These tests use the REAL Prisma client and REAL transactions against the local *_test
 * database — a mock cannot demonstrate row-level serialization.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

// Partial mock: keep the REAL bootstrapPersonalOrg (it is the subject under test) and stub only
// requireRole, which is what revokeTenantInvite imports from this module. Without this the
// revoke action would fail at the gate and never reach the DB protocol.
vi.mock("@/lib/auth-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guard")>();
  return {
    ...actual,
    requireRole: vi.fn().mockResolvedValue({ email: "admin@fikirtive.test", role: "super-admin" }),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = "";
  process.env.FOUNDER_ADMIN_EMAILS = "";
});

const { prisma } = await import("@fikirtive/db");
const { bootstrapPersonalOrg } = await import("@/lib/auth-guard");
const { revokeTenantInvite } = await import("@/lib/tenant-actions");

async function freshInvited(): Promise<{ id: string; email: string }> {
  const email = `sync-${randomUUID()}@fikirtive.test`;
  await prisma.allowedEmail.create({ data: { email, status: "invited", invitedBy: "operator@fikirtive.test" } });
  const user = await prisma.user.create({
    data: { id: `usr_${randomUUID()}`, email },
    select: { id: true, email: true },
  });
  return user;
}

async function statusOf(email: string): Promise<string | null> {
  const row = await prisma.allowedEmail.findUnique({ where: { email }, select: { status: true } });
  return row?.status ?? null;
}

describe("#538 invite/signup sync protocol — registration side", () => {
  // Premise the whole protocol rests on, and a real display bug on its own: self-signup used
  // skipDuplicates, so an operator-invited address stayed "invited" forever after the merchant
  // was already inside — permanently "pending" in /admin/tenants.
  it("flips the operator's invited row to active when the membership is created", async () => {
    const user = await freshInvited();
    expect(await statusOf(user.email)).toBe("invited");

    const orgId = await bootstrapPersonalOrg(user.id, user.email);

    expect(orgId).toBe(`org_${user.id}`);
    expect(await statusOf(user.email)).toBe("active");
  });

  it("normalizes a mixed-case login address onto the canonical lowercase row", async () => {
    const email = `sync-${randomUUID()}@fikirtive.test`;
    await prisma.allowedEmail.create({ data: { email, status: "invited", invitedBy: "operator@fikirtive.test" } });
    // The login address is stored as typed, in a different case than AllowedEmail.
    const user = await prisma.user.create({
      data: { id: `usr_${randomUUID()}`, email: email.toUpperCase() },
      select: { id: true, email: true },
    });

    await bootstrapPersonalOrg(user.id, user.email);

    expect(await statusOf(email)).toBe("active");
  });

  // #538 round 4 (P1) — AllowedEmail.email is a plain TEXT primary key, so `a@b.com` and
  // `A@b.com` CAN coexist. If provisioning matched case-insensitively while revoke matched
  // lowercase-exact, the two sides would arbitrate over DIFFERENT physical rows and the split
  // state would return. Both sides now name the canonical lowercase row only; a case-variant
  // row is inert. (The durable fix, a lower(email) unique constraint, is #578.)
  it("touches ONLY the canonical lowercase row, never a case-variant one", async () => {
    const lower = `variant-${randomUUID()}@fikirtive.test`;
    const variant = lower.toUpperCase();
    await prisma.allowedEmail.create({ data: { email: lower, status: "invited", invitedBy: "operator@fikirtive.test" } });
    await prisma.allowedEmail.create({ data: { email: variant, status: "invited", invitedBy: "operator@fikirtive.test" } });
    const user = await prisma.user.create({
      data: { id: `usr_${randomUUID()}`, email: lower },
      select: { id: true, email: true },
    });

    await bootstrapPersonalOrg(user.id, user.email);

    expect(await statusOf(lower)).toBe("active");
    // The case-variant row must be untouched — provisioning must not flip it to active.
    expect(await statusOf(variant)).toBe("invited");
  });

  // The reviewer's exact counter-example: revoke flips the canonical row, and provisioning
  // must NOT then activate itself off a case-variant row.
  it("still aborts when the canonical row is revoked even if a case-variant row says invited", async () => {
    const lower = `ce-${randomUUID()}@fikirtive.test`;
    const variant = lower.toUpperCase();
    await prisma.allowedEmail.create({ data: { email: lower, status: "revoked", invitedBy: "operator@fikirtive.test" } });
    await prisma.allowedEmail.create({ data: { email: variant, status: "invited", invitedBy: "operator@fikirtive.test" } });
    const user = await prisma.user.create({
      data: { id: `usr_${randomUUID()}`, email: variant },
      select: { id: true, email: true },
    });

    await expect(bootstrapPersonalOrg(user.id, user.email)).rejects.toThrow(/revoked/i);

    expect(await prisma.membership.findFirst({ where: { userId: user.id } })).toBeNull();
    expect(await statusOf(lower)).toBe("revoked");
    // Deterministic half of this test. A case-INSENSITIVE update would have flipped the
    // variant row to 'active' here; only the abort itself was ever order-dependent, because
    // an unordered insensitive findFirst may or may not return the revoked row.
    expect(await statusOf(variant)).toBe("invited");
  });

  // The fail-closed half. Revoke won the row; provisioning must abort ENTIRELY rather than
  // leave a live membership owned by a revoked address.
  it("aborts provisioning and rolls back org, membership AND the welcome grant when revoked", async () => {
    const user = await freshInvited();
    await prisma.allowedEmail.update({ where: { email: user.email }, data: { status: "revoked" } });

    await expect(bootstrapPersonalOrg(user.id, user.email)).rejects.toThrow(/revoked/i);
    const expectedOrgId = `org_${user.id}`;
    expect(await prisma.organization.findUnique({ where: { id: expectedOrgId } })).toBeNull();
    expect(await prisma.membership.findFirst({ where: { userId: user.id } })).toBeNull();
    // MONEY PATH: the welcome grant lives in this same transaction. A revoked address must
    // never be granted credits, and no half-written ledger may survive the abort.
    expect(await prisma.creditLedger.findMany({ where: { orgId: expectedOrgId } })).toHaveLength(0);
    expect(await prisma.creditAccount.findUnique({ where: { orgId: expectedOrgId } })).toBeNull();
    // The revoke stands — provisioning does not quietly re-open the door.
    expect(await statusOf(user.email)).toBe("revoked");
  });

  it("leaves a plain (never-invited) signup untouched by the protocol", async () => {
    const email = `plain-${randomUUID()}@fikirtive.test`;
    const user = await prisma.user.create({
      data: { id: `usr_${randomUUID()}`, email },
      select: { id: true, email: true },
    });

    const orgId = await bootstrapPersonalOrg(user.id, user.email);

    expect(orgId).toBe(`org_${user.id}`);
    // No AllowedEmail row existed; the conditional update matched nothing and invented nothing.
    expect(await statusOf(email)).toBeNull();
  });
});

// #538 round 5 (P2) — the converge-layer log test in better-auth-converge.test.ts mocks
// bootstrapPersonalOrg away and hand-rolls the Error, so it never exercises the real
// RevokedDuringProvisioning constructor nor auth-guard's own log line. This drives the WHOLE
// chain against the real database: real revoked row → real bootstrap → real sentinel →
// convergeIdentity → both production log lines.
describe("#538 provisioning refusal — real chain, real logs", () => {
  it("emits both production log lines and never puts the address in any of them", async () => {
    const { convergeIdentity } = await import("@/lib/better-auth/converge");
    const email = `chain-${randomUUID()}@fikirtive.test`;
    await prisma.allowedEmail.create({ data: { email, status: "revoked", invitedBy: "operator@fikirtive.test" } });
    await prisma.user.create({ data: { id: `usr_${randomUUID()}`, email } });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // The refusal propagates all the way out of convergeIdentity, not swallowed as non-fatal.
      await expect(convergeIdentity({ email, name: "Chain Co", emailVerified: true })).rejects.toThrow(/revoked/i);

      const errors = errorSpy.mock.calls.map((c) => c.map(String).join(" "));
      // Line 1 — auth-guard, at the point the transaction is aborted.
      expect(errors).toContain("auth-guard: provisioning refused — address revoked during signup");
      // Line 2 — converge, refusing to degrade it into a non-fatal hiccup.
      expect(errors).toContain("[better-auth] converge: provisioning refused — address revoked during signup");
      // Not downgraded to the generic non-fatal warning anywhere along the chain.
      const warnings = warnSpy.mock.calls.map((c) => c.map(String).join(" "));
      expect(warnings.join(" ")).not.toMatch(/converge bootstrap failed|convergeIdentity failed/);
      // #575 log discipline — the address is user content and must appear in NO log argument,
      // including via any Error.message that a generic handler might interpolate.
      expect([...errors, ...warnings].join(" ")).not.toContain(email);
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }

    // And the refusal really was fail-closed: nothing was provisioned.
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    expect(await prisma.membership.findFirst({ where: { userId: user!.id } })).toBeNull();
    expect(await statusOf(email)).toBe("revoked");
  });
});

describe("#538 invite/signup sync protocol — the two sides serialize", () => {
  // The interleaving the reviewer said was never actually tested: signup commits first, THEN
  // the admin clicks Revoke on a row the page still shows as pending.
  it("signup first → the admin's revoke finds no pending invite and refuses", async () => {
    const user = await freshInvited();
    await bootstrapPersonalOrg(user.id, user.email);
    expect(await statusOf(user.email)).toBe("active");

    const res = await revokeTenantInvite(user.email);

    expect(res).toHaveProperty("error");
    expect(await statusOf(user.email)).toBe("active");
  });

  // Isolates the CONDITIONAL UPDATE from the best-effort membership pre-check: with the
  // membership deleted, the pre-check has nothing to find, so only the `status='invited'`
  // predicate can be doing the work. It still refuses.
  it("refuses on an activated row even when no membership exists to veto it", async () => {
    const user = await freshInvited();
    await bootstrapPersonalOrg(user.id, user.email);
    await prisma.membership.deleteMany({ where: { userId: user.id } });
    expect(await statusOf(user.email)).toBe("active");

    const res = await revokeTenantInvite(user.email);

    expect(res).toEqual({ error: "No pending invite for that address." });
    expect(await statusOf(user.email)).toBe("active");
  });

  // The mirror image: the admin commits first, then provisioning runs.
  it("revoke first → provisioning aborts and the address stays revoked", async () => {
    const user = await freshInvited();

    const res = await revokeTenantInvite(user.email);
    expect(res).toEqual({ ok: true });
    expect(await statusOf(user.email)).toBe("revoked");

    await expect(bootstrapPersonalOrg(user.id, user.email)).rejects.toThrow(/revoked/i);

    expect(await prisma.membership.findFirst({ where: { userId: user.id } })).toBeNull();
    expect(await statusOf(user.email)).toBe("revoked");
  });

  // #538 round 4 (P2) — the tests above drive the two sides SERIALLY, which cannot demonstrate
  // the claim the protocol actually rests on: that a competing UPDATE blocks on the row lock
  // and then re-evaluates its WHERE against the newly committed version. This one creates real
  // lock contention. Interactive transactions each hold their own pooled connection, so the
  // outer statement genuinely waits on the open transaction rather than on JS scheduling.
  it("makes a competing UPDATE block on the row lock, then match 0 rows after the winner commits", async () => {
    // Guard against a false green on a single-connection pool: if only ONE connection were
    // available, side B would be queued waiting for a POOL SLOT, not for the row lock, and the
    // "still pending" assertion below would pass while proving nothing.
    const poolMax = Number(process.env.DB_POOL_MAX) || 10; // packages/db/src/index.ts default
    expect(poolMax, "this test needs at least 2 pooled connections to be meaningful").toBeGreaterThanOrEqual(2);

    const user = await freshInvited();
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const deferred = () => { let go!: () => void; const p = new Promise<void>((r) => (go = r)); return { p, go }; };

    const aHasConnection = deferred();
    const bHasConnection = deferred();
    const aMayTakeLock = deferred();
    const aMayCommit = deferred();
    const bMayUpdate = deferred();
    const lockIsHeld = deferred();

    // Both sides run in EXPLICIT interactive transactions, and each one first performs a
    // trivial read and awaits it. Once both of those have returned, both transactions
    // demonstrably hold their own connection — so anything B waits for afterwards can only be
    // the row lock, never pool acquisition. That barrier is the whole point of this test.
    const sideA = prisma.$transaction(
      async (tx) => {
        await tx.allowedEmail.count({ where: { email: `barrier-a-${randomUUID()}@none.test` } });
        aHasConnection.go();
        await aMayTakeLock.p;
        const r = await tx.allowedEmail.updateMany({
          where: { email: user.email, status: "invited" },
          data: { status: "revoked" },
        });
        lockIsHeld.go();
        await aMayCommit.p;
        return r.count;
      },
      { timeout: 30_000, maxWait: 15_000 },
    );

    let sideBSettled = false;
    const sideB = prisma.$transaction(
      async (tx) => {
        await tx.allowedEmail.count({ where: { email: `barrier-b-${randomUUID()}@none.test` } });
        bHasConnection.go();
        await bMayUpdate.p;
        const r = await tx.allowedEmail.updateMany({
          where: { email: user.email, status: "invited" },
          data: { status: "active" },
        });
        sideBSettled = true;
        return r.count;
      },
      { timeout: 30_000, maxWait: 15_000 },
    );

    // BARRIER: neither side has touched the contended row yet, and both hold a connection.
    await Promise.all([aHasConnection.p, bHasConnection.p]);

    aMayTakeLock.go();
    await lockIsHeld.p; // A now holds the row lock inside an uncommitted transaction
    bMayUpdate.go();

    await sleep(600);
    expect(sideBSettled, "the competing UPDATE should still be waiting on the row lock").toBe(false);

    aMayCommit.go();
    expect(await sideA).toBe(1);

    // After the winner commits, the blocked UPDATE re-evaluates `status='invited'` against the
    // committed row (now 'revoked') and matches nothing. This is the serialization the whole
    // protocol depends on, measured rather than asserted from the docs.
    expect(await sideB).toBe(0);
    expect(await statusOf(user.email)).toBe("revoked");
  });

  // Whoever loses, the forbidden end state — live membership + revoked row — is unreachable.
  it("never leaves a live membership owned by a revoked address, in either order", async () => {
    for (const signupFirst of [true, false]) {
      const user = await freshInvited();
      if (signupFirst) {
        await bootstrapPersonalOrg(user.id, user.email);
        await revokeTenantInvite(user.email);
      } else {
        await revokeTenantInvite(user.email);
        // Provisioning now REFUSES loudly for a revoked address. Swallow it here: this test
        // is about the END STATE the two orders can produce, not about how the loser reports.
        await bootstrapPersonalOrg(user.id, user.email).catch(() => null);
      }
      const status = await statusOf(user.email);
      const membership = await prisma.membership.findFirst({ where: { userId: user.id, deletedAt: null } });
      expect(
        status === "revoked" && membership !== null,
        `forbidden split state (signupFirst=${signupFirst}): status=${status}, membership=${membership?.id}`,
      ).toBe(false);
    }
  });
});
