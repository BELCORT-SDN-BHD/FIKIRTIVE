// Presentation-only helpers shared by the Inbox list, conversation, and template
// views. No data access, no gateway calls — pure formatting of values already
// returned by customer-inbox-ui-actions.ts.

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const DATE_TIME = new Intl.DateTimeFormat("en-MY", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kuala_Lumpur",
});
const TIME_ONLY = new Intl.DateTimeFormat("en-MY", {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Asia/Kuala_Lumpur",
});

/** "Not recorded" for a genuinely absent value — never fabricate a fallback date. */
export function dateTimeLabel(value: Date | string | null | undefined): string {
  if (!value) return "Not recorded";
  return DATE_TIME.format(new Date(value));
}

export function timeOnlyLabel(value: Date | string | null | undefined): string {
  if (!value) return "Unknown";
  return TIME_ONLY.format(new Date(value));
}

/** Short relative label ("3m ago", "yesterday"). Falls back to an absolute date
 *  past 6 days, matching how most chat UIs avoid ambiguous "N weeks ago" labels. */
export function relativeTimeLabel(value: Date | string | null | undefined): string {
  if (!value) return "No activity yet";
  const date = new Date(value);
  const diffMs = date.getTime() - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return "just now";
  if (abs < 3600) return RELATIVE.format(Math.round(diffSec / 60), "minute");
  if (abs < 86_400) return RELATIVE.format(Math.round(diffSec / 3600), "hour");
  if (abs < 6 * 86_400) return RELATIVE.format(Math.round(diffSec / 86_400), "day");
  return dateTimeLabel(date);
}

export function attentionPresentation(
  // Typed as `string`, not a literal union: the service's needs_reply keyset-scan
  // branch (customer-inbox-service.ts) annotates its row type as `attention: string`,
  // so the gateway's inferred return type is not narrower than that across both
  // listConversations code paths.
  attention: string,
): { label: string; variant: "destructive" | "warning" | "outline" } {
  if (attention === "needs_reply") return { label: "Needs reply", variant: "destructive" };
  if (attention === "waiting_on_customer") return { label: "Waiting on customer", variant: "warning" };
  return { label: "No open action", variant: "outline" };
}

export type AutomationState = "disabled" | "paused_by_human" | string;

/** Fixed badge semantics — driven only by automationState. Never invent a state.
 *
 *  #791-2: the "Otto handling" badge is gone. Otto has never answered a customer
 *  conversation — the service says so in its own words ("M2 never writes otto_active"),
 *  and the only writer of `paused_by_human` is a take-over FROM that state, so it cannot
 *  occur either. A badge for a state the product cannot reach told merchants their inbox
 *  was being worked by an assistant that was never there. What is left is what is true:
 *  every conversation is handled by a person. `paused_by_human` keeps its wording because
 *  historical rows may carry it and it is honest about what happened. */
export function controlBadgePresentation(
  state: AutomationState,
): { label: string; variant: "outline" | "warning" } {
  if (state === "paused_by_human") return { label: "Human took over · Otto paused", variant: "warning" };
  return { label: "Manual only", variant: "outline" };
}

export function statusPresentation(status: string): { label: string; variant: "success" | "outline" } {
  return status === "open" ? { label: "Open", variant: "success" } : { label: "Closed", variant: "outline" };
}

/** Extracts safe display text from a stored message/draft content envelope.
 *  Anything that isn't the known `{type:"text"}` shape renders as a neutral
 *  placeholder — never attempt to render unknown JSON as if it were media. */
export function messageText(contentJson: unknown): { text: string } | { unsupported: true } {
  if (
    contentJson &&
    typeof contentJson === "object" &&
    "type" in contentJson &&
    (contentJson as { type: unknown }).type === "text" &&
    "text" in contentJson &&
    typeof (contentJson as { text: unknown }).text === "string"
  ) {
    return { text: (contentJson as { text: string }).text };
  }
  return { unsupported: true };
}

const ERROR_COPY: Record<string, string> = {
  NOT_AUTHORIZED: "You need to sign in again to see this workspace.",
  ACTION_DENIED: "Your account doesn't have access to this workspace's Inbox.",
  RESOURCE_NOT_FOUND: "This item is not available. It may not exist, or you may not have access.",
  IMPERSONATION_READ_ONLY: "Impersonation is read-only — exit impersonation to make this change.",
  CAS_CONFLICT: "This changed since you last loaded it — reload to see the latest.",
  TAKEOVER_REQUIRED: "Take over the conversation from Otto before editing the draft.",
  IDEMPOTENCY_CONFLICT: "That request was already recorded differently — reload to check the latest state.",
  SEND_PATH_UNAVAILABLE: "Sending isn't available yet.",
  TEMPLATE_SUBMISSION_UNAVAILABLE: "Template submission isn't available yet.",
  INVALID_ARGUMENT: "That request wasn't valid. Please check the values and try again.",
  PROVIDER_CONNECTION_CONFLICT: "Inbox eligibility could not be verified because more than one active channel connection matched.",
  TEMPLATE_VARIABLE_MISMATCH: "The message body and the variables list don't match. Line them up and try again.",
};

/** Plain-English copy for a CustomerInboxErrorCode. Falls back to a generic
 *  message (with the raw code visible) for any code this UI doesn't recognize,
 *  rather than showing nothing.
 *
 *  #729 — a refusal whose reason depends on what was submitted (which placeholder, which
 *  variable) arrives with the server's own sentence in `detail`; it is more specific than
 *  anything a fixed map can say, so it wins. */
export function errorMessage(code: string, detail?: string): string {
  return detail ?? ERROR_COPY[code] ?? `The request failed (${code}). Please retry.`;
}

// Per docs/superpowers/specs/2026-07-19-c4a-inbox-whatsapp-physical-contract.md §7.2: only
// these three codes get the deliberately indistinguishable "not available" page (denied —
// never leak whether a resource exists vs. is merely inaccessible). Every other stable
// error code is honest and gets an in-page error card that keeps the header/filters intact.
const DENIAL_ERROR_CODES = new Set(["NOT_AUTHORIZED", "ACTION_DENIED", "RESOURCE_NOT_FOUND"]);

export function isDenialErrorCode(code: string): boolean {
  return DENIAL_ERROR_CODES.has(code);
}

/** #725 — a membership the member directory doesn't contain (left the workspace, or the
 *  directory read failed) is described honestly. A display name is never fabricated, and the
 *  internal membership id is never shown to the merchant: no screen in the product resolves it. */
function memberPhrase(
  membershipId: string | null | undefined,
  resolveMemberName: (membershipId: string) => string | null,
): string {
  if (!membershipId) return "a team member";
  return resolveMemberName(membershipId) ?? "a team member who is no longer listed";
}

/** Plain-English description of a control/assignment timeline event. Names come from the
 *  server-read member directory passed in by the caller. */
export function eventDescription(
  event: {
    kind: string;
    fromAssigneeMembershipId: string | null;
    toAssigneeMembershipId: string | null;
    fromAutomationState: string | null;
    toAutomationState: string | null;
    note: string | null;
  },
  resolveMemberName: (membershipId: string) => string | null,
): string {
  switch (event.kind) {
    case "assigned":
      return `Assigned to ${memberPhrase(event.toAssigneeMembershipId, resolveMemberName)}`;
    case "unassigned":
      return "Unassigned";
    case "takeover":
      return "A team member took over from Otto";
    case "handoff":
      return `Handed off to ${memberPhrase(event.toAssigneeMembershipId, resolveMemberName)}${event.note ? ` — "${event.note}"` : ""}`;
    case "automation_resume_requested":
      return `Automation resume requested${event.note ? ` — "${event.note}"` : ""} (auto-reply stays off for now)`;
    case "opened":
      return "Conversation reopened";
    case "closed":
      return "Conversation closed";
    default:
      return event.kind.replaceAll("_", " ");
  }
}
