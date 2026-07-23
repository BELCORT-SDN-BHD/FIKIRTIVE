export const MAGIC_LINK_SUCCESS_MESSAGE =
  "If this email has access, a sign-in link is on its way — check your inbox.";
export const MAGIC_LINK_INVALID_EMAIL_MESSAGE = "Enter a valid email address.";
export const MAGIC_LINK_DELIVERY_FAILED_MESSAGE =
  "We couldn't send a sign-in link right now. Try again shortly.";
export const MAGIC_LINK_UNKNOWN_FAILED_MESSAGE =
  "We couldn't send a sign-in link. Try again.";

export type MagicLinkFailureReason =
  | "invalid_email"
  | "rate_limited"
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
