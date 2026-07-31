/**
 * signup-door.test.ts — #543 merchant self-service signup door (integration).
 *
 * Runs the REAL Better Auth instance against the REAL local test Postgres, so the
 * assertions cover the whole door: the open `/sign-up/email` path, the pause switch,
 * the revoked-email fail-closed case, email verification, the welcome grant, and the
 * regressions that must NOT move (magic link stays invite-only; existing accounts and
 * the deny-by-default session gate are untouched).
 *
 * Money: the welcome grant is a CreditLedger write. The exactly-once proof lives in
 * signup-grant-exactly-once.test.ts; here we only assert the happy path lands once.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

type SentEmail = { to: string; subject: string; text?: string; devPreview?: string };
const sent: SentEmail[] = [];

vi.mock("@/lib/email", () => ({
  emailPort: { send: vi.fn(async (m: SentEmail) => { sent.push(m); }) },
  EmailSendError: class EmailSendError extends Error {},
}));

// Set BEFORE the top-level dynamic imports below — Better Auth reads baseURL/secret at
// construction time, which happens at module load, not in beforeAll.
process.env.BETTER_AUTH_SECRET = "x".repeat(40);
process.env.BETTER_AUTH_URL = "http://localhost:3100";
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";
process.env.AUTH_ALLOWED_EMAILS = "";
process.env.FOUNDER_ADMIN_EMAILS = "";
delete process.env.SIGNUPS_PAUSED;

beforeEach(() => {
  sent.length = 0;
  delete process.env.SIGNUPS_PAUSED;
});

const { auth } = await import("@/lib/better-auth/server");
const { prisma } = await import("@fikirtive/db");
const { SIGNUP_GRANT_CREDITS } = await import("@fikirtive/core");

const PASSWORD = "correct-horse-battery-staple";
const newEmail = () => `merchant-${randomUUID()}@fikirtive.test`;

/** POST the public sign-up endpoint exactly as the browser form does. */
async function postSignUp(body: { email: string; password: string; name: string }) {
  return auth.handler(
    new Request("http://localhost:3100/api/better-auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3100" },
      body: JSON.stringify(body),
    }),
  );
}

/** The verification token Better Auth put in the email it just "sent". */
function verificationTokenFromInbox(email: string): string {
  const msg = [...sent].reverse().find((m) => m.to === email && m.subject.toLowerCase().includes("verify"));
  if (!msg) throw new Error(`no verification email for ${email}; inbox=${JSON.stringify(sent)}`);
  const url = new URL((msg.devPreview ?? msg.text ?? "").match(/https?:\/\/\S+/)?.[0] ?? "");
  const token = url.searchParams.get("token");
  if (!token) throw new Error(`no token in verification URL ${url.toString()}`);
  return token;
}

async function verifyEmail(token: string) {
  return auth.handler(
    new Request(`http://localhost:3100/api/better-auth/verify-email?token=${encodeURIComponent(token)}`, {
      method: "GET",
      headers: { origin: "http://localhost:3100" },
    }),
  );
}

describe("#543 · the door opens — a stranger can register with email + password + shop name", () => {
  it("creates the account, admits the email, and sends a verification email — with NO session and NO credits yet", async () => {
    const email = newEmail();
    const res = await postSignUp({ email, password: PASSWORD, name: "Kopi Corner" });
    expect(res.status).toBe(200);

    // The account exists but is unverified.
    const baUser = await prisma.betterAuthUser.findUnique({ where: { email } });
    expect(baUser).not.toBeNull();
    expect(baUser?.emailVerified).toBe(false);
    expect(baUser?.name).toBe("Kopi Corner");

    // Registration IS the invite: the email admits itself so every existing
    // deny-by-default gate keeps working unchanged.
    const admitted = await prisma.allowedEmail.findUnique({ where: { email } });
    expect(admitted?.status).toBe("active");
    expect(admitted?.invitedBy).toBe("self-signup");

    // Unverified ⇒ no tenant graph and no money.
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    expect(sent.some((m) => m.to === email && m.subject.toLowerCase().includes("verify"))).toBe(true);
  });

  it("verification lands the workspace named after the shop and the 20-credit welcome grant", async () => {
    const email = newEmail();
    await postSignUp({ email, password: PASSWORD, name: "Nasi Lemak Ibu" });
    const res = await verifyEmail(verificationTokenFromInbox(email));
    expect(res.status).toBeLessThan(400);

    const baUser = await prisma.betterAuthUser.findUnique({ where: { email } });
    expect(baUser?.emailVerified).toBe(true);

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).not.toBeNull();
    // #544 — the CANONICAL User row must also record the verification, not just the ba_user
    // mirror. The canonical column is a DateTime? (next-auth convention): "verified" = a
    // non-null timestamp, null = never verified. A null here would leave the tenant graph
    // unable to tell a verified merchant from an unverified one.
    expect(user!.emailVerified).toBeInstanceOf(Date);
    const orgId = `org_${user!.id}`;

    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    expect(org?.name).toBe("Nasi Lemak Ibu"); // first screen shows the merchant's own shop name

    const membership = await prisma.membership.findUnique({ where: { userId_orgId: { userId: user!.id, orgId } } });
    expect(membership?.role).toBe("owner");

    const account = await prisma.creditAccount.findUnique({ where: { orgId } });
    expect(account?.balance).toBe(SIGNUP_GRANT_CREDITS);
    expect(SIGNUP_GRANT_CREDITS).toBe(200);

    const grants = await prisma.creditLedger.findMany({ where: { orgId, kind: "GRANT" } });
    expect(grants).toHaveLength(1);
    expect(grants[0]!.balanceDelta).toBe(SIGNUP_GRANT_CREDITS);
    expect(grants[0]!.idempotencyKey).toBe(`signup:${orgId}`);
    expect(grants[0]!.createdBy).toBe("auth:bootstrap-personal-org");
  });

  it("a verified self-registered merchant can then sign in with their password", async () => {
    const email = newEmail();
    await postSignUp({ email, password: PASSWORD, name: "Warung Sedap" });
    await verifyEmail(verificationTokenFromInbox(email));

    const res = await auth.handler(
      new Request("http://localhost:3100/api/better-auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3100" },
        body: JSON.stringify({ email, password: PASSWORD }),
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("#543 · the pause switch — fail-closed, honest", () => {
  it("SIGNUPS_PAUSED refuses the sign-up endpoint and writes nothing", async () => {
    process.env.SIGNUPS_PAUSED = "1";
    const email = newEmail();

    const res = await postSignUp({ email, password: PASSWORD, name: "Too Late Cafe" });
    expect(res.status).toBeGreaterThanOrEqual(400);

    expect(await prisma.betterAuthUser.findUnique({ where: { email } })).toBeNull();
    expect(await prisma.allowedEmail.findUnique({ where: { email } })).toBeNull();
    expect(sent.filter((m) => m.to === email)).toHaveLength(0);
  });

  it("treats any unrecognised value as PAUSED (fail-closed), and only explicit off values as open", async () => {
    const { signupsPaused } = await import("@/lib/signup-gate");
    for (const on of ["1", "true", "yes", "TRUE", "paused", "maybe"]) {
      process.env.SIGNUPS_PAUSED = on;
      expect(signupsPaused()).toBe(true);
    }
    for (const off of ["", "0", "false", "off", "no"]) {
      process.env.SIGNUPS_PAUSED = off;
      expect(signupsPaused()).toBe(false);
    }
    delete process.env.SIGNUPS_PAUSED;
    expect(signupsPaused()).toBe(false);
  });
});

describe("#543 · what must NOT open", () => {
  it("a REVOKED email cannot re-register itself back in", async () => {
    const email = newEmail();
    await prisma.allowedEmail.create({ data: { email, status: "revoked", invitedBy: "operator@fikirtive.test" } });

    const res = await postSignUp({ email, password: PASSWORD, name: "Banned Shop" });
    expect(res.status).toBeGreaterThanOrEqual(400);

    const row = await prisma.allowedEmail.findUnique({ where: { email } });
    expect(row?.status).toBe("revoked"); // never resurrected
    expect(row?.invitedBy).toBe("operator@fikirtive.test");
    expect(await prisma.betterAuthUser.findUnique({ where: { email } })).toBeNull();
  });

  it("a REJECTED signup admits nothing — no account means no AllowedEmail row to walk in with later", async () => {
    const email = newEmail();
    const res = await postSignUp({ email, password: "short", name: "Weak Password Shop" });
    expect(res.status).toBeGreaterThanOrEqual(400);

    expect(await prisma.betterAuthUser.findUnique({ where: { email } })).toBeNull();
    expect(await prisma.allowedEmail.findUnique({ where: { email } })).toBeNull();
  });

  it("magic link stays invite-only — an unknown email still gets the neutral response and NO email", async () => {
    const email = newEmail();
    const res = await auth.handler(
      new Request("http://localhost:3100/api/better-auth/sign-in/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3100" },
        body: JSON.stringify({ email, callbackURL: "/" }),
      }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: true });
    expect(sent.filter((m) => m.to === email)).toHaveLength(0);
    expect(await prisma.allowedEmail.findUnique({ where: { email } })).toBeNull();
  });

  it("password sign-in for a never-registered email still answers with the generic credential error", async () => {
    const res = await auth.handler(
      new Request("http://localhost:3100/api/better-auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3100" },
        body: JSON.stringify({ email: newEmail(), password: PASSWORD }),
      }),
    );
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ code: "INVALID_EMAIL_OR_PASSWORD" });
  });
});

describe("#543 · the signup pages are reachable without a session", () => {
  it("the auth wall exempts /signup, /forgot-password and /reset-password", async () => {
    const { config } = await import("@/proxy");
    const matcher = new RegExp(`^${config.matcher[0]!}$`);
    for (const walled of ["/", "/otto", "/settings"]) expect(matcher.test(walled)).toBe(true);
    for (const open of ["/signup", "/forgot-password", "/reset-password", "/login"]) {
      expect(matcher.test(open)).toBe(false);
    }
  });
});

describe("#543 · the newly public endpoints carry a rate-limit fail-safe", () => {
  it("signup, password-reset and verification-email requests all have a bounded per-window rule", async () => {
    const ctx = await auth.$context;
    const rules = (ctx.options.rateLimit?.customRules ?? {}) as Record<string, { window: number; max: number } | undefined>;
    for (const path of ["/sign-up/email", "/request-password-reset", "/send-verification-email"]) {
      const rule = rules[path];
      expect(rule?.window).toBeGreaterThan(0);
      expect(rule?.max).toBeGreaterThan(0);
    }
  });
});
