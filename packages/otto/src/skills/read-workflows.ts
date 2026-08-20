/**
 * readWorkflows — $0 C7 Workflow definition/revision read parity (B0-40/48/49, C7).
 *
 * Reads only through the injected authenticated workflow port. It never accepts tenant identity,
 * imports the database, or receives Routine activation/run/dispatch authority.
 *
 * C7 —— 同 `draft-workflows.ts`:能读到 run 与 journey 的状态,不等于这个产品今天跑得起一次
 * run。那句实话拼在描述末尾,措辞与另一条技能共用一份(`_availability.ts`)。
 */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";
import { ROUTINE_EXECUTION_AVAILABILITY } from "./_availability.js";

export const workflowResourceIdSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);

const workflowDefinitionId = workflowResourceIdSchema.describe(
  "Exact Workflow definition id returned by listWorkflowDefinitions. Never guess an id.",
);
const routineId = workflowResourceIdSchema.describe(
  "Exact Routine id returned by listRoutines. Never guess an id.",
);
const businessHoursPolicyId = workflowResourceIdSchema.describe(
  "Exact business-hours policy id returned by listBusinessHoursPolicies. Never guess an id.",
);
const cursor = workflowResourceIdSchema.describe("Exact nextCursor returned by the preceding page.");
const limit = z.number().int().min(1).max(200).optional();

const routineStatus = z.enum(["draft", "active", "paused", "revoked", "expired"]);
const runStatus = z.enum([
  "queued",
  "running",
  "waiting",
  "completed",
  "blocked",
  "cancelled",
  "failed",
]);
const journeyStatus = z.enum([
  "active",
  "waiting",
  "paused",
  "completed",
  "exited",
  "blocked",
  "failed",
]);
const policyStatus = z.enum(["draft", "published", "archived"]);
type RoutineStatus = z.infer<typeof routineStatus>;
type RunStatus = z.infer<typeof runStatus>;
type JourneyStatus = z.infer<typeof journeyStatus>;
type PolicyStatus = z.infer<typeof policyStatus>;

const allStatuses = z.union([routineStatus, runStatus, journeyStatus, policyStatus]);
const operationFields = {
  listWorkflowDefinitions: ["limit"],
  getWorkflowDefinition: ["workflowDefinitionId"],
  listWorkflowRevisions: ["workflowDefinitionId", "limit"],
  listRoutines: ["workflowDefinitionId", "status", "cursor", "limit"],
  getRoutine: ["routineId"],
  listRoutineRuns: ["routineId", "workflowDefinitionId", "status", "cursor", "limit"],
  getContactJourneyStates: ["routineId", "workflowDefinitionId", "status", "cursor", "limit"],
  listBusinessHoursPolicies: ["status", "cursor", "limit"],
  getBusinessHoursPolicy: ["businessHoursPolicyId"],
} as const;

export const readWorkflowsParams = z.object({
  operation: z.enum(Object.keys(operationFields) as [keyof typeof operationFields, ...(keyof typeof operationFields)[]]),
  workflowDefinitionId: workflowDefinitionId.optional(),
  routineId: routineId.optional(),
  businessHoursPolicyId: businessHoursPolicyId.optional(),
  status: allStatuses.optional(),
  cursor: cursor.optional(),
  limit,
}).strict().superRefine((value, context) => {
  const allowed = new Set<string>(operationFields[value.operation]);
  for (const field of [
    "workflowDefinitionId",
    "routineId",
    "businessHoursPolicyId",
    "status",
    "cursor",
    "limit",
  ] as const) {
    if (value[field] !== undefined && !allowed.has(field)) {
      context.addIssue({ code: "custom", path: [field], message: `${field} is not valid for ${value.operation}.` });
    }
  }
  if (
    (value.operation === "getWorkflowDefinition" || value.operation === "listWorkflowRevisions") &&
    value.workflowDefinitionId === undefined
  ) context.addIssue({ code: "custom", path: ["workflowDefinitionId"], message: "workflowDefinitionId is required." });
  if (value.operation === "getRoutine" && value.routineId === undefined) {
    context.addIssue({ code: "custom", path: ["routineId"], message: "routineId is required." });
  }
  if (value.operation === "getBusinessHoursPolicy" && value.businessHoursPolicyId === undefined) {
    context.addIssue({ code: "custom", path: ["businessHoursPolicyId"], message: "businessHoursPolicyId is required." });
  }
  if (
    (value.operation === "listRoutineRuns" || value.operation === "getContactJourneyStates") &&
    ((value.routineId === undefined) === (value.workflowDefinitionId === undefined))
  ) context.addIssue({ code: "custom", message: "Choose exactly one of routineId or workflowDefinitionId." });
  if (value.operation === "listRoutines" && value.status !== undefined && !routineStatus.safeParse(value.status).success) {
    context.addIssue({ code: "custom", path: ["status"], message: "Invalid Routine status." });
  }
  if (value.operation === "listRoutineRuns" && value.status !== undefined && !runStatus.safeParse(value.status).success) {
    context.addIssue({ code: "custom", path: ["status"], message: "Invalid Routine run status." });
  }
  if (value.operation === "getContactJourneyStates" && value.status !== undefined && !journeyStatus.safeParse(value.status).success) {
    context.addIssue({ code: "custom", path: ["status"], message: "Invalid journey status." });
  }
  if (value.operation === "listBusinessHoursPolicies" && value.status !== undefined && !policyStatus.safeParse(value.status).success) {
    context.addIssue({ code: "custom", path: ["status"], message: "Invalid policy status." });
  }
});

type ReadWorkflowsInput = z.infer<typeof readWorkflowsParams>;

export async function executeReadWorkflows(
  input: ReadWorkflowsInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  const workflows = runContext?.context?.workflows;
  if (!workflows) return { ok: false, error: "Workflows aren't available right now." };

  const parsed = readWorkflowsParams.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Use only the exact parameters documented for this Workflow read." };
  }

  switch (parsed.data.operation) {
    case "listWorkflowDefinitions":
      return workflows.listWorkflowDefinitions({ limit: parsed.data.limit });
    case "getWorkflowDefinition":
      return workflows.getWorkflowDefinition({
        workflowDefinitionId: parsed.data.workflowDefinitionId!,
      });
    case "listWorkflowRevisions":
      return workflows.listWorkflowRevisions({
        workflowDefinitionId: parsed.data.workflowDefinitionId!,
        limit: parsed.data.limit,
      });
    case "listRoutines":
      return workflows.listRoutines({
        workflowDefinitionId: parsed.data.workflowDefinitionId,
        status: parsed.data.status as RoutineStatus | undefined,
        cursor: parsed.data.cursor,
        limit: parsed.data.limit,
      });
    case "getRoutine":
      return workflows.getRoutine({ routineId: parsed.data.routineId! });
    case "listRoutineRuns":
      return workflows.listRoutineRuns({
        ...(parsed.data.routineId
          ? { routineId: parsed.data.routineId }
          : { workflowDefinitionId: parsed.data.workflowDefinitionId! }),
        status: parsed.data.status as RunStatus | undefined,
        cursor: parsed.data.cursor,
        limit: parsed.data.limit,
      });
    case "getContactJourneyStates":
      return workflows.getContactJourneyStates({
        ...(parsed.data.routineId
          ? { routineId: parsed.data.routineId }
          : { workflowDefinitionId: parsed.data.workflowDefinitionId! }),
        status: parsed.data.status as JourneyStatus | undefined,
        cursor: parsed.data.cursor,
        limit: parsed.data.limit,
      });
    case "listBusinessHoursPolicies":
      return workflows.listBusinessHoursPolicies({
        status: parsed.data.status as PolicyStatus | undefined,
        cursor: parsed.data.cursor,
        limit: parsed.data.limit,
      });
    case "getBusinessHoursPolicy":
      return workflows.getBusinessHoursPolicy({
        businessHoursPolicyId: parsed.data.businessHoursPolicyId!,
      });
  }
}

export const readWorkflowsSkill = defineOttoSkill({
  name: "readWorkflows",
  cost: "free",
  effect: "read",
  reach: "internal",
  description:
    "Read the user's Workflow definitions, immutable revisions, Routine authorization envelopes, run and journey " +
    "status, and business-hours policies through the one authenticated, owner-scoped service, not a second " +
    "implementation of its own. $0 read-only. Start with a list operation and never guess ids or cursors. This skill cannot " +
    "activate, reauthorize, or kill a Routine; create or advance a run or journey; dispatch a step; send; call a " +
    "provider; or spend credits. " +
    ROUTINE_EXECUTION_AVAILABILITY,
  parameters: readWorkflowsParams,
  execute: executeReadWorkflows,
});
