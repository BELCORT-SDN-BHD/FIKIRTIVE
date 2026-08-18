import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two endpoint-level parity cases that used to live here — "a stranger's sign-in-code request
 * answers exactly like an owner's" and "a stranger's password request is indistinguishable from
 * invalid credentials" — moved to `auth-enumeration-structural.test.ts` (#678 r2).
 *
 * They had to move because they can no longer be honestly asserted here. This file stubs the
 * database down to a single `allowedEmail.findUnique`, which was enough while our own before-hook
 * turned a stranger away before Better Auth's adapter was ever touched. That short-circuit WAS
 * the defect: an address with no account cost one query, an address with an account cost a token
 * write plus a wait on the email network, and the difference was readable on the clock. Both
 * doors now run Better Auth's real flow for every address, so proving parity needs the real
 * adapter — a stubbed one can only prove that the stub was consulted.
 *
 * What stays here is the one claim that never needed the adapter: a removed merchant's
 * password-reset request must not put mail in flight.
 */

const mockAllowedEmailFindUnique = vi.fn();
const mockSend = vi.fn();

vi.mock("@fikirtive/db", () => ({
  prisma: {
    allowedEmail: { findUnique: mockAllowedEmailFindUnique },
  },
}));

vi.mock("@/lib/email", () => ({
  emailPort: { send: mockSend },
}));

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = "x".repeat(40);
  process.env.BETTER_AUTH_URL = "http://localhost:3100";
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  process.env.FOUNDER_ADMIN_EMAILS = "";
  process.env.AUTH_ALLOWED_EMAILS = "";
});

async function resetPasswordFor(email: string) {
  const { auth } = await import("@/lib/better-auth/server");
  const { authEmailQueueSettled } = await import("@/lib/better-auth/sender");
  const context = await auth.$context;
  const sendResetPassword = context.options.emailAndPassword?.sendResetPassword;
  expect(sendResetPassword).toBeTypeOf("function");
  if (!sendResetPassword) throw new Error("sendResetPassword is not configured");

  await expect(
    sendResetPassword({
      user: {
        id: "some-user",
        email,
        emailVerified: true,
        name: "Someone",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      url: "http://localhost:3100/reset-password/token",
      token: "token",
    }),
  ).resolves.toBeUndefined();
  // #678 — the hook queues and returns; the decision happens after. Asserting before this
  // settles would pass for the wrong reason.
  await authEmailQueueSettled();
}

describe("Better Auth enumeration-safe responses", () => {
  beforeEach(async () => {
    // #678 — the queue jitters each job and holds its worker for a fixed floor so that one
    // merchant's email arrival cannot be read as an answer about another merchant's address.
    // This file is about the RESET gate; those delays have their own file
    // (auth-email-queue-executor), so it takes them out.
    const { __configureAuthEmailQueueForTests, __resetAuthEmailCapsForTests } = await import(
      "@/lib/better-auth/sender"
    );
    __configureAuthEmailQueueForTests({ jitterMaxMs: 0, slotFloorMs: 0 });
    // #795 — the per-address outbound cap is a SHARED counter now, not a process-local Map, so it
    // survives the process this test runs in: without this reset the fifth run of this file (or
    // any earlier file that mailed the same address) would suppress the send and the failure would
    // read as "the reset gate is broken". Same reason every other file that mails an address
    // resets it.
    await __resetAuthEmailCapsForTests();
    mockAllowedEmailFindUnique.mockReset();
    mockSend.mockReset();
    mockSend.mockResolvedValue(undefined);
  });

  it("does not send a reset email for a non-allowlisted existing user", async () => {
    mockAllowedEmailFindUnique.mockResolvedValue(null);
    await resetPasswordFor("removed@example.com");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("still sends one for a merchant who does have access", async () => {
    mockAllowedEmailFindUnique.mockResolvedValue({ status: "active" });
    await resetPasswordFor("owner@example.com");
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].to).toBe("owner@example.com");
  });
});
