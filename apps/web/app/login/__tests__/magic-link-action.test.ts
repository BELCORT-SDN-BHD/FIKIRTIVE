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

const { requestMagicLink } = await import("../actions");
const { __resetMagicLinkThrottleForTests } = await import("@/lib/better-auth/magic-link-request");

const NEUTRAL = {
  status: "success",
  message: "If this email has access, a sign-in link is on its way — check your inbox.",
};
const INVALID = {
  status: "error",
  reason: "invalid_email",
  message: "Enter a valid email address.",
};

beforeEach(() => {
  queued.length = 0;
  __resetMagicLinkThrottleForTests();
  mockHeaders.mockReset();
  mockHeaders.mockResolvedValue(new Headers({ "x-forwarded-for": "203.0.113.10" }));
});

describe("requestMagicLink", () => {
  it("rejects a malformed address before anything is queued", async () => {
    await expect(requestMagicLink({ email: "not-an-email", callbackURL: "/" })).resolves.toEqual(
      INVALID,
    );
    expect(queued).toHaveLength(0);
  });

  it("hands over one opaque job and answers neutrally", async () => {
    await expect(
      requestMagicLink({ email: " Owner@Example.com ", callbackURL: "/campaign?tab=plan" }),
    ).resolves.toEqual(NEUTRAL);
    expect(queued).toEqual([
      {
        purpose: "sign-in-link",
        email: "owner@example.com",
        callbackURL: "/campaign?tab=plan",
        overBudget: false,
      },
    ]);
  });

  it("answers the same for an address with access, one without, and one over the throttle", async () => {
    const answers: unknown[] = [];
    answers.push(await requestMagicLink({ email: "owner@example.com", callbackURL: "/" }));
    answers.push(await requestMagicLink({ email: "stranger@example.com", callbackURL: "/" }));
    for (let i = 0; i < 6; i++) {
      answers.push(await requestMagicLink({ email: "owner@example.com", callbackURL: "/" }));
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
      "Too many sign-in links",
      "EmailSendError",
      // r3: the work itself, not just the vocabulary. None of these may appear on this path —
      // minting the token, asking the allowlist, or touching the database are background work.
      "signInMagicLink",
      "isAllowedEmail",
      "prisma",
    ]) {
      expect(source, `login/actions.ts must not reference ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("the contract itself offers only existence-independent reasons", async () => {
    const contract = await import("@/lib/better-auth/magic-link-contract");
    expect(Object.keys(contract).sort()).toEqual([
      "MAGIC_LINK_INVALID_EMAIL_MESSAGE",
      "MAGIC_LINK_SUCCESS_MESSAGE",
      "MAGIC_LINK_UNKNOWN_FAILED_MESSAGE",
      "normalizeMagicLinkEmail",
    ]);
  });
});
