import { purposeLabel } from "@/lib/crm-labels";
import { MY_DATE_TIME_FORMAT } from "@/lib/my-date-format";

// #728 — the channel and purpose maps this page was already right about now live in ONE place
// so the rest of CRM can read the same words instead of printing the stored column.
export { channelLabel, purposeLabel } from "@/lib/crm-labels";

type BadgeVariant =
  | "default"
  | "brand"
  | "outline"
  | "success"
  | "warning"
  | "info"
  | "destructive";

const DATE_TIME = MY_DATE_TIME_FORMAT;

export function dateTimeLabel(value: Date | string | null | undefined): string {
  if (!value) return "Not recorded";
  return DATE_TIME.format(new Date(value));
}

export function shortBroadcastId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

export function broadcastTitle(purpose: string): string {
  return `${purposeLabel(purpose)} broadcast`;
}

export function runStatusPresentation(status: string): { label: string; variant: BadgeVariant } {
  switch (status) {
    case "draft":
      return { label: "Draft", variant: "outline" };
    case "audience_frozen":
      return { label: "Audience frozen", variant: "brand" };
    case "confirmed":
      return { label: "Confirmed", variant: "brand" };
    case "executing":
      return { label: "Simulating", variant: "warning" };
    case "completed":
      return { label: "Completed (simulated)", variant: "success" };
    case "cancelled":
      return { label: "Canceled", variant: "outline" };
    case "failed":
      return { label: "Failed", variant: "destructive" };
    default:
      return { label: status.replaceAll("_", " "), variant: "outline" };
  }
}

export function sendStatePresentation(state: string): { label: string; variant: BadgeVariant } {
  switch (state) {
    case "simulated_sent":
      return { label: "Simulated attempt", variant: "brand" };
    case "skipped_ineligible":
      return { label: "Skipped before sending", variant: "warning" };
    case "send_unavailable":
      return { label: "Send unavailable", variant: "outline" };
    default:
      return { label: "Pending attempt", variant: "outline" };
  }
}

export function lifecyclePresentation(lifecycle: string): { label: string; variant: BadgeVariant } {
  switch (lifecycle) {
    case "accepted":
      return { label: "Accepted", variant: "info" };
    case "delivered":
      return { label: "Delivered", variant: "success" };
    case "read":
      return { label: "Read", variant: "success" };
    case "failed":
      return { label: "Failed", variant: "destructive" };
    default:
      return { label: "Unknown", variant: "outline" };
  }
}

export function reconciliationPresentation(status: string): { label: string; variant: BadgeVariant } {
  switch (status) {
    case "converged":
      return { label: "Converged", variant: "success" };
    case "conflict":
      return { label: "Conflict", variant: "destructive" };
    case "timeout_unknown":
      return { label: "Timeout unknown", variant: "warning" };
    case "not_applicable":
      return { label: "Not applicable", variant: "outline" };
    case "pending":
      return { label: "Pending", variant: "warning" };
    default:
      return { label: status.replaceAll("_", " "), variant: "outline" };
  }
}

const RECEIPT_REASON_COPY: Record<string, string> = {
  NO_SENDING_ATTEMPT:
    "No sending attempt reached this recipient, so there is nothing to reconcile.",
  SIMULATED_ATTEMPT_NO_EXTERNAL_FACT:
    "This was a simulated attempt, so no external provider fact exists.",
  EXTERNAL_RESPONSE_TIMEOUT:
    "The provider response timed out. Delivery remains unknown.",
  MUTUALLY_EXCLUSIVE_TERMINAL_FACTS:
    "The provider facts conflict. No delivery outcome was chosen automatically.",
  SOURCE_EVENT_CONFLICT:
    "Two provider facts conflict. The receipt needs review.",
  EXISTING_RECONCILIATION_CONFLICT:
    "This receipt has an unresolved provider-fact conflict.",
  UNRECOGNIZED_DELIVERY_FACT:
    "The provider fact is not recognized, so it was not treated as a delivery outcome.",
};

export function receiptReasonCopy(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return RECEIPT_REASON_COPY[reason] ?? reason.replaceAll("_", " ").toLowerCase();
}

const ERROR_COPY: Record<string, string> = {
  NOT_AUTHORIZED: "You need to sign in again to see delivery reports.",
  ACTION_DENIED: "Delivery reports are only available to the workspace owner.",
  RESOURCE_NOT_FOUND: "This report is not available. It may not exist, or you may not have access.",
  INVALID_ARGUMENT: "That report request was not valid. Please retry from the reports list.",
};

export function errorMessage(code: string): string {
  return ERROR_COPY[code] ?? `The report request failed (${code}). Please retry.`;
}

const DENIAL_ERROR_CODES = new Set(["NOT_AUTHORIZED", "ACTION_DENIED", "RESOURCE_NOT_FOUND"]);

export function isDenialErrorCode(code: string): boolean {
  return DENIAL_ERROR_CODES.has(code);
}
