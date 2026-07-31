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

  it("matches the invited row case-insensitively", async () => {
    const email = `Sync-${randomUUID()}@Fikirtive.test`.toLowerCase();
    await prisma.allowedEmail.create({ data: { email, status: "invited", invitedBy: "operator@fikirtive.test" } });
    // The login address is stored as typed, in a different case than AllowedEmail.
    const user = await prisma.user.create({
      data: { id: `usr_${randomUUID()}`, email: email.toUpperCase() },
      select: { id: true, email: true },
    });

    await bootstrapPersonalOrg(user.id, user.email);

    expect(await statusOf(email)).toBe("active");
  });

  // The fail-closed half. Revoke won the row; provisioning must abort ENTIRELY rather than
  // leave a live membership owned by a revoked address.
  it("aborts provisioning and rolls back org, membership AND the welcome grant when revoked", async () => {
    const user = await freshInvited();
    await prisma.allowedEmail.update({ where: { email: user.email }, data: { status: "revoked" } });

    const orgId = await bootstrapPersonalOrg(user.id, user.email);

    expect(orgId).toBeNull();
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

    const orgId = await bootstrapPersonalOrg(user.id, user.email);

    expect(orgId).toBeNull();
    expect(await prisma.membership.findFirst({ where: { userId: user.id } })).toBeNull();
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
        await bootstrapPersonalOrg(user.id, user.email);
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
