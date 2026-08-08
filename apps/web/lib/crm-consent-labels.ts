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
 * The profile page has room to say the whole fact, and it has to: the consent history card below
 * it is empty by definition — the fence exists precisely because the ledger never reached this
 * contact — so without this sentence the page shows a reason-free exclusion.
 */
export const CRM_PRE_LEDGER_OPT_OUT_NOTE =
  "No consent facts were recorded for this contact, and an opt-out was recorded before this history was kept. Fikirtive keeps this contact out of audiences until the customer opts in again through their own channel.";

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
