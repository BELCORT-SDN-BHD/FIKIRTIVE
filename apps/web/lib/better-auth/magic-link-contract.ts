export const MAGIC_LINK_SUCCESS_MESSAGE =
  "If this email has access, a sign-in link is on its way — check your inbox.";
export const MAGIC_LINK_INVALID_EMAIL_MESSAGE = "Enter a valid email address.";
export const MAGIC_LINK_UNKNOWN_FAILED_MESSAGE =
  "We couldn't send a sign-in link. Try again.";

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
export type MagicLinkFailureReason =
  | "invalid_email"
  | "unknown";

export type MagicLinkFailure = {
  status: "error";
  reason: MagicLinkFailureReason;
  message: string;
};

export type MagicLinkRequestResult =
  | { status: "success"; message: string }
  | MagicLinkFailure;

export function normalizeMagicLinkEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && email.length <= 254
    ? email
    : null;
}
