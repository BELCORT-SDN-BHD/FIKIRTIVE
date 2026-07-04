import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { APIError } from "better-auth/api";

// ---------------------------------------------------------------------------
// INTEGRATION test (not a unit test): drives the REAL better-auth server
// instance against the REAL local Postgres (via @fikirtive/db Prisma) — NO
// mocks. It locks the library wiring that better-auth-gate.test.ts cannot
// reach (that file mocks @fikirtive/db and calls the gate functions directly,
// so better-auth never actually invokes the hook):
//
//   session-issuing request
//     → internalAdapter.createSession
//     → createWithHooks("session")
//     → databaseHooks.session.create.before
//     → assertAllowedForUserId  → throws APIError("FORBIDDEN")
//     → 403 response, no Set-Cookie, no ba_session row
//
// WHY NOT the email+password sign-in endpoint? server.ts ALSO mounts a
// front-door middleware (hooks.before / createAuthMiddleware) that calls
// assertAllowedEmail on any "/sign-in*" or "/sign-up*" request carrying an
// email — so that path is blocked BEFORE session.create.before ever runs and
// would not exercise the wiring under test. The OAuth callback ("/callback/
// :provider") has no email in its body and its path does not start with
// "/sign-in", so it bypasses the front door and the deny-by-default guarantee
// rests SOLELY on session.create.before. That is the gap flagged in
// docs/superpowers/handoffs/2026-06-25-betterauth-cutover.md §6 item 2.
//
// "/magic-link/verify" is the faithful, deterministic stand-in for the OAuth
// callback: same front-door bypass, and for an already-existing user it skips
// createUser and goes straight to internalAdapter.createSession(user.id) —
// the identical createSession → session.create.before chain — without having
// to forge signed OAuth state and mock Google's token/userinfo endpoints.
//
// Requires DATABASE_URL pointing at a local Postgres with the better_auth
// migration applied (same prerequisite as isolation.test.ts).
// ---------------------------------------------------------------------------

// betterAuth() reads these at construction time, so they MUST be set before the
// dynamic import of server.ts below.
process.env.BETTER_AUTH_SECRET ||= "x".repeat(40);
process.env.BETTER_AUTH_URL ||= "http://localhost:3100";
process.env.GOOGLE_CLIENT_ID ||= "test-client-id";
process.env.GOOGLE_CLIENT_SECRET ||= "test-secret";
// Deny-by-default allowlist: a founder that is NOT our test subject, and an
// empty env allowlist. The blocked email (below) is therefore in NONE of
// FOUNDER_ADMIN_EMAILS, AUTH_ALLOWED_EMAILS, or the AllowedEmail table.
process.env.FOUNDER_ADMIN_EMAILS = "founder@artlio.test";
process.env.AUTH_ALLOWED_EMAILS = "";

const { auth } = await import("@/lib/better-auth/server");
const { prisma } = await import("@fikirtive/db");

const BASE_URL = process.env.BETTER_AUTH_URL as string;
const GATE_MESSAGE = "This email isn't on the allowlist.";

// A non-allowlisted, email-verified user that ALREADY EXISTS in ba_user.
// Seeded via raw Prisma so databaseHooks.user.create.before is bypassed — we
// are simulating a repeat sign-in / pre-existing OAuth identity, the exact
// case session.create.before is designed to catch.
const blockedEmail = `blocked-${randomUUID()}@example.com`;
const userId = `bau_${randomUUID()}`;

/** Seed a magic-link verification row (plain-token mode: the URL token is the
 *  stored identifier) and return the raw token to put in the verify URL. */
async function seedMagicLinkToken(email: string): Promise<string> {
  const token = randomUUID().replace(/-/g, "");
  await prisma.betterAuthVerification.create({
    data: {
      id: `bav_${randomUUID()}`,
      identifier: token,
      value: JSON.stringify({ email, name: "Blocked Tester" }),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
  });
  return token;
}

beforeAll(async () => {
  await prisma.betterAuthUser.create({
    data: { id: userId, email: blockedEmail, name: "Blocked Tester", emailVerified: true },
  });
});

afterAll(async () => {
  // Cascade (onDelete: Cascade) removes any sessions/accounts with the user.
  await prisma.betterAuthUser.deleteMany({ where: { id: userId } });
  // Verification rows have no user FK; drop any our seeds left behind.
  await prisma.betterAuthVerification.deleteMany({ where: { value: { contains: blockedEmail } } });
});

describe("Better Auth allowlist gate — session.create.before library wiring (integration)", () => {
  it("blocks a non-allowlisted user on a front-door-bypassing session path (magic-link verify, like the OAuth callback): 403, no session cookie, no ba_session row", async () => {
    const token = await seedMagicLinkToken(blockedEmail);

    const res = await auth.handler(
      new Request(`${BASE_URL}/api/better-auth/magic-link/verify?token=${token}`, {
        method: "GET",
        headers: { origin: BASE_URL },
      }),
    );

    // (3) 403 FORBIDDEN — and specifically the ALLOWLIST gate. Asserting the
    // gate's exact message pins the 403 to assertAllowedForUserId (fired from
    // session.create.before), proving the wiring under test ran.
    expect(res.status).toBe(403);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toBe(GATE_MESSAGE);

    // (2) no session cookie was set
    expect(res.headers.get("set-cookie") ?? "").not.toContain("session_token");

    // (1) no ba_session row was written for this user
    expect(await prisma.betterAuthSession.count({ where: { userId } })).toBe(0);
  });

  it("blocks at the exact seam the OAuth callback uses: internalAdapter.createSession → session.create.before throws FORBIDDEN, writes no ba_session row", async () => {
    const ctx = await auth.$context;
    const err = await ctx.internalAdapter
      .createSession(userId)
      .then(() => null)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(APIError);
    expect((err as APIError).status).toBe("FORBIDDEN");
    expect((err as APIError).message).toBe(GATE_MESSAGE);
    expect(await prisma.betterAuthSession.count({ where: { userId } })).toBe(0);
  });
});
