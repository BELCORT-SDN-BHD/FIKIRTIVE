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
//     → assertSignInDoorForUserId  → throws APIError("FORBIDDEN")
//     → 403 response, no Set-Cookie, no ba_session row
//
// WHY NOT the email+password sign-in endpoint? server.ts ALSO mounts a
// front-door middleware (hooks.before / createAuthMiddleware) that calls
// assertSignInDoor on any "/sign-in*" or "/sign-up*" request carrying an
// email — so that path is blocked BEFORE session.create.before ever runs and
// would not exercise the wiring under test. The OAuth callback ("/callback/
// :provider") has no email in its body and its path does not start with
// "/sign-in", so it bypasses the front door and the deny-by-default guarantee
// rests SOLELY on session.create.before. That is the gap flagged in
// docs/superpowers/handoffs/2026-06-25-betterauth-cutover.md §6 item 2.
//
// "/sign-in/email-otp" is the faithful, deterministic stand-in for the OAuth
// callback: for an already-existing user it skips createUser and goes straight
// to internalAdapter.createSession(user.id) — the identical createSession →
// session.create.before chain — without having to forge signed OAuth state and
// mock Google's token/userinfo endpoints.
//
// It bypasses the front door too, and that is not an accident of routing: its
// path DOES start with "/sign-in" and it DOES carry an email, so the middleware
// would have refused it — server.ts carves it out on purpose, because deciding
// access at that door turns "wrong code" and "no such merchant" into two
// visibly different answers (an account-existence oracle, #678). This test is
// therefore the proof that the carve-out costs nothing: the deny-by-default
// guarantee for the code door rests SOLELY on session.create.before, exactly as
// it does for the OAuth callback.
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
// A founder that is NOT our test subject, and an empty env allowlist, so the blocked address
// below owes its refusal to ONE thing: the operator revoked it.
process.env.FOUNDER_ADMIN_EMAILS = "founder@fikirtive.test";
process.env.AUTH_ALLOWED_EMAILS = "";

const { auth } = await import("@/lib/better-auth/server");
const { prisma } = await import("@fikirtive/db");

const BASE_URL = process.env.BETTER_AUTH_URL as string;
const GATE_MESSAGE = "This email can't sign in.";

/**
 * SIGNIN-A7 —— 这个测试对象换了身份，而换的理由是产品变了，不是断言被放宽。
 *
 * 它以前是「一个**不在名单里**的、已验证的既有用户」。规格 §1.6 把门的判定收窄成三步之后，
 * 「不在名单里」根本不再是拒绝的理由（陌生人本来就该进得来，SIGNIN-A1），所以拿它当被拒的
 * 主体会让这条围栏永远绿不了 —— 也永远证不了任何事。
 *
 * 现在的主体是**被撤销的**地址：这是这条路上仅存的绝对拒绝，也正是 `session.create.before`
 * 存在的全部理由 —— 撤销之后，一个已经存在的身份（OAuth 回调、重复登录）不许再拿到会话。
 *
 * Seeded via raw Prisma so databaseHooks.user.create.before is bypassed — we are simulating a
 * repeat sign-in / pre-existing OAuth identity, the exact case session.create.before is designed
 * to catch.
 */
const blockedEmail = `blocked-${randomUUID()}@example.com`;
const userId = `bau_${randomUUID()}`;

/** Mint a REAL sign-in code for this address and return it. Better Auth's own server-only
 *  endpoint is used rather than a hand-seeded row because the stored value is encrypted under
 *  BETTER_AUTH_SECRET (server.ts, `storeOTP: "encrypted"`) — a forged row would not verify, and a
 *  test that had to reimplement the cipher would pass for the wrong reason. */
async function mintSignInCode(email: string): Promise<string> {
  return auth.api.createVerificationOTP({ body: { email, type: "sign-in" } });
}

beforeAll(async () => {
  await prisma.betterAuthUser.create({
    data: { id: userId, email: blockedEmail, name: "Blocked Tester", emailVerified: true },
  });
  // SIGNIN-A7 —— 操作员撤销了这个地址。这是这条路上唯一还成立的绝对拒绝。
  await prisma.allowedEmail.upsert({
    where: { email: blockedEmail },
    create: { email: blockedEmail, status: "revoked", invitedBy: "operator@fikirtive.test" },
    update: { status: "revoked" },
  });
});

afterAll(async () => {
  // Cascade (onDelete: Cascade) removes any sessions/accounts with the user.
  await prisma.betterAuthUser.deleteMany({ where: { id: userId } });
  // Verification rows have no user FK; drop any our seeds left behind. The address lives in the
  // OTP row's `identifier` (`sign-in-otp-<email>`), never in its `value` — the value is the
  // encrypted code.
  await prisma.betterAuthVerification.deleteMany({
    where: { identifier: { contains: blockedEmail } },
  });
  await prisma.allowedEmail.deleteMany({ where: { email: blockedEmail } });
});

describe("Better Auth sign-in door — session.create.before library wiring (integration)", () => {
  it("SIGNIN-A7 —— blocks a REVOKED user on a front-door-bypassing session path (sign-in code, like the OAuth callback): 403, no session cookie, no ba_session row", async () => {
    const otp = await mintSignInCode(blockedEmail);

    const res = await auth.handler(
      new Request(`${BASE_URL}/api/better-auth/sign-in/email-otp`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE_URL },
        body: JSON.stringify({ email: blockedEmail, otp }),
      }),
    );

    // (3) 403 FORBIDDEN — and specifically the DOOR. Asserting the
    // gate's exact message pins the 403 to assertSignInDoorForUserId (fired from
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
