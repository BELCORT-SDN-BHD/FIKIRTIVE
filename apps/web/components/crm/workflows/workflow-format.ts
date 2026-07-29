export type WorkflowBadgeVariant =
  | "brand"
  | "outline"
  | "success"
  | "warning"
  | "info"
  | "destructive";

export type WorkflowPresentation = {
  label: string;
  variant: WorkflowBadgeVariant;
};

const DATE_TIME = new Intl.DateTimeFormat("en-MY", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kuala_Lumpur",
});

export function dateTimeLabel(value: Date | string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? DATE_TIME.format(date) : "Not recorded";
}

export function shortWorkflowId(id: string): string {
  return id.length > 18 ? `${id.slice(0, 9)}…${id.slice(-5)}` : id;
}

const TRIGGER_LABELS: Record<string, string> = {
  manual: "Run manually",
  schedule: "On a schedule",
  customer_message: "When a customer messages",
  journey_due: "When a contact reaches this step",
};

const ACTION_LABELS: Record<string, string> = {
  conversation_reply: "reply in the conversation",
  broadcast_run: "send a broadcast",
  wait: "wait",
  complete: "mark the journey complete",
};

export type RuleSummary = {
  trigger: string;
  actions: string;
  condition: string | null;
};

/** A best-effort, display-only summary of the plain-text rule file. This never validates the
 *  rule — validateWorkflowRules is the source of truth — it only extracts a human-readable
 *  headline so the default view is three lines, not raw YAML. An unrecognized shape falls back
 *  to a generic label rather than guessing. */
export function summarizeRuleSource(rulesSource: string): RuleSummary {
  const triggerMatch = /trigger:\s*\n\s*type:\s*(\S+)/.exec(rulesSource);
  const triggerType = triggerMatch?.[1];
  const trigger = (triggerType && TRIGGER_LABELS[triggerType]) || "Custom trigger";

  // Each step's fields (and each action's fields within it) may appear in any order — the
  // workflow grammar does not fix key order within a mapping. Scope the search to each step's
  // own slice of the source (bounded by the next "- key:" step marker) so a rule that writes
  // templateVersionRef before type still surfaces its action, instead of silently dropping it.
  const stepBlocks = rulesSource.split(/\n(?=[ \t]*-[ \t]+key:\s)/);
  const actionTypes = stepBlocks.flatMap((block) => {
    const actionSection = /action:\s*\n([\s\S]*)/.exec(block)?.[1];
    if (!actionSection) return [];
    const typeMatch = /(?:^|\n)[ \t]*type:\s*(\S+)/.exec(actionSection);
    return typeMatch ? [typeMatch[1]] : [];
  });
  const actionPhrases = actionTypes.map((type) => ACTION_LABELS[type] ?? humanizeCode(type));
  const actions = actionPhrases.length > 0
    ? actionPhrases[0].charAt(0).toUpperCase() + actionPhrases[0].slice(1) + actionPhrases.slice(1).map((phrase) => `, then ${phrase}`).join("")
    : "No steps defined yet";

  const condition = /type:\s*outside_business_hours/.test(rulesSource)
    ? "Only outside business hours"
    : null;

  return { trigger, actions, condition };
}

export function definitionStatusPresentation(status: string): WorkflowPresentation {
  switch (status) {
    case "draft":
      return { label: "Draft", variant: "outline" };
    case "published":
      return { label: "Published", variant: "brand" };
    case "archived":
      return { label: "Archived", variant: "outline" };
    default:
      return { label: humanizeCode(status), variant: "outline" };
  }
}

export function validationStatusPresentation(status: string): WorkflowPresentation {
  switch (status) {
    case "valid":
      return { label: "Valid", variant: "success" };
    case "invalid":
      return { label: "Invalid", variant: "destructive" };
    case "unavailable":
      return { label: "Unavailable", variant: "outline" };
    default:
      return { label: "Not validated", variant: "outline" };
  }
}

export function routineStatusPresentation(status: string): WorkflowPresentation {
  switch (status) {
    case "active":
      return { label: "Active", variant: "success" };
    case "draft":
      return { label: "Awaiting authorization", variant: "outline" };
    case "paused":
      return { label: "Paused", variant: "warning" };
    case "revoked":
      return { label: "Superseded", variant: "outline" };
    case "expired":
      return { label: "Expired", variant: "warning" };
    default:
      return { label: "Unknown", variant: "outline" };
  }
}

export function runStatusPresentation(status: string): WorkflowPresentation {
  switch (status) {
    case "queued":
      return { label: "Queued", variant: "outline" };
    case "running":
      return { label: "Running", variant: "info" };
    case "waiting":
      return { label: "Waiting", variant: "warning" };
    case "completed":
      return { label: "Completed (simulated)", variant: "brand" };
    case "blocked":
      return { label: "Blocked", variant: "warning" };
    case "cancelled":
      return { label: "Cancelled", variant: "outline" };
    case "failed":
      return { label: "Failed", variant: "destructive" };
    default:
      return { label: "Unknown", variant: "outline" };
  }
}

export function stepStatusPresentation(status: string): WorkflowPresentation {
  switch (status) {
    case "reserved":
      return { label: "Reserved", variant: "outline" };
    case "blocked":
      return { label: "Blocked", variant: "warning" };
    case "simulated":
      return { label: "Simulated", variant: "brand" };
    case "delegated":
      return { label: "Delegated", variant: "info" };
    case "unavailable":
      return { label: "Unavailable", variant: "outline" };
    case "failed":
      return { label: "Failed", variant: "destructive" };
    default:
      return { label: "Unknown", variant: "outline" };
  }
}

export function journeyStatusPresentation(status: string): WorkflowPresentation {
  switch (status) {
    case "active":
      return { label: "Active", variant: "info" };
    case "waiting":
      return { label: "Waiting", variant: "warning" };
    case "paused":
      return { label: "Paused", variant: "warning" };
    case "completed":
      return { label: "Completed", variant: "success" };
    case "exited":
      return { label: "Exited", variant: "outline" };
    case "blocked":
      return { label: "Blocked", variant: "warning" };
    case "failed":
      return { label: "Failed", variant: "destructive" };
    default:
      return { label: "Unknown", variant: "outline" };
  }
}

const VALIDATION_ERROR_COPY: Record<string, string> = {
  SOURCE_TOO_LARGE: "This rule file is too large. Shorten it before saving.",
  UNSUPPORTED_YAML_FEATURE:
    "This rule uses a YAML feature that workflows do not allow. Use plain keys, values, and lists only.",
  MULTI_DOCUMENT: "Keep this as one rule document. Multiple YAML documents are not supported.",
  DUPLICATE_KEY: "This field appears more than once. Keep one value for it.",
  INVALID_YAML: "The rule file cannot be read. Check its spacing and punctuation.",
  UNKNOWN_KEY: "This field is not part of the supported workflow format.",
  MISSING_KEY: "A required field is missing.",
  INVALID_VALUE: "This value is not valid for this field.",
  UNKNOWN_TYPE: "This trigger, condition, or action type is not supported.",
  LIMIT_EXCEEDED: "This rule has more conditions or steps than the workflow limit allows.",
  DUPLICATE_STEP_KEY: "Each step needs a different key.",
  DEPENDENCY_UNAVAILABLE:
    "A referenced business-hours policy or message template is unavailable. The rule cannot be published until that exact reference is available.",
};

export type ValidationIssue = {
  code: string;
  path: string;
  line?: number;
  column?: number;
};

export function validationIssues(value: unknown): ValidationIssue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.code !== "string" || typeof record.path !== "string") return [];
    return [{
      code: record.code,
      path: record.path,
      ...(typeof record.line === "number" ? { line: record.line } : {}),
      ...(typeof record.column === "number" ? { column: record.column } : {}),
    }];
  });
}

export function validationIssueCopy(issue: ValidationIssue): string {
  return VALIDATION_ERROR_COPY[issue.code] ?? "This part of the rule is not valid.";
}

const REASON_COPY: Record<string, string> = {
  routine_authority_kill: "The Routine kill switch stopped this action.",
  routine_authority_status: "The Routine is not active, so this action was stopped.",
  routine_authority_expired: "The Routine authorization expired before this action could start.",
  routine_authority_hash_drift:
    "The rule, dependencies, scope, or authorization no longer match what was approved.",
  routine_authority_budget_unavailable:
    "The approved budget could not be verified, so this action was stopped.",
  workflow_dependency_unavailable:
    "A pinned rule dependency could not be verified. Nothing was sent.",
  workflow_target_unavailable:
    "The exact customer or channel identity could not be verified. Nothing was sent.",
  HUMAN_TAKEOVER_AUTOMATION_PAUSED:
    "A person took over this conversation, so related automation remains paused.",
  BUSINESS_HOURS_INSIDE:
    "The message arrived during business hours, so the outside-hours reply did not run.",
  BUSINESS_HOURS_TIME_ZONE_UNAVAILABLE:
    "The business-hours time zone could not be verified. No automatic reply was attempted.",
  BUSINESS_HOURS_SCHEDULE_UNAVAILABLE:
    "The business-hours schedule could not be interpreted. No automatic reply was attempted.",
  CONVERSATION_STRICT_CLASSIFICATION_UNAVAILABLE:
    "The strict workflow messaging classification is not connected yet. No reply was sent.",
  BROADCAST_ONE_MEMBER_SUBMIT_SEAM_UNAVAILABLE:
    "The single-contact broadcast handoff is not connected yet. No message was sent.",
  "consentStop:unknown": "Verified permission is missing, so this action was blocked.",
  "consentStop:effective_revoke": "The customer has opted out, so this action was blocked.",
  "doNotDisturb:block": "Do not disturb is on for this customer, so this action was blocked.",
  "providerRefusal:block": "The messaging provider has refused this destination.",
  "frequency:block": "The contact frequency limit blocked this action.",
  "eligibility:unknown": "Customer messaging eligibility could not be verified.",
};

export function reasonCodeCopy(code: string | null | undefined): string {
  if (!code) return "No reason was recorded.";
  if (REASON_COPY[code]) return REASON_COPY[code];
  if (code.startsWith("delegated_then_routine_authority_")) {
    return "The action had already been handed off when Routine authority changed. Delivery remains unknown until receipt reconciliation is available.";
  }
  return `This workflow stopped with reason ${humanizeCode(code)}.`;
}

const ERROR_COPY: Record<string, string> = {
  NOT_AUTHORIZED: "You need to sign in again to use workflows.",
  ACTION_DENIED: "Only the workspace owner can use this workflow action.",
  RESOURCE_NOT_FOUND: "This workflow is not available. It may not exist, or you may not have access.",
  INVALID_ARGUMENT: "Some workflow details are not valid. Review the highlighted fields and try again.",
  CAS_CONFLICT: "This workflow changed in another session. Refresh before trying again.",
  IDEMPOTENCY_CONFLICT:
    "This operation conflicts with an earlier workflow action. Nothing was repeated.",
  AUTHORITY_UNAVAILABLE:
    "The exact rule, dependencies, scope, budget, or authorization could not be verified. Nothing was activated.",
  ACTIVE_ROUTINE_ACKNOWLEDGEMENT_REQUIRED:
    "Active Routines still reference this workflow. Review every Routine before archiving.",
  SEND_PATH_UNAVAILABLE:
    "Real customer delivery is not connected in this simulated workspace. Nothing was sent.",
};

export function workflowErrorMessage(code: string): string {
  return ERROR_COPY[code] ?? `The workflow request failed (${code}). Please retry.`;
}

export function isDenialErrorCode(code: string): boolean {
  return ["NOT_AUTHORIZED", "ACTION_DENIED", "RESOURCE_NOT_FOUND"].includes(code);
}

export function humanizeCode(code: string): string {
  return code.replaceAll("_", " ").toLowerCase();
}
