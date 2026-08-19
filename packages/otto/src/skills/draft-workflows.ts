/**
 * draftWorkflows — $0 C7 Workflow definition/revision and Routine-draft parity.
 *
 * These are internal draft mutations only. Workflow revision publish moves the definition pointer;
 * it never activates or authorizes a Routine. The injected web port fixes Routine budgets to zero and
 * supplies the summary policy, so neither model arguments nor this skill can manufacture authority.
 *
 * C7 —— 描述原来只说「**本技能**不会激活/派发」,那是一句关于技能的话,不是关于产品的话:
 * 商家听完会以为「换个地方点一下就跑起来了」。真相是整个产品今天都启动不了一次 run
 * (证据逐条列在 `_availability.ts` 的 `ROUTINE_EXECUTION_AVAILABILITY`),所以那一句拼在描述
 * 末尾。同一次顺手删掉「as the Workflow UI」—— 那扇界面今天是 `redirect("/")`。
 */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";
import { workflowResourceIdSchema } from "./read-workflows.js";
import { ROUTINE_EXECUTION_AVAILABILITY } from "./_availability.js";

const workflowSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,127}$/);
const routineKeySchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,127}$/);
const scopeTokenSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,127}$/);

const uniqueArray = <T extends z.ZodTypeAny>(schema: T, maximum: number) =>
  z.array(schema).max(maximum).refine(
    (values) => new Set(values.map((value) => JSON.stringify(value))).size === values.length,
    "Values must be unique.",
  );

export const workflowRoutineScopeSchema = z.object({
  actionKinds: uniqueArray(
    z.enum(["conversation_reply", "broadcast_run", "wait", "complete"]),
    4,
  ),
  channelScopes: uniqueArray(z.object({
    channel: scopeTokenSchema,
    providerConnectionId: workflowResourceIdSchema.nullable(),
  }).strict(), 32),
  contactIds: uniqueArray(workflowResourceIdSchema, 200),
  segmentIds: uniqueArray(workflowResourceIdSchema, 200),
  maxActions: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  maxRecipients: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict();

export const draftWorkflowsParams = z.object({
  operation: z.enum([
    "createWorkflowDefinition",
    "validateWorkflowRules",
    "saveWorkflowRevision",
    "publishWorkflowRevision",
    "createRoutineDraft",
  ]),
  workflowDefinitionId: workflowResourceIdSchema.optional(),
  workflowRevisionId: workflowResourceIdSchema.optional(),
  expectedRowRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  slug: workflowSlugSchema.optional(),
  name: z.string().trim().min(1).max(256).optional(),
  definitionKind: z.enum(["rule", "journey"]).optional(),
  rulesSource: z.string().min(1).max(32 * 1024).optional(),
  routineKey: routineKeySchema.optional(),
  scopeJson: workflowRoutineScopeSchema.optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
}).strict();

type DraftWorkflowsInput = z.infer<typeof draftWorkflowsParams>;

function exactId(value: string | undefined): value is string {
  return workflowResourceIdSchema.safeParse(value).success;
}

function hasOnly(
  input: DraftWorkflowsInput,
  allowed: ReadonlySet<keyof DraftWorkflowsInput>,
): boolean {
  return Object.entries(input).every(
    ([key, value]) => value === undefined || allowed.has(key as keyof DraftWorkflowsInput),
  );
}

export async function executeDraftWorkflows(
  input: DraftWorkflowsInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  const workflows = runContext?.context?.workflows;
  if (!workflows) return { ok: false, error: "Workflow drafting isn't available right now." };

  switch (input.operation) {
    case "createWorkflowDefinition":
      if (
        !input.slug ||
        !input.name ||
        !input.definitionKind ||
        !hasOnly(input, new Set(["operation", "slug", "name", "definitionKind"]))
      ) {
        return {
          ok: false,
          error: "createWorkflowDefinition needs only `slug`, `name`, and `definitionKind`.",
        };
      }
      return workflows.createWorkflowDefinition({
        slug: input.slug,
        name: input.name,
        definitionKind: input.definitionKind,
        originKind: "custom",
      });
    case "validateWorkflowRules":
      if (
        !exactId(input.workflowDefinitionId) ||
        !input.rulesSource ||
        !hasOnly(input, new Set(["operation", "workflowDefinitionId", "rulesSource"]))
      ) {
        return {
          ok: false,
          error: "validateWorkflowRules needs only exact `workflowDefinitionId` and bounded `rulesSource`.",
        };
      }
      return workflows.validateWorkflowRules({
        workflowDefinitionId: input.workflowDefinitionId,
        rulesSource: input.rulesSource,
      });
    case "saveWorkflowRevision":
      if (
        !exactId(input.workflowDefinitionId) ||
        !input.rulesSource ||
        !hasOnly(input, new Set(["operation", "workflowDefinitionId", "rulesSource"]))
      ) {
        return {
          ok: false,
          error: "saveWorkflowRevision needs only exact `workflowDefinitionId` and bounded `rulesSource`.",
        };
      }
      return workflows.saveWorkflowRevision({
        workflowDefinitionId: input.workflowDefinitionId,
        rulesSource: input.rulesSource,
      });
    case "publishWorkflowRevision":
      if (
        !exactId(input.workflowDefinitionId) ||
        !exactId(input.workflowRevisionId) ||
        input.expectedRowRevision === undefined ||
        !hasOnly(input, new Set([
          "operation",
          "workflowDefinitionId",
          "workflowRevisionId",
          "expectedRowRevision",
        ]))
      ) {
        return {
          ok: false,
          error: "publishWorkflowRevision needs exact definition/revision ids and `expectedRowRevision` only.",
        };
      }
      return workflows.publishWorkflowRevision({
        workflowDefinitionId: input.workflowDefinitionId,
        workflowRevisionId: input.workflowRevisionId,
        expectedRowRevision: input.expectedRowRevision,
      });
    case "createRoutineDraft":
      if (
        !exactId(input.workflowDefinitionId) ||
        !exactId(input.workflowRevisionId) ||
        !input.routineKey ||
        !input.scopeJson ||
        !hasOnly(input, new Set([
          "operation",
          "workflowDefinitionId",
          "workflowRevisionId",
          "routineKey",
          "scopeJson",
          "expiresAt",
        ]))
      ) {
        return {
          ok: false,
          error: "createRoutineDraft needs exact definition/revision ids, `routineKey`, closed `scopeJson`, and optional ISO expiry only.",
        };
      }
      return workflows.createRoutineDraft({
        workflowDefinitionId: input.workflowDefinitionId,
        workflowRevisionId: input.workflowRevisionId,
        routineKey: input.routineKey,
        scopeJson: input.scopeJson,
        expiresAt: input.expiresAt,
      });
  }
}

export const draftWorkflowsSkill = defineOttoSkill({
  name: "draftWorkflows",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Create a custom Workflow definition, validate or save its readable rule source, publish one immutable revision " +
    "as the definition pointer, or create a Routine DRAFT through the one authenticated, owner-scoped service, not a " +
    "second implementation of its own. $0 internal drafting only. Publishing a revision NEVER activates or authorizes a " +
    "Routine. Routine budgets are fixed to zero server-side; this skill cannot authorize, kill, run, dispatch, send, " +
    "call a provider, or spend credits. Use exact ids returned by readWorkflows and never guess them. " +
    ROUTINE_EXECUTION_AVAILABILITY,
  parameters: draftWorkflowsParams,
  execute: executeDraftWorkflows,
});

export const draftWorkflows = draftWorkflowsSkill.tool;
