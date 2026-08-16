// Presentation-only helpers shared by the broadcast workbench list, composer, and detail
// views. No data access, no gateway calls — pure formatting of values already returned by
// customer-broadcast-ui-actions.ts. Copy is English sentence case throughout.

import { MY_DATE_TIME_FORMAT } from "@/lib/my-date-format";

// #728 — the channel name, the broadcast purpose and the four-axis status vocabulary are one
// set of words for the whole of CRM, defined in `@/lib/crm-labels` and re-exported here so this
// family keeps its single import site without keeping a second copy of the map.
export { axisStatusPresentation, channelAccountLabel, channelLabel, purposeLabel } from "@/lib/crm-labels";

type BadgeVariant = "default" | "brand" | "outline" | "success" | "warning" | "destructive";

const DATE_TIME = MY_DATE_TIME_FORMAT;

export function dateTimeLabel(value: Date | string | null | undefined): string {
  if (!value) return "Not recorded";
  return DATE_TIME.format(new Date(value));
}

/** The four send-eligibility axes, always shown separately — never merged (§3.2). */
export type AxisKey = "consentStop" | "doNotDisturb" | "providerRefusal" | "frequency";

export const AXIS_ORDER: AxisKey[] = ["consentStop", "doNotDisturb", "providerRefusal", "frequency"];

export const AXIS_LABELS: Record<AxisKey, string> = {
  consentStop: "Consent / STOP",
  doNotDisturb: "Do not disturb",
  providerRefusal: "Provider refusal",
  frequency: "Frequency cap",
};

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
      return { label: "Cancelled", variant: "outline" };
    case "failed":
      return { label: "Failed", variant: "destructive" };
    default:
      return { label: status, variant: "outline" };
  }
}

export function sendStatePresentation(state: string): { label: string; variant: BadgeVariant } {
  switch (state) {
    case "simulated_sent":
      return { label: "Simulated send", variant: "success" };
    case "skipped_ineligible":
      return { label: "Skipped", variant: "warning" };
    case "send_unavailable":
      return { label: "Send unavailable", variant: "outline" };
    default:
      return { label: "Pending", variant: "outline" };
  }
}

export function roleLabel(role: string): string {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  if (role === "member") return "Member";
  return role;
}

const AXIS_REASON_COPY: Record<string, string> = {
  // #728 — "D5" is an internal design-document number. It named the rule for us, never for the
  // merchant, who has no way to look it up. The rule itself is stated in full instead.
  effective_revoke: "The customer has opted out (STOP). A send would need two independent human confirmations, which are unavailable.",
  consent_unknown_d5_eligible: "Consent is unknown. A send would need two independent human confirmations, which are unavailable.",
  consent_unknown_unconfirmed_automatic_hard_block: "Consent is unknown — a hard block for automated sends.",
  // #806 — every clause states only what the ledger holds, the rule #768 arrived at for this
  // exact customer (see CRM_PRE_LEDGER_OPT_OUT_NOTE). "An opt-out was recorded" is passive on
  // purpose: R-010 fixes the legacy carrier at `legacy_unknown / unresolved` and forbids
  // guessing who recorded it. No "again" either — that would presuppose a first opt-in the
  // ledger cannot see. The release clause is the note's own, word for word.
  unresolved_legacy_opt_out:
    "An opt-out was recorded for this contact before consent history began, so sending stays closed until the customer opts in through their own channel.",
  // Says only what happened: a read failed. This reason also fires for a contact who has no
  // pre-ledger record at all, so it must not describe one.
  legacy_mirror_unreadable: "Part of the consent record could not be read, so sending fails closed.",
  dnd_set: "The customer is on Do Not Disturb.",
  permanent_recipient_block: "The provider has permanently refused this recipient.",
  account_level_block: "The provider has suspended this account.",
  frequency_cap_reached: "The frequency cap for this contact was already reached in the rolling window.",
  missing_channel_policy: "No frequency policy is configured for this channel, so sending fails closed.",
  projection_unreadable: "The consent record could not be read, so sending fails closed.",
  fold_unreadable: "The do-not-disturb record could not be read, so sending fails closed.",
  state_unreadable: "The provider refusal record could not be read, so sending fails closed.",
  counter_unreadable: "The frequency counter could not be read, so sending fails closed.",
  contact_not_found_in_tenant: "The contact record was not found in this workspace.",
  no_blocking_axis: "No blocking axis was found.",
};

/** Plain-English copy for a `axis:reason` skip code (never PII). Falls back gracefully. */
export function skipReasonCopy(skipReason: string | null | undefined): string {
  if (!skipReason) return "Skipped.";
  const [axis, reason] = skipReason.split(":");
  const axisName = (AXIS_LABELS as Record<string, string>)[axis] ?? axis;
  const detail = reason ? AXIS_REASON_COPY[reason] ?? reason.replaceAll("_", " ") : "blocked";
  return `${axisName}: ${detail}`;
}

/** Plain-English copy for an axis reason code (used in preflight rows). */
export function axisReasonCopy(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return AXIS_REASON_COPY[reason] ?? reason.replaceAll("_", " ");
}

const ERROR_COPY: Record<string, string> = {
  NOT_AUTHORIZED: "You need to sign in again to see this workspace.",
  ACTION_DENIED: "Your account doesn't have access to this workspace's broadcasts.",
  RESOURCE_NOT_FOUND: "This item is not available. It may not exist, or you may not have access.",
  CAS_CONFLICT: "This changed since you last loaded it — reload to see the latest.",
  AUDIENCE_STATE_CONFLICT: "This broadcast's audience is in an unexpected state — reload before re-freezing.",
  IDEMPOTENCY_CONFLICT: "That request was already recorded differently — reload to check the latest state.",
  SEND_PATH_UNAVAILABLE: "Real sending isn't available yet — this workbench only runs simulated sends.",
  INVALID_ARGUMENT: "That request wasn't valid. Please check the values and try again.",
  TEMPLATE_CHANNEL_MISMATCH: "That template belongs to a different channel account. Choose a matching template.",
  TEMPLATE_CLASSIFICATION_UNSUPPORTED: "That template cannot be used for a broadcast because its purpose is unavailable.",
  PROVIDER_CONNECTION_CONFLICT: "Broadcast eligibility could not be verified because more than one active channel connection matched.",
};

export function errorMessage(code: string): string {
  return ERROR_COPY[code] ?? `The request failed (${code}). Please retry.`;
}

// Only these three codes get the deliberately indistinguishable "not available" page (denied —
// never leak whether a resource exists vs. is merely inaccessible), matching the Inbox precedent.
const DENIAL_ERROR_CODES = new Set(["NOT_AUTHORIZED", "ACTION_DENIED", "RESOURCE_NOT_FOUND"]);

export function isDenialErrorCode(code: string): boolean {
  return DENIAL_ERROR_CODES.has(code);
}

/** Short customer display for an audience member row (name + channel handle), never fabricated. */
export function memberDisplay(member: {
  contact?: { name?: string | null } | null;
  contactIdentity?: { handle?: string | null; label?: string | null; externalId?: string | null } | null;
  contactId: string;
}): { name: string; handle: string | null } {
  const name = member.contact?.name?.trim() || `Contact ${member.contactId.slice(0, 6)}`;
  const identity = member.contactIdentity;
  const handle = identity?.handle ?? identity?.label ?? identity?.externalId ?? null;
  return { name, handle };
}
