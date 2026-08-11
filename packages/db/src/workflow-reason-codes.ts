/**
 * The closed vocabulary of stop reasons a Routine can put in front of a merchant (#811, #834 r2).
 *
 * `RoutineRun.blockReason` and `RoutineRun.errorCode` are rendered by exactly one surface —
 * the Routine monitoring panel — and it turns whichever is set into an English sentence through
 * `reasonCodeCopy`. So both columns hold merchant-visible vocabulary, and both are typed against
 * THIS union: a hand-written code can no longer be persisted, which is what made the copy
 * pinboard bypassable (a new string landed in the column, the merchant read the humanised token,
 * and the both-directions test stayed green because nobody had added it to any enumeration).
 *
 * Every family is DERIVED from the module that owns it, never retyped here. Adding a reason
 * there lands it here on its own, and `workflow-format`'s pinboard then demands a sentence for it.
 */
import { BUSINESS_HOURS_UNAVAILABLE_REASONS, type BusinessHoursUnavailableReason } from "./workflow-business-hours.js";
import { ROUTINE_AUTHORITY_FAILURES, type RoutineAuthorityFailure } from "./workflow-engine.js";
import { WORKFLOW_PRE_DISPATCH_UNAVAILABLE_REASONS } from "./workflow-journey.js";
import { SEND_ELIGIBILITY_NON_PASS_REASONS } from "./send-eligibility.js";

/**
 * The stop reasons the workflow dispatch names itself, rather than reading off an evaluator.
 * They live here, beside the column that stores them, so the union below is complete without
 * the web app having to hand a second list to the ledger.
 */
export const WORKFLOW_SERVICE_STOP_REASONS = {
  humanTakeover: "HUMAN_TAKEOVER_AUTOMATION_PAUSED",
  businessHoursInside: "BUSINESS_HOURS_INSIDE",
  conversationStrictClassificationUnavailable: "CONVERSATION_STRICT_CLASSIFICATION_UNAVAILABLE",
  broadcastOneMemberSubmitSeamUnavailable: "BROADCAST_ONE_MEMBER_SUBMIT_SEAM_UNAVAILABLE",
} as const;

type ServiceStopReason =
  (typeof WORKFLOW_SERVICE_STOP_REASONS)[keyof typeof WORKFLOW_SERVICE_STOP_REASONS];

type PreDispatchUnavailableReason = (typeof WORKFLOW_PRE_DISPATCH_UNAVAILABLE_REASONS)[number];

type AxisName = keyof typeof SEND_ELIGIBILITY_NON_PASS_REASONS;

/** `firstNonPass` writes `<axis>:<that axis's reason>` — the pairing is part of the code. */
type AxisStopReason = {
  [A in AxisName]: `${A}:${(typeof SEND_ELIGIBILITY_NON_PASS_REASONS)[A][number]}`;
}[AxisName];

export type WorkflowRunReasonCode =
  | `routine_authority_${RoutineAuthorityFailure}`
  | PreDispatchUnavailableReason
  | ServiceStopReason
  | `BUSINESS_HOURS_${BusinessHoursUnavailableReason}`
  | AxisStopReason;

/**
 * The same union as a value, for the copy pinboard to compare against. A function, not a
 * module-level array: assembling it reads four other modules, and nothing needs it at import
 * time — building it eagerly would make importing the ledger depend on all four being loaded.
 */
export function workflowRunReasonCodes(): readonly WorkflowRunReasonCode[] {
  const axisCodes = (Object.keys(SEND_ELIGIBILITY_NON_PASS_REASONS) as AxisName[]).flatMap(
    (axisName) =>
      SEND_ELIGIBILITY_NON_PASS_REASONS[axisName].map((reason) => `${axisName}:${reason}`),
  );
  return [
    ...ROUTINE_AUTHORITY_FAILURES.map((failure) => `routine_authority_${failure}`),
    ...WORKFLOW_PRE_DISPATCH_UNAVAILABLE_REASONS,
    ...Object.values(WORKFLOW_SERVICE_STOP_REASONS),
    ...BUSINESS_HOURS_UNAVAILABLE_REASONS.map((reason) => `BUSINESS_HOURS_${reason}`),
    ...axisCodes,
  ] as WorkflowRunReasonCode[];
}
