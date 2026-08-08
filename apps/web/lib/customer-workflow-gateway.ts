import "server-only";

import { prisma } from "@fikirtive/db";
import { runAsUser, type UserPrincipal } from "@fikirtive/db/principal";
import {
  effectiveOrgRoles,
  orgRolesAllow,
  primaryOrgRole,
} from "@fikirtive/core";
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

/**
 * #463 — this gateway is one of the four request-level principal SEAMS (design contract §2-v2).
 *
 * `service` is byte-for-byte the object the service layer has always received; `ambient` is the
 * full identity pushed into the AsyncLocalStorage store by runRead/runMutation and handed to
 * NOBODY. Both come out of the one membership query that was already here — widened by three
 * selected columns, with no extra round trip.
 */
type ResolvedPrincipal = { service: CustomerWorkflowPrincipal; ambient: UserPrincipal };

async function resolvePrincipal(): Promise<ResolvedPrincipal> {
  const gate = await requireOwner();
  if ("error" in gate) throw new CustomerWorkflowError("NOT_AUTHORIZED");

  const membership = await prisma.membership.findFirst({
    where: {
      orgId: gate.ownerId,
      status: "active",
      deletedAt: null,
      user: { email: gate.email },
    },
    select: { id: true, userId: true, roles: { select: { role: true } } },
  });
  if (!membership) throw new CustomerWorkflowError("ACTION_DENIED");
  const orgRoles = effectiveOrgRoles(
    membership.roles.map((assignment) => assignment.role),
  );
  if (!orgRolesAllow(orgRoles, "workflow.read")) {
    throw new CustomerWorkflowError("ACTION_DENIED");
  }

  const impersonating = await isImpersonating();
  return {
    service: { ownerId: gate.ownerId, membershipId: membership.id, impersonating },
    ambient: {
      kind: "user",
      subjectUserId: membership.userId,
      subjectEmail: gate.email,
      ownerId: gate.ownerId,
      orgRole: primaryOrgRole(orgRoles),
      membershipId: membership.id,
      impersonating,
      // #463 never carries the impersonator's id — see @fikirtive/db/principal (deferred to ②-D).
      impersonatedByBaUserId: null,
    },
  };
}

async function runRead<T>(
  operation: (principal: CustomerWorkflowPrincipal) => Promise<T>,
): Promise<{ ok: true; resource: T } | GatewayFailure> {
  try {
    const { service, ambient } = await resolvePrincipal();
    return { ok: true, resource: await runAsUser(ambient, () => operation(service)) };
  } catch (error) {
    if (error instanceof CustomerWorkflowError) return { ok: false, error: error.code };
    throw error;
  }
}

async function runMutation<T>(
  operation: (principal: CustomerWorkflowPrincipal) => Promise<T>,
): Promise<T | GatewayFailure> {
  try {
    const { service, ambient } = await resolvePrincipal();
    return await runAsUser(ambient, () => operation(service));
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

/** #720 判官 r2 — the authorization hash's own input plus the human names inside it, for the
 *  confirmation dialog. Read-only and owner-scoped like every other read here. */
export async function getRoutineAuthorizationPreview(input: GetRoutineInput) {
  return runRead((principal) =>
    workflowLifecycleService(prisma).getRoutineAuthorizationPreview(principal, input),
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
