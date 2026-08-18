export const SIGN_IN_CODE_SUCCESS_MESSAGE =
  "If this email has access, a sign-in code is on its way — check your inbox.";
export const SIGN_IN_CODE_INVALID_EMAIL_MESSAGE = "Enter a valid email address.";
export const SIGN_IN_CODE_UNKNOWN_FAILED_MESSAGE =
  "We couldn't send a sign-in code. Try again.";

/** #678 — TWO reasons, and the omissions are the point.
 *
 *  No "rate_limited": being over the per-address hourly cap is reachable only for an address
 *  that has access, so a distinct answer for it IS an account-existence oracle.
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
  | "unknown";

export type SignInCodeFailure = {
  status: "error";
  reason: SignInCodeFailureReason;
  message: string;
};

export type SignInCodeRequestResult =
  | { status: "success"; message: string }
  | SignInCodeFailure;

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
 *  ONE sentence for all three of Better Auth's refusals — wrong code, expired code, attempts
 *  exhausted — and that is deliberate rather than lazy. Distinguishing them tells a caller who
 *  typed six random digits at somebody else's address whether a live code exists for it, which is
 *  the account-existence oracle this whole path is built to avoid; and all three have the same
 *  cure anyway, which the sentence names. */
export const SIGN_IN_CODE_REJECTED_MESSAGE =
  "That code didn't work. Check it and try again, or send it again.";
