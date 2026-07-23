import "server-only";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "./auth-guard";
import { isImpersonating } from "./better-auth/compat";
import {
  CustomerWorkflowError,
  workflowLifecycleService,
  type ActivateRoutineInput,
  type ArchiveWorkflowDefinitionInput,
  type CreateRoutineDraftInput,
  type CreateWorkflowDefinitionInput,
  type CustomerWorkflowErrorCode,
  type CustomerWorkflowPrincipal,
  type GetBusinessHoursPolicyInput,
  type GetContactJourneyStatesInput,
  type GetRoutineInput,
  type KillRoutineInput,
  type ListBusinessHoursPoliciesInput,
  type ListRoutineRunsInput,
  type ListRoutinesInput,
  type ListWorkflowDefinitionsInput,
  type ListWorkflowRevisionsInput,
  type PublishWorkflowRevisionInput,
  type ReauthorizeRoutineInput,
  type SaveWorkflowRevisionInput,
  type UpdateWorkflowDefinitionInput,
  type ValidateWorkflowRulesInput,
  type WorkflowDefinitionIdInput,
} from "./customer-workflow-service";

type GatewayFailure = { ok: false; error: CustomerWorkflowErrorCode };

async function resolvePrincipal(): Promise<CustomerWorkflowPrincipal> {
  const gate = await requireOwner();
  if ("error" in gate) throw new CustomerWorkflowError("NOT_AUTHORIZED");

  const membership = await prisma.membership.findFirst({
    where: {
      orgId: gate.ownerId,
      role: "owner",
      status: "active",
      deletedAt: null,
      user: { email: gate.email },
    },
    select: { id: true },
  });
  if (!membership) throw new CustomerWorkflowError("ACTION_DENIED");

  return {
    ownerId: gate.ownerId,
    membershipId: membership.id,
    impersonating: await isImpersonating(),
  };
}

async function runRead<T>(
  operation: (principal: CustomerWorkflowPrincipal) => Promise<T>,
): Promise<{ ok: true; resource: T } | GatewayFailure> {
  try {
    return { ok: true, resource: await operation(await resolvePrincipal()) };
  } catch (error) {
    if (error instanceof CustomerWorkflowError) return { ok: false, error: error.code };
    throw error;
  }
}

async function runMutation<T>(
  operation: (principal: CustomerWorkflowPrincipal) => Promise<T>,
): Promise<T | GatewayFailure> {
  try {
    return await operation(await resolvePrincipal());
  } catch (error) {
    if (error instanceof CustomerWorkflowError) return { ok: false, error: error.code };
    throw error;
  }
}

export async function createWorkflowDefinition(input: CreateWorkflowDefinitionInput) {
  return runMutation((principal) =>
    workflowLifecycleService(prisma).createWorkflowDefinition(principal, input),
  );
}

export async function getWorkflowDefinition(input: WorkflowDefinitionIdInput) {
  return runRead((principal) =>
    workflowLifecycleService(prisma).getWorkflowDefinition(principal, input),
  );
}

export async function listWorkflowDefinitions(input: ListWorkflowDefinitionsInput = {}) {
  return runRead((principal) =>
    workflowLifecycleService(prisma).listWorkflowDefinitions(principal, input),
  );
}

export async function listRoutines(input: ListRoutinesInput = {}) {
  return runRead((principal) =>
    workflowLifecycleService(prisma).listRoutines(principal, input),
  );
}

export async function getRoutine(input: GetRoutineInput) {
  return runRead((principal) =>
    workflowLifecycleService(prisma).getRoutine(principal, input),
  );
}

export async function listRoutineRuns(input: ListRoutineRunsInput) {
  return runRead((principal) =>
    workflowLifecycleService(prisma).listRoutineRuns(principal, input),
  );
}

export async function getContactJourneyStates(input: GetContactJourneyStatesInput) {
  return runRead((principal) =>
    workflowLifecycleService(prisma).getContactJourneyStates(principal, input),
  );
}

export async function listBusinessHoursPolicies(
  input: ListBusinessHoursPoliciesInput = {},
) {
  return runRead((principal) =>
    workflowLifecycleService(prisma).listBusinessHoursPolicies(principal, input),
  );
}

export async function getBusinessHoursPolicy(input: GetBusinessHoursPolicyInput) {
  return runRead((principal) =>
    workflowLifecycleService(prisma).getBusinessHoursPolicy(principal, input),
  );
}

export async function updateWorkflowDefinition(input: UpdateWorkflowDefinitionInput) {
  return runMutation((principal) =>
    workflowLifecycleService(prisma).updateWorkflowDefinition(principal, input),
  );
}

export async function archiveWorkflowDefinition(input: ArchiveWorkflowDefinitionInput) {
  return runMutation((principal) =>
    workflowLifecycleService(prisma).archiveWorkflowDefinition(principal, input),
  );
}

export async function validateWorkflowRules(input: ValidateWorkflowRulesInput) {
  return runRead((principal) =>
    workflowLifecycleService(prisma).validateWorkflowRules(principal, input),
  );
}

export async function saveWorkflowRevision(input: SaveWorkflowRevisionInput) {
  return runMutation((principal) =>
    workflowLifecycleService(prisma).saveWorkflowRevision(principal, input),
  );
}

export async function listWorkflowRevisions(input: ListWorkflowRevisionsInput) {
  return runRead((principal) =>
    workflowLifecycleService(prisma).listWorkflowRevisions(principal, input),
  );
}

export async function publishWorkflowRevision(input: PublishWorkflowRevisionInput) {
  return runMutation((principal) =>
    workflowLifecycleService(prisma).publishWorkflowRevision(principal, input),
  );
}

export async function createRoutineDraft(input: CreateRoutineDraftInput) {
  return runMutation((principal) =>
    workflowLifecycleService(prisma).createRoutineDraft(principal, input),
  );
}

export async function activateRoutine(input: ActivateRoutineInput) {
  return runMutation((principal) =>
    workflowLifecycleService(prisma).activateRoutine(principal, input),
  );
}

export async function killRoutine(input: KillRoutineInput) {
  return runMutation((principal) =>
    workflowLifecycleService(prisma).killRoutine(principal, input),
  );
}

export async function reauthorizeRoutine(input: ReauthorizeRoutineInput) {
  return runMutation((principal) =>
    workflowLifecycleService(prisma).reauthorizeRoutine(principal, input),
  );
}
