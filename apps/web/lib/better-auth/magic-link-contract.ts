export const MAGIC_LINK_SUCCESS_MESSAGE =
  "If this email has access, a sign-in link is on its way — check your inbox.";
export const MAGIC_LINK_INVALID_EMAIL_MESSAGE = "Enter a valid email address.";
export const MAGIC_LINK_DELIVERY_FAILED_MESSAGE =
  "We couldn't send a sign-in link right now. Try again shortly.";
export const MAGIC_LINK_UNKNOWN_FAILED_MESSAGE =
  "We couldn't send a sign-in link. Try again.";

/** #678 — there is deliberately NO "rate_limited" reason. Being over the per-address hourly
 *  cap is reachable only for an address that has access (server.ts answers everything else with
 *  the neutral success body before the sender is ever called), so a distinct rate-limit answer
 *  IS an account-existence oracle. The cap still stops the email; the merchant reads the same
 *  neutral success either way. See lib/better-auth/sender.ts. */
export type MagicLinkFailureReason =
  | "invalid_email"
  | "delivery_failed"
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
