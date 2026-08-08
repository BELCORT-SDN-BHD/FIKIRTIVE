/**
 * signup-grant-exactly-once.test.ts — #543 MONEY PATH.
 *
 * The signup welcome grant is a CreditLedger write. Whatever re-fires it — a second
 * verification click, a re-login, two browser tabs racing, a retried request — the
 * merchant must end up with exactly ONE grant row and exactly SIGNUP_GRANT_CREDITS.
 * Exactly-once is enforced by the DB: grantCreditsTx inserts with
 * `skipDuplicates` on the (orgId, idempotencyKey) unique index, so the duplicate
 * insert affects 0 rows and the account is never touched a second time.
 *
 * These tests use the REAL Prisma client against the local *_test database.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";

beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = "";
  process.env.FOUNDER_ADMIN_EMAILS = "";
});

const { prisma } = await import("@fikirtive/db");
const { SIGNUP_GRANT_CREDITS } = await import("@fikirtive/core");
const { bootstrapPersonalOrg } = await import("@/lib/auth-guard");
const { convergeIdentity } = await import("@/lib/better-auth/converge");

async function freshUser(name?: string): Promise<{ id: string; email: string }> {
  const email = `grant-${randomUUID()}@fikirtive.test`;
  return prisma.user.create({
    data: { id: `usr_${randomUUID()}`, email, ...(name ? { name } : {}) },
    select: { id: true, email: true },
  });
}

async function ledgerFacts(orgId: string) {
  const rows = await prisma.creditLedger.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
  const account = await prisma.creditAccount.findUnique({ where: { orgId } });
  return { rows, balance: account?.balance ?? null, reserved: account?.reserved ?? null };
}

describe("#543 signup grant — exactly-once", () => {
  it("grants SIGNUP_GRANT_CREDITS once, under the stable key, attributed to the bootstrap writer", async () => {
    const user = await freshUser("Roti Bakar Co");
    const orgId = await bootstrapPersonalOrg(user.id, user.email);
    expect(orgId).toBe(`org_${user.id}`);

    const { rows, balance, reserved } = await ledgerFacts(orgId!);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("GRANT");
    expect(rows[0]!.source).toBe("BETA");
    expect(rows[0]!.balanceDelta).toBe(SIGNUP_GRANT_CREDITS);
    expect(rows[0]!.reservedDelta).toBe(0);
    expect(rows[0]!.idempotencyKey).toBe(`signup:${orgId}`);
    expect(rows[0]!.createdBy).toBe("auth:bootstrap-personal-org");
    expect(balance).toBe(SIGNUP_GRANT_CREDITS);
    expect(reserved).toBe(0);
    // the ledger reconstructs the account (balance == Σ balanceDelta)
    expect(rows.reduce((s, r) => s + r.balanceDelta, 0)).toBe(balance);
  });

  it("a SECOND trigger is a zero-effect replay — one row, same balance", async () => {
    const user = await freshUser("Second Trigger Shop");
    const orgId = (await bootstrapPersonalOrg(user.id, user.email))!;
    const first = await ledgerFacts(orgId);

    await bootstrapPersonalOrg(user.id, user.email);
    await convergeIdentity({ email: user.email, name: "Second Trigger Shop", emailVerified: true });
    await convergeIdentity({ email: user.email, name: "Second Trigger Shop", emailVerified: true });

    const after = await ledgerFacts(orgId);
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0]!.id).toBe(first.rows[0]!.id);
    expect(after.balance).toBe(SIGNUP_GRANT_CREDITS);
  });

  it("CONCURRENT triggers (two tabs) still grant exactly once", async () => {
    const user = await freshUser("Race Condition Cafe");
    const orgId = `org_${user.id}`;

    await Promise.all([
      bootstrapPersonalOrg(user.id, user.email),
      bootstrapPersonalOrg(user.id, user.email),
      bootstrapPersonalOrg(user.id, user.email),
    ]);

    const { rows, balance } = await ledgerFacts(orgId);
    expect(rows).toHaveLength(1);
    expect(balance).toBe(SIGNUP_GRANT_CREDITS);
  });

  it("an UNVERIFIED identity converges nothing — no user row, no org, no money", async () => {
    const email = `unverified-${randomUUID()}@fikirtive.test`;
    await convergeIdentity({ email, name: "Not Verified Yet", emailVerified: false });
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    expect(await prisma.organization.count({ where: { name: "Not Verified Yet" } })).toBe(0);
  });

  it("#544 — a verified convergence stamps the canonical User.emailVerified, and is set-once", async () => {
    const email = `verify-stamp-${randomUUID()}@fikirtive.test`;
    await convergeIdentity({ email, name: "Verified Shop", emailVerified: true });

    const user = await prisma.user.findUnique({ where: { email }, select: { emailVerified: true } });
    expect(user?.emailVerified).toBeInstanceOf(Date);

    // Set-once: a later convergence never re-stamps a fresh timestamp over the original.
    const firstStamp = user!.emailVerified!;
    await convergeIdentity({ email, name: "Verified Shop", emailVerified: true });
    const again = await prisma.user.findUnique({ where: { email }, select: { emailVerified: true } });
    expect(again?.emailVerified?.getTime()).toBe(firstStamp.getTime());
  });

  it("names the workspace after the shop, and leaves it unset when no shop name was given", async () => {
    const named = await freshUser("Kedai Kopi Aman");
    const namedOrg = (await bootstrapPersonalOrg(named.id, named.email))!;
    expect((await prisma.organization.findUnique({ where: { id: namedOrg } }))?.name).toBe("Kedai Kopi Aman");

    // #680 — the magic-link/invite door never asks for a shop name, so there is nothing to
    // write. This used to fall back to the merchant's email address, which /profile then showed
    // back to them as "Your shop name". Unset is the truthful state; /profile asks for it.
    const anonymous = await freshUser();
    const anonymousOrg = (await bootstrapPersonalOrg(anonymous.id, anonymous.email))!;
    expect((await prisma.organization.findUnique({ where: { id: anonymousOrg } }))?.name).toBe("");
  });

  it("never RENAMES an existing workspace on a later bootstrap", async () => {
    const user = await freshUser("Original Name");
    const orgId = (await bootstrapPersonalOrg(user.id, user.email))!;
    await prisma.user.update({ where: { id: user.id }, data: { name: "Renamed Later" } });
    await bootstrapPersonalOrg(user.id, user.email);
    expect((await prisma.organization.findUnique({ where: { id: orgId } }))?.name).toBe("Original Name");
  });
});
