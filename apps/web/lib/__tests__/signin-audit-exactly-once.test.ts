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
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = "";
  process.env.FOUNDER_ADMIN_EMAILS = "";
});

const { prisma } = await import("@fikirtive/db");
const { FOUNDER_OWNER_ID } = await import("@fikirtive/core");
const { convergeIdentity } = await import("@/lib/better-auth/converge");
const { signinSessionId } = await import("@/lib/better-auth/signin-session");

/** Frozen well inside a minute. The current design never reads the clock, so freezing changes
 *  nothing about what these tests exercise — it exists so the "same minute" pin below is a
 *  DETERMINISTIC red against the rejected minute-bucket design instead of a coin flip on where
 *  the two calls happened to land relative to a minute boundary. */
const T0 = new Date("2026-08-09T10:30:20.000Z");

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
    const sessionId = newSessionId();
    await convergeIdentity({ email, name: "Kedai Sate Ayu", emailVerified: true, sessionId });
    await convergeIdentity({ email, name: "Kedai Sate Ayu", emailVerified: true, sessionId });

    expect(await signinRows(email)).toHaveLength(1);
  });

  // The load-bearing case for keying on the session rather than a clock window. Two real logins
  // seconds apart — a merchant on their phone and then their laptop — are two events, and a
  // key that folded them together would delete the second one for good. The clock is frozen
  // (see T0) so "the same minute" is a fact of the test, not an accident of when it ran.
  it("TWO real logins in the same minute stay TWO rows", async () => {
    const email = freshEmail();
    await convergeIdentity({ email, name: "Two Devices", emailVerified: true, sessionId: newSessionId() });
    vi.setSystemTime(new Date(T0.getTime() + 15_000)); // 15s later — same minute, by construction
    await convergeIdentity({ email, name: "Two Devices", emailVerified: true, sessionId: newSessionId() });

    expect(new Date().getUTCMinutes()).toBe(T0.getUTCMinutes()); // the premise itself, pinned
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

  // The user-create hook and afterEmailVerification converge WITHOUT a session. Each is the
  // first half of one login whose session-create convergence writes that login's single row —
  // e.g. a first-time magic-link sign-in creates the (already verified) user, then the session.
  it("convergence with NO session records no sign-in at all", async () => {
    const email = freshEmail();
    await convergeIdentity({ email, name: "User Created, Session Next", emailVerified: true });

    expect(await signinRows(email)).toHaveLength(0);
    // The identity itself still converged — this drops the audit row, not the account.
    expect(await prisma.user.findUnique({ where: { email }, select: { id: true } })).not.toBeNull();
  });

  // #756 sits next to this: the founder's own `impersonate.start` already records that the
  // founder became this merchant. A sign-in row here would ALSO put the merchant's name on it.
  it("an IMPERSONATION session records no sign-in for the merchant being impersonated", async () => {
    const email = freshEmail();
    const impersonation = { id: newSessionId(), impersonatedBy: "ba_founder" };

    await convergeIdentity({
      email,
      name: "Impersonated Merchant",
      emailVerified: true,
      sessionId: signinSessionId(impersonation),
    });

    expect(await signinRows(email)).toHaveLength(0);
  });

  // /change-password with revokeOtherSessions deletes the caller's sessions and mints ONE
  // replacement so they stay logged in. They did not log in again — they were already here.
  it("a password-change session ROTATION records no sign-in", async () => {
    const email = freshEmail();
    const rotated = { id: newSessionId() };

    await convergeIdentity({
      email,
      name: "Just Changed Password",
      emailVerified: true,
      sessionId: signinSessionId(rotated, { path: "/change-password" }),
    });

    expect(await signinRows(email)).toHaveLength(0);
  });
});

/** The classifier itself, pinned directly: which session creations are a sign-in and which are a
 *  side effect of an action taken by someone already signed in. */
describe("#737 signinSessionId — session.create is not a synonym for a login", () => {
  it("attributes an ordinary session to its own id", () => {
    expect(signinSessionId({ id: "ba_sess_plain" })).toBe("ba_sess_plain");
    expect(signinSessionId({ id: "ba_sess_plain", impersonatedBy: null }, { path: "/sign-in/email" })).toBe("ba_sess_plain");
  });

  it("refuses an impersonation session — the merchant did not sign in, the founder came in as them", () => {
    expect(signinSessionId({ id: "ba_sess_imp", impersonatedBy: "ba_founder" })).toBeNull();
    // Still refused whatever endpoint it arrives from: the signal is on the session record.
    expect(signinSessionId({ id: "ba_sess_imp", impersonatedBy: "ba_founder" }, { path: "/admin/impersonate-user" })).toBeNull();
  });

  it("refuses the replacement session /change-password mints for an already signed-in person", () => {
    expect(signinSessionId({ id: "ba_sess_rot" }, { path: "/change-password" })).toBeNull();
  });

  it("keeps every real door a sign-in, including when the hook gets no endpoint context", () => {
    for (const path of ["/sign-in/email", "/sign-in/magic-link", "/magic-link/verify", "/callback/google", "/verify-email"]) {
      expect(signinSessionId({ id: "ba_sess_door" }, { path })).toBe("ba_sess_door");
    }
    expect(signinSessionId({ id: "ba_sess_door" }, null)).toBe("ba_sess_door");
    expect(signinSessionId({ id: "ba_sess_door" }, undefined)).toBe("ba_sess_door");
    expect(signinSessionId({ id: "ba_sess_door" }, {})).toBe("ba_sess_door");
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
