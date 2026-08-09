/**
 * crm-labels — the ONE place CRM turns a stored machine value into the words a merchant reads.
 *
 * #728: the same facts had two vocabularies. Reports said `WhatsApp` while Inbox, Templates and
 * Broadcasts printed the column value `whatsapp`; Broadcasts mapped run statuses through a
 * presentation function while the template card printed `not_submitted` and the conversation
 * diagnostics printed `risk`. One conversation card managed to print both spellings of the same
 * channel, one line apart. That is the project's standing root cause — what the product SAYS
 * drifting from what it DOES — in its cheapest form: a second copy of a fact.
 *
 * So there is exactly one definition of each of these maps in the repository, and every CRM
 * surface reads it. `report-format.ts` and `broadcast-format.ts` re-export from here rather than
 * defining their own, so a caller cannot accidentally pick up a stale copy.
 *
 * Two rules this file keeps:
 *   1. no merchant-facing string is ever a raw stored token. How an unmapped value is handled
 *      depends on the vocabulary it belongs to: an OPEN set the schema lets grow without a
 *      migration (channel `kind`) is humanized, while a CLOSED, code-validated set (purpose) gets
 *      a neutral placeholder — humanizing a closed-set token is still showing the token;
 *   2. nothing here invents a state. Only values the product can actually store get bespoke
 *      wording.
 *
 * Pure presentation: no data access, no tenant logic, no authority over what is true.
 */

export type CrmBadgeVariant =
  | "default"
  | "brand"
  | "outline"
  | "success"
  | "warning"
  | "info"
  | "destructive";

/** Underscored machine token → readable words. The last line of defence, never the first. */
export function humanizeToken(token: string): string {
  const words = token.replaceAll("_", " ").trim();
  return words.length === 0 ? words : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

// ── Messaging channel ────────────────────────────────────────────────────────────────────────

/** Brand spellings a merchant recognizes. `whatsapp` is the only channel the product stores. */
const CHANNEL_LABELS: Record<string, string> = { whatsapp: "WhatsApp" };

export function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel.replaceAll("_", " ");
}

/** How one connected channel account is named wherever it is offered or displayed. */
export function channelAccountLabel(scope: { channel: string; scopeKey: string }): string {
  return `${channelLabel(scope.channel)} · ${scope.scopeKey}`;
}

// ── Contact source ───────────────────────────────────────────────────────────────────────────

/**
 * How a contact got here. #822: the contacts list printed the column — `Active · manual` — and
 * `manual` is the word the CODE picked for "the merchant typed this one in", not a word anyone
 * would choose to read.
 *
 * The stored column is free text (120 chars) and only three writers exist today, so this is an
 * OPEN set with three known members: an unrecognized value is humanized rather than replaced,
 * because whatever wrote it meant something by it.
 */
const CONTACT_SOURCE_LABELS: Record<string, string> = {
  manual: "Added by you",
  otto: "Added by Otto",
  import: "Imported",
};

export function contactSourceLabel(source: string): string {
  return CONTACT_SOURCE_LABELS[source] ?? humanizeToken(source);
}

// ── Contact identity credibility grade (#803) ────────────────────────────────────────────────

/**
 * The badge next to a stored number. A closed, code-validated set of two, so an unrecognized
 * value is NOT humanized: a grade this build does not know is a grade it cannot vouch for, and
 * the honest badge for it is the cautious one.
 *
 * The words are chosen to answer the merchant's real question — "can I message this?" — without
 * promising a timeline nobody controls. No channel is connected yet (#792), so the verified badge
 * describes what happened, and the unverified one describes what is missing, and neither says
 * "soon".
 */
export function identityGradePresentation(
  verificationStatus: string,
): { label: string; variant: CrmBadgeVariant; note: string } {
  if (verificationStatus === "channel_verified") {
    return {
      label: "Channel verified",
      variant: "success",
      note: "A connected channel confirmed this number.",
    };
  }
  return {
    label: "Not verified",
    variant: "warning",
    note: "You entered this number. It is saved on the record and is not used for broadcasts.",
  };
}

// ── Broadcast purpose ────────────────────────────────────────────────────────────────────────

/**
 * 判官 r2 P2-2 — every purpose the schema allows, not just the two the broadcast workbench can
 * create. `CONSENT_PURPOSES` (packages/db consent-fold) is the closed, code-validated set, and
 * the contact profile renders consent events for ALL of it — which is how `transactional` reached
 * a merchant as a lowercase machine value.
 *
 * The fallback deliberately does NOT echo the value. For a closed set, an unrecognized member
 * means this build does not know the word for it; humanizing the token would still be showing the
 * token, just with the underscores taken out.
 */
const PURPOSE_LABELS: Record<string, string> = {
  marketing: "Marketing",
  review_request: "Review request",
  transactional: "Transactional",
};

export const UNRECOGNIZED_PURPOSE_LABEL = "Purpose not recognized";

export function purposeLabel(purpose: string): string {
  return PURPOSE_LABELS[purpose] ?? UNRECOGNIZED_PURPOSE_LABEL;
}

// ── Send-eligibility axis status ─────────────────────────────────────────────────────────────

/** The four-axis vocabulary, shared by the broadcast workbench and the conversation
 *  send-readiness diagnostics — the same axis status must read the same on both screens. */
export function axisStatusPresentation(status: string): { label: string; variant: CrmBadgeVariant } {
  switch (status) {
    case "pass":
      return { label: "Pass", variant: "success" };
    case "block":
      return { label: "Blocked", variant: "destructive" };
    case "risk":
      return { label: "At risk", variant: "warning" };
    case "unavailable":
      return { label: "Unavailable", variant: "outline" };
    default:
      return { label: "Unknown", variant: "outline" };
  }
}

// ── Message template version state ───────────────────────────────────────────────────────────

/** The only three values `customer-inbox-service` ever writes for a template version's
 *  submission / review / availability columns. No axis shares a value with another, so one map
 *  serves all three; anything else is humanized rather than shown raw. */
const TEMPLATE_STATE_LABELS: Record<string, string> = {
  draft: "Draft",
  not_submitted: "Not submitted",
  unavailable: "Unavailable",
};

export function templateStateLabel(state: string): string {
  return TEMPLATE_STATE_LABELS[state] ?? humanizeToken(state);
}
