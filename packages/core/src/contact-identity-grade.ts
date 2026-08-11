/**
 * #803 — the two credibility grades a stored contact identity can have, in one place.
 *
 * A merchant may now type a customer's phone number in himself. What he typed is a real,
 * useful record — and it is NOT the same fact as a number a messaging channel has actually
 * confirmed. Conflating the two is how a product ends up broadcasting to a digit someone
 * mistyped, so the grade travels on the row itself:
 *
 *   merchant_unverified — the merchant entered it. Stored, searchable, shown with its grade.
 *   channel_verified    — a connected channel confirmed this identity, with a timestamp and
 *                         the source that confirmed it (ContactIdentity.verifiedAt /
 *                         verifiedSourceKind). Only these are audience/send material.
 *
 * The taxonomy lives in @fikirtive/core because every layer needs the SAME word for it: the
 * database CHECK constraint, the CRM write path, the audience gate shared by the segments page
 * and the broadcast freeze, and the client component that prints the badge. A second copy is
 * how "what the page says" and "what the broadcast does" drift apart (#716/#750).
 */
export const CONTACT_IDENTITY_VERIFICATIONS = ["merchant_unverified", "channel_verified"] as const;

export type ContactIdentityVerification = (typeof CONTACT_IDENTITY_VERIFICATIONS)[number];

/** Typed by the merchant. Never a send target, never a channel fact. */
export const MERCHANT_UNVERIFIED_IDENTITY: ContactIdentityVerification = "merchant_unverified";

/** Confirmed by a connected channel, with recorded evidence of when and by what. */
export const CHANNEL_VERIFIED_IDENTITY: ContactIdentityVerification = "channel_verified";

export function isContactIdentityVerification(value: unknown): value is ContactIdentityVerification {
  return CONTACT_IDENTITY_VERIFICATIONS.includes(value as ContactIdentityVerification);
}

/**
 * The one predicate deciding whether an identity may be reached. Written as a positive test on
 * `channel_verified` rather than "not unverified" on purpose: a future third grade must have to
 * argue its way IN, not slip in by not being the excluded word.
 */
export function isChannelVerifiedIdentity(identity: { verificationStatus: string }): boolean {
  return identity.verificationStatus === CHANNEL_VERIFIED_IDENTITY;
}
