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
 * This sentence sits ON TOP of the event list, so it has to stay true next to everything that list
 * can render. Two things it must not assume, each of which it once got wrong:
 *
 *  1. That the history is empty. The fence is `state === "unknown"` plus a legacy `opt_out`
 *     (`contactConsentTruth`), and `unknown` survives the merchant recording his own opt-out — so
 *     a fenced contact can have events. Claiming "no consent facts were recorded" contradicted the
 *     card listing one.
 *  2. That the list covers the same tuple the state does. It does not: the badge state comes from
 *     the whatsapp × marketing projection alone (`crm-view-data.contactSelect`), while `getContact`
 *     lists consent events for EVERY channel and purpose. A verified `review_request` grant from
 *     the customer leaves the marketing tuple `unknown` and the legacy column untouched (the
 *     compatibility mirror is whatsapp × marketing only, `consent-runtime.ts:441`) — so the fence
 *     holds while the customer's own grant renders right above this note. Any unscoped claim about
 *     the customer's silence is false there.
 *
 * So the sentence names the one tuple it actually read. Within that tuple it is exact: R-010's
 * closed writer set makes every `actorKind: "customer"` source `verified`, and any such event
 * folds the state off `unknown` (`foldConsentEvents`). `state === "unknown"` on whatsapp ×
 * marketing therefore means precisely that the customer never opted in or out of WhatsApp
 * marketing. Merchant records, legacy snapshots, and other purposes can all be in the list, and
 * each event card names its own channel, purpose, and actor.
 */
export const CRM_PRE_LEDGER_OPT_OUT_NOTE =
  "The customer has never opted in or out of WhatsApp marketing, and an opt-out was recorded for this contact before this history was kept. Fikirtive keeps this contact out of audiences until the customer opts in again through their own channel.";

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
