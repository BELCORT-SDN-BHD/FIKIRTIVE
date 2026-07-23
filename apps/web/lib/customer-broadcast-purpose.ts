import type { SendPurpose } from "@fikirtive/db";

export type BroadcastPurpose = Extract<SendPurpose, "marketing" | "review_request">;

/**
 * Single authority for mapping a stored customer-message template classification into the
 * consent purpose used by broadcast eligibility. Unknown tuples deliberately return null so
 * every caller must fail closed rather than guess a purpose.
 */
export function broadcastPurposeFromTemplateClassification(classification: {
  category: string;
  purposeClass: string;
}): "marketing" | null {
  return classification.category === "marketing" &&
    classification.purposeClass === "proactive_non_transactional"
    ? "marketing"
    : null;
}
