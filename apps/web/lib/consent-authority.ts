import {
  contactMatchesRules,
  type SegmentContactFacts,
  type SegmentRuleGroup,
} from "@fikirtive/core";
import {
  contactConsentTruth,
  CRM_CONSENT_SCOPE,
  isKnownOptOut,
  NO_CONSENT_RECORD,
  type ConsentScope,
  type ConsentState,
  type ContactConsentTruth,
  type Prisma,
} from "@fikirtive/db";

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
 * longer an authority of its own. It keeps exactly ONE power: it can hold a customer out, never
 * let one in.
 *
 * #806 moved the pure part of that reading down into @fikirtive/db (consent-fold.ts), because
 * the send-eligibility engine lives there and needed the SAME reading rather than a second copy
 * of the rule. This module re-exports it unchanged, so every call site here is untouched and
 * there is still exactly one definition.
 */
export {
  contactConsentTruth,
  CRM_CONSENT_SCOPE,
  isKnownOptOut,
  NO_CONSENT_RECORD,
  type ConsentScope,
  type ConsentState,
  type ContactConsentTruth,
};

/**
 * The segment-rule fact for this contact. Known opt-out is `opt_out`; a merchant-recorded
 * opt-out stays `unknown` because that is what it is — unverified.
 */
export function consentFact(truth: ContactConsentTruth): "opt_in" | "opt_out" | "unknown" {
  if (isKnownOptOut(truth)) return "opt_out";
  return truth.state === "verified_grant" ? "opt_in" : "unknown";
}

/**
 * The one gate every audience-selecting path goes through (#806): the segments page's match and
 * the broadcast's candidate list.
 *
 * Before #806 the consent authority reached the rules only as a FACT (`marketingConsent`), so it
 * could only keep a known opt-out out of a segment whose rules happened to ask about consent. A
 * perfectly legal segment that named nothing but the channel ("everyone on WhatsApp") never asked
 * — and a customer held out of every consent-aware list walked straight into a frozen broadcast
 * audience, displayed as a kept member. That is the shape #750's Founder ruling forbids: a
 * historical opt-out must not come back onto a list.
 *
 * So the authority is a GATE, not just a fact, and it fails closed: a known opt-out is in a
 * selection only when the merchant went looking for opt-outs — i.e. when these same rules would
 * NOT have selected the contact had they been contactable. That keeps "everyone who opted out"
 * a real, working segment (the merchant asked, the page says so, the freeze agrees) while a
 * selection that never mentions consent can no longer admit one by default.
 *
 * `doNotDisturb` is normalized to false here for the same reason both callers already did it:
 * DND is a send-time axis carried honestly in each member's verdict, never a silent selection
 * filter (B0-44).
 */
export function selectedIntoAudience(
  truth: ContactConsentTruth,
  facts: SegmentContactFacts,
  rules: SegmentRuleGroup,
  evaluatedAt: string,
): boolean {
  const matchesAs = (marketingConsent: "opt_in" | "opt_out"): boolean =>
    contactMatchesRules({ ...facts, marketingConsent, doNotDisturb: false }, rules, { evaluatedAt });
  const optedOut = isKnownOptOut(truth);
  if (!matchesAs(optedOut ? "opt_out" : "opt_in")) return false;
  return optedOut ? !matchesAs("opt_in") : true;
}

export type ConsentExclusionCandidate = {
  truth: ContactConsentTruth;
  /** The `selectedIntoAudience` verdict for this contact — not the raw rule match. */
  selected: boolean;
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
 * selection: a known opt-out that is not selected today, but would have been if it were
 * contactable. Since #806 that covers the gate above as well as the rules, so a contact the gate
 * fails closed on is reported as excluded instead of vanishing from both numbers.
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
      !contact.selected &&
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
