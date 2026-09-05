/**
 * meta-card-decline-view — the client-safe half of the Meta card decline contract
 * (spec `docs/specs/frontend-baseline.md` FRONT-A12).
 *
 * The card component and the server action must agree on two things: what a declined payload
 * LOOKS like, and what the merchant is TOLD. Both live here, once, so the sentence the card
 * renders after the click and the sentence persisted into the conversation cannot drift apart.
 *
 * No server imports, no DB — mirrors `approval-card-view.ts`.
 */

/** The two Otto cards whose approval is a frozen `Approval` binding (not an SDK park). */
export type MetaCardKind = "ACTION_CARD" | "BUILD_CARD";

/** One sentence per card kind, inserted verbatim into the conversation and rendered on the card. */
export const ACTION_PLAN_DECLINE_TEXT = "Plan declined — nothing was changed.";
export const AD_BUILD_DECLINE_TEXT = "Build declined — nothing was created.";

export function declineTextFor(kind: MetaCardKind): string {
  return kind === "ACTION_CARD" ? ACTION_PLAN_DECLINE_TEXT : AD_BUILD_DECLINE_TEXT;
}

/** Read a persisted decline off a card payload — the card asks this of the payload it renders,
 *  the server asks it of the row it loaded. `declinedAt` is an ISO instant stamped by
 *  `declineMetaCard`; absent = never declined. */
export function isDeclinedPayload(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  return typeof (payload as { declinedAt?: unknown }).declinedAt === "string";
}
