/**
 * signin-audit-exactly-once.test.ts — #737 AUDIT WRITE DISCIPLINE.
 *
 * One sign-in must leave exactly ONE `auth.signin` row. `convergeIdentity` is called more than
 * once per login by design (Better Auth fires it from both the user-create and the
 * session-create hook, and a second verification click or a racing tab fires it again), and
 * every OTHER step in that function is already idempotent — the account, the personal org, the
 * welcome grant. Only the audit write was not, so a single login was recorded twice, tens of
 * milliseconds apart.
 *
 * Why it matters beyond noise: anything later counted off this table — unusual sign-in
 * frequency, suspicious-location review, a lockout threshold — doubles.
 *
 * These tests use the REAL Prisma client against the local *_test database, and freeze the
 * clock so the dedupe window is exercised deterministically on both sides of its boundary.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = "";
  process.env.FOUNDER_ADMIN_EMAILS = "";
});

const { prisma } = await import("@fikirtive/db");
const { FOUNDER_OWNER_ID } = await import("@fikirtive/core");
const { convergeIdentity } = await import("@/lib/better-auth/converge");

/** Well inside a minute, so a frozen "same login" pair cannot straddle the boundary by accident. */
const T0 = new Date("2026-08-08T10:30:20.000Z");

const emails: string[] = [];

function freshEmail(): string {
  const email = `signin-audit-${randomUUID()}@fikirtive.test`;
  emails.push(email);
  return email;
}

/** The platform-wide sign-in stream, narrowed to one identity via the payload. */
async function signinRows(email: string) {
  return prisma.actionEvent.findMany({
    where: { type: "auth.signin", ownerId: FOUNDER_OWNER_ID, payload: { path: ["email"], equals: email } },
    orderBy: { createdAt: "asc" },
    select: { id: true, ownerId: true, payload: true, createdAt: true },
  });
}

beforeAll(async () => {
  // ActionEvent.ownerId is a foreign key to Organization; the platform stream lives on the
  // founder org, so it has to exist before any of this can be written at all.
  await prisma.organization.upsert({
    where: { id: FOUNDER_OWNER_ID },
    update: {},
    create: { id: FOUNDER_OWNER_ID, name: "Fikirtive" },
  });
});

beforeEach(() => {
  // Only Date is faked: Prisma's own timers and the Postgres clock must keep running.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  for (const email of emails) {
    await prisma.actionEvent.deleteMany({
      where: { type: "auth.signin", payload: { path: ["email"], equals: email } },
    });
  }
});

describe("#737 auth.signin — one login, one row", () => {
  it("a login that fires convergence twice records ONE sign-in", async () => {
    const email = freshEmail();
    await convergeIdentity({ email, name: "Kedai Sate Ayu", emailVerified: true });
    await convergeIdentity({ email, name: "Kedai Sate Ayu", emailVerified: true });

    expect(await signinRows(email)).toHaveLength(1);
  });

  it("the replay does not REWRITE the row it collided with (history stays history)", async () => {
    const email = freshEmail();
    await convergeIdentity({ email, name: "Warung Nasi Lemak", emailVerified: true });
    const [first] = await signinRows(email);
    expect(first).toBeDefined();

    await convergeIdentity({ email, name: "Renamed Later", emailVerified: true });

    const after = await signinRows(email);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(first!.id);
    expect(after[0]!.createdAt.getTime()).toBe(first!.createdAt.getTime());
  });

  it("CONCURRENT convergence (racing tabs) still records ONE sign-in", async () => {
    const email = freshEmail();
    // Converge once first so the account already exists: otherwise the racers collide on the
    // User row instead and never reach the audit write, and this would pass without proving
    // anything about the audit write at all.
    await convergeIdentity({ email, name: "Race Kopitiam", emailVerified: true });
    await Promise.all([
      convergeIdentity({ email, name: "Race Kopitiam", emailVerified: true }),
      convergeIdentity({ email, name: "Race Kopitiam", emailVerified: true }),
      convergeIdentity({ email, name: "Race Kopitiam", emailVerified: true }),
    ]);

    expect(await signinRows(email)).toHaveLength(1);
  });

  it("a LATER sign-in by the same person is still its own row — this dedupes a replay, not a person", async () => {
    const email = freshEmail();
    await convergeIdentity({ email, name: "Repeat Visitor", emailVerified: true });

    vi.setSystemTime(new Date(T0.getTime() + 60_000));
    await convergeIdentity({ email, name: "Repeat Visitor", emailVerified: true });

    expect(await signinRows(email)).toHaveLength(2);
  });

  it("two people signing in at the same moment each get their own row", async () => {
    const a = freshEmail();
    const b = freshEmail();
    await convergeIdentity({ email: a, name: "Shop A", emailVerified: true });
    await convergeIdentity({ email: b, name: "Shop B", emailVerified: true });

    expect(await signinRows(a)).toHaveLength(1);
    expect(await signinRows(b)).toHaveLength(1);
  });

  it("the surviving row still answers WHO signed in, on the platform stream (#735/#568 unchanged)", async () => {
    const email = freshEmail();
    await convergeIdentity({ email, name: "Attribution Check", emailVerified: true });
    await convergeIdentity({ email, name: "Attribution Check", emailVerified: true });

    const [row] = await signinRows(email);
    // ownerId is the event's DATA SCOPE (FK to Organization), never the person; the person is
    // payload.email. Deduping must not quietly change either.
    expect(row!.ownerId).toBe(FOUNDER_OWNER_ID);
    expect(row!.payload).toEqual({ email });
  });
});
