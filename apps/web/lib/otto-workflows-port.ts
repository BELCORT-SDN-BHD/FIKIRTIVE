/** Exact C7 read/draft capability. Authenticated UI-action successes are projected to safe DTOs;
 * no raw gateway/service, Prisma, activation, run, dispatch, send, provider, or spend seam. */
import "server-only";
import type { OttoContext } from "@fikirtive/otto";
import {
  createRoutineDraft,
  createWorkflowDefinition,
  getWorkflowDefinition,
  listWorkflowDefinitions,
  listWorkflowRevisions,
  publishWorkflowRevision,
  saveWorkflowRevision,
  validateWorkflowRules,
} from "./customer-workflow-ui-actions";

const ROUTINE_DRAFT_SUMMARY_POLICY = {
  mode: "counts_only",
  scope: "workflow_activity",
} as const;

const DEFINITION_KEYS = [
  "id", "slug", "name", "definitionKind", "originKind", "recipeKey",
  "recipeCatalogVersion", "currentRevision", "rowRevision", "status", "archivedAt", "createdAt", "updatedAt",
] as const;
const VALIDATION_KEYS = ["formatVersion", "compilerVersion", "validationState", "validationErrorsJson"] as const;
const REVISION_KEYS = [
  "id", "workflowDefinitionId", "revision", "formatVersion", "rulesSource",
  "compilerVersion", "validationState", "validationErrorsJson", "createdAt",
] as const;
const ROUTINE_KEYS = [
  "id", "workflowDefinitionId", "workflowRevisionId", "routineKey", "supersedesRoutineId",
  "status", "scopeJson", "maxCreditsPerRun", "maxCreditsPerMonth", "summaryPolicyJson",
  "authorizationRevision", "expiresAt", "killSwitchEngaged", "rowRevision", "createdAt", "updatedAt",
] as const;
const ROUTINE_GUARD_KEYS = [
  ...ROUTINE_KEYS, "authorizationHash", "authorizedAt", "authorizedByMembershipId",
  "killedByMembershipId", "killedAt", "killReasonCode",
] as const;
const SCOPE_KEYS = ["actionKinds", "channelScopes", "contactIds", "segmentIds", "maxActions", "maxRecipients"] as const;
const CHANNEL_SCOPE_KEYS = ["channel", "providerConnectionId"] as const;
const VALIDATION_ERROR_KEYS = ["code", "path", "line", "column"] as const;
const CHANGE_KEYS = ["id", "revision", "kind"] as const;

type Projection = Record<string, unknown>;
type ProjectedResource = Projection | Projection[];
type Projector = (value: unknown) => ProjectedResource | null;
type ItemProjector = (value: unknown) => Projection | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredRecord(value: unknown, keys: readonly string[]) {
  if (!isRecord(value) || keys.some((key) => !(key in value))) return null;
  return value;
}

function pick(value: Record<string, unknown>, keys: readonly string[]): Projection {
  return Object.fromEntries(keys.filter((key) => key in value).map((key) => [key, value[key]]));
}

function isoDate(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (!(value instanceof Date) && typeof value !== "string") return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function projectValidationErrors(value: unknown) {
  if (!Array.isArray(value)) return null;
  const errors: Projection[] = [];
  for (const entry of value) {
    const row = requiredRecord(entry, ["code", "path"]);
    if (!row) return null;
    errors.push(pick(row, VALIDATION_ERROR_KEYS));
  }
  return errors;
}

function projectDefinition(value: unknown) {
  const row = requiredRecord(value, DEFINITION_KEYS);
  if (!row) return null;
  const archivedAt = isoDate(row.archivedAt);
  const createdAt = isoDate(row.createdAt);
  const updatedAt = isoDate(row.updatedAt);
  if (archivedAt === undefined || typeof createdAt !== "string" || typeof updatedAt !== "string") return null;
  return { ...pick(row, DEFINITION_KEYS), archivedAt, createdAt, updatedAt };
}

function projectValidation(value: unknown) {
  const row = requiredRecord(value, VALIDATION_KEYS);
  if (!row) return null;
  const validationErrorsJson = projectValidationErrors(row.validationErrorsJson);
  return validationErrorsJson === null
    ? null
    : { ...pick(row, VALIDATION_KEYS), validationErrorsJson };
}

function projectRevision(value: unknown) {
  const row = requiredRecord(value, REVISION_KEYS);
  if (!row) return null;
  const validationErrorsJson = projectValidationErrors(row.validationErrorsJson);
  const createdAt = isoDate(row.createdAt);
  if (validationErrorsJson === null || typeof createdAt !== "string") return null;
  return { ...pick(row, REVISION_KEYS), validationErrorsJson, createdAt };
}

function projectScope(value: unknown) {
  const row = requiredRecord(value, SCOPE_KEYS);
  if (
    !row ||
    !Array.isArray(row.actionKinds) ||
    !Array.isArray(row.channelScopes) ||
    !Array.isArray(row.contactIds) ||
    !Array.isArray(row.segmentIds)
  ) return null;
  const channelScopes: Projection[] = [];
  for (const entry of row.channelScopes) {
    const channelScope = requiredRecord(entry, CHANNEL_SCOPE_KEYS);
    if (!channelScope) return null;
    channelScopes.push(pick(channelScope, CHANNEL_SCOPE_KEYS));
  }
  return { ...pick(row, SCOPE_KEYS), channelScopes };
}

function projectRoutine(value: unknown) {
  const row = requiredRecord(value, ROUTINE_GUARD_KEYS);
  if (!row) return null;
  const scopeJson = projectScope(row.scopeJson);
  const summary = requiredRecord(row.summaryPolicyJson, ["mode", "scope"]);
  const expiresAt = isoDate(row.expiresAt);
  const createdAt = isoDate(row.createdAt);
  const updatedAt = isoDate(row.updatedAt);
  if (
    !scopeJson ||
    !summary ||
    summary.mode !== ROUTINE_DRAFT_SUMMARY_POLICY.mode ||
    summary.scope !== ROUTINE_DRAFT_SUMMARY_POLICY.scope ||
    row.status !== "draft" ||
    row.maxCreditsPerRun !== 0 ||
    row.maxCreditsPerMonth !== 0 ||
    row.authorizationRevision !== 1 ||
    row.supersedesRoutineId !== null ||
    row.authorizationHash !== null ||
    row.authorizedAt !== null ||
    row.authorizedByMembershipId !== null ||
    row.killSwitchEngaged !== false ||
    row.killedByMembershipId !== null ||
    row.killedAt !== null ||
    row.killReasonCode !== null ||
    expiresAt === undefined ||
    typeof createdAt !== "string" ||
    typeof updatedAt !== "string"
  ) return null;
  return {
    ...pick(row, ROUTINE_KEYS),
    scopeJson,
    summaryPolicyJson: ROUTINE_DRAFT_SUMMARY_POLICY,
    expiresAt,
    createdAt,
    updatedAt,
  };
}

function projectList(value: unknown, projector: ItemProjector) {
  if (!Array.isArray(value)) return null;
  const resources = value.map(projector);
  return resources.some((resource) => resource === null) ? null : resources as Projection[];
}

function authorityUnavailable() {
  return { ok: false as const, error: "AUTHORITY_UNAVAILABLE" as const };
}

function projectEnvelope(value: unknown, projector: Projector, includeChange = false) {
  if (!isRecord(value)) return authorityUnavailable();
  if (value.ok === false && typeof value.error === "string") {
    return { ok: false as const, error: value.error };
  }
  if (value.ok !== true) return authorityUnavailable();
  const resource = projector(value.resource);
  if (!resource) return authorityUnavailable();
  if (!includeChange) return { ok: true as const, resource };
  const change = requiredRecord(value.change, CHANGE_KEYS);
  return change
    ? { ok: true as const, resource, change: pick(change, CHANGE_KEYS) }
    : authorityUnavailable();
}

export function makeOttoWorkflowsPort(): NonNullable<OttoContext["workflows"]> {
  return {
    listWorkflowDefinitions: async (input = {}) => projectEnvelope(
      await listWorkflowDefinitions(input), (value) => projectList(value, projectDefinition),
    ),
    getWorkflowDefinition: async (input) =>
      projectEnvelope(await getWorkflowDefinition(input), projectDefinition),
    listWorkflowRevisions: async (input) => projectEnvelope(
      await listWorkflowRevisions(input), (value) => projectList(value, projectRevision),
    ),
    createWorkflowDefinition: async (input) =>
      projectEnvelope(await createWorkflowDefinition(input), projectDefinition, true),
    validateWorkflowRules: async (input) =>
      projectEnvelope(await validateWorkflowRules(input), projectValidation),
    saveWorkflowRevision: async (input) =>
      projectEnvelope(await saveWorkflowRevision(input), projectRevision, true),
    publishWorkflowRevision: async (input) =>
      projectEnvelope(await publishWorkflowRevision(input), projectDefinition, true),
    createRoutineDraft: async (input) => {
      let expiresAt: Date | null | undefined;
      if (input.expiresAt === null) expiresAt = null;
      else if (input.expiresAt !== undefined) {
        expiresAt = new Date(input.expiresAt);
        if (!Number.isFinite(expiresAt.getTime())) {
          return { ok: false as const, error: "INVALID_ARGUMENT" as const };
        }
      }
      return projectEnvelope(await createRoutineDraft({
        workflowDefinitionId: input.workflowDefinitionId,
        workflowRevisionId: input.workflowRevisionId,
        routineKey: input.routineKey,
        scopeJson: input.scopeJson,
        maxCreditsPerRun: 0,
        maxCreditsPerMonth: 0,
        summaryPolicyJson: ROUTINE_DRAFT_SUMMARY_POLICY,
        ...(expiresAt === undefined ? {} : { expiresAt }),
      }), projectRoutine, true);
    },
  };
}
