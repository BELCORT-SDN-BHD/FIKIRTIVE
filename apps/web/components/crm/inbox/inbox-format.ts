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

export type AutomationState = "disabled" | "otto_active" | "paused_by_human" | string;

/** Fixed badge semantics — driven only by automationState. Never invent a fourth. */
export function controlBadgePresentation(
  state: AutomationState,
): { label: string; variant: "outline" | "brand" | "warning" } {
  if (state === "otto_active") return { label: "Otto handling", variant: "brand" };
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
};

/** Plain-English copy for a CustomerInboxErrorCode. Falls back to a generic
 *  message (with the raw code visible) for any code this UI doesn't recognize,
 *  rather than showing nothing. */
export function errorMessage(code: string): string {
  return ERROR_COPY[code] ?? `The request failed (${code}). Please retry.`;
}

function shortId(id: string | null | undefined): string {
  if (!id) return "unassigned";
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

/** Plain-English description of a control/assignment timeline event. Membership
 *  names aren't available from any read this UI can call, so events reference the
 *  membership ID (shortened) rather than fabricating a display name. */
export function eventDescription(event: {
  kind: string;
  fromAssigneeMembershipId: string | null;
  toAssigneeMembershipId: string | null;
  fromAutomationState: string | null;
  toAutomationState: string | null;
  note: string | null;
}): string {
  switch (event.kind) {
    case "assigned":
      return `Assigned to membership ${shortId(event.toAssigneeMembershipId)}`;
    case "unassigned":
      return "Unassigned";
    case "takeover":
      return "A team member took over from Otto";
    case "handoff":
      return `Handed off to membership ${shortId(event.toAssigneeMembershipId)}${event.note ? ` — "${event.note}"` : ""}`;
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
