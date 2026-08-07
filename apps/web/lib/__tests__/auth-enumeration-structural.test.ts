/**
 * #678 r2 — the sign-in doors are indistinguishable in SHAPE, not just in words.
 *
 * Round 1 made the two answers read identically and stopped there. A cross-family review found
 * that identical words are only half of it: the request still BEHAVED differently.
 *
 *   1. TIMING. An address with no account was one allowlist query and out. An address with an
 *      account wrote a verification token, queried again, then waited on the email network —
 *      five slow replies and then a suddenly fast sixth once the per-address cap kicked in.
 *      "Slow ×5 then fast" is a fingerprint of an account existing.
 *   2. FAILURE. An address with no account always succeeded, because nothing was ever handed to
 *      the mail provider on its behalf. An address with an account surfaced `delivery_failed`
 *      the moment the shared provider answered 429 or 5xx — and any public sending surface can
 *      push a shared provider into 429, so that was a signal an attacker could CREATE.
 *   3. PASSWORD. Our own before-hook refused an unknown address before Better Auth ran, walking
 *      straight past Better Auth's dummy password hash — the constant-time step that exists so a
 *      missing user costs the same as a wrong password (sign-in.mjs: `await
 *      ctx.context.password.hash(password)` on the not-found branch).
 *
 * Timing is a poor thing to assert directly — a wall-clock threshold in CI is a flake generator.
 * So these tests assert the STRUCTURE that makes the timing equal, which is both stronger and
 * stable: what the request awaits, in what order, and that delivery is not part of it.
 *
 * The real Better Auth instance and the real database are used throughout: the claim is about
 * what the actual endpoint does, and a mock of the endpoint could not fail this suite.
 */
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

// ── the trace ────────────────────────────────────────────────────────────────────────────────
// Every awaited step we can observe, in the order the request reached it. Populated by the two
// wrappers below, both of which delegate to the REAL implementation.
const trace: string[] = [];

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return { ...actual, emailPort: { send: mockSend } };
});

vi.mock("@/lib/allowlist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/allowlist")>();
  return {
    ...actual,
    isAllowedEmail: async (email: string | null | undefined) => {
      trace.push("allowlist-lookup");
      return actual.isAllowedEmail(email);
    },
  };
});

vi.mock("@/lib/better-auth/sender", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/better-auth/sender")>();
  return {
    ...actual,
    dispatchAuthEmail: (job: Parameters<typeof actual.dispatchAuthEmail>[0]) => {
      trace.push("hand-off-to-background");
      return actual.dispatchAuthEmail(job);
    },
  };
});

const mockHeaders = vi.fn();
vi.mock("next/headers", () => ({ headers: mockHeaders }));

const WITH_ACCOUNT = `p678-known-${randomUUID()}@fikirtive.test`;
const NO_ACCOUNT = `p678-stranger-${randomUUID()}@fikirtive.test`;
// The per-address cap is real and module-scoped, so the endpoint-level case below uses its own
// pair rather than spending what the cases above already spent.
const WITH_ACCOUNT_HTTP = `p678-known-http-${randomUUID()}@fikirtive.test`;
const NO_ACCOUNT_HTTP = `p678-stranger-http-${randomUUID()}@fikirtive.test`;

// Set BEFORE the dynamic imports below, not in a hook: better-auth reads these at construction,
// and the imports are evaluated while the module loads — long before beforeAll runs.
process.env.BETTER_AUTH_SECRET = "x".repeat(40);
process.env.BETTER_AUTH_URL = "http://localhost:3100";
process.env.AUTH_ALLOWED_EMAILS = `${WITH_ACCOUNT},${WITH_ACCOUNT_HTTP}`;
process.env.FOUNDER_ADMIN_EMAILS = "noone@fikirtive.test";

const { prisma } = await import("@fikirtive/db");
const { auth } = await import("@/lib/better-auth/server");
const { authEmailDispatchesSettled } = await import("@/lib/better-auth/sender");
const { requestMagicLink } = await import("@/app/login/actions");

const NEUTRAL = {
  status: "success",
  message: "If this email has access, a sign-in link is on its way — check your inbox.",
};

const verificationCount = () => prisma.betterAuthVerification.count();

beforeEach(() => {
  trace.length = 0;
  mockSend.mockReset();
  mockSend.mockResolvedValue(undefined);
  mockHeaders.mockReset();
  mockHeaders.mockResolvedValue(new Headers({ origin: "http://localhost:3100" }));
});

// ── ① the response does not wait on delivery ─────────────────────────────────────────────────
describe("#678 r2 ① — the request answers while the email is still in flight", () => {
  it("resolves with the neutral success before emailPort.send has settled", async () => {
    let release!: () => void;
    const sendStarted = new Promise<void>((resolveStarted) => {
      mockSend.mockImplementation(
        () =>
          new Promise<void>((resolveSend) => {
            resolveStarted();
            release = () => resolveSend();
          }),
      );
    });

    // RED before r2: sendMagicLink AWAITED the send, so this line could not resolve until
    // `release()` had been called — the request's clock was the mail provider's clock.
    const result = await requestMagicLink({ email: WITH_ACCOUNT, callbackURL: "/" });
    expect(result).toEqual(NEUTRAL);

    await sendStarted;
    // The send is genuinely still open at the moment the merchant already has their answer.
    let settled = false;
    void authEmailDispatchesSettled().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    release();
    await authEmailDispatchesSettled();
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

// ── ② both doors await the same steps, in the same order ─────────────────────────────────────
describe("#678 r2 ② — an address with an account and one without walk the same path", () => {
  it("awaits an identical step sequence and leaves the same trace in the database", async () => {
    const before1 = await verificationCount();
    const known = await requestMagicLink({ email: WITH_ACCOUNT, callbackURL: "/" });
    const knownTrace = [...trace]; // snapshot AT THE MOMENT the request answered
    const knownRows = (await verificationCount()) - before1;

    trace.length = 0;
    const before2 = await verificationCount();
    const stranger = await requestMagicLink({ email: NO_ACCOUNT, callbackURL: "/" });
    const strangerTrace = [...trace];
    const strangerRows = (await verificationCount()) - before2;

    // RED before r2: the stranger's trace was ["allowlist-lookup"] with 0 rows written, while
    // the known address wrote a token, looked the allowlist up a second time and then waited on
    // the network. Same words, different work.
    expect(strangerTrace).toEqual(knownTrace);
    // The hand-off, then the access lookup the BACKGROUND job starts — the same two steps in the
    // same order for both addresses. (The lookup is *started* synchronously inside the hand-off
    // and never awaited by the request; test ① is what proves the request does not wait for it.)
    expect(knownTrace).toEqual(["hand-off-to-background", "allowlist-lookup"]);
    expect(strangerRows).toBe(knownRows);
    expect(knownRows).toBe(1); // a token is minted for BOTH — that is what makes the cost equal
    expect(known).toEqual(NEUTRAL);
    expect(stranger).toEqual(NEUTRAL);

    await authEmailDispatchesSettled();
    // Exactly one of the two addresses was actually written to — the gate did its job, silently.
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].to).toBe(WITH_ACCOUNT);
  });
});

// ── ③ a broken mail provider changes nothing the merchant can see ────────────────────────────
describe("#678 r2 ③ — a 429/5xx from the shared mail provider is an operator signal only", () => {
  it.each([
    ["429 (shared provider under pressure)", "retryable"],
    ["5xx (provider outage)", "retryable"],
    ["a non-retryable rejection", "non_retryable"],
  ])("%s → the merchant still gets the one neutral answer", async (_case, kind) => {
    const { EmailSendError } = await import("@/lib/email");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSend.mockRejectedValue(new EmailSendError("provider detail", kind as "retryable"));

    // RED before r2: this came back {status:"error",reason:"delivery_failed",…} for the address
    // WITH an account, while the stranger's identical request still succeeded.
    const known = await requestMagicLink({ email: WITH_ACCOUNT, callbackURL: "/" });
    const stranger = await requestMagicLink({ email: NO_ACCOUNT, callbackURL: "/" });
    expect(known).toEqual(NEUTRAL);
    expect(known).toEqual(stranger);

    await authEmailDispatchesSettled();

    const lines = log.mock.calls.map((c) => c.join(" "));
    expect(lines.some((l) => l.includes("auth email delivery failed"))).toBe(true);
    for (const line of lines) {
      expect(line).not.toContain(WITH_ACCOUNT);
      expect(line).not.toContain(NO_ACCOUNT);
    }
    log.mockRestore();
  });
});

// ── endpoint-level parity (moved here from better-auth-magic-link-neutral.test.ts) ───────────
describe("#678 r2 — the HTTP endpoint answers both addresses identically", () => {
  const post = (email: string) =>
    auth.handler(
      new Request("http://localhost:3100/api/better-auth/sign-in/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3100" },
        body: JSON.stringify({ email, callbackURL: "/" }),
      }),
    );

  it("same status and same body for an address with an account and one without", async () => {
    const known = await post(WITH_ACCOUNT_HTTP);
    const stranger = await post(NO_ACCOUNT_HTTP);

    expect(known.status).toBe(200);
    expect(stranger.status).toBe(known.status);
    expect(await stranger.json()).toEqual(await known.json());

    await authEmailDispatchesSettled();
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].to).toBe(WITH_ACCOUNT_HTTP);
  });
});

// ── ④ the password door uses Better Auth's own constant-time path ────────────────────────────
describe("#678 r2 ④ — an unknown address at the password door reaches the dummy hash", () => {
  it("lets Better Auth hash the submitted password instead of short-circuiting", async () => {
    const ctx = await auth.$context;
    const hash = vi.spyOn(ctx.password, "hash");

    // RED before r2: our before-hook threw INVALID_EMAIL_OR_PASSWORD at :117-125, so Better
    // Auth's not-found branch — and its dummy hash — never ran for an unknown address.
    await expect(
      auth.api.signInEmail({
        body: { email: NO_ACCOUNT, password: "not-the-password" },
        headers: new Headers({ origin: "http://localhost:3100" }),
      }),
    ).rejects.toMatchObject({ status: "UNAUTHORIZED" });

    expect(hash).toHaveBeenCalledTimes(1);
    expect(hash).toHaveBeenCalledWith("not-the-password");
    hash.mockRestore();
  });

  it("answers an address WITH access and one without with the same refusal", async () => {
    const call = (email: string) =>
      auth.api
        .signInEmail({
          body: { email, password: "not-the-password" },
          headers: new Headers({ origin: "http://localhost:3100" }),
        })
        .then(() => "unexpected-success")
        .catch((e: { status?: string; body?: { code?: string; message?: string } }) =>
          JSON.stringify({ status: e.status, code: e.body?.code, message: e.body?.message }),
        );

    expect(await call(NO_ACCOUNT)).toBe(await call(WITH_ACCOUNT));
  });
});

afterAll(async () => {
  await authEmailDispatchesSettled();
  for (const email of [WITH_ACCOUNT, NO_ACCOUNT, WITH_ACCOUNT_HTTP, NO_ACCOUNT_HTTP]) {
    try {
      await prisma.betterAuthVerification.deleteMany({ where: { identifier: { contains: email } } });
    } catch { /* best-effort cleanup */ }
  }
});
