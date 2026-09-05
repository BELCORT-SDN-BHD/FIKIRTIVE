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

/** Read a persisted expiry off a card payload. `expiredAt` is stamped by `declineMetaCard` when
 *  Deny arrives after the ask's own deadline: the card is settled, but it was never declined. */
export function isExpiredPayload(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  return typeof (payload as { expiredAt?: unknown }).expiredAt === "string";
}

/**
 * How a card can already be settled when the merchant's Deny lands. Covers both vocabularies that
 * reach this client: `declineMetaCard`'s own word ("declined") and the universal card's
 * ("rejected", plus "failed" — a consent that was spent and then died).
 */
export type MetaCardSettlement = "approved" | "declined" | "rejected" | "expired" | "failed";

/**
 * What the merchant is told about a card that was already settled before this click.
 *
 * Deny used to answer every settled card with the decline sentence, so a plan someone else had
 * APPROVED, and an ask that had simply run out of time, both read "Plan declined — nothing was
 * changed" — two false statements, with the merchant's own click apparently behind them. Each
 * terminal state now says what actually happened.
 */
export function settlementTextFor(kind: MetaCardKind, settlement: MetaCardSettlement): string {
  const plan = kind === "ACTION_CARD";
  switch (settlement) {
    case "expired":
      return plan ? "This plan expired before you decided." : "This build expired before you decided.";
    case "approved":
    case "failed":
      // "failed" is only ever reached from approved — the consent was spent either way.
      return plan ? "This plan was already approved." : "This build was already approved.";
    default:
      return declineTextFor(kind);
  }
}

/** The sentence a card renders from its own persisted payload, or null while it is still awaiting
 *  the merchant. One reading of the payload, shared by both Meta cards. */
export function settledTextFromPayload(kind: MetaCardKind, payload: unknown): string | null {
  if (isDeclinedPayload(payload)) return declineTextFor(kind);
  if (isExpiredPayload(payload)) return settlementTextFor(kind, "expired");
  return null;
}
