/**
 * THE SIGN-IN-CODE DOOR, END TO END (2026-08-18 — Founder ruling: the mailed link becomes a
 * mailed code).
 *
 * Every case here runs the REAL Better Auth instance against the REAL local Postgres. Only the
 * mail transport is mocked, and it is mocked as an inbox rather than as a spy: the code these
 * cases type back in is the one that was actually delivered, so nothing passes because a stub
 * agreed with itself.
 *
 * What it pins, in the order a merchant meets it:
 *   ① asking for a code puts ONE email in the inbox, and that email carries a six-digit code;
 *   ② a wrong code is refused and does not mint a session;
 *   ③ the right code signs them in — and converges their tenant, exactly as the link did;
 *   ④ a code is single-use, and three wrong guesses burn it;
 *   ⑤ the doors that must stay shut: no session for an address off the allowlist even with the
 *      correct code, no session without one, and no reaching into another tenant.
 */
import { describe, it, expect, afterAll, beforeAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

type SentEmail = { to: string; subject: string; text?: string; html?: string; devPreview?: string };
const inbox: SentEmail[] = [];

vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...actual,
    emailPort: {
      send: vi.fn(async (m: SentEmail) => {
        inbox.push(m);
      }),
    },
  };
});

// Better Auth reads these at construction, which happens during the imports below.
process.env.BETTER_AUTH_SECRET = "x".repeat(40);
process.env.BETTER_AUTH_URL = "http://localhost:3100";

/** On the allowlist, and the merchant every happy-path case belongs to. */
const MERCHANT = `otp-merchant-${randomUUID()}@fikirtive.test`;
/** A REAL account that is on NO list — the fail-closed gate's subject. */
const UNLISTED = `otp-unlisted-${randomUUID()}@fikirtive.test`;
/** A second allowlisted merchant, so "one code, one merchant" can be shown rather than assumed. */
const NEIGHBOUR = `otp-neighbour-${randomUUID()}@fikirtive.test`;
process.env.AUTH_ALLOWED_EMAILS = [MERCHANT, NEIGHBOUR].join(",");
process.env.FOUNDER_ADMIN_EMAILS = "noone@fikirtive.test";

const { prisma } = await import("@fikirtive/db");
const { auth } = await import("@/lib/better-auth/server");
const {
  enqueueAuthEmail,
  authEmailQueueSettled,
  __resetAuthEmailCapsForTests,
  __configureAuthEmailQueueForTests,
} = await import("@/lib/better-auth/sender");

const ORIGIN = "http://localhost:3100";
const createdUserIds: string[] = [];

/** Ask for a code the way the login page does — through the queue — and read what arrived. */
async function requestCode(email: string): Promise<string | undefined> {
  inbox.length = 0;
  enqueueAuthEmail({ purpose: "sign-in-code", email, overBudget: false });
  await authEmailQueueSettled();
  return inbox.find((m) => m.to === email)?.devPreview;
}

/** Submit a code at the one OTP door that faces the public. */
function submitCode(email: string, otp: string): Promise<Response> {
  return auth.handler(
    new Request(`${ORIGIN}/api/better-auth/sign-in/email-otp`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ email, otp }),
    }),
  );
}

const sessionsFor = (email: string) =>
  prisma.betterAuthSession.count({ where: { user: { email } } });

beforeAll(async () => {
  // UNLISTED is a real, verified account — the case session.create.before exists for. Seeded
  // through Prisma so `user.create.before` is bypassed: we are testing the REPEAT sign-in, not
  // registration.
  const id = randomUUID();
  createdUserIds.push(id);
  await prisma.betterAuthUser.create({
    data: { id, name: "Unlisted Shop", email: UNLISTED, emailVerified: true },
  });
});

beforeEach(async () => {
  inbox.length = 0;
  await __resetAuthEmailCapsForTests();
  // The queue's jitter and slot floor are asserted in auth-email-queue-executor; here they would
  // only add real seconds to every case.
  __configureAuthEmailQueueForTests({ jitterMaxMs: 0, slotFloorMs: 0 });
  // A live code survives the case that made it (15 minutes), and several cases below count rows
  // or attempts — so each one starts from no outstanding codes rather than from whatever the
  // previous case left behind.
  await prisma.betterAuthVerification.deleteMany({
    where: { identifier: { contains: "otp-" } },
  });
});

// ── ① one press, one email, one six-digit code ───────────────────────────────────────────────
describe("asking for a sign-in code", () => {
  it("puts exactly one email in the merchant's inbox, carrying six digits and no link", async () => {
    const code = await requestCode(MERCHANT);

    expect(inbox.filter((m) => m.to === MERCHANT)).toHaveLength(1);
    expect(code).toMatch(/^\d{6}$/);
    const message = inbox.find((m) => m.to === MERCHANT)!;
    expect(message.subject).toBe("Your Fikirtive sign-in code");
    expect(message.text).toContain(code);
    expect(message.text).not.toMatch(/https?:\/\//);
  });

  it("mints one verification row for that address, and none for anybody else", async () => {
    await requestCode(MERCHANT);
    expect(
      await prisma.betterAuthVerification.count({
        where: { identifier: `sign-in-otp-${MERCHANT}` },
      }),
    ).toBe(1);
    expect(
      await prisma.betterAuthVerification.count({
        where: { identifier: `sign-in-otp-${NEIGHBOUR}` },
      }),
    ).toBe(0);
  });

  /**
   * PRESSING AGAIN RE-SENDS THE SAME CODE — the `resendStrategy: "reuse"` decision, pinned at the
   * behaviour rather than at the config line.
   *
   * RED under Better Auth's default ("rotate"): the second press writes a SECOND row with
   * DIFFERENT digits and leaves the first in place, so the merchant holds two emails of which
   * only one works — and typing the older one spends an attempt belonging to the newer.
   */
  it("re-sends the SAME code when the merchant presses again, leaving one live code", async () => {
    const first = await requestCode(MERCHANT);
    const second = await requestCode(MERCHANT);

    expect(second).toBe(first);
    expect(
      await prisma.betterAuthVerification.count({
        where: { identifier: `sign-in-otp-${MERCHANT}` },
      }),
    ).toBe(1);
    // …and the code from the FIRST email still signs them in, which is the whole point.
    expect((await submitCode(MERCHANT, first!)).status).toBe(200);
  });
});

// ── ② a wrong code buys nothing ──────────────────────────────────────────────────────────────
describe("submitting the wrong code", () => {
  it("is refused, sets no cookie and writes no session", async () => {
    const code = await requestCode(MERCHANT);
    const wrong = code === "000000" ? "111111" : "000000";
    const before = await sessionsFor(MERCHANT);

    const res = await submitCode(MERCHANT, wrong);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.get("set-cookie") ?? "").not.toContain("session_token");
    expect(await sessionsFor(MERCHANT)).toBe(before);
  });

  it("answers a stranger's guess exactly as it answers a merchant's wrong guess", async () => {
    // No code has ever been minted for this address, so the row simply is not there. If that
    // case read differently from "wrong digits for a real code", six random digits would be an
    // account-existence probe.
    await requestCode(MERCHANT);
    const stranger = `otp-nobody-${randomUUID()}@fikirtive.test`;

    const mine = await submitCode(MERCHANT, "000000");
    const theirs = await submitCode(stranger, "000000");

    expect(theirs.status).toBe(mine.status);
    expect(await theirs.json()).toEqual(await mine.json());
  });
});

// ── ③ the right code is a sign-in ────────────────────────────────────────────────────────────
describe("submitting the right code", () => {
  it("creates a session, sets the cookie, and converges the merchant's tenant", async () => {
    const code = await requestCode(MERCHANT);
    const res = await submitCode(MERCHANT, code!);

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toContain("session_token");
    expect(await sessionsFor(MERCHANT)).toBeGreaterThan(0);

    // The same convergence the magic link produced: a canonical User and a personal workspace.
    // #680 — and still NO shop name invented from the address, because this door never asked.
    const user = await prisma.user.findUnique({ where: { email: MERCHANT } });
    expect(user).not.toBeNull();
    const org = await prisma.organization.findUnique({ where: { id: `org_${user!.id}` } });
    expect(org).not.toBeNull();
    expect(org!.name).toBe("");
  });

  it("spends the code — the same six digits do not work twice", async () => {
    const code = await requestCode(MERCHANT);
    expect((await submitCode(MERCHANT, code!)).status).toBe(200);

    const replay = await submitCode(MERCHANT, code!);
    expect(replay.status).toBeGreaterThanOrEqual(400);
  });

  it("belongs to the address it was mailed to — a neighbour cannot use it", async () => {
    const code = await requestCode(MERCHANT);
    const stolen = await submitCode(NEIGHBOUR, code!);
    expect(stolen.status).toBeGreaterThanOrEqual(400);
    expect(await sessionsFor(NEIGHBOUR)).toBe(0);
  });
});

// ── ④ the guess budget lives on the code ─────────────────────────────────────────────────────
describe("the per-code attempt budget", () => {
  it("burns the code after three wrong guesses, so the right one no longer works", async () => {
    const code = await requestCode(MERCHANT);
    const wrong = (n: number) => String(n).padStart(6, "9");
    const sessionsBefore = await sessionsFor(MERCHANT);

    for (let i = 0; i < 3; i++) {
      expect((await submitCode(MERCHANT, wrong(i))).status).toBeGreaterThanOrEqual(400);
    }

    // RED if `allowedAttempts` is ever removed from the plugin's configuration: without it a
    // caller could keep guessing one live code until they found it, and no request-level rate
    // limiter can bring that budget back — it belongs to the CODE, not to the caller.
    const withRealCode = await submitCode(MERCHANT, code!);
    expect(withRealCode.status).toBeGreaterThanOrEqual(400);
    expect(await sessionsFor(MERCHANT)).toBe(sessionsBefore);

    // …and the merchant is not locked out of the product: a fresh code works. A burnt code is
    // never reused either, however the resend strategy is configured.
    const fresh = await requestCode(MERCHANT);
    expect(fresh).not.toBe(code);
    expect((await submitCode(MERCHANT, fresh!)).status).toBe(200);
    expect(await sessionsFor(MERCHANT)).toBe(sessionsBefore + 1);
  });
});

// ── ⑤ what must stay shut ────────────────────────────────────────────────────────────────────
describe("what the code door must never open", () => {
  it("refuses a session for a real account on no allowlist, even with the correct code", async () => {
    // The gate this swap must not loosen. UNLISTED is a real, verified account and the code is
    // genuinely correct — Better Auth would happily open the door. session.create.before is what
    // stops it, and it is still fail-closed after the plugin changed underneath it.
    const otp = await auth.api.createVerificationOTP({
      body: { email: UNLISTED, type: "sign-in" },
    });

    const res = await submitCode(UNLISTED, otp);

    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie") ?? "").not.toContain("session_token");
    expect(await sessionsFor(UNLISTED)).toBe(0);
  });

  it("never mails a code to an address off the allowlist, however it reaches the queue", async () => {
    const stranger = `otp-stranger-${randomUUID()}@fikirtive.test`;
    expect(await requestCode(stranger)).toBeUndefined();
    expect(inbox.filter((m) => m.to === stranger)).toHaveLength(0);
    expect(
      await prisma.betterAuthVerification.count({
        where: { identifier: `sign-in-otp-${stranger}` },
      }),
    ).toBe(0);
  });

  it("leaves the magic-link endpoints unregistered — both of them, server API and HTTP", async () => {
    // The plugin is gone, not merely unused: its server API is absent…
    expect((auth.api as Record<string, unknown>).signInMagicLink).toBeUndefined();
    expect((auth.api as Record<string, unknown>).magicLinkVerify).toBeUndefined();
    // Read as strings: TypeScript already narrows `p.id` to the registered set, so comparing it
    // to "magic-link" is a compile error rather than a runtime check — which is a nice proof in
    // itself, but not one that survives into a test run.
    const pluginIds = (auth.options.plugins ?? []).map((p) => String(p.id));
    expect(pluginIds).not.toContain("magic-link");
    expect(pluginIds).toContain("email-otp");

    // …and so are its two routes.
    const post = await auth.handler(
      new Request(`${ORIGIN}/api/better-auth/sign-in/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ email: MERCHANT, callbackURL: "/" }),
      }),
    );
    expect(post.status).toBe(404);

    const verify = await auth.handler(
      new Request(`${ORIGIN}/api/better-auth/magic-link/verify?token=anything`, {
        method: "GET",
        headers: { origin: ORIGIN },
      }),
    );
    expect(verify.status).toBe(404);
  });
});

afterAll(async () => {
  __configureAuthEmailQueueForTests({});
  const addresses = [MERCHANT, UNLISTED, NEIGHBOUR];
  try {
    await prisma.betterAuthVerification.deleteMany({
      where: { OR: [...addresses, "otp-"].map((s) => ({ identifier: { contains: s } })) },
    });
    const users = await prisma.betterAuthUser.findMany({
      where: { email: { in: addresses } },
      select: { id: true },
    });
    const ids = [...createdUserIds, ...users.map((u) => u.id)];
    await prisma.betterAuthSession.deleteMany({ where: { userId: { in: ids } } });
    await prisma.betterAuthAccount.deleteMany({ where: { userId: { in: ids } } });
    await prisma.betterAuthUser.deleteMany({ where: { email: { in: addresses } } });
    const canonical = await prisma.user.findMany({
      where: { email: { in: addresses } },
      select: { id: true },
    });
    for (const { id } of canonical) {
      await prisma.creditLedger.deleteMany({ where: { orgId: `org_${id}` } });
      await prisma.creditAccount.deleteMany({ where: { orgId: `org_${id}` } });
      await prisma.membership.deleteMany({ where: { orgId: `org_${id}` } });
      await prisma.organization.deleteMany({ where: { id: `org_${id}` } });
    }
    await prisma.user.deleteMany({ where: { email: { in: addresses } } });
    await prisma.allowedEmail.deleteMany({ where: { email: { in: addresses } } });
  } catch {
    /* best-effort cleanup */
  }
});
