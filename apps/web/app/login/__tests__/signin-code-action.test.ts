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
/** SIGNIN-A8 —— 规格 §1.3 逐字。它谈次数与时间，从不谈这个邮箱有没有账号。 */
const RATE_LIMITED = {
  status: "error",
  reason: "rate_limited",
  message: "Too many codes requested. Try again in an hour.",
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

  /**
   * SIGNIN-A8 —— 「对陌生邮箱与老邮箱的响应时间与文案一致」，加上「第 6 次被拒并提示一小时
   * 后再试」。这两句现在同时成立，而这正是这一片的产品变化。
   *
   * 一致的是**地址之间**：一个从没出现过的地址与一个老商家走同一条预算、拿同一串答案。
   * 不一致的是**次数之间**：第 6 次说出来。后者不构成账号存在性探针，因为桶里的数字完全由
   * 发问的人自己造成（`signin-code-request.ts` 的 `SignInCodeRequestOutcome` 写了全部理由）。
   */
  it("SIGNIN-A8 —— 陌生与老邮箱答案逐字相同；同一邮箱第 6 次要码答「一小时后再试」", async () => {
    const walk = async (email: string) => {
      const answers: unknown[] = [];
      for (let i = 0; i < 7; i++) answers.push(await requestSignInCode({ email }));
      return answers;
    };
    const stranger = await walk("stranger@example.com");
    const owner = await walk("owner@example.com");

    // 陌生与老邮箱：逐字相同。
    expect(stranger).toEqual(owner);
    expect(owner.slice(0, 5)).toEqual([NEUTRAL, NEUTRAL, NEUTRAL, NEUTRAL, NEUTRAL]);
    expect(owner.slice(5)).toEqual([RATE_LIMITED, RATE_LIMITED]);

    // Every press handed over a job — r4: an over-budget press that skipped the hand-over did
    // less work than one inside its budget, which is a clock. 超额现在**说得出口**，但做的事
    // 还是一样：被撤销的地址与暂停期的陌生人走的正是这条「已寄出」的路。
    expect(queued).toHaveLength(14);
    const ownerJobs = queued.filter((j) => j.email === "owner@example.com");
    expect(ownerJobs.filter((j) => j.overBudget === false)).toHaveLength(5);
    expect(ownerJobs.filter((j) => j.overBudget === true)).toHaveLength(2);
  });
});

/**
 * Founder 2026-09-05 裁决①「按环境提示」—— 没有邮件通道的部署,答案是环境本身。
 *
 * 这一组跑的是**服务端**那一半。登录页在输入邮箱那一步就把同一句话说出来、并禁掉按钮
 * (`LoginForm.tsx`,围栏在 `login-code-resend.test.tsx`),这里钉的是仍然到得了这个动作的
 * 那条路(旧标签页、直接调用)也不会得到一句假的「已寄出」。
 */
describe("FRONT-A12 — a deployment with no mail transport says so instead of claiming a code was sent", () => {
  const UNAVAILABLE = {
    status: "error",
    reason: "unknown",
    message: "Sign-in codes aren't available in this environment yet.",
  };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** 走查看到的那个形状:在服务的生产进程,`RESEND_API_KEY` 没配(契约里它是 optional)。 */
  function servingWithNoMailProvider() {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("AUTH_EMAIL_TRANSPORT", "");
  }

  it("FRONT-A12: answers with the environment sentence and queues nothing", async () => {
    servingWithNoMailProvider();
    await expect(requestSignInCode({ email: "owner@example.com" })).resolves.toEqual(UNAVAILABLE);
    expect(queued).toHaveLength(0);
  });

  it("FRONT-A2: the same sentence for an address with access, one without, and a malformed one", async () => {
    servingWithNoMailProvider();
    for (const email of ["owner@example.com", "stranger@example.com", "not-an-email"]) {
      await expect(requestSignInCode({ email })).resolves.toEqual(UNAVAILABLE);
    }
    // 措辞只提环境,一个字都不提这个邮箱 —— 它不可能被读成「这个地址存不存在」。
    expect(UNAVAILABLE.message).not.toMatch(/email|address|account/i);
  });

  it("FRONT-A12: a deployment that CAN deliver still behaves exactly as before", async () => {
    // 控制组。少了它,上面两条在「动作永远回绝」的实现下也会绿。
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    await expect(requestSignInCode({ email: "owner@example.com" })).resolves.toEqual(NEUTRAL);
    expect(queued).toEqual([
      { purpose: "sign-in-code", email: "owner@example.com", overBudget: false },
    ]);
  });
});

describe("#678 — the action's whole answer vocabulary is existence-independent", () => {
  /**
   * SIGNIN-A8 —— `rate_limited` 从这张禁用清单里**拿掉了**，而且是一次改判，不是放宽。
   *
   * #678 当时禁它的理由写得很清楚：码门只放行名单内的地址，所以「你被限流了」等于「这个地址
   * 有账号」。规格（已冻结 · v1 §1.6）把码门对陌生人打开，那个等号不成立了 —— 每个地址都会被
   * 寄码，计数桶一视同仁，桶里的数字完全由发问的人自己造成。
   *
   * 清单上其余每一条仍然禁着，而且理由一个字没变：它们要么是关于**这个地址**的
   * （`delivery_failed` —— 只有有权限的地址才会被交给邮件商），要么是本该发生在背景的工作
   * （铸码、问名单、碰数据库）。
   */
  it("keeps no branch a future edit could lean on", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../actions.ts", import.meta.url), "utf8"),
    );
    for (const forbidden of [
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
      // FSE-201 —— 一个码值几次猜。它是 `allowedAttempts` 与登录页那个计数器共用的那个数，
      // 是我们自己配的常量，与「这个地址是谁」无关，所以它同样是 existence-independent 的。
      "SIGN_IN_CODE_ALLOWED_ATTEMPTS",
      "SIGN_IN_CODE_INVALID_EMAIL_MESSAGE",
      "SIGN_IN_CODE_LENGTH",
      // SIGNIN-A8 —— 「一小时内第 6 次」。它谈的是**次数**，不是地址：桶对每个地址一样存在，
      // 里面的数字完全由发问的人自己造成（码门对陌生人打开之后，那个「限流 = 有账号」的等号
      // 不成立了）。所以它与其它几条一样是 existence-independent 的。
      "SIGN_IN_CODE_RATE_LIMITED_MESSAGE",
      "SIGN_IN_CODE_REJECTED_MESSAGE",
      // FSE-201（S5 批量裁决 2026-09-12，docs/specs/sign-in.md §5）—— 码用尽之后那一句。
      // 它由**商家自己按了几次**挑出来，不是由服务端的答案挑出来：撤销地址与暂停期的陌生人
      // 从来没被铸过码，所以按答案分岔会泄露他们是谁（规格 §1.3）。按次数分岔对每个地址一样。
      "SIGN_IN_CODE_SPENT_MESSAGE",
      "SIGN_IN_CODE_SUCCESS_MESSAGE",
      // Founder 2026-09-05 裁决①。它说的是**部署**(这里有没有邮件通道),不是地址:一次
      // env 读,对每个邮箱同一个答案,在任何地址被看一眼之前就定了 —— 所以它与上面两条
      // reason 一样是 existence-independent 的,不是被放进来的例外。
      "SIGN_IN_CODE_UNAVAILABLE_MESSAGE",
      "SIGN_IN_CODE_UNKNOWN_FAILED_MESSAGE",
      "normalizeSignInEmail",
      // SIGNIN-A5 —— 邮件链接落地时读片段的那个纯函数。它住在这份客户端／服务端共用的契约里，
      // 因为片段只有浏览器看得见（链接的**构造**在 signin-code-login-url.ts，那边读 env）。
      "parseSignInCodeFragment",
    ]);
  });

  /** The refusals Better Auth can return when a code is submitted — wrong, expired, out of
   *  attempts — must all read the same on the page. Telling them apart would answer "does a
   *  live code exist for this address", which is the oracle the whole path avoids.
   *
   *  FSE-201 added a SECOND sentence, and this test is what keeps it on the right side of that:
   *  the page picks it from the merchant's own refusal count, so the page still never looks at
   *  what came back. Hence the assertion below is now about the WHOLE `signInError` object, not
   *  only the four error names. */
  it("FSE-201: what the page says about a refused code never depends on what came back", async () => {
    const { SIGN_IN_CODE_REJECTED_MESSAGE, SIGN_IN_CODE_SPENT_MESSAGE } = await import(
      "@/lib/better-auth/signin-code-contract"
    );
    const form = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../LoginForm.tsx", import.meta.url), "utf8"),
    );
    expect(SIGN_IN_CODE_REJECTED_MESSAGE).not.toMatch(/expired|attempts/i);
    expect(SIGN_IN_CODE_SPENT_MESSAGE).not.toMatch(/expired|attempts/i);
    for (const leak of ["OTP_EXPIRED", "TOO_MANY_ATTEMPTS", "INVALID_OTP", "Invalid OTP"]) {
      expect(form, `LoginForm must not branch on ${leak}`).not.toContain(leak);
    }
    // 连读都不许读:`if (signInError)`「有没有被拒」是唯一用到它的地方,任何 `signInError.<field>`
    // 都是在拿服务端的答案说话,而那个答案分得出「这个地址被铸过码没有」。
    expect(form.match(/signInError\./g) ?? [], "LoginForm must not read any field off the refusal").toHaveLength(0);
  });
});
