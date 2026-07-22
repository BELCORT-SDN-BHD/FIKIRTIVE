/**
 * readWorkflows — $0 C7 Workflow definition/revision read parity (B0-40/48/49, C7).
 *
 * Reads only through the injected authenticated workflow port. It never accepts tenant identity,
 * imports the database, or receives Routine activation/run/dispatch authority.
 */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";

export const workflowResourceIdSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);

export const readWorkflowsParams = z.object({
  operation: z.enum([
    "listWorkflowDefinitions",
    "getWorkflowDefinition",
    "listWorkflowRevisions",
  ]),
  workflowDefinitionId: workflowResourceIdSchema.optional().describe(
    "Exact Workflow definition id returned by listWorkflowDefinitions. Never guess an id.",
  ),
  limit: z.number().int().min(1).max(200).optional(),
}).strict();

type ReadWorkflowsInput = z.infer<typeof readWorkflowsParams>;

function exactId(value: string | undefined): value is string {
  return workflowResourceIdSchema.safeParse(value).success;
}

export async function executeReadWorkflows(
  input: ReadWorkflowsInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  const workflows = runContext?.context?.workflows;
  if (!workflows) return { ok: false, error: "Workflows aren't available right now." };

  switch (input.operation) {
    case "listWorkflowDefinitions":
      if (input.workflowDefinitionId !== undefined) {
        return { ok: false, error: "listWorkflowDefinitions does not accept a Workflow id." };
      }
      return workflows.listWorkflowDefinitions({ limit: input.limit });
    case "getWorkflowDefinition":
      if (!exactId(input.workflowDefinitionId) || input.limit !== undefined) {
        return {
          ok: false,
          error: "getWorkflowDefinition needs only the exact `workflowDefinitionId` from listWorkflowDefinitions.",
        };
      }
      return workflows.getWorkflowDefinition({ workflowDefinitionId: input.workflowDefinitionId });
    case "listWorkflowRevisions":
      if (!exactId(input.workflowDefinitionId)) {
        return {
          ok: false,
          error: "listWorkflowRevisions needs the exact `workflowDefinitionId` from listWorkflowDefinitions.",
        };
      }
      return workflows.listWorkflowRevisions({
        workflowDefinitionId: input.workflowDefinitionId,
        limit: input.limit,
      });
  }
}

export const readWorkflowsSkill = defineOttoSkill({
  name: "readWorkflows",
  cost: "free",
  effect: "read",
  reach: "internal",
  description:
    "Read the user's Workflow definitions, one exact definition, or its immutable revision history through the " +
    "same authenticated, owner-scoped service as the Workflow UI. $0 read-only. Start with " +
    "listWorkflowDefinitions and never guess ids. This skill cannot activate a Routine, create a run, dispatch a " +
    "step, send a message, call a provider, or spend credits.",
  parameters: readWorkflowsParams,
  execute: executeReadWorkflows,
});

export const readWorkflows = readWorkflowsSkill.tool;
