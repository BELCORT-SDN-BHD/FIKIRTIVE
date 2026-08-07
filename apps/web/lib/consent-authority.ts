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
 * longer read by anything that selects, freezes or sends an audience.
 *
 * The reading carries TWO separate facts, and they are never collapsed into one:
 *  - `state` — the verified consent state. Only `effective_revoke` is a known opt-out.
 *  - `reportedOptOut` — the merchant's OWN record of an opt-out (contact profile
 *    "Record reported opt-out", or a CSV import row with `consent=opt_out`). R-010 keeps this
 *    out of the verified state on purpose: a merchant assertion is not customer-verified
 *    evidence (#496, Founder's option B). It is surfaced, never silently folded into "unknown".
 */

/**
 * Every consent surface a merchant can reach today — the contact profile's opt-out control, CSV
 * import, the contacts list badge — writes and reads this one scope. Segment selection has no
 * channel or purpose of its own, so it reads the same scope those pages display; a broadcast
 * reads its own run's channel + purpose through the same functions.
 */
export const CRM_CONSENT_SCOPE = { channel: "whatsapp", purpose: "marketing" } as const;

export type ConsentScope = { channel: string; purpose: string };

export type ConsentState = "unknown" | "verified_grant" | "effective_revoke";

export type ContactConsentTruth = {
  /** Verified R-010 state. Only `effective_revoke` is a known opt-out. */
  state: ConsentState;
  /** The merchant's own latest record says "opted out" — recorded, not verified. */
  reportedOptOut: boolean;
};

/** No consent event has ever been recorded for this contact in this scope. */
export const NO_CONSENT_RECORD: ContactConsentTruth = { state: "unknown", reportedOptOut: false };

/** The one definition of "known opt-out" — shared by segment selection, freeze and display. */
export function isKnownOptOut(truth: ContactConsentTruth): boolean {
  return truth.state === "effective_revoke";
}

/**
 * The segment-rule fact for this contact. Known opt-out is `opt_out`; a merchant-recorded
 * opt-out stays `unknown` because that is what it is — unverified.
 */
export function consentFact(truth: ContactConsentTruth): "opt_in" | "opt_out" | "unknown" {
  if (truth.state === "effective_revoke") return "opt_out";
  return truth.state === "verified_grant" ? "opt_in" : "unknown";
}

export type ConsentExclusionCandidate = {
  knownOptOut: boolean;
  matched: boolean;
  facts: SegmentContactFacts;
};

/**
 * How many contacts the consent authority — not the merchant's other rules — kept out of this
 * selection: a known opt-out that does not match today, but would match if it were contactable.
 *
 * The segments page and the broadcast audience both count with this one function, so "N known
 * opt-out excluded" cannot mean one thing on one page and another downstream (#726). Each caller
 * passes its own population (the segments page has no channel; a broadcast counts only contacts
 * reachable on its run's channel), and both get the same arithmetic over it.
 */
export function countExcludedByConsent(
  contacts: readonly ConsentExclusionCandidate[],
  rules: SegmentRuleGroup,
  evaluatedAt: string,
): number {
  return contacts.filter(
    (contact) =>
      contact.knownOptOut &&
      !contact.matched &&
      contactMatchesRules(
        { ...contact.facts, marketingConsent: "opt_in", doNotDisturb: false },
        rules,
        { evaluatedAt },
      ),
  ).length;
}

function asState(value: string): ConsentState {
  return value === "verified_grant" || value === "effective_revoke" ? value : "unknown";
}

/**
 * Reads every contact's consent truth for one owner in one scope.
 *
 * Two owner-fenced queries, no per-contact fan-out:
 *  1. the projection rows (the verified authority);
 *  2. the last event behind each projection that is still `unknown` AND `asserted` — that is
 *     exactly the "merchant recorded something and no verified evidence overrode it" set, and
 *     `lastEventId` makes it a primary-key read. Any verified event would have moved `state` off
 *     `unknown`, so a still-unknown projection whose last event is an asserted merchant revoke is
 *     precisely a merchant-recorded opt-out (the same rule the contact profile already states).
 */
export async function readContactConsentTruth(
  client: Prisma.TransactionClient,
  ownerId: string,
  scope: ConsentScope = CRM_CONSENT_SCOPE,
): Promise<Map<string, ContactConsentTruth>> {
  const projections = await client.consentStateProjection.findMany({
    where: { ownerId, channel: scope.channel, purpose: scope.purpose },
    select: { contactId: true, state: true, evidenceStatus: true, lastEventId: true },
  });

  const assertedLastEventIds = projections
    .filter((row) => row.state === "unknown" && row.evidenceStatus === "asserted")
    .map((row) => row.lastEventId);
  const reportedEventIds = new Set<string>();
  if (assertedLastEventIds.length > 0) {
    const reported = await client.consentEvent.findMany({
      where: {
        ownerId,
        id: { in: assertedLastEventIds },
        action: "revoke",
        actorKind: "merchant",
        evidenceStatus: "asserted",
      },
      select: { id: true },
    });
    for (const row of reported) reportedEventIds.add(row.id);
  }

  const truth = new Map<string, ContactConsentTruth>();
  for (const row of projections) {
    truth.set(row.contactId, {
      state: asState(row.state),
      reportedOptOut: reportedEventIds.has(row.lastEventId),
    });
  }
  return truth;
}
