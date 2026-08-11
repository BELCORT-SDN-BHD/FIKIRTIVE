import {
  contactMatchesRules,
  isChannelVerifiedIdentity,
  type SegmentContactFacts,
  type SegmentRuleGroup,
} from "@fikirtive/core";
import type { Prisma } from "@fikirtive/db";
// The pure R-010 fold module, NOT the package root: importing it never constructs a Prisma
// client, so a caller's unit test can keep mocking `@fikirtive/db` as just a fake client
// without having to restate the consent rule (which is the very duplication #716 removed).
import {
  contactConsentTruth,
  CRM_CONSENT_SCOPE,
  isKnownOptOut,
  NO_CONSENT_RECORD,
  type ConsentScope,
  type ConsentState,
  type ContactConsentTruth,
} from "@fikirtive/db/consent-fold";

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

/** R-010 channel-token normalization, applied identically wherever a channel becomes a fact. */
function normalizedChannel(value: string): string | null {
  const channel = value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(channel) ? channel : null;
}

/**
 * The `channels` fact a segment rule sees for one contact: every live channel that contact has.
 *
 * #806 r2 — this construction is shared because the two selecting call sites disagreed without it.
 * The broadcast used to hand the matcher `[<the run's channel>]`, which is not a fact about the
 * contact at all, and the two sides then answered `selectedIntoAudience` differently for the same
 * person: on `any(channel is email, contact is a known opt-out)`, a fenced customer holding BOTH
 * an Email and a WhatsApp identity reads as "matched on email, not selected because of consent"
 * on the segments page, but a WhatsApp run — seeing only `["whatsapp"]` — reads the same rules as
 * "the merchant deliberately asked for opt-outs" and froze her in as a kept member. The very
 * defect #806 exists to close, reappearing through a channel fact rather than a consent one.
 *
 * A rule fact describes the CONTACT. Which identities a run may actually send to is a separate
 * question, answered separately by each caller (the broadcast still targets — and still counts
 * over — only identities on its own channel).
 *
 * #803 — only CHANNEL-VERIFIED identities become channel facts. A merchant who types a customer's
 * number into the contact page is recording an address book, not a delivery guarantee: nobody has
 * confirmed that number reaches anyone, let alone on WhatsApp. If a typed number counted here,
 * "channel is whatsapp" — a segment rule that says nothing about consent and needs no opt-in —
 * would quietly sweep every hand-typed digit into a broadcast audience. That is the same shape
 * #806 closed for consent, arriving through a different door, and it is exactly what the Founder
 * ruling forbids: the lower grade is stored, shown, and searchable, never messaged.
 */
export function contactChannelFacts(
  identities: readonly { channel: string; verificationStatus: string }[],
): string[] {
  return [
    ...new Set(
      identities
        .filter(isChannelVerifiedIdentity)
        .map((identity) => normalizedChannel(identity.channel))
        .filter((channel): channel is string => channel !== null),
    ),
  ].sort();
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
  // #758 — the merchant's own optional tightening, and the ONLY thing it can do is subtract.
  // It runs inside the same gate as everything else so the count, the preview and the frozen
  // audience cannot disagree about it (#750), and it is checked before the rules because no
  // rule can undo it: a contact the merchant asked to leave out stays out of every shape,
  // including a segment deliberately built out of opt-outs.
  if (rules.excludeReportedOptOut === true && truth.reportedOptOut) return false;
  const matchesAs = (marketingConsent: "opt_in" | "opt_out"): boolean =>
    contactMatchesRules({ ...facts, marketingConsent, doNotDisturb: false }, rules, { evaluatedAt });
  const optedOut = isKnownOptOut(truth);
  if (!matchesAs(optedOut ? "opt_out" : "opt_in")) return false;
  return optedOut ? !matchesAs("opt_in") : true;
}

/** The same rules with the merchant's optional exclusion off — "who would this have selected?" */
function withoutReportedOptOutExclusion(rules: SegmentRuleGroup): SegmentRuleGroup {
  return { match: rules.match, rules: rules.rules };
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
  /**
   * #758 — contacts this selection would have kept, and the merchant's own optional exclusion
   * removed. Counted apart from `excluded` on purpose: that number is what the consent ledger
   * decided, this one is what the merchant chose, and the page may not present a choice as
   * evidence (#768). The two can never contain the same contact — see the function below.
   */
  excludedByReportedOptOut: number;
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
  // #758 — who the merchant's own exclusion removed, and nobody else. The test is the exclusion
  // itself: the same gate, on the same rules, with the option off would have selected them. So a
  // contact the ledger already holds out (the `excluded` number above) is never counted here —
  // turning the option off would not bring her back, and one person may not be reported twice
  // under two different reasons.
  const withoutOption = withoutReportedOptOutExclusion(rules);
  const excludedByReportedOptOut =
    rules.excludeReportedOptOut === true
      ? contacts.filter(
          (contact) =>
            contact.truth.reportedOptOut &&
            !contact.selected &&
            selectedIntoAudience(contact.truth, contact.facts, withoutOption, evaluatedAt),
        ).length
      : 0;
  return {
    excluded: excluded.length,
    unresolvedLegacy: excluded.filter((contact) => contact.truth.unresolvedLegacyOptOut).length,
    excludedByReportedOptOut,
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
 *  1. the projection rows in the CALLER's scope (the verified authority, which really is
 *     per-channel and per-purpose: a customer's unsubscribe is about the channel she used it on);
 *  2. every merchant declaration, folded in R-010's own `(receivedAt, id)` order so the LAST one
 *     wins. Looking at the merchant's latest record — rather than at the folded state — is what
 *     makes an opt-out recorded after a verified opt-in visible: that fold stays `verified_grant`
 *     (correctly, the customer's own evidence decides the send), so a reading keyed on the state
 *     reported such a contact as zero and #716's disclosure gap survived.
 *
 * #758 r2 判官 P1 — that second read is fixed to `CRM_CONSENT_SCOPE`, NOT the caller's scope,
 * because that is the one tuple the merchant's own record is ever WRITTEN to: both merchant
 * surfaces hardcode it (crm-actions.ts `setContactConsent` and the CSV import), exactly as
 * R-010 §4.6.1 fixes it. Reading it at the caller's scope made one fact answer differently per
 * caller: the segments page (always this scope) called a contact a reported opt-out while a
 * broadcast on any other channel looked in its own tuple, found nothing, and put back precisely
 * the people the page had just excluded — #750's defect arriving through the scope instead of
 * through the rules. If a merchant surface ever starts writing this record per channel, this
 * read has to follow it in the same commit.
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
      where: {
        ownerId,
        channel: CRM_CONSENT_SCOPE.channel,
        purpose: CRM_CONSENT_SCOPE.purpose,
        actorKind: "merchant",
      },
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
  // A merchant record can exist where THIS scope's ledger has said nothing at all — the record
  // lives in one scope, the projection is read in another. Dropping such a contact from the map
  // is how the same person became a stranger to a run on another channel, so she is carried with
  // the state this scope actually has (nothing) and the record she actually carries.
  for (const [contactId, action] of latestMerchantAction) {
    if (action !== "revoke" || truth.has(contactId)) continue;
    truth.set(contactId, { state: "unknown", unresolvedLegacyOptOut: false, reportedOptOut: true });
  }
  return truth;
}
