"use server";

// C7-M3 (issue #421): thin client-callable wrapper over the frozen customer-workflow
// gateway. This module contains no business logic. Every export forwards its input to
// the matching owner-scoped gateway function and returns the result shape unchanged.
//
// Deliberately omitted: updateWorkflowDefinition (the M3 UI does not rename definitions)
// and every worker-only engine function (run creation/transition, journey advancement,
// business-hours evaluation, and step dispatch). Those functions must never become browser
// affordances. The runtime export allowlist below is enforced by the adjacent test.
import {
  activateRoutine as gatewayActivateRoutine,
  archiveWorkflowDefinition as gatewayArchiveWorkflowDefinition,
  createRoutineDraft as gatewayCreateRoutineDraft,
  createWorkflowDefinition as gatewayCreateWorkflowDefinition,
  getBusinessHoursPolicy as gatewayGetBusinessHoursPolicy,
  getContactJourneyStates as gatewayGetContactJourneyStates,
  getRoutine as gatewayGetRoutine,
  getRoutineAuthorizationPreview as gatewayGetRoutineAuthorizationPreview,
  getWorkflowDefinition as gatewayGetWorkflowDefinition,
  killRoutine as gatewayKillRoutine,
  listBusinessHoursPolicies as gatewayListBusinessHoursPolicies,
  listRoutineRuns as gatewayListRoutineRuns,
  listRoutines as gatewayListRoutines,
  listWorkflowDefinitions as gatewayListWorkflowDefinitions,
  listWorkflowRevisions as gatewayListWorkflowRevisions,
  publishWorkflowRevision as gatewayPublishWorkflowRevision,
  reauthorizeRoutine as gatewayReauthorizeRoutine,
  saveWorkflowRevision as gatewaySaveWorkflowRevision,
  validateWorkflowRules as gatewayValidateWorkflowRules,
} from "./customer-workflow-gateway";
import type {
  ActivateRoutineInput,
  ArchiveWorkflowDefinitionInput,
  CreateRoutineDraftInput,
  CreateWorkflowDefinitionInput,
  GetBusinessHoursPolicyInput,
  GetContactJourneyStatesInput,
  GetRoutineAuthorizationPreviewInput,
  GetRoutineInput,
  KillRoutineInput,
  ListBusinessHoursPoliciesInput,
  ListRoutineRunsInput,
  ListRoutinesInput,
  ListWorkflowDefinitionsInput,
  ListWorkflowRevisionsInput,
  PublishWorkflowRevisionInput,
  ReauthorizeRoutineInput,
  SaveWorkflowRevisionInput,
  ValidateWorkflowRulesInput,
  WorkflowDefinitionIdInput,
} from "./customer-workflow-service";

export async function listWorkflowDefinitions(input: ListWorkflowDefinitionsInput = {}) {
  return gatewayListWorkflowDefinitions(input);
}

export async function getWorkflowDefinition(input: WorkflowDefinitionIdInput) {
  return gatewayGetWorkflowDefinition(input);
}

export async function listRoutines(input: ListRoutinesInput = {}) {
  return gatewayListRoutines(input);
}

export async function getRoutine(input: GetRoutineInput) {
  return gatewayGetRoutine(input);
}

export async function getRoutineAuthorizationPreview(input: GetRoutineAuthorizationPreviewInput) {
  return gatewayGetRoutineAuthorizationPreview(input);
}

export async function listRoutineRuns(input: ListRoutineRunsInput) {
  return gatewayListRoutineRuns(input);
}

export async function getContactJourneyStates(input: GetContactJourneyStatesInput) {
  return gatewayGetContactJourneyStates(input);
}

export async function listBusinessHoursPolicies(
  input: ListBusinessHoursPoliciesInput = {},
) {
  return gatewayListBusinessHoursPolicies(input);
}

export async function getBusinessHoursPolicy(input: GetBusinessHoursPolicyInput) {
  return gatewayGetBusinessHoursPolicy(input);
}

export async function createWorkflowDefinition(input: CreateWorkflowDefinitionInput) {
  return gatewayCreateWorkflowDefinition(input);
}

export async function validateWorkflowRules(input: ValidateWorkflowRulesInput) {
  return gatewayValidateWorkflowRules(input);
}

export async function saveWorkflowRevision(input: SaveWorkflowRevisionInput) {
  return gatewaySaveWorkflowRevision(input);
}

export async function listWorkflowRevisions(input: ListWorkflowRevisionsInput) {
  return gatewayListWorkflowRevisions(input);
}

export async function publishWorkflowRevision(input: PublishWorkflowRevisionInput) {
  return gatewayPublishWorkflowRevision(input);
}

export async function archiveWorkflowDefinition(input: ArchiveWorkflowDefinitionInput) {
  return gatewayArchiveWorkflowDefinition(input);
}

export async function createRoutineDraft(input: CreateRoutineDraftInput) {
  return gatewayCreateRoutineDraft(input);
}

export async function activateRoutine(input: ActivateRoutineInput) {
  return gatewayActivateRoutine(input);
}

export async function killRoutine(input: KillRoutineInput) {
  return gatewayKillRoutine(input);
}

export async function reauthorizeRoutine(input: ReauthorizeRoutineInput) {
  return gatewayReauthorizeRoutine(input);
}
