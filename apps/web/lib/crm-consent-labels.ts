import type { CrmConsentState } from "./crm-view-data";

export const CRM_CONSENT_LABELS: Record<CrmConsentState["state"], string> = {
  unknown: "Unknown",
  verified_grant: "Verified opt-in",
  effective_revoke: "Opted out",
};

/**
 * #752 — the words for a contact the pre-ledger fence holds out of every audience.
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
 *  3. "Fikirtive keeps this contact out of audiences until the customer opts in through their own
 *     channel."
 *     Behaviour, not biography: `isKnownOptOut` excludes while the fence stands, and only the
 *     customer's own verified evidence folding to `verified_grant` lifts it (`contactConsentTruth`).
 *     No "again" — that would presuppose an earlier opt-in the ledger cannot see.
 *
 * What the note must never do again: deny records on the same screen (r1), claim the customer was
 * silent when another purpose holds her own grant (r2), or claim she "has never" decided, which no
 * `unknown` can establish (r3).
 */
export const CRM_PRE_LEDGER_OPT_OUT_NOTE =
  "This history has no WhatsApp marketing decision from the customer, and an opt-out was recorded before it began. Fikirtive keeps this contact out of audiences until the customer opts in through their own channel.";

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
