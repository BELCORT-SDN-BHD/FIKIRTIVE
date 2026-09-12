export const SIGN_IN_CODE_SUCCESS_MESSAGE =
  "If this email has access, a sign-in code is on its way — check your inbox.";
export const SIGN_IN_CODE_INVALID_EMAIL_MESSAGE = "Enter a valid email address.";
export const SIGN_IN_CODE_UNKNOWN_FAILED_MESSAGE =
  "We couldn't send a sign-in code. Try again.";

/**
 * What a merchant is told on a deployment that has no way to send mail at all
 * (Founder 2026-09-05 裁决①「按环境提示」).
 *
 * IT TALKS ABOUT THE ENVIRONMENT, NEVER ABOUT THE ADDRESS — and that is what keeps it on the
 * right side of FRONT-A2. The fact behind it is one env read (`emailDeliveryAvailable()`,
 * lib/email/transport.ts): the same answer for every address, decided before any address is
 * looked at, so it cannot encode whether an account exists. A single failed delivery is the
 * opposite case and still says nothing — only an address with access is ever handed to the mail
 * provider, which is why "delivery_failed" is deliberately absent from the reasons below.
 *
 * ONE sentence, and it is the whole vocabulary for this state: the login page shows it in place
 * of "We'll send a temporary login code." on the email step, and the server action answers with
 * it if a press gets through anyway.
 */
export const SIGN_IN_CODE_UNAVAILABLE_MESSAGE =
  "Sign-in codes aren't available in this environment yet.";

/**
 * SIGNIN-A8 —— 商家一小时内第 6 次要码时读到的那一句（规格 §1.3 逐字）。
 *
 * 它说的是「太多了」和「一小时后」，不说这个邮箱有没有账号 —— 它也做不到：码门对陌生人打开
 * 之后，这个计数桶对任何地址都存在，桶里的数字完全由发问的人自己造成。
 */
export const SIGN_IN_CODE_RATE_LIMITED_MESSAGE =
  "Too many codes requested. Try again in an hour.";

/** #678 / SIGNIN-A8 — THREE reasons, and the omission is still the point.
 *
 *  "rate_limited" 是这一片新加的，而且是**改判**：#678 当时不许它存在，理由是码门只放行名单内
 *  的地址，所以「你被限流了」等于「这个地址有账号」。规格（已冻结 · v1）把码门对陌生人打开，
 *  那个等号不成立了 —— 每个地址都会被寄码，计数桶一视同仁 —— 而验收 A8 要求把话说出来。
 *  仍然不许存在的是关于**地址本身**的拒绝（撤销、暂停期陌生人），它们在背景里静静丢掉。
 *
 *  No "delivery_failed" either (r2): the same argument applies one step further out. Only an
 *  address with access was ever handed to the mail provider, so "the provider said 429" was
 *  also an existence signal — and a shared provider can be pushed into 429 through any public
 *  sending surface, so it was a signal an attacker could induce rather than merely wait for.
 *  Delivery is no longer on the request path at all (lib/better-auth/sender.ts), so this module
 *  has nothing to say about it: delivery faults are an OPERATOR signal, carried by logs and
 *  alerting, not by the merchant's response.
 *
 *  What is left is existence-independent by construction: a format check that runs before any
 *  lookup, and a genuine server fault that lands the same way for every address. */
export type SignInCodeFailureReason =
  | "invalid_email"
  | "rate_limited"
  | "unknown";

export type SignInCodeFailure = {
  status: "error";
  reason: SignInCodeFailureReason;
  message: string;
};

export type SignInCodeRequestResult =
  | { status: "success"; message: string }
  | SignInCodeFailure;

/**
 * SIGNIN-A5 —— 邮件里的 Log in 按钮落地时，`/login` 从 URL **片段**里读回来的两样东西。
 *
 * 纯函数、无 env、无 server-only：登录页那个客户端组件要用它（片段根本不会送到服务器，只有浏览器
 * 看得见），所以它住在这份客户端／服务端共用的契约里，而链接的**构造**在
 * `signin-code-login-url.ts` —— 那边读 `BETTER_AUTH_URL`，不该被打进浏览器包。
 *
 * 只接受形状对的值：码必须是数字，邮箱必须像个邮箱。片段是**任何人**都能写的地方，所以读进来的
 * 东西只用来预填输入框，不构成任何授权 —— 真正的判定仍然是提交之后服务器验那六位数。
 */
export function parseSignInCodeFragment(hash: string): { email: string; code: string } | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return null;
  }
  const email = normalizeSignInEmail(params.get("email"));
  const code = (params.get("code") ?? "").trim();
  if (!email) return null;
  if (!/^\d{4,10}$/.test(code)) return null;
  return { email, code };
}

export function normalizeSignInEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && email.length <= 254
    ? email
    : null;
}

/** The number of digits a sign-in code has. ONE source, shared by the input's `maxLength`, the
 *  client-side "is this even worth submitting" check, and the `otpLength` handed to Better Auth
 *  (lib/better-auth/server.ts) — so the box a merchant types into and the code we mail them can
 *  never disagree about their length. */
export const SIGN_IN_CODE_LENGTH = 6;

/** What a merchant is told when the code they typed is refused.
 *
 *  ONE sentence for every one of Better Auth's refusals — wrong code, expired code, attempts
 *  exhausted — and that is deliberate rather than lazy. Distinguishing them BY WHAT THE SERVER
 *  ANSWERED tells a caller who typed six random digits at somebody else's address whether a live
 *  code exists for it, which is the account-existence oracle this whole path is built to avoid.
 *
 *  FSE-201 did not change that: the second sentence below is chosen by the merchant's OWN
 *  attempt count on this page, never by the answer that came back. See it for why. */
export const SIGN_IN_CODE_REJECTED_MESSAGE =
  "That code didn't work. Check it and try again, or send it again.";

/** HOW MANY GUESSES ONE ISSUED CODE IS WORTH — one source for the two halves that must agree.
 *
 *  It is `allowedAttempts` on the emailOTP plugin (lib/better-auth/server.ts), where the whole
 *  brute-force argument is written out, AND the number the login page counts its own refusals
 *  against so it can stop telling a merchant to re-check a code the server has already burnt.
 *  Two copies of it would drift the moment one side was tuned, and the drift is silent: the page
 *  would go back to saying "check it and try again" about a dead code, which is exactly FSE-201. */
export const SIGN_IN_CODE_ALLOWED_ATTEMPTS = 3;

/** FSE-201 —— what a merchant is told from the attempt AFTER the last guess this code was worth.
 *
 *  THE DEFECT IT CLOSES (staging 走查 2026-09-11, `docs/audits/fullstack-staging-2026-09-11/`):
 *  Better Auth burns the code on the fourth try — `atomicVerifyOTP` consumes the verification row
 *  and does not recreate it once the attempts are spent — so from then on even the real code out
 *  of the merchant's own inbox is refused. The page kept saying "Check it and try again", so the
 *  merchant re-typed a dead code over and over. S5 批量裁决 2026-09-12 (docs/specs/sign-in.md §5):
 *  name the cure instead.
 *
 *  WHY THIS SENTENCE IS NOT PICKED FROM THE SERVER'S ERROR CODE, even though Better Auth answers
 *  a distinguishable `TOO_MANY_ATTEMPTS` here. A revoked address, and a stranger while signups are
 *  paused, are never issued a code at all (`sendVerificationOTP` asks `signInDoorDecision` first),
 *  so they can never reach that answer — and 规格 §1.3 requires those two refusals to read exactly
 *  like a wrong code. Branching on the server's answer would therefore turn this sentence into a
 *  probe for "is this address revoked / does it have an account". The count the page keeps is the
 *  merchant's own presses: the same number for every address, caused entirely by whoever is
 *  typing. */
export const SIGN_IN_CODE_SPENT_MESSAGE =
  "That code can no longer be used. Press Send again to get a new one.";
