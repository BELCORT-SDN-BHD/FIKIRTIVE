import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The login page's server action. What this file pins is narrow and complementary to
 * `lib/__tests__/auth-enumeration-structural.test.ts` (real Better Auth, real database, real
 * queue): the CONTRACT this action is allowed to express at all, and the fact that it does
 * nothing but translate the one request path into that contract.
 */

const queued: Array<Record<string, unknown>> = [];

vi.mock("@/lib/better-auth/sender", () => ({
  enqueueAuthEmail: (job: Record<string, unknown>) => {
    queued.push(job);
  },
}));

const mockHeaders = vi.fn();
vi.mock("next/headers", () => ({ headers: mockHeaders }));

const { requestSignInCode } = await import("../actions");
const { __resetSignInCodeThrottleForTests } = await import("@/lib/better-auth/signin-code-request");

const NEUTRAL = {
  status: "success",
  message: "If this email has access, a sign-in code is on its way — check your inbox.",
};
const INVALID = {
  status: "error",
  reason: "invalid_email",
  message: "Enter a valid email address.",
};

beforeEach(async () => {
  queued.length = 0;
  await __resetSignInCodeThrottleForTests();
  mockHeaders.mockReset();
  mockHeaders.mockResolvedValue(new Headers({ "x-forwarded-for": "203.0.113.10" }));
});

describe("requestSignInCode", () => {
  it("rejects a malformed address before anything is queued", async () => {
    await expect(requestSignInCode({ email: "not-an-email" })).resolves.toEqual(INVALID);
    expect(queued).toHaveLength(0);
  });

  it("hands over one opaque job and answers neutrally", async () => {
    await expect(requestSignInCode({ email: " Owner@Example.com " })).resolves.toEqual(NEUTRAL);
    // A code does not navigate, so nothing about where the merchant wanted to land travels with
    // the job — the page keeps its own redirect. RED if `callbackURL` ever comes back.
    expect(queued).toEqual([
      { purpose: "sign-in-code", email: "owner@example.com", overBudget: false },
    ]);
  });

  it("answers the same for an address with access, one without, and one over the throttle", async () => {
    const answers: unknown[] = [];
    answers.push(await requestSignInCode({ email: "owner@example.com" }));
    answers.push(await requestSignInCode({ email: "stranger@example.com" }));
    for (let i = 0; i < 6; i++) {
      answers.push(await requestSignInCode({ email: "owner@example.com" }));
    }
    for (const answer of answers) expect(answer).toEqual(NEUTRAL);
    // Every press handed over a job — r4: an over-budget press that skipped the hand-over did
    // less work than one inside its budget, which is a clock.
    expect(queued).toHaveLength(8);
    // …and the throttle really did bite, so the sameness above is not vacuous.
    const owner = queued.filter((j) => j.email === "owner@example.com");
    expect(owner.filter((j) => j.overBudget === false)).toHaveLength(5);
    expect(owner.filter((j) => j.overBudget === true)).toHaveLength(2);
  });
});

describe("#678 — the action's whole answer vocabulary is existence-independent", () => {
  it("keeps no branch a future edit could lean on", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../actions.ts", import.meta.url), "utf8"),
    );
    for (const forbidden of [
      "rate_limited",
      "delivery_failed",
      "Too many sign-in",
      "EmailSendError",
      // r3: the work itself, not just the vocabulary. None of these may appear on this path —
      // minting the code, asking the allowlist, or touching the database are background work.
      "sendVerificationOTP",
      "isAllowedEmail",
      "prisma",
    ]) {
      expect(source, `login/actions.ts must not reference ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("the contract itself offers only existence-independent reasons", async () => {
    const contract = await import("@/lib/better-auth/signin-code-contract");
    expect(Object.keys(contract).sort()).toEqual([
      "SIGN_IN_CODE_INVALID_EMAIL_MESSAGE",
      "SIGN_IN_CODE_LENGTH",
      "SIGN_IN_CODE_REJECTED_MESSAGE",
      "SIGN_IN_CODE_SUCCESS_MESSAGE",
      "SIGN_IN_CODE_UNKNOWN_FAILED_MESSAGE",
      "normalizeSignInEmail",
    ]);
  });

  /** The three refusals Better Auth can return when a code is submitted — wrong, expired, out of
   *  attempts — collapse into ONE sentence on the page. Telling them apart would answer "does a
   *  live code exist for this address", which is the oracle the whole path avoids. */
  it("offers exactly one thing to say about a refused code", async () => {
    const { SIGN_IN_CODE_REJECTED_MESSAGE } = await import(
      "@/lib/better-auth/signin-code-contract"
    );
    const form = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../LoginForm.tsx", import.meta.url), "utf8"),
    );
    expect(SIGN_IN_CODE_REJECTED_MESSAGE).not.toMatch(/expired|attempts/i);
    for (const leak of ["OTP_EXPIRED", "TOO_MANY_ATTEMPTS", "INVALID_OTP", "Invalid OTP"]) {
      expect(form, `LoginForm must not branch on ${leak}`).not.toContain(leak);
    }
  });
});
