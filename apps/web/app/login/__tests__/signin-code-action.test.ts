import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const UNDELIVERABLE = {
  status: "error",
  reason: "unknown",
  message: "We couldn't send a sign-in code. Try again.",
};

beforeEach(async () => {
  queued.length = 0;
  await __resetSignInCodeThrottleForTests();
  mockHeaders.mockReset();
  mockHeaders.mockResolvedValue(new Headers({ "x-forwarded-for": "203.0.113.10" }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A production process with no mail transport configured — the state the 3310 走查 caught the
 *  page lying in: every send throws `config_missing` in the background and the page said
 *  "We sent a temporary login code" anyway. */
function withNoMailTransport(): void {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("RESEND_API_KEY", "");
}

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

/**
 * FRONT-A12 —— 「没有邮件通道」这一态,是 #678 的规则唯一允许的诚实分支。
 *
 * 它与被关掉的那些泄漏不同:答案只由本进程的配置决定,对每个地址一模一样 —— 要么对所有商家
 * 都说不出去,要么对谁都说得出去。所以下面既钉「它真的说了实话」,也钉「它对有权限的地址和
 * 无权限的地址说的是同一句」(FRONT-A2)。
 */
describe("FRONT-A12 — a deployment that cannot post mail says so instead of 'check your inbox'", () => {
  it("FRONT-A12: answers honestly and hands over nothing when there is no mail transport", async () => {
    withNoMailTransport();

    await expect(requestSignInCode({ email: "owner@example.com" })).resolves.toEqual(UNDELIVERABLE);
    // 变异守卫:把 ①′ 那道检查删掉,这里会拿回 NEUTRAL(「a sign-in code is on its way」)而变红。
    expect(await requestSignInCode({ email: "owner@example.com" })).not.toEqual(NEUTRAL);
    // 一封都没交出去 —— 交出去只会在后台抛 config_missing,白白花掉商家的每小时额度。
    expect(queued).toHaveLength(0);
  });

  it("FRONT-A2: that refusal is the same sentence for an address with access and one without", async () => {
    withNoMailTransport();

    const withAccess = await requestSignInCode({ email: "owner@example.com" });
    const without = await requestSignInCode({ email: "stranger@example.com" });

    expect(withAccess).toEqual(UNDELIVERABLE);
    expect(without).toEqual(withAccess);
    // 那句话只说「没寄出去」,不说这个邮箱存不存在。
    expect(UNDELIVERABLE.message).not.toMatch(/account|exist|allow|invit/i);
  });

  it("FRONT-A12: a malformed address is still told what is wrong with it, not about the outage", async () => {
    withNoMailTransport();

    await expect(requestSignInCode({ email: "not-an-email" })).resolves.toEqual(INVALID);
  });

  it("FRONT-A12: with a transport configured nothing about the accepted path changes", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "re_live_key");

    await expect(requestSignInCode({ email: "owner@example.com" })).resolves.toEqual(NEUTRAL);
    expect(queued).toEqual([
      { purpose: "sign-in-code", email: "owner@example.com", overBudget: false },
    ]);
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
