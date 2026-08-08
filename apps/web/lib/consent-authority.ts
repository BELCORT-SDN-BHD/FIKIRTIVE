import {
  contactMatchesRules,
  type SegmentContactFacts,
  type SegmentRuleGroup,
} from "@fikirtive/core";
import type { Prisma } from "@fikirtive/db";

/**
 * #716 / #726 — the single predicate deciding whether a contact has opted out.
 *
 * Before this module the same question had two answers: the segments page read the legacy
 * `Contact.marketingConsent` column while the broadcast estimate, the contacts list and the
 * send-eligibility engine read `ConsentStateProjection`. A merchant could be told "2 contacts,
 * the opt-out is excluded" on one page and get 3 — the opted-out customer back in — on the next.
 *
 * There is now exactly one reading. `ConsentStateProjection` is the R-010 authority; the legacy
 * column is a whatsapp+marketing compatibility mirror written by the consent runtime and is no
 * longer an authority of its own. It keeps exactly ONE power, described under
 * `unresolvedLegacyOptOut` below: it can hold a customer out, never let one in.
 *
 * The reading carries THREE separate facts, and they are never collapsed into one:
 *  - `state` — the verified consent state. Only `effective_revoke` is a verified opt-out.
 *  - `unresolvedLegacyOptOut` — an opt-out recorded before this contact had a consent history.
 *  - `reportedOptOut` — the merchant's OWN latest record says "opted out". R-010 keeps this out
 *    of the verified state on purpose: a merchant assertion is not customer-verified evidence
 *    (#496, Founder's option B). It is surfaced, never silently folded into "unknown".
 */

/**
 * Every consent surface a merchant can reach today — the contact profile's opt-out control, CSV
 * import, the contacts list badge — writes and reads this one scope. Segment selection has no
 * channel or purpose of its own, so it reads the same scope those pages display; a broadcast
 * reads its own run's channel + purpose through the same functions.
 *
 * R-010 §4.6.1 also fixes this as the ONLY scope the legacy `Contact.marketingConsent` column
 * mirrors, which is why the pre-ledger fence below is scoped to it and to nothing else.
 */
export const CRM_CONSENT_SCOPE = { channel: "whatsapp", purpose: "marketing" } as const;

export type ConsentScope = { channel: string; purpose: string };

export type ConsentState = "unknown" | "verified_grant" | "effective_revoke";

export type ContactConsentTruth = {
  /** Verified R-010 state folded from the consent ledger. */
  state: ConsentState;
  /**
   * An opt-out that predates this contact's consent history and nothing has resolved since
   * (R-010 §4.6.5). It holds the contact OUT of every audience until the customer's own verified
   * evidence supersedes it. See `contactConsentTruth`.
   */
  unresolvedLegacyOptOut: boolean;
  /** The merchant's own latest record says "opted out" — recorded, not verified. */
  reportedOptOut: boolean;
};

/** No consent record of any kind exists for this contact in this scope. */
export const NO_CONSENT_RECORD: ContactConsentTruth = {
  state: "unknown",
  unresolvedLegacyOptOut: false,
  reportedOptOut: false,
};

/** The one definition of "known opt-out" — shared by segment selection, freeze and display. */
export function isKnownOptOut(truth: ContactConsentTruth): boolean {
  return truth.state === "effective_revoke" || truth.unresolvedLegacyOptOut;
}

/**
 * The segment-rule fact for this contact. Known opt-out is `opt_out`; a merchant-recorded
 * opt-out stays `unknown` because that is what it is — unverified.
 */
export function consentFact(truth: ContactConsentTruth): "opt_in" | "opt_out" | "unknown" {
  if (isKnownOptOut(truth)) return "opt_out";
  return truth.state === "verified_grant" ? "opt_in" : "unknown";
}

/**
 * The pre-ledger fence (R-010 §4.6.5): a `Contact.marketingConsent` of `opt_out` that the
 * consent ledger has not yet reached is a KNOWN historical revoke, and R-010 forbids losing it
 * silently in the cutover. Until the tuple is resolved one contact at a time, it is fail-closed:
 * the customer stays out.
 *
 * Fail-closed means the merchant's own newer assertion cannot release it either — re-recording
 * an opt-out, or asserting an opt-in, both leave the state `unknown` and the fence standing.
 * Only the customer's own verified evidence (an opt-in through their channel, folding to
 * `verified_grant`) supersedes the stale byte, which is exactly R-010 §4.6.4's rule that a
 * historical baseline is neutral once a newer interactive stance covers it.
 *
 * Scoped to whatsapp+marketing because that is the only tuple the legacy column mirrors
 * (R-010 §4.6.1); for any other channel or purpose the column carries no meaning and is not read.
 */
export function contactConsentTruth(
  projected: ContactConsentTruth | undefined,
  legacyMarketingConsent: string | null | undefined,
  scope: ConsentScope = CRM_CONSENT_SCOPE,
): ContactConsentTruth {
  const truth = projected ?? NO_CONSENT_RECORD;
  const fenced =
    truth.state === "unknown" &&
    legacyMarketingConsent === "opt_out" &&
    scope.channel === CRM_CONSENT_SCOPE.channel &&
    scope.purpose === CRM_CONSENT_SCOPE.purpose;
  return fenced ? { ...truth, unresolvedLegacyOptOut: true } : truth;
}

export type ConsentExclusionCandidate = {
  truth: ContactConsentTruth;
  matched: boolean;
  facts: SegmentContactFacts;
};

export type ConsentExclusionCounts = {
  /** Known opt-outs the consent authority kept out of this selection. */
  excluded: number;
  /** Of those, the ones held out by the pre-ledger fence — resolvable one contact at a time. */
  unresolvedLegacy: number;
};

/**
 * How many contacts the consent authority — not the merchant's other rules — kept out of this
 * selection: a known opt-out that does not match today, but would match if it were contactable.
 *
 * The segments page and the broadcast audience both count with this one function, so the number
 * cannot mean one thing on one page and another downstream (#726). Each caller passes its own
 * population — the segments page every contact the merchant has, a broadcast only the contacts
 * it can reach on its run's channel — and both pages say which population they counted.
 */
export function countExcludedByConsent(
  contacts: readonly ConsentExclusionCandidate[],
  rules: SegmentRuleGroup,
  evaluatedAt: string,
): ConsentExclusionCounts {
  const excluded = contacts.filter(
    (contact) =>
      isKnownOptOut(contact.truth) &&
      !contact.matched &&
      contactMatchesRules(
        { ...contact.facts, marketingConsent: "opt_in", doNotDisturb: false },
        rules,
        { evaluatedAt },
      ),
  );
  return {
    excluded: excluded.length,
    unresolvedLegacy: excluded.filter((contact) => contact.truth.unresolvedLegacyOptOut).length,
  };
}

function asState(value: string): ConsentState {
  return value === "verified_grant" || value === "effective_revoke" ? value : "unknown";
}

/**
 * Reads every contact's ledger consent truth for one owner in one scope. The caller layers the
 * pre-ledger fence on top with `contactConsentTruth`, because only the caller holds the contact
 * rows the legacy column lives on.
 *
 * Two owner-fenced queries, no per-contact fan-out:
 *  1. the projection rows (the verified authority);
 *  2. every merchant declaration in this scope, folded in R-010's own `(receivedAt, id)` order so
 *     the LAST one wins. Looking at the merchant's latest record — rather than at the folded
 *     state — is what makes an opt-out recorded after a verified opt-in visible: that fold stays
 *     `verified_grant` (correctly, the customer's own evidence decides the send), so a reading
 *     keyed on the state reported such a contact as zero and #716's disclosure gap survived.
 */
export async function readContactConsentTruth(
  client: Prisma.TransactionClient,
  ownerId: string,
  scope: ConsentScope = CRM_CONSENT_SCOPE,
): Promise<Map<string, ContactConsentTruth>> {
  const [projections, declarations] = await Promise.all([
    client.consentStateProjection.findMany({
      where: { ownerId, channel: scope.channel, purpose: scope.purpose },
      select: { contactId: true, state: true },
    }),
    // `actorKind: "merchant"` is the closed R-010 writer set for the two surfaces a merchant can
    // record consent from himself (contact profile and CSV import); both are always `asserted`.
    client.consentEvent.findMany({
      where: { ownerId, channel: scope.channel, purpose: scope.purpose, actorKind: "merchant" },
      select: { contactId: true, action: true },
      orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    }),
  ]);

  const latestMerchantAction = new Map<string, string>();
  for (const row of declarations) latestMerchantAction.set(row.contactId, row.action);

  const truth = new Map<string, ContactConsentTruth>();
  for (const row of projections) {
    truth.set(row.contactId, {
      state: asState(row.state),
      unresolvedLegacyOptOut: false,
      reportedOptOut: latestMerchantAction.get(row.contactId) === "revoke",
    });
  }
  return truth;
}
