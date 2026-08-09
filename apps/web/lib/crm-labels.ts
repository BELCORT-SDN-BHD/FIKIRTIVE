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
 *   1. no merchant-facing string is ever a raw stored token — an unmapped value is humanized
 *      (underscores out, first letter up), never printed as-is;
 *   2. nothing here invents a state. Only values the product can actually store get bespoke
 *      wording; everything else falls through to the humanizer.
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

// ── Broadcast purpose ────────────────────────────────────────────────────────────────────────

const PURPOSE_LABELS: Record<string, string> = {
  marketing: "Marketing",
  review_request: "Review request",
};

export function purposeLabel(purpose: string): string {
  return PURPOSE_LABELS[purpose] ?? purpose.replaceAll("_", " ");
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
