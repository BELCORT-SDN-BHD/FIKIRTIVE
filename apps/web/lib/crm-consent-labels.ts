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
 * The sentence has to hold for EVERY shape the fence covers, not only the empty-history one. The
 * fence is `state === "unknown"` plus a legacy `opt_out` (`contactConsentTruth`), and `unknown`
 * survives the merchant recording his own opt-out — so a fenced contact can have events, and this
 * note used to claim "no consent facts were recorded" while the card underneath listed one.
 *
 * What is true in all of them: R-010's closed writer set makes every `actorKind: "customer"`
 * source `verified`, and any such event folds the state off `unknown` (`foldConsentEvents`).
 * So `state === "unknown"` means exactly this — nothing in this scope's history came from the
 * customer. Merchant records and legacy snapshots can be there, and the event card names their
 * actor.
 */
export const CRM_PRE_LEDGER_OPT_OUT_NOTE =
  "Nothing in this consent history came from the customer, and an opt-out was recorded for this contact before the history was kept. Fikirtive keeps this contact out of audiences until the customer opts in again through their own channel.";

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
