import type { CrmConsentState } from "./crm-view-data";

export const CRM_CONSENT_LABELS: Record<CrmConsentState["state"], string> = {
  unknown: "Unknown",
  verified_grant: "Verified opt-in",
  effective_revoke: "Opted out",
};

/**
 * #752 — the words for a contact the pre-ledger fence holds out of the audiences that were not
 * looking for her.
 *
 * Precisely (#806/#807): she is kept out of any selection whose rules would have selected her had
 * she been contactable, which is every ordinary audience. The one selection she still belongs to
 * is the one a merchant deliberately built out of opt-outs — he asked, the page says so, and the
 * send gate is what holds there, answering `block` on this same fence. "Every audience" would
 * therefore be an overclaim, and this file may not make one.
 *
 * The segments page already says `opted out before consent history` about exactly these people.
 * The ledger state behind them is `unknown`, so a badge read from the state alone said "Unknown"
 * on the contacts list and the profile while the segments page said they were excluded — one
 * customer, two stories. The fence decision itself is made in ONE place
 * (`consent-authority.contactConsentTruth`); this file only puts it into words.
 */
export const CRM_PRE_LEDGER_OPT_OUT_LABEL = "Opted out before consent history";

/**
 * The profile page has room to say the whole fact, and it has to: what fences this contact is the
 * legacy column, which never becomes an event, so the consent history card below cannot show the
 * reason and the exclusion would read as reason-free.
 *
 * THE RULE, arrived at after three wrong versions: every clause may state only what the ledger can
 * prove. The note may not describe what the customer did or did not do in life — the ledger records
 * what was written down, not what happened.
 *
 * Clause by clause, and the evidence for each:
 *
 *  1. "This history has no WhatsApp marketing decision from the customer."
 *     R-010's closed writer set gives every `actorKind: "customer"` source `evidenceStatus:
 *     "verified"`, and every such event folds the state off `unknown` (`foldConsentEvents`). So
 *     `state === "unknown"` on this tuple is exactly "no event here is recorded as the customer's".
 *     It is scoped to whatsapp × marketing because that is the only tuple the state is read from
 *     (`crm-view-data.contactSelect`) while the list below shows EVERY channel and purpose — a
 *     verified `review_request` grant from the customer can sit right above this note.
 *  2. "…and an opt-out was recorded before it began."
 *     The legacy `Contact.marketingConsent` column, which predates the ledger (R-010 §4.6.5) and is
 *     never written by it outside whatsapp × marketing (`consent-runtime.ts:441`). It deliberately
 *     does NOT say who recorded it: R-010 fixes the legacy carrier at `legacy_unknown /
 *     unresolved` and forbids guessing an actor, so the opt-out may well be the customer's own act
 *     in an older system — which is precisely why the fence is fail-closed rather than ignorable.
 *  3. "When Fikirtive evaluates segment rules for WhatsApp marketing, it counts this contact as
 *     opted out until the customer opts in through their own channel."
 *     Written as a CLASSIFICATION because when #768 shipped it, that was all the product could
 *     honestly promise: the fence reached the matcher only as a fact, so a segment whose rules
 *     never mentioned contactability selected this contact anyway, and the broadcast froze her
 *     in with `includedByMerchant: true`; the send gate did not save it either, because
 *     `send-eligibility` read only `ConsentStateProjection` and answered `risk`, not `block`.
 *     #806 closed both halves, so the sentence is now backed by an enforced gate as well:
 *      - selection — `consent-authority.selectedIntoAudience` is the one gate the segments page
 *        and the broadcast's candidate list both go through, on the same shared facts. A known
 *        opt-out stays in a selection ONLY when these rules would not have selected her had she
 *        been contactable, i.e. only when the merchant went looking for opt-outs;
 *      - sending — the consentStop axis reads the fence itself and answers `block`
 *        (`unresolved_legacy_opt_out`) for every callerClass, never the D5-overridable `risk`.
 *     The wording still says "counts as opted out" rather than promising she is kept out of
 *     audiences, and that is deliberate: the one audience she can still enter is the one a
 *     merchant deliberately built out of opt-outs, where the send gate is what holds.
 *     Scoped to WhatsApp marketing because `contactConsentTruth` applies the fence to no other
 *     tuple. Only the customer's own verified evidence folding to `verified_grant` clears it. No
 *     "again" — that would presuppose an earlier opt-in the ledger cannot see.
 *
 * What the note must never do again: deny records on the same screen (r1), claim the customer was
 * silent when another purpose holds her own grant (r2), claim she "has never" decided, which no
 * `unknown` can establish (r3), or promise an exclusion the product does not enforce (r4).
 *
 * The empty state in `contact-profile-page.tsx` carried the same r4 promise and was corrected with
 * this one — it now points at this note rather than restating it, so the claim cannot come back by
 * that route. The underlying product gap this copy was forbidden to paper over (a channel-only
 * segment selects a fenced contact; the send gate answers `risk` because it never reads the legacy
 * column) was closed by #806 — see clause 3. The wording did not need to change, which is the
 * point: it only ever claimed what was true.
 */
export const CRM_PRE_LEDGER_OPT_OUT_NOTE =
  "This history has no WhatsApp marketing decision from the customer, and an opt-out was recorded before it began. When Fikirtive evaluates segment rules for WhatsApp marketing, it counts this contact as opted out until the customer opts in through their own channel.";

export type CrmConsentBadge = {
  label: string;
  variant: "success" | "destructive" | "warning";
};

/**
 * One badge for the contacts list and the contact profile, so the two pages cannot drift apart
 * the way they drifted from the segments page.
 *
 * The fence is read first because it is the stronger fact: it only ever applies while `state` is
 * `unknown` (see `contactConsentTruth`), and while it applies this contact is kept out of
 * audiences exactly like a verified opt-out — so it gets the same `destructive` weight, never the
 * `warning` weight of "we do not know yet".
 */
export function crmConsentBadge(consentState: CrmConsentState): CrmConsentBadge {
  if (consentState.unresolvedLegacyOptOut) {
    return { label: CRM_PRE_LEDGER_OPT_OUT_LABEL, variant: "destructive" };
  }
  if (consentState.state === "verified_grant") {
    return { label: CRM_CONSENT_LABELS.verified_grant, variant: "success" };
  }
  if (consentState.state === "effective_revoke") {
    return { label: CRM_CONSENT_LABELS.effective_revoke, variant: "destructive" };
  }
  return { label: CRM_CONSENT_LABELS.unknown, variant: "warning" };
}
