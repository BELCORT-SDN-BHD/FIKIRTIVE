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
 * THE KEY IS THE SESSION ID, not a clock window. That distinction is what these tests pin from
 * both sides: replays of ONE login collapse to one row, and two genuinely separate logins stay
 * two rows however close together they happen. A time-bucketed key would pass the first half and
 * silently fail the second — and because the dedupe is a DB-level ON CONFLICT DO NOTHING that
 * never rewrites history, a login swallowed that way would be unrecoverable.
 *
 * These tests use the REAL Prisma client against the local *_test database.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = "";
  process.env.FOUNDER_ADMIN_EMAILS = "";
});

const { prisma } = await import("@fikirtive/db");
const { FOUNDER_OWNER_ID } = await import("@fikirtive/core");
const { convergeIdentity } = await import("@/lib/better-auth/converge");

const emails: string[] = [];

function freshEmail(): string {
  const email = `signin-audit-${randomUUID()}@fikirtive.test`;
  emails.push(email);
  return email;
}

/** A Better Auth session id. Real ones come from `session.create.after`; one per sign-in. */
function newSessionId(): string {
  return `ba_sess_${randomUUID()}`;
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
    const sessionId = newSessionId();
    await convergeIdentity({ email, name: "Kedai Sate Ayu", emailVerified: true, sessionId });
    await convergeIdentity({ email, name: "Kedai Sate Ayu", emailVerified: true, sessionId });

    expect(await signinRows(email)).toHaveLength(1);
  });

  // The load-bearing case for keying on the session rather than a clock window. Two real logins
  // seconds apart — a merchant on their phone and then their laptop — are two events, and a
  // key that folded them together would delete the second one for good.
  it("TWO real logins in the same minute stay TWO rows", async () => {
    const email = freshEmail();
    await convergeIdentity({ email, name: "Two Devices", emailVerified: true, sessionId: newSessionId() });
    await convergeIdentity({ email, name: "Two Devices", emailVerified: true, sessionId: newSessionId() });

    expect(await signinRows(email)).toHaveLength(2);
  });

  it("the replay does not REWRITE the row it collided with (history stays history)", async () => {
    const email = freshEmail();
    const sessionId = newSessionId();
    await convergeIdentity({ email, name: "Warung Nasi Lemak", emailVerified: true, sessionId });
    const [first] = await signinRows(email);
    expect(first).toBeDefined();

    await convergeIdentity({ email, name: "Renamed Later", emailVerified: true, sessionId });

    const after = await signinRows(email);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(first!.id);
    expect(after[0]!.createdAt.getTime()).toBe(first!.createdAt.getTime());
  });

  it("CONCURRENT convergence of one login (racing tabs) still records ONE sign-in", async () => {
    const email = freshEmail();
    const sessionId = newSessionId();
    // Converge once first so the account already exists: otherwise the racers collide on the
    // User row instead and never reach the audit write, and this would pass without proving
    // anything about the audit write at all.
    await convergeIdentity({ email, name: "Race Kopitiam", emailVerified: true, sessionId });
    await Promise.all([
      convergeIdentity({ email, name: "Race Kopitiam", emailVerified: true, sessionId }),
      convergeIdentity({ email, name: "Race Kopitiam", emailVerified: true, sessionId }),
      convergeIdentity({ email, name: "Race Kopitiam", emailVerified: true, sessionId }),
    ]);

    expect(await signinRows(email)).toHaveLength(1);
  });

  // Registration is not a sign-in. The user-create hook and afterEmailVerification converge
  // WITHOUT a session; the only shape that reaches them with no session to follow is
  // self-service signup held at requireEmailVerification, which has not signed in yet.
  it("convergence with NO session records no sign-in at all", async () => {
    const email = freshEmail();
    await convergeIdentity({ email, name: "Registered Not Signed In", emailVerified: true });

    expect(await signinRows(email)).toHaveLength(0);
    // The identity itself still converged — this drops the audit row, not the account.
    expect(await prisma.user.findUnique({ where: { email }, select: { id: true } })).not.toBeNull();
  });

  it("two people signing in at the same moment each get their own row", async () => {
    const a = freshEmail();
    const b = freshEmail();
    await convergeIdentity({ email: a, name: "Shop A", emailVerified: true, sessionId: newSessionId() });
    await convergeIdentity({ email: b, name: "Shop B", emailVerified: true, sessionId: newSessionId() });

    expect(await signinRows(a)).toHaveLength(1);
    expect(await signinRows(b)).toHaveLength(1);
  });

  it("the surviving row still answers WHO signed in, on the platform stream (#735/#568 unchanged)", async () => {
    const email = freshEmail();
    const sessionId = newSessionId();
    await convergeIdentity({ email, name: "Attribution Check", emailVerified: true, sessionId });
    await convergeIdentity({ email, name: "Attribution Check", emailVerified: true, sessionId });

    const [row] = await signinRows(email);
    // ownerId is the event's DATA SCOPE (FK to Organization), never the person; the person is
    // payload.email. Deduping must not quietly change either.
    expect(row!.ownerId).toBe(FOUNDER_OWNER_ID);
    expect(row!.payload).toEqual({ email });
  });
});
