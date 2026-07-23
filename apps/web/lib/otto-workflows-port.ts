/** Exact C7 read/draft capability. Authenticated UI-action successes are projected to safe DTOs;
 * no raw gateway/service, Prisma, activation, run mutation, dispatch, send, provider, or spend seam. */
import "server-only";
import type { OttoContext } from "@fikirtive/otto";
import {
  createRoutineDraft,
  createWorkflowDefinition,
  getBusinessHoursPolicy,
  getContactJourneyStates,
  getRoutine,
  getWorkflowDefinition,
  listBusinessHoursPolicies,
  listRoutineRuns,
  listRoutines,
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
const ROUTINE_READ_KEYS = [
  "id", "routineKey", "supersedesRoutineId", "status", "workflowDefinition",
  "workflowRevision", "authorization", "scopeSummary", "maxCreditsPerRun",
  "maxCreditsPerMonth", "summaryPolicy", "killSwitchEngaged", "killedAt",
  "killReasonCode", "rowRevision", "createdAt", "updatedAt",
] as const;
const ROUTINE_DEFINITION_REF_KEYS = ["id", "slug", "name", "definitionKind", "status"] as const;
const ROUTINE_REVISION_REF_KEYS = ["id", "revision", "validationState"] as const;
const ROUTINE_AUTHORIZATION_KEYS = ["revision", "authorized", "authorizedAt", "expiresAt"] as const;
const ROUTINE_SCOPE_SUMMARY_KEYS = [
  "actionKinds", "channelCount", "contactCount", "segmentCount", "maxActions", "maxRecipients",
] as const;
const SAFE_SUMMARY_POLICY_KEYS = ["schemaVersion", "mode", "scope", "destination", "afterEachRun"] as const;
const RUN_READ_KEYS = [
  "id", "routineId", "routineKey", "workflowDefinitionId", "workflowRevisionId",
  "contactJourneyStateId", "triggerKind", "scheduledFor", "status", "currentStepKey",
  "rowRevision", "simulated", "reservedCredits", "settledCredits", "summary", "blockReason",
  "errorCode", "startedAt", "finishedAt", "createdAt", "updatedAt",
] as const;
const JOURNEY_READ_KEYS = [
  "id", "contact", "workflowDefinitionId", "workflowRevisionId", "routineId", "status",
  "currentStepKey", "nextEligibleAt", "waitGeneration", "lastRoutineRunId", "lastRoutineRun",
  "rowRevision", "enrolledAt", "terminalAt", "createdAt", "updatedAt",
] as const;
const JOURNEY_CONTACT_KEYS = ["id", "name"] as const;
const JOURNEY_LAST_RUN_KEYS = [
  "id", "status", "blockReason", "errorCode", "startedAt", "finishedAt", "createdAt", "updatedAt",
] as const;
const POLICY_SUMMARY_KEYS = [
  "id", "policyKey", "revision", "supersedesPolicyId", "name", "timeZone", "status",
  "rowRevision", "archivedAt", "createdAt", "updatedAt",
] as const;
const POLICY_DETAIL_KEYS = [...POLICY_SUMMARY_KEYS, "weeklyWindows"] as const;
const WEEKLY_WINDOW_KEYS = ["weekday", "startMinute", "endMinute"] as const;

const ROUTINE_STATUSES = ["draft", "active", "paused", "revoked", "expired"] as const;
const RUN_STATUSES = [
  "queued", "running", "waiting", "completed", "blocked", "cancelled", "failed",
] as const;
const JOURNEY_STATUSES = [
  "active", "waiting", "paused", "completed", "exited", "blocked", "failed",
] as const;
const POLICY_STATUSES = ["draft", "published", "archived"] as const;
const DEFINITION_STATUSES = ["draft", "published", "archived"] as const;
const VALIDATION_STATUSES = ["valid", "invalid", "unavailable"] as const;
const ACTION_KINDS = ["conversation_reply", "broadcast_run", "wait", "complete"] as const;
const TRIGGER_KINDS = ["manual", "schedule", "customer_message", "journey_due"] as const;
const WORKFLOW_RESOURCE_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

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

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isResourceId(value: unknown): value is string {
  return typeof value === "string" && WORKFLOW_RESOURCE_ID.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isExact<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function isoFields(row: Record<string, unknown>, fields: readonly string[]) {
  const dates: Projection = {};
  for (const field of fields) {
    const date = isoDate(row[field]);
    if (date === undefined) return null;
    dates[field] = date;
  }
  return dates;
}

function projectSummaryPolicy(value: unknown) {
  if (!isRecord(value)) return null;
  const summary = pick(value, SAFE_SUMMARY_POLICY_KEYS);
  if (Object.values(summary).some((item) => !(
    item === null ||
    typeof item === "boolean" ||
    (typeof item === "number" && Number.isFinite(item) && item >= 0) ||
    (typeof item === "string" && item.length <= 128)
  ))) return null;
  return summary;
}

function projectActionKinds(value: unknown) {
  if (!Array.isArray(value) || value.some((item) => !isExact(item, ACTION_KINDS))) return null;
  return [...value] as string[];
}

function projectRoutineDefinitionRef(value: unknown) {
  const row = requiredRecord(value, ROUTINE_DEFINITION_REF_KEYS);
  if (
    !row ||
    !isString(row.id) ||
    !isString(row.slug) ||
    !isString(row.name) ||
    (row.definitionKind !== "rule" && row.definitionKind !== "journey") ||
    !isExact(row.status, DEFINITION_STATUSES)
  ) return null;
  return pick(row, ROUTINE_DEFINITION_REF_KEYS);
}

function projectRoutineRevisionRef(value: unknown) {
  const row = requiredRecord(value, ROUTINE_REVISION_REF_KEYS);
  if (
    !row ||
    !isString(row.id) ||
    !isNonNegativeInteger(row.revision) ||
    !isExact(row.validationState, VALIDATION_STATUSES)
  ) return null;
  return pick(row, ROUTINE_REVISION_REF_KEYS);
}

function projectRoutineAuthorization(value: unknown) {
  const row = requiredRecord(value, ROUTINE_AUTHORIZATION_KEYS);
  if (!row || !isNonNegativeInteger(row.revision) || typeof row.authorized !== "boolean") return null;
  const dates = isoFields(row, ["authorizedAt", "expiresAt"]);
  return dates ? { revision: row.revision, authorized: row.authorized, ...dates } : null;
}

function projectRoutineScopeSummary(value: unknown) {
  const row = requiredRecord(value, ROUTINE_SCOPE_SUMMARY_KEYS);
  const actionKinds = row ? projectActionKinds(row.actionKinds) : null;
  if (
    !row ||
    !actionKinds ||
    !isNonNegativeInteger(row.channelCount) ||
    !isNonNegativeInteger(row.contactCount) ||
    !isNonNegativeInteger(row.segmentCount) ||
    !isNonNegativeInteger(row.maxActions) ||
    !isNonNegativeInteger(row.maxRecipients)
  ) return null;
  return { ...pick(row, ROUTINE_SCOPE_SUMMARY_KEYS), actionKinds };
}

function projectPersistedRoutineSummary(value: unknown) {
  const row = requiredRecord(value, ROUTINE_READ_KEYS);
  if (!row) return null;
  const workflowDefinition = projectRoutineDefinitionRef(row.workflowDefinition);
  const workflowRevision = projectRoutineRevisionRef(row.workflowRevision);
  const authorization = projectRoutineAuthorization(row.authorization);
  const scopeSummary = projectRoutineScopeSummary(row.scopeSummary);
  const summaryPolicy = projectSummaryPolicy(row.summaryPolicy);
  const dates = isoFields(row, ["killedAt", "createdAt", "updatedAt"]);
  if (
    !workflowDefinition ||
    !workflowRevision ||
    !authorization ||
    !scopeSummary ||
    !summaryPolicy ||
    !dates ||
    !isString(row.id) ||
    !isString(row.routineKey) ||
    !isNullableString(row.supersedesRoutineId) ||
    !isExact(row.status, ROUTINE_STATUSES) ||
    !isNonNegativeInteger(row.maxCreditsPerRun) ||
    !isNonNegativeInteger(row.maxCreditsPerMonth) ||
    typeof row.killSwitchEngaged !== "boolean" ||
    !isNullableString(row.killReasonCode) ||
    !isNonNegativeInteger(row.rowRevision)
  ) return null;
  return {
    ...pick(row, ROUTINE_READ_KEYS),
    workflowDefinition,
    workflowRevision,
    authorization,
    scopeSummary,
    summaryPolicy,
    ...dates,
  };
}

function projectPersistedRoutineScope(value: unknown) {
  const row = requiredRecord(value, SCOPE_KEYS);
  if (!row) return null;
  const actionKinds = projectActionKinds(row.actionKinds);
  const channelScopes: Projection[] = [];
  if (Array.isArray(row.channelScopes)) {
    for (const entry of row.channelScopes) {
      const channelScope = requiredRecord(entry, CHANNEL_SCOPE_KEYS);
      if (
        !channelScope ||
        !isString(channelScope.channel) ||
        !isNullableString(channelScope.providerConnectionId)
      ) return null;
      channelScopes.push(pick(channelScope, CHANNEL_SCOPE_KEYS));
    }
  }
  if (
    !actionKinds ||
    !Array.isArray(row.contactIds) ||
    row.contactIds.some((id) => !isString(id)) ||
    !Array.isArray(row.segmentIds) ||
    row.segmentIds.some((id) => !isString(id)) ||
    !isNonNegativeInteger(row.maxActions) ||
    !isNonNegativeInteger(row.maxRecipients) ||
    !Array.isArray(row.channelScopes)
  ) return null;
  return { ...pick(row, SCOPE_KEYS), actionKinds, channelScopes };
}

function projectPersistedRoutineDetail(value: unknown) {
  const row = requiredRecord(value, ["routine", "predecessors"]);
  if (!row || !Array.isArray(row.predecessors)) return null;
  const routineRow = isRecord(row.routine) ? row.routine : null;
  const routine = routineRow ? projectPersistedRoutineSummary(routineRow) : null;
  const scope = routineRow ? projectPersistedRoutineScope(routineRow.scope) : null;
  const predecessors = row.predecessors.map(projectPersistedRoutineSummary);
  if (!routine || !scope || predecessors.some((item) => item === null)) return null;
  return {
    routine: { ...routine, scope },
    predecessors: predecessors as Projection[],
  };
}

function projectSafeRunSummary(value: unknown) {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > 64) return undefined;
  const summary: Projection = {};
  for (const [key, item] of entries) {
    if (
      key.length === 0 ||
      key.length > 128 ||
      /[\u0000-\u001f\u007f]/.test(key) ||
      !(item === null || typeof item === "boolean" || (
      typeof item === "number" && Number.isFinite(item) && item >= 0
      ))
    ) return undefined;
    summary[key] = item;
  }
  return Buffer.byteLength(JSON.stringify(summary), "utf8") <= 8 * 1024 ? summary : undefined;
}

function projectRoutineRun(value: unknown) {
  const row = requiredRecord(value, RUN_READ_KEYS);
  if (!row) return null;
  const dates = isoFields(
    row,
    ["scheduledFor", "startedAt", "finishedAt", "createdAt", "updatedAt"],
  );
  const summary = projectSafeRunSummary(row.summary);
  if (
    !dates ||
    summary === undefined ||
    !isString(row.id) ||
    !isString(row.routineId) ||
    !isString(row.routineKey) ||
    !isString(row.workflowDefinitionId) ||
    !isString(row.workflowRevisionId) ||
    !isNullableString(row.contactJourneyStateId) ||
    !isExact(row.triggerKind, TRIGGER_KINDS) ||
    !isExact(row.status, RUN_STATUSES) ||
    !isNullableString(row.currentStepKey) ||
    !isNonNegativeInteger(row.rowRevision) ||
    typeof row.simulated !== "boolean" ||
    !isNonNegativeInteger(row.reservedCredits) ||
    !isNonNegativeInteger(row.settledCredits) ||
    !isNullableString(row.blockReason) ||
    !isNullableString(row.errorCode)
  ) return null;
  return { ...pick(row, RUN_READ_KEYS), summary, ...dates };
}

function projectJourneyLastRun(value: unknown) {
  if (value === null) return null;
  const row = requiredRecord(value, JOURNEY_LAST_RUN_KEYS);
  if (!row) return undefined;
  const dates = isoFields(row, ["startedAt", "finishedAt", "createdAt", "updatedAt"]);
  if (
    !dates ||
    !isString(row.id) ||
    !isExact(row.status, RUN_STATUSES) ||
    !isNullableString(row.blockReason) ||
    !isNullableString(row.errorCode)
  ) return undefined;
  return { ...pick(row, JOURNEY_LAST_RUN_KEYS), ...dates };
}

function projectJourneyState(value: unknown) {
  const row = requiredRecord(value, JOURNEY_READ_KEYS);
  if (!row) return null;
  const contact = requiredRecord(row.contact, JOURNEY_CONTACT_KEYS);
  const lastRoutineRun = projectJourneyLastRun(row.lastRoutineRun);
  const dates = isoFields(
    row,
    ["nextEligibleAt", "enrolledAt", "terminalAt", "createdAt", "updatedAt"],
  );
  if (
    !contact ||
    !dates ||
    lastRoutineRun === undefined ||
    !isString(contact.id) ||
    !isString(contact.name) ||
    !isString(row.id) ||
    !isString(row.workflowDefinitionId) ||
    !isString(row.workflowRevisionId) ||
    !isString(row.routineId) ||
    !isExact(row.status, JOURNEY_STATUSES) ||
    !isNullableString(row.currentStepKey) ||
    !isNonNegativeInteger(row.waitGeneration) ||
    !isNullableString(row.lastRoutineRunId) ||
    !isNonNegativeInteger(row.rowRevision)
  ) return null;
  return {
    ...pick(row, JOURNEY_READ_KEYS),
    contact: pick(contact, JOURNEY_CONTACT_KEYS),
    lastRoutineRun,
    ...dates,
  };
}

function projectBusinessHoursPolicySummary(value: unknown) {
  const row = requiredRecord(value, POLICY_SUMMARY_KEYS);
  if (!row) return null;
  const dates = isoFields(row, ["archivedAt", "createdAt", "updatedAt"]);
  if (
    !dates ||
    !isString(row.id) ||
    !isString(row.policyKey) ||
    !isNonNegativeInteger(row.revision) ||
    !isNullableString(row.supersedesPolicyId) ||
    !isString(row.name) ||
    !isString(row.timeZone) ||
    !isExact(row.status, POLICY_STATUSES) ||
    !isNonNegativeInteger(row.rowRevision)
  ) return null;
  return { ...pick(row, POLICY_SUMMARY_KEYS), ...dates };
}

function projectBusinessHoursPolicy(value: unknown) {
  const row = requiredRecord(value, POLICY_DETAIL_KEYS);
  const summary = row ? projectBusinessHoursPolicySummary(row) : null;
  if (!row || !summary || !Array.isArray(row.weeklyWindows)) return null;
  const weeklyWindows: Projection[] = [];
  for (const item of row.weeklyWindows) {
    const window = requiredRecord(item, WEEKLY_WINDOW_KEYS);
    if (
      !window ||
      !Number.isInteger(window.weekday) ||
      (window.weekday as number) < 1 ||
      (window.weekday as number) > 7 ||
      !Number.isInteger(window.startMinute) ||
      (window.startMinute as number) < 0 ||
      (window.startMinute as number) >= 1440 ||
      !Number.isInteger(window.endMinute) ||
      (window.endMinute as number) <= 0 ||
      (window.endMinute as number) > 1440 ||
      (window.startMinute as number) >= (window.endMinute as number)
    ) return null;
    weeklyWindows.push(pick(window, WEEKLY_WINDOW_KEYS));
  }
  return { ...summary, weeklyWindows };
}

function projectPage(value: unknown, projector: ItemProjector) {
  const page = requiredRecord(value, ["items", "nextCursor"]);
  if (
    !page ||
    !Array.isArray(page.items) ||
    !(page.nextCursor === null || isResourceId(page.nextCursor))
  ) return null;
  const items = page.items.map(projector);
  return items.some((item) => item === null)
    ? null
    : { items: items as Projection[], nextCursor: page.nextCursor };
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
    listRoutines: async (input = {}) => projectEnvelope(
      await listRoutines(input), (value) => projectPage(value, projectPersistedRoutineSummary),
    ),
    getRoutine: async (input) =>
      projectEnvelope(await getRoutine(input), projectPersistedRoutineDetail),
    listRoutineRuns: async (input) => projectEnvelope(
      await listRoutineRuns(input), (value) => projectPage(value, projectRoutineRun),
    ),
    getContactJourneyStates: async (input) => projectEnvelope(
      await getContactJourneyStates(input), (value) => projectPage(value, projectJourneyState),
    ),
    listBusinessHoursPolicies: async (input = {}) => projectEnvelope(
      await listBusinessHoursPolicies(input),
      (value) => projectPage(value, projectBusinessHoursPolicySummary),
    ),
    getBusinessHoursPolicy: async (input) =>
      projectEnvelope(await getBusinessHoursPolicy(input), projectBusinessHoursPolicy),
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
