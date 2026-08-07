import "server-only";

import {
  effectiveOrgRoles,
  newId,
  orgRolesAllow,
  type OrgCapability,
  type OrgRole,
} from "@fikirtive/core";
import { broadcastPurposeFromTemplateClassification } from "./customer-broadcast-purpose";
import {
  canonicalHash,
  canonicalJson,
  canonicalizeBusinessHoursPolicy,
  canonicalizeRoutineScope,
  compileWorkflowSource,
  computeRoutineAuthorizationHash,
  computeRoutineScopeHash,
  createRoutineAuthorizationSnapshot,
  createRoutineRunInTransaction,
  createJourneyDueRun,
  enrollContactJourney,
  enterJourneyWait,
  evaluateSendEligibility,
  evaluateBusinessHours,
  advanceContactJourney,
  reserveWorkflowStepInTransaction,
  settleWorkflowStepInTransaction,
  transitionRoutineRun,
  verifyRoutineRunAuthorityInTransaction,
  WORKFLOW_COMPILER_VERSION,
  WORKFLOW_FORMAT_VERSION,
  type AdvanceContactJourneyInput,
  type BusinessHoursEvaluationInput,
  type CreateJourneyDueRunInput,
  type CreateRoutineRunResult,
  type EligibilityAxis,
  type EnrollContactJourneyInput,
  type EnterJourneyWaitInput,
  type Prisma,
  type PrismaClient,
  type RoutineAuthorizationMaterial,
  type RoutineRunRecord,
  type SendEligibilityResult,
  type SettleWorkflowStepInput,
  type TransitionRoutineRunInput,
  type WorkflowActionOccurrence,
  type WorkflowDependencyResolver,
  type WorkflowTrigger,
} from "@fikirtive/db";

export const CUSTOMER_WORKFLOW_ERROR_CODES = {
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  ACTION_DENIED: "ACTION_DENIED",
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  CAS_CONFLICT: "CAS_CONFLICT",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  AUTHORITY_UNAVAILABLE: "AUTHORITY_UNAVAILABLE",
  ACTIVE_ROUTINE_ACKNOWLEDGEMENT_REQUIRED: "ACTIVE_ROUTINE_ACKNOWLEDGEMENT_REQUIRED",
  SEND_PATH_UNAVAILABLE: "SEND_PATH_UNAVAILABLE",
} as const;

export type CustomerWorkflowErrorCode =
  (typeof CUSTOMER_WORKFLOW_ERROR_CODES)[keyof typeof CUSTOMER_WORKFLOW_ERROR_CODES];

export class CustomerWorkflowError extends Error {
  constructor(public readonly code: CustomerWorkflowErrorCode) {
    super(code);
    this.name = "CustomerWorkflowError";
  }
}

export type CustomerWorkflowPrincipal = {
  ownerId: string;
  membershipId: string;
  impersonating?: boolean;
};

export type VerifiedCustomerWorkflowWorkerContext = {
  ownerId: string;
  queueJobId: string;
  leaseId: string;
  fencingToken: string;
};

/** Opaque queue adapter input. Tenant and lease facts are accepted only from the injected verifier. */
export type CustomerWorkflowWorkerContext = unknown;

export type CreateWorkflowDefinitionInput = {
  slug: string;
  name: string;
  definitionKind: "rule" | "journey";
  originKind: "custom" | "inbox_recipe";
  recipeKey?: string | null;
  recipeCatalogVersion?: string | null;
};

export type WorkflowDefinitionIdInput = { workflowDefinitionId: string };
export type ListWorkflowDefinitionsInput = { limit?: number };
export type UpdateWorkflowDefinitionInput = WorkflowDefinitionIdInput & {
  expectedRowRevision: number;
  name: string;
};

export type ActiveRoutineArchiveAcknowledgement = {
  message: string;
  routines: Array<{ id: string; routineKey: string }>;
};

export type ArchiveWorkflowDefinitionInput = WorkflowDefinitionIdInput & {
  expectedRowRevision: number;
  acknowledgement?: ActiveRoutineArchiveAcknowledgement;
};

export type ValidateWorkflowRulesInput = WorkflowDefinitionIdInput & { rulesSource: string };
export type SaveWorkflowRevisionInput = ValidateWorkflowRulesInput;
export type PublishWorkflowRevisionInput = WorkflowDefinitionIdInput & {
  workflowRevisionId: string;
  expectedRowRevision: number;
};
export type ListWorkflowRevisionsInput = WorkflowDefinitionIdInput & { limit?: number };

export type CreateRoutineDraftInput = {
  workflowDefinitionId: string;
  workflowRevisionId: string;
  routineKey: string;
  scopeJson: unknown;
  maxCreditsPerRun: number;
  maxCreditsPerMonth: number;
  summaryPolicyJson: unknown;
  expiresAt?: Date | null;
};

export type ActivateRoutineInput = { routineId: string; expectedRowRevision: number };
export type KillRoutineInput = {
  routineId: string;
  expectedRowRevision: number;
  reasonCode: string;
};

export const CUSTOMER_WORKFLOW_ROUTINE_STATUSES = [
  "draft",
  "active",
  "paused",
  "revoked",
  "expired",
] as const;
export type CustomerWorkflowRoutineStatus =
  (typeof CUSTOMER_WORKFLOW_ROUTINE_STATUSES)[number];

export const CUSTOMER_WORKFLOW_RUN_STATUSES = [
  "queued",
  "running",
  "waiting",
  "completed",
  "blocked",
  "cancelled",
  "failed",
] as const;
export type CustomerWorkflowRunStatus =
  (typeof CUSTOMER_WORKFLOW_RUN_STATUSES)[number];

export const CUSTOMER_WORKFLOW_JOURNEY_STATUSES = [
  "active",
  "waiting",
  "paused",
  "completed",
  "exited",
  "blocked",
  "failed",
] as const;
export type CustomerWorkflowJourneyStatus =
  (typeof CUSTOMER_WORKFLOW_JOURNEY_STATUSES)[number];

export const CUSTOMER_WORKFLOW_BUSINESS_HOURS_POLICY_STATUSES = [
  "draft",
  "published",
  "archived",
] as const;
export type CustomerWorkflowBusinessHoursPolicyStatus =
  (typeof CUSTOMER_WORKFLOW_BUSINESS_HOURS_POLICY_STATUSES)[number];

export type ListRoutinesInput = {
  workflowDefinitionId?: string;
  status?: CustomerWorkflowRoutineStatus;
  cursor?: string;
  limit?: number;
};
export type GetRoutineInput = { routineId: string };
export type ListRoutineRunsInput = {
  routineId?: string;
  workflowDefinitionId?: string;
  status?: CustomerWorkflowRunStatus;
  cursor?: string;
  limit?: number;
};
export type GetContactJourneyStatesInput = {
  routineId?: string;
  workflowDefinitionId?: string;
  status?: CustomerWorkflowJourneyStatus;
  cursor?: string;
  limit?: number;
};
export type ListBusinessHoursPoliciesInput = {
  status?: CustomerWorkflowBusinessHoursPolicyStatus;
  cursor?: string;
  limit?: number;
};
export type GetBusinessHoursPolicyInput = { businessHoursPolicyId: string };

export type ReauthorizeRoutineInput = {
  routineId: string;
  expectedRowRevision: number;
  workflowRevisionId: string;
  scopeJson: unknown;
  maxCreditsPerRun: number;
  maxCreditsPerMonth: number;
  summaryPolicyJson: unknown;
  expiresAt?: Date | null;
};

export type CreateWorkflowRunInput = {
  routineId: string;
  trigger: WorkflowTrigger;
  trustedTriggerPayload: unknown;
};

export type TransitionWorkflowRunInput = Omit<
  TransitionRoutineRunInput,
  "ownerId" | "now"
>;

export type DispatchWorkflowStepInput = { routineRunId: string; stepKey: string };

export type EnrollWorkflowJourneyInput = Omit<
  EnrollContactJourneyInput,
  "id" | "ownerId" | "now"
>;
export type AdvanceWorkflowJourneyInput = Omit<AdvanceContactJourneyInput, "ownerId" | "now">;
export type EnterWorkflowJourneyWaitInput = Omit<EnterJourneyWaitInput, "ownerId" | "now">;
export type CreateWorkflowJourneyDueRunInput = Omit<
  CreateJourneyDueRunInput,
  "ownerId" | "routineRunId" | "now"
>;
export type EvaluateWorkflowBusinessHoursInput = {
  workflowRevisionId: string;
  conditionIndex: number;
};

export type WorkflowCompilation = {
  formatVersion: "fikirtive-workflow/v1";
  compiledRuleJson: unknown;
  dependencyManifestJson: unknown;
  dependencyHash: string;
  compilerVersion: string;
  contentHash: string;
  validationState: "valid" | "invalid" | "unavailable";
  validationErrorsJson: unknown;
};

type ActiveWorkflowMembership = { id: string; roles: OrgRole[] };
type CompiledCustomerAction = {
  key: string;
  action: {
    type: "conversation_reply" | "broadcast_run";
    dependency: {
      kind: "customer_message_template_version";
      resourceId: string;
      resourceRevision: number;
      contentHash: string;
    };
  };
};

const MAX_TEXT = 512;
const MAX_JSON_BYTES = 32 * 1024;
const MAX_SAFE_RUN_SUMMARY_BYTES = 8 * 1024;
const MAX_SAFE_RUN_SUMMARY_KEYS = 64;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const TOKEN = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const AXES = ["consentStop", "doNotDisturb", "providerRefusal", "frequency"] as const;

function fail(code: CustomerWorkflowErrorCode): never {
  throw new CustomerWorkflowError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, max = MAX_TEXT): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    fail("INVALID_ARGUMENT");
  }
  return value.trim();
}

function requiredToken(value: unknown): string {
  const token = requiredString(value, 128);
  if (!TOKEN.test(token)) fail("INVALID_ARGUMENT");
  return token;
}

function workflowRulesSource(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) fail("INVALID_ARGUMENT");
  return value;
}

function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail("INVALID_ARGUMENT");
  return value as number;
}

function nonNegative(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail("INVALID_ARGUMENT");
  return value as number;
}

function limit(value: unknown): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_LIMIT) {
    fail("INVALID_ARGUMENT");
  }
  return value as number;
}

function optionalFilterId(value: unknown): string | undefined {
  return value === undefined ? undefined : requiredString(value);
}

function optionalCursor(value: unknown): string | undefined {
  return value === undefined ? undefined : requiredString(value);
}

function exactStatus<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T)) fail("INVALID_ARGUMENT");
  return value as T;
}

function exactlyOneParentFilter(input: {
  routineId?: unknown;
  workflowDefinitionId?: unknown;
}): { routineId?: string; workflowDefinitionId?: string } {
  const routineId = optionalFilterId(input.routineId);
  const workflowDefinitionId = optionalFilterId(input.workflowDefinitionId);
  if ((routineId === undefined) === (workflowDefinitionId === undefined)) {
    fail("INVALID_ARGUMENT");
  }
  return { routineId, workflowDefinitionId };
}

function safeRunSummary(value: unknown): Record<string, number | boolean | null> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_SAFE_RUN_SUMMARY_KEYS) return null;
  const summary: Record<string, number | boolean | null> = {};
  for (const [key, item] of entries) {
    if (
      key.length === 0 ||
      key.length > 128 ||
      /[\u0000-\u001f\u007f]/.test(key) ||
      !(
        item === null ||
        typeof item === "boolean" ||
        (typeof item === "number" && Number.isFinite(item) && item >= 0)
      )
    ) {
      return null;
    }
    summary[key] = item as number | boolean | null;
  }
  if (Buffer.byteLength(JSON.stringify(summary), "utf8") > MAX_SAFE_RUN_SUMMARY_BYTES) {
    return null;
  }
  return summary;
}

function safeSummaryPolicy(value: unknown): Record<string, string | number | boolean | null> {
  if (!isRecord(value)) return {};
  const safe: Record<string, string | number | boolean | null> = {};
  for (const key of ["schemaVersion", "mode", "scope", "destination", "afterEachRun"] as const) {
    const item = value[key];
    if (
      item === null ||
      typeof item === "boolean" ||
      (typeof item === "number" && Number.isFinite(item) && item >= 0) ||
      (typeof item === "string" && item.length <= 128 && !/[\u0000-\u001f\u007f]/.test(item))
    ) {
      safe[key] = item;
    }
  }
  return safe;
}

function optionalDate(value: unknown): Date | null {
  if (value === undefined || value === null) return null;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail("INVALID_ARGUMENT");
  return new Date(value.getTime());
}

function prismaCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function translateCoreError(error: unknown): never {
  const code = prismaCode(error);
  if (
    code === "INVALID_ARGUMENT" ||
    code === "RESOURCE_NOT_FOUND" ||
    code === "CAS_CONFLICT" ||
    code === "IDEMPOTENCY_CONFLICT" ||
    code === "AUTHORITY_UNAVAILABLE"
  ) {
    fail(code);
  }
  throw error;
}

function inputJson(value: unknown): Prisma.InputJsonValue {
  let encoded: string;
  try {
    encoded = canonicalJson(value);
  } catch {
    fail("INVALID_ARGUMENT");
  }
  if (Buffer.byteLength(encoded, "utf8") > MAX_JSON_BYTES) fail("INVALID_ARGUMENT");
  return value as Prisma.InputJsonValue;
}

function summaryPolicyJson(value: unknown): Prisma.InputJsonValue {
  if (!isRecord(value) || Object.keys(value).length === 0) fail("INVALID_ARGUMENT");
  return inputJson(value);
}

function routineScopeHash(value: unknown): string {
  try {
    return computeRoutineScopeHash(value);
  } catch (error) {
    return translateCoreError(error);
  }
}

function authorizationHash(material: RoutineAuthorizationMaterial): string {
  try {
    createRoutineAuthorizationSnapshot(material);
    return computeRoutineAuthorizationHash(material);
  } catch (error) {
    return translateCoreError(error);
  }
}

function workflowDefinitionSlug(value: unknown): string {
  const slug = requiredString(value, 128).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(slug)) fail("INVALID_ARGUMENT");
  return slug;
}

function exactArchiveAcknowledgement(
  acknowledgement: ActiveRoutineArchiveAcknowledgement | undefined,
  active: Array<{ id: string; routineKey: string }>,
): boolean {
  if (active.length === 0) return true;
  if (!acknowledgement || !Array.isArray(acknowledgement.routines)) return false;
  if (acknowledgement.message !== `Archiving does not stop these ${active.length} active Routines`) {
    return false;
  }
  const expected = [...active].sort((a, b) => a.id.localeCompare(b.id));
  const received = [...acknowledgement.routines].sort((a, b) => a.id.localeCompare(b.id));
  return (
    received.length === expected.length &&
    received.every(
      (entry, index) => entry.id === expected[index]!.id && entry.routineKey === expected[index]!.routineKey,
    )
  );
}

function compiledCustomerAction(compiled: unknown, stepKey: string): CompiledCustomerAction | null {
  if (!isRecord(compiled) || !Array.isArray(compiled.steps)) return null;
  const raw = compiled.steps.find((entry) => isRecord(entry) && entry.key === stepKey);
  if (!isRecord(raw) || !isRecord(raw.action)) return null;
  if (raw.action.type !== "conversation_reply" && raw.action.type !== "broadcast_run") return null;
  if (!isRecord(raw.action.dependency)) return null;
  const dependency = raw.action.dependency;
  if (
    dependency.kind !== "customer_message_template_version" ||
    typeof dependency.resourceId !== "string" ||
    !Number.isSafeInteger(dependency.resourceRevision) ||
    typeof dependency.contentHash !== "string"
  ) {
    return null;
  }
  return {
    key: stepKey,
    action: {
      type: raw.action.type,
      dependency: {
        kind: dependency.kind,
        resourceId: dependency.resourceId,
        resourceRevision: dependency.resourceRevision as number,
        contentHash: dependency.contentHash,
      },
    },
  };
}

function allAxesPass(verdict: SendEligibilityResult): boolean {
  return AXES.every((name) => (verdict[name] as EligibilityAxis).status === "pass");
}

function firstNonPass(verdict: SendEligibilityResult): string {
  for (const name of AXES) {
    const axis = verdict[name] as EligibilityAxis;
    if (axis.status !== "pass") return `${name}:${axis.reason ?? axis.status}`;
  }
  return "eligibility:unknown";
}

function unavailableConversationEligibility(checkedAt: string): SendEligibilityResult {
  const unavailable = (source: string): EligibilityAxis => ({
    status: "unavailable",
    source,
    reason: "strict_classification_unavailable",
    checkedAt,
  });
  return {
    consentStop: unavailable("workflow_strict_classification"),
    doNotDisturb: unavailable("workflow_strict_classification"),
    providerRefusal: unavailable("workflow_strict_classification"),
    frequency: unavailable("workflow_strict_classification"),
    aggregate: { status: "unavailable", reason: "SEND_PATH_UNAVAILABLE" },
    checkedAt,
  };
}

export function workflowLifecycleService(
  db: PrismaClient,
  options: {
    clock?: () => Date;
    id?: () => string;
    resolveWorkerContext?: (
      context: CustomerWorkflowWorkerContext,
    ) => VerifiedCustomerWorkflowWorkerContext | null | Promise<VerifiedCustomerWorkflowWorkerContext | null>;
  } = {},
) {
  const clock = options.clock ?? (() => new Date());
  const issueId = options.id ?? newId;
  const now = () => new Date(clock().getTime());

  async function requireWorkflowPermission(
    tx: Prisma.TransactionClient,
    principal: CustomerWorkflowPrincipal,
    capability: Extract<OrgCapability, "workflow.read" | "workflow.manage">,
  ): Promise<ActiveWorkflowMembership> {
    if (
      !principal ||
      typeof principal.ownerId !== "string" ||
      typeof principal.membershipId !== "string"
    ) {
      fail("NOT_AUTHORIZED");
    }
    if (principal.impersonating) fail("ACTION_DENIED");
    const membership = await tx.membership.findFirst({
      where: {
        id: principal.membershipId,
        orgId: principal.ownerId,
        status: "active",
        deletedAt: null,
      },
      select: { id: true, roles: { select: { role: true } } },
    });
    if (!membership) fail("ACTION_DENIED");
    const roles = effectiveOrgRoles(
      (membership.roles ?? []).map((assignment) => assignment.role),
    );
    if (!orgRolesAllow(roles, capability)) fail("ACTION_DENIED");
    return { id: membership.id, roles };
  }

  const routineReadSelect = {
    id: true,
    workflowDefinitionId: true,
    workflowRevisionId: true,
    routineKey: true,
    supersedesRoutineId: true,
    status: true,
    scopeJson: true,
    maxCreditsPerRun: true,
    maxCreditsPerMonth: true,
    summaryPolicyJson: true,
    authorizationRevision: true,
    authorizationHash: true,
    authorizedAt: true,
    expiresAt: true,
    killSwitchEngaged: true,
    killedAt: true,
    killReasonCode: true,
    rowRevision: true,
    createdAt: true,
    updatedAt: true,
    workflowDefinition: {
      select: { id: true, slug: true, name: true, definitionKind: true, status: true },
    },
    workflowRevision: {
      select: { id: true, revision: true, validationState: true },
    },
  } satisfies Prisma.RoutineSelect;

  type RoutineReadRow = Prisma.RoutineGetPayload<{ select: typeof routineReadSelect }>;

  function storedStatus<T extends string>(value: string, allowed: readonly T[]): T {
    if (!allowed.includes(value as T)) fail("AUTHORITY_UNAVAILABLE");
    return value as T;
  }

  function projectRoutineSummary(row: RoutineReadRow) {
    const scope = canonicalizeRoutineScope(row.scopeJson);
    if (!scope) fail("AUTHORITY_UNAVAILABLE");
    return {
      id: row.id,
      routineKey: row.routineKey,
      supersedesRoutineId: row.supersedesRoutineId,
      status: storedStatus(row.status, CUSTOMER_WORKFLOW_ROUTINE_STATUSES),
      workflowDefinition: row.workflowDefinition,
      workflowRevision: row.workflowRevision,
      authorization: {
        revision: row.authorizationRevision,
        authorized: row.authorizationHash !== null && row.authorizedAt !== null,
        authorizedAt: row.authorizedAt,
        expiresAt: row.expiresAt,
      },
      scopeSummary: {
        actionKinds: scope.actionKinds,
        channelCount: scope.channelScopes.length,
        contactCount: scope.contactIds.length,
        segmentCount: scope.segmentIds.length,
        maxActions: scope.maxActions,
        maxRecipients: scope.maxRecipients,
      },
      maxCreditsPerRun: row.maxCreditsPerRun,
      maxCreditsPerMonth: row.maxCreditsPerMonth,
      summaryPolicy: safeSummaryPolicy(row.summaryPolicyJson),
      killSwitchEngaged: row.killSwitchEngaged,
      killedAt: row.killedAt,
      killReasonCode: row.killReasonCode,
      rowRevision: row.rowRevision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  function projectRoutine(row: RoutineReadRow) {
    const scope = canonicalizeRoutineScope(row.scopeJson);
    if (!scope) fail("AUTHORITY_UNAVAILABLE");
    return { ...projectRoutineSummary(row), scope };
  }

  async function assertDefinitionFilter(
    tx: Prisma.TransactionClient,
    ownerId: string,
    workflowDefinitionId: string,
  ): Promise<void> {
    const definition = await tx.workflowDefinition.findFirst({
      where: { id: workflowDefinitionId, ownerId },
      select: { id: true },
    });
    if (!definition) fail("RESOURCE_NOT_FOUND");
  }

  async function assertRoutineFilter(
    tx: Prisma.TransactionClient,
    ownerId: string,
    routineId: string,
  ): Promise<void> {
    const routine = await tx.routine.findFirst({
      where: { id: routineId, ownerId },
      select: { id: true },
    });
    if (!routine) fail("RESOURCE_NOT_FOUND");
  }

  async function listRoutines(
    principal: CustomerWorkflowPrincipal,
    input: ListRoutinesInput = {},
  ) {
    const workflowDefinitionId = optionalFilterId(input.workflowDefinitionId);
    const status = exactStatus(input.status, CUSTOMER_WORKFLOW_ROUTINE_STATUSES);
    const cursor = optionalCursor(input.cursor);
    const take = limit(input.limit);
    return db.$transaction(async (tx) => {
      await requireWorkflowPermission(tx, principal, "workflow.read");
      if (workflowDefinitionId) {
        await assertDefinitionFilter(tx, principal.ownerId, workflowDefinitionId);
      }
      const filter: Prisma.RoutineWhereInput = {
        ownerId: principal.ownerId,
        ...(workflowDefinitionId ? { workflowDefinitionId } : {}),
        ...(status ? { status } : {}),
      };
      const cursorRow = cursor
        ? await tx.routine.findFirst({
            where: { ...filter, id: cursor },
            select: { id: true, updatedAt: true },
          })
        : null;
      if (cursor && !cursorRow) fail("RESOURCE_NOT_FOUND");
      const rows = await tx.routine.findMany({
        where: {
          ...filter,
          ...(cursorRow
            ? {
                OR: [
                  { updatedAt: { lt: cursorRow.updatedAt } },
                  { updatedAt: cursorRow.updatedAt, id: { lt: cursorRow.id } },
                ],
              }
            : {}),
        },
        select: routineReadSelect,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: take + 1,
      });
      const hasMore = rows.length > take;
      if (hasMore) rows.pop();
      return {
        items: rows.map(projectRoutineSummary),
        nextCursor: hasMore ? rows.at(-1)?.id ?? null : null,
      };
    });
  }

  async function getRoutine(
    principal: CustomerWorkflowPrincipal,
    input: GetRoutineInput,
  ) {
    const routineId = requiredString(input?.routineId);
    return db.$transaction(async (tx) => {
      await requireWorkflowPermission(tx, principal, "workflow.read");
      const row = await tx.routine.findFirst({
        where: { id: routineId, ownerId: principal.ownerId },
        select: routineReadSelect,
      });
      if (!row) fail("RESOURCE_NOT_FOUND");
      const predecessors: ReturnType<typeof projectRoutineSummary>[] = [];
      const seen = new Set<string>([row.id]);
      let predecessorId = row.supersedesRoutineId;
      while (predecessorId) {
        if (seen.has(predecessorId) || seen.size > MAX_LIMIT) fail("AUTHORITY_UNAVAILABLE");
        seen.add(predecessorId);
        const predecessor = await tx.routine.findFirst({
          where: {
            id: predecessorId,
            ownerId: principal.ownerId,
            workflowDefinitionId: row.workflowDefinitionId,
            routineKey: row.routineKey,
          },
          select: routineReadSelect,
        });
        if (!predecessor) fail("AUTHORITY_UNAVAILABLE");
        predecessors.push(projectRoutineSummary(predecessor));
        predecessorId = predecessor.supersedesRoutineId;
      }
      return { routine: projectRoutine(row), predecessors };
    });
  }

  async function listRoutineRuns(
    principal: CustomerWorkflowPrincipal,
    input: ListRoutineRunsInput,
  ) {
    const parent = exactlyOneParentFilter(input ?? {});
    const status = exactStatus(input?.status, CUSTOMER_WORKFLOW_RUN_STATUSES);
    const cursor = optionalCursor(input?.cursor);
    const take = limit(input?.limit);
    return db.$transaction(async (tx) => {
      await requireWorkflowPermission(tx, principal, "workflow.read");
      if (parent.routineId) await assertRoutineFilter(tx, principal.ownerId, parent.routineId);
      if (parent.workflowDefinitionId) {
        await assertDefinitionFilter(tx, principal.ownerId, parent.workflowDefinitionId);
      }
      const filter: Prisma.RoutineRunWhereInput = {
        ownerId: principal.ownerId,
        ...(parent.routineId ? { routineId: parent.routineId } : {}),
        ...(parent.workflowDefinitionId
          ? { workflowDefinitionId: parent.workflowDefinitionId }
          : {}),
        ...(status ? { status } : {}),
      };
      const cursorRow = cursor
        ? await tx.routineRun.findFirst({
            where: { ...filter, id: cursor },
            select: { id: true, createdAt: true },
          })
        : null;
      if (cursor && !cursorRow) fail("RESOURCE_NOT_FOUND");
      const rows = await tx.routineRun.findMany({
        where: {
          ...filter,
          ...(cursorRow
            ? {
                OR: [
                  { createdAt: { lt: cursorRow.createdAt } },
                  { createdAt: cursorRow.createdAt, id: { lt: cursorRow.id } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          routineId: true,
          routineKey: true,
          workflowDefinitionId: true,
          workflowRevisionId: true,
          contactJourneyStateId: true,
          triggerKind: true,
          scheduledFor: true,
          status: true,
          currentStepKey: true,
          rowRevision: true,
          simulated: true,
          reservedCredits: true,
          settledCredits: true,
          summaryJson: true,
          blockReason: true,
          errorCode: true,
          startedAt: true,
          finishedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: take + 1,
      });
      const hasMore = rows.length > take;
      if (hasMore) rows.pop();
      return {
        items: rows.map(({ summaryJson, ...row }) => ({
          ...row,
          status: storedStatus(row.status, CUSTOMER_WORKFLOW_RUN_STATUSES),
          summary: safeRunSummary(summaryJson),
        })),
        nextCursor: hasMore ? rows.at(-1)?.id ?? null : null,
      };
    });
  }

  async function getContactJourneyStates(
    principal: CustomerWorkflowPrincipal,
    input: GetContactJourneyStatesInput,
  ) {
    const parent = exactlyOneParentFilter(input ?? {});
    const status = exactStatus(input?.status, CUSTOMER_WORKFLOW_JOURNEY_STATUSES);
    const cursor = optionalCursor(input?.cursor);
    const take = limit(input?.limit);
    return db.$transaction(async (tx) => {
      await requireWorkflowPermission(tx, principal, "workflow.read");
      if (parent.routineId) await assertRoutineFilter(tx, principal.ownerId, parent.routineId);
      if (parent.workflowDefinitionId) {
        await assertDefinitionFilter(tx, principal.ownerId, parent.workflowDefinitionId);
      }
      const filter: Prisma.ContactJourneyStateWhereInput = {
        ownerId: principal.ownerId,
        ...(parent.routineId ? { routineId: parent.routineId } : {}),
        ...(parent.workflowDefinitionId
          ? { workflowDefinitionId: parent.workflowDefinitionId }
          : {}),
        ...(status ? { status } : {}),
      };
      const cursorRow = cursor
        ? await tx.contactJourneyState.findFirst({
            where: { ...filter, id: cursor },
            select: { id: true, updatedAt: true },
          })
        : null;
      if (cursor && !cursorRow) fail("RESOURCE_NOT_FOUND");
      const rows = await tx.contactJourneyState.findMany({
        where: {
          ...filter,
          ...(cursorRow
            ? {
                OR: [
                  { updatedAt: { lt: cursorRow.updatedAt } },
                  { updatedAt: cursorRow.updatedAt, id: { lt: cursorRow.id } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          contact: { select: { id: true, name: true } },
          workflowDefinitionId: true,
          workflowRevisionId: true,
          routineId: true,
          status: true,
          currentStepKey: true,
          nextEligibleAt: true,
          waitGeneration: true,
          lastRoutineRunId: true,
          lastRoutineRun: {
            select: {
              id: true,
              status: true,
              blockReason: true,
              errorCode: true,
              startedAt: true,
              finishedAt: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          rowRevision: true,
          enrolledAt: true,
          terminalAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: take + 1,
      });
      const hasMore = rows.length > take;
      if (hasMore) rows.pop();
      return {
        items: rows.map((row) => ({
          ...row,
          status: storedStatus(row.status, CUSTOMER_WORKFLOW_JOURNEY_STATUSES),
          lastRoutineRun: row.lastRoutineRun
            ? {
                ...row.lastRoutineRun,
                status: storedStatus(
                  row.lastRoutineRun.status,
                  CUSTOMER_WORKFLOW_RUN_STATUSES,
                ),
              }
            : null,
        })),
        nextCursor: hasMore ? rows.at(-1)?.id ?? null : null,
      };
    });
  }

  async function listBusinessHoursPolicies(
    principal: CustomerWorkflowPrincipal,
    input: ListBusinessHoursPoliciesInput = {},
  ) {
    const status = exactStatus(
      input.status,
      CUSTOMER_WORKFLOW_BUSINESS_HOURS_POLICY_STATUSES,
    );
    const cursor = optionalCursor(input.cursor);
    const take = limit(input.limit);
    return db.$transaction(async (tx) => {
      await requireWorkflowPermission(tx, principal, "workflow.read");
      const filter: Prisma.BusinessHoursPolicyWhereInput = {
        ownerId: principal.ownerId,
        ...(status ? { status } : {}),
      };
      const cursorRow = cursor
        ? await tx.businessHoursPolicy.findFirst({
            where: { ...filter, id: cursor },
            select: { id: true, updatedAt: true },
          })
        : null;
      if (cursor && !cursorRow) fail("RESOURCE_NOT_FOUND");
      const rows = await tx.businessHoursPolicy.findMany({
        where: {
          ...filter,
          ...(cursorRow
            ? {
                OR: [
                  { updatedAt: { lt: cursorRow.updatedAt } },
                  { updatedAt: cursorRow.updatedAt, id: { lt: cursorRow.id } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          policyKey: true,
          revision: true,
          supersedesPolicyId: true,
          name: true,
          timeZone: true,
          status: true,
          rowRevision: true,
          archivedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: take + 1,
      });
      const hasMore = rows.length > take;
      if (hasMore) rows.pop();
      return {
        items: rows.map((row) => ({
          ...row,
          status: storedStatus(
            row.status,
            CUSTOMER_WORKFLOW_BUSINESS_HOURS_POLICY_STATUSES,
          ),
        })),
        nextCursor: hasMore ? rows.at(-1)?.id ?? null : null,
      };
    });
  }

  async function getBusinessHoursPolicy(
    principal: CustomerWorkflowPrincipal,
    input: GetBusinessHoursPolicyInput,
  ) {
    const businessHoursPolicyId = requiredString(input?.businessHoursPolicyId);
    return db.$transaction(async (tx) => {
      await requireWorkflowPermission(tx, principal, "workflow.read");
      const row = await tx.businessHoursPolicy.findFirst({
        where: { id: businessHoursPolicyId, ownerId: principal.ownerId },
        select: {
          id: true,
          policyKey: true,
          revision: true,
          supersedesPolicyId: true,
          name: true,
          timeZone: true,
          weeklyWindowsJson: true,
          status: true,
          rowRevision: true,
          contentHash: true,
          archivedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!row) fail("RESOURCE_NOT_FOUND");
      const canonical = canonicalizeBusinessHoursPolicy({
        timeZone: row.timeZone,
        weeklyWindows: row.weeklyWindowsJson,
      });
      if (!canonical.ok || canonical.value.contentHash !== row.contentHash) {
        fail("AUTHORITY_UNAVAILABLE");
      }
      return {
        id: row.id,
        policyKey: row.policyKey,
        revision: row.revision,
        supersedesPolicyId: row.supersedesPolicyId,
        name: row.name,
        timeZone: row.timeZone,
        status: storedStatus(
          row.status,
          CUSTOMER_WORKFLOW_BUSINESS_HOURS_POLICY_STATUSES,
        ),
        weeklyWindows: canonical.value.weeklyWindowsJson,
        rowRevision: row.rowRevision,
        archivedAt: row.archivedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }

  function dependencyResolver(
    tx: Prisma.TransactionClient,
    ownerId: string,
  ): WorkflowDependencyResolver {
    return async (input) => {
      if (input.ownerId !== ownerId) return null;
      if (input.kind === "business_hours_policy") {
        const policy = await tx.businessHoursPolicy.findFirst({
          where: { id: input.sourceRef, ownerId, status: { in: ["published", "archived"] } },
          select: {
            id: true,
            ownerId: true,
            revision: true,
            contentHash: true,
            timeZone: true,
            weeklyWindowsJson: true,
          },
        });
        const canonical = policy
          ? canonicalizeBusinessHoursPolicy({
              timeZone: policy.timeZone,
              weeklyWindows: policy.weeklyWindowsJson,
            })
          : null;
        if (!policy || !canonical?.ok || canonical.value.contentHash !== policy.contentHash) {
          return null;
        }
        return policy
          ? {
              ownerId: policy.ownerId,
              kind: input.kind,
              resourceId: policy.id,
              resourceRevision: policy.revision,
              contentHash: policy.contentHash,
            }
          : null;
      }
      const template = await tx.customerMessageTemplateVersion.findFirst({
        where: { id: input.sourceRef, ownerId },
        select: { id: true, ownerId: true, revision: true, contentHash: true },
      });
      return template
        ? {
            ownerId: template.ownerId,
            kind: input.kind,
            resourceId: template.id,
            resourceRevision: template.revision,
            contentHash: template.contentHash,
          }
        : null;
    };
  }

  async function compile(
    tx: Prisma.TransactionClient,
    ownerId: string,
    rulesSource: unknown,
  ): Promise<WorkflowCompilation> {
    const source = workflowRulesSource(rulesSource);
    const result = await compileWorkflowSource(
      { ownerId, source },
      dependencyResolver(tx, ownerId),
    );
    if (result.ok) {
      return {
        formatVersion: result.formatVersion,
        compiledRuleJson: result.compiledRuleJson,
        dependencyManifestJson: result.dependencyManifestJson,
        dependencyHash: result.dependencyHash,
        compilerVersion: result.compilerVersion,
        contentHash: result.contentHash,
        validationState: result.validationState,
        validationErrorsJson: [],
      };
    }
    const dependencyManifestJson: unknown[] = [];
    return {
      formatVersion: WORKFLOW_FORMAT_VERSION,
      compiledRuleJson: {},
      dependencyManifestJson,
      dependencyHash: canonicalHash(
        "fikirtive-workflow-dependencies/v1",
        dependencyManifestJson,
      ),
      compilerVersion: WORKFLOW_COMPILER_VERSION,
      contentHash: canonicalHash("fikirtive-workflow-invalid-content/v1", {
        source,
        validationState: result.validationState,
        errors: result.errors,
      }),
      validationState: result.validationState,
      validationErrorsJson: result.errors,
    };
  }

  async function assertLiveRevisionDependencies(
    tx: Prisma.TransactionClient,
    ownerId: string,
    workflowRevision: {
      rulesSource: string;
      compiledRuleJson: unknown;
      dependencyManifestJson: unknown;
      dependencyHash: string;
      compilerVersion: string;
      contentHash: string;
      validationState: string;
    },
  ): Promise<void> {
    const current = await compile(tx, ownerId, workflowRevision.rulesSource);
    if (
      workflowRevision.validationState !== "valid" ||
      current.validationState !== "valid" ||
      current.compilerVersion !== workflowRevision.compilerVersion ||
      current.contentHash !== workflowRevision.contentHash ||
      current.dependencyHash !== workflowRevision.dependencyHash ||
      canonicalJson(current.compiledRuleJson) !== canonicalJson(workflowRevision.compiledRuleJson) ||
      canonicalJson(current.dependencyManifestJson) !==
        canonicalJson(workflowRevision.dependencyManifestJson)
    ) {
      fail("AUTHORITY_UNAVAILABLE");
    }
  }

  async function assertLiveRoutineScope(
    tx: Prisma.TransactionClient,
    ownerId: string,
    value: unknown,
  ): Promise<void> {
    const scope = canonicalizeRoutineScope(value);
    if (!scope) fail("AUTHORITY_UNAVAILABLE");
    const [contacts, segments] = await Promise.all([
      tx.contact.count({ where: { ownerId, id: { in: scope.contactIds } } }),
      tx.segment.count({
        where: { ownerId, id: { in: scope.segmentIds }, deletedAt: null },
      }),
    ]);
    if (contacts !== scope.contactIds.length || segments !== scope.segmentIds.length) {
      fail("AUTHORITY_UNAVAILABLE");
    }
    for (const channelScope of scope.channelScopes) {
      if (channelScope.providerConnectionId === null) continue;
      const connection = await tx.channelConnection.findFirst({
        where: {
          id: channelScope.providerConnectionId,
          ownerId,
          kind: channelScope.channel,
          status: "active",
        },
        select: { id: true },
      });
      if (!connection) fail("AUTHORITY_UNAVAILABLE");
    }
  }

  async function createWorkflowDefinition(
    principal: CustomerWorkflowPrincipal,
    input: CreateWorkflowDefinitionInput,
  ) {
    const slug = workflowDefinitionSlug(input?.slug);
    const name = requiredString(input?.name, 256);
    if (input?.definitionKind !== "rule" && input?.definitionKind !== "journey") {
      fail("INVALID_ARGUMENT");
    }
    if (input?.originKind !== "custom" && input?.originKind !== "inbox_recipe") {
      fail("INVALID_ARGUMENT");
    }
    const recipeKey = input.recipeKey == null ? null : requiredToken(input.recipeKey);
    const recipeCatalogVersion =
      input.recipeCatalogVersion == null ? null : requiredString(input.recipeCatalogVersion, 128);
    if (input.originKind === "inbox_recipe" && (!recipeKey || !recipeCatalogVersion)) {
      fail("INVALID_ARGUMENT");
    }
    if (input.originKind === "custom" && (recipeKey !== null || recipeCatalogVersion !== null)) {
      fail("INVALID_ARGUMENT");
    }
    return db.$transaction(async (tx) => {
      const membership = await requireWorkflowPermission(tx, principal, "workflow.manage");
      const row = await tx.workflowDefinition.create({
        data: {
          id: issueId(),
          ownerId: principal.ownerId,
          slug,
          name,
          definitionKind: input.definitionKind,
          originKind: input.originKind,
          recipeKey,
          recipeCatalogVersion,
          status: "draft",
          createdByMembershipId: membership.id,
        },
      });
      return { ok: true, resource: row, change: { id: row.id, revision: row.rowRevision, kind: "created" } } as const;
    });
  }

  async function getWorkflowDefinition(
    principal: CustomerWorkflowPrincipal,
    input: WorkflowDefinitionIdInput,
  ) {
    const workflowDefinitionId = requiredString(input?.workflowDefinitionId);
    return db.$transaction(async (tx) => {
      await requireWorkflowPermission(tx, principal, "workflow.read");
      const row = await tx.workflowDefinition.findFirst({
        where: { id: workflowDefinitionId, ownerId: principal.ownerId },
      });
      if (!row) fail("RESOURCE_NOT_FOUND");
      return row;
    });
  }

  async function listWorkflowDefinitions(
    principal: CustomerWorkflowPrincipal,
    input: ListWorkflowDefinitionsInput = {},
  ) {
    const take = limit(input.limit);
    return db.$transaction(async (tx) => {
      await requireWorkflowPermission(tx, principal, "workflow.read");
      return tx.workflowDefinition.findMany({
        where: { ownerId: principal.ownerId },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take,
      });
    });
  }

  async function updateWorkflowDefinition(
    principal: CustomerWorkflowPrincipal,
    input: UpdateWorkflowDefinitionInput,
  ) {
    const workflowDefinitionId = requiredString(input?.workflowDefinitionId);
    const expectedRowRevision = revision(input?.expectedRowRevision);
    const name = requiredString(input?.name, 256);
    return db.$transaction(async (tx) => {
      await requireWorkflowPermission(tx, principal, "workflow.manage");
      const changed = await tx.workflowDefinition.updateMany({
        where: {
          id: workflowDefinitionId,
          ownerId: principal.ownerId,
          rowRevision: expectedRowRevision,
          status: { not: "archived" },
        },
        data: { name, rowRevision: { increment: 1 } },
      });
      if (changed.count !== 1) {
        const exists = await tx.workflowDefinition.findFirst({
          where: { id: workflowDefinitionId, ownerId: principal.ownerId },
          select: { id: true },
        });
        if (!exists) fail("RESOURCE_NOT_FOUND");
        fail("CAS_CONFLICT");
      }
      const row = await tx.workflowDefinition.findFirst({
        where: { id: workflowDefinitionId, ownerId: principal.ownerId },
      });
      if (!row) fail("RESOURCE_NOT_FOUND");
      return { ok: true, resource: row, change: { id: row.id, revision: row.rowRevision, kind: "updated" } } as const;
    });
  }

  async function archiveWorkflowDefinition(
    principal: CustomerWorkflowPrincipal,
    input: ArchiveWorkflowDefinitionInput,
  ) {
    const workflowDefinitionId = requiredString(input?.workflowDefinitionId);
    const expectedRowRevision = revision(input?.expectedRowRevision);
    return db.$transaction(async (tx) => {
      await requireWorkflowPermission(tx, principal, "workflow.manage");
      await tx.$queryRaw`SELECT "id" FROM "WorkflowDefinition" WHERE "id" = ${workflowDefinitionId} AND "ownerId" = ${principal.ownerId} FOR UPDATE`;
      const definition = await tx.workflowDefinition.findFirst({
        where: { id: workflowDefinitionId, ownerId: principal.ownerId },
      });
      if (!definition) fail("RESOURCE_NOT_FOUND");
      const active = await tx.routine.findMany({
        where: { ownerId: principal.ownerId, workflowDefinitionId, status: "active" },
        select: { id: true, routineKey: true },
        orderBy: [{ id: "asc" }],
      });
      if (!exactArchiveAcknowledgement(input.acknowledgement, active)) {
        fail("ACTIVE_ROUTINE_ACKNOWLEDGEMENT_REQUIRED");
      }
      const changed = await tx.workflowDefinition.updateMany({
        where: {
          id: workflowDefinitionId,
          ownerId: principal.ownerId,
          rowRevision: expectedRowRevision,
          status: { not: "archived" },
        },
        data: { status: "archived", archivedAt: now(), rowRevision: { increment: 1 } },
      });
      if (changed.count !== 1) fail("CAS_CONFLICT");
      const row = await tx.workflowDefinition.findFirst({
        where: { id: workflowDefinitionId, ownerId: principal.ownerId },
      });
      if (!row) fail("RESOURCE_NOT_FOUND");
      return { ok: true, resource: row, change: { id: row.id, revision: row.rowRevision, kind: "archived" } } as const;
    });
  }

  async function validateWorkflowRules(
    principal: CustomerWorkflowPrincipal,
    input: ValidateWorkflowRulesInput,
  ) {
    const workflowDefinitionId = requiredString(input?.workflowDefinitionId);
    return db.$transaction(async (tx) => {
      await requireWorkflowPermission(tx, principal, "workflow.manage");
      const definition = await tx.workflowDefinition.findFirst({
        where: { id: workflowDefinitionId, ownerId: principal.ownerId, status: { not: "archived" } },
        select: { id: true },
      });
      if (!definition) fail("RESOURCE_NOT_FOUND");
      return compile(tx, principal.ownerId, input.rulesSource);
    });
  }

  async function saveWorkflowRevision(
    principal: CustomerWorkflowPrincipal,
    input: SaveWorkflowRevisionInput,
  ) {
    const workflowDefinitionId = requiredString(input?.workflowDefinitionId);
    const rulesSource = workflowRulesSource(input?.rulesSource);
    return db.$transaction(async (tx) => {
      const membership = await requireWorkflowPermission(tx, principal, "workflow.manage");
      await tx.$queryRaw`SELECT "id" FROM "WorkflowDefinition" WHERE "id" = ${workflowDefinitionId} AND "ownerId" = ${principal.ownerId} FOR UPDATE`;
      const definition = await tx.workflowDefinition.findFirst({
        where: { id: workflowDefinitionId, ownerId: principal.ownerId, status: { not: "archived" } },
        select: { id: true },
      });
      if (!definition) fail("RESOURCE_NOT_FOUND");
      const compiled = await compile(tx, principal.ownerId, rulesSource);
      const replay = await tx.workflowRevision.findFirst({
        where: {
          ownerId: principal.ownerId,
          workflowDefinitionId,
          contentHash: compiled.contentHash,
        },
      });
      if (replay) return { ok: true, resource: replay, change: { id: replay.id, revision: replay.revision, kind: "replayed" } } as const;
      const latest = await tx.workflowRevision.findFirst({
        where: { ownerId: principal.ownerId, workflowDefinitionId },
        orderBy: [{ revision: "desc" }],
        select: { revision: true },
      });
      const row = await tx.workflowRevision.create({
        data: {
          id: issueId(),
          ownerId: principal.ownerId,
          workflowDefinitionId,
          revision: (latest?.revision ?? 0) + 1,
          formatVersion: compiled.formatVersion,
          rulesSource,
          compiledRuleJson: inputJson(compiled.compiledRuleJson),
          dependencyManifestJson: inputJson(compiled.dependencyManifestJson),
          dependencyHash: compiled.dependencyHash,
          compilerVersion: compiled.compilerVersion,
          contentHash: compiled.contentHash,
          validationState: compiled.validationState,
          validationErrorsJson: inputJson(compiled.validationErrorsJson),
          createdByMembershipId: membership.id,
        },
      });
      return { ok: true, resource: row, change: { id: row.id, revision: row.revision, kind: "saved" } } as const;
    });
  }

  async function listWorkflowRevisions(
    principal: CustomerWorkflowPrincipal,
    input: ListWorkflowRevisionsInput,
  ) {
    const workflowDefinitionId = requiredString(input?.workflowDefinitionId);
    const take = limit(input?.limit);
    return db.$transaction(async (tx) => {
      await requireWorkflowPermission(tx, principal, "workflow.read");
      const definition = await tx.workflowDefinition.findFirst({
        where: { id: workflowDefinitionId, ownerId: principal.ownerId },
        select: { id: true },
      });
      if (!definition) fail("RESOURCE_NOT_FOUND");
      return tx.workflowRevision.findMany({
        where: { ownerId: principal.ownerId, workflowDefinitionId },
        orderBy: [{ revision: "desc" }, { id: "desc" }],
        take,
      });
    });
  }

  async function publishWorkflowRevision(
    principal: CustomerWorkflowPrincipal,
    input: PublishWorkflowRevisionInput,
  ) {
    const workflowDefinitionId = requiredString(input?.workflowDefinitionId);
    const workflowRevisionId = requiredString(input?.workflowRevisionId);
    const expectedRowRevision = revision(input?.expectedRowRevision);
    return db.$transaction(async (tx) => {
      await requireWorkflowPermission(tx, principal, "workflow.manage");
      const row = await tx.workflowRevision.findFirst({
        where: {
          id: workflowRevisionId,
          ownerId: principal.ownerId,
          workflowDefinitionId,
          validationState: "valid",
        },
      });
      if (!row) fail("RESOURCE_NOT_FOUND");
      await assertLiveRevisionDependencies(tx, principal.ownerId, row);
      const changed = await tx.workflowDefinition.updateMany({
        where: {
          id: workflowDefinitionId,
          ownerId: principal.ownerId,
          rowRevision: expectedRowRevision,
          status: { not: "archived" },
        },
        data: { currentRevision: row.revision, status: "published", rowRevision: { increment: 1 } },
      });
      if (changed.count !== 1) fail("CAS_CONFLICT");
      const definition = await tx.workflowDefinition.findFirst({
        where: { id: workflowDefinitionId, ownerId: principal.ownerId },
      });
      if (!definition) fail("RESOURCE_NOT_FOUND");
      return { ok: true, resource: definition, change: { id: definition.id, revision: definition.rowRevision, kind: "published" } } as const;
    });
  }

  function authorizationMaterial(
    routine: {
      ownerId: string;
      routineKey: string;
      workflowDefinitionId: string;
      workflowRevisionId: string;
      scopeJson: unknown;
      maxCreditsPerRun: number;
      maxCreditsPerMonth: number;
      summaryPolicyJson: unknown;
      authorizationRevision: number;
      expiresAt: Date | null;
    },
    workflowRevision: { revision: number; contentHash: string; dependencyHash: string },
  ): RoutineAuthorizationMaterial {
    return {
      ownerId: routine.ownerId,
      routineKey: routine.routineKey,
      workflowDefinitionId: routine.workflowDefinitionId,
      workflowRevisionId: routine.workflowRevisionId,
      workflowRevision: workflowRevision.revision,
      workflowContentHash: workflowRevision.contentHash,
      dependencyHash: workflowRevision.dependencyHash,
      scopeJson: routine.scopeJson,
      maxCreditsPerRun: routine.maxCreditsPerRun,
      maxCreditsPerMonth: routine.maxCreditsPerMonth,
      expiresAt: routine.expiresAt,
      summaryPolicyJson: routine.summaryPolicyJson,
      authorizationRevision: routine.authorizationRevision,
    };
  }

  async function createRoutineDraft(
    principal: CustomerWorkflowPrincipal,
    input: CreateRoutineDraftInput,
  ) {
    const workflowDefinitionId = requiredString(input?.workflowDefinitionId);
    const workflowRevisionId = requiredString(input?.workflowRevisionId);
    const routineKey = requiredToken(input?.routineKey);
    const maxCreditsPerRun = nonNegative(input?.maxCreditsPerRun);
    const maxCreditsPerMonth = nonNegative(input?.maxCreditsPerMonth);
    const expiresAt = optionalDate(input?.expiresAt);
    const scopeHash = routineScopeHash(input?.scopeJson);
    const summaryPolicy = summaryPolicyJson(input?.summaryPolicyJson);
    return db.$transaction(async (tx) => {
      const membership = await requireWorkflowPermission(tx, principal, "workflow.manage");
      const definition = await tx.workflowDefinition.findFirst({
        where: {
          id: workflowDefinitionId,
          ownerId: principal.ownerId,
          status: { not: "archived" },
        },
        select: { id: true },
      });
      if (!definition) fail("RESOURCE_NOT_FOUND");
      // $executeRaw: pg_advisory_xact_lock returns void, which $queryRaw cannot deserialize.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`c7-routine-key:${principal.ownerId}:${workflowDefinitionId}:${routineKey}`}, 0))`;
      const existingRoutineKey = await tx.routine.findFirst({
        where: { ownerId: principal.ownerId, workflowDefinitionId, routineKey },
        select: { id: true },
      });
      if (existingRoutineKey) fail("CAS_CONFLICT");
      const workflowRevision = await tx.workflowRevision.findFirst({
        where: {
          id: workflowRevisionId,
          ownerId: principal.ownerId,
          workflowDefinitionId,
          validationState: "valid",
        },
        select: { id: true },
      });
      if (!workflowRevision) fail("RESOURCE_NOT_FOUND");
      const row = await tx.routine.create({
        data: {
          id: issueId(),
          ownerId: principal.ownerId,
          workflowDefinitionId,
          workflowRevisionId,
          routineKey,
          status: "draft",
          scopeJson: inputJson(input.scopeJson),
          scopeHash,
          maxCreditsPerRun,
          maxCreditsPerMonth,
          summaryPolicyJson: summaryPolicy,
          authorizationRevision: 1,
          expiresAt,
          killSwitchEngaged: false,
          createdByMembershipId: membership.id,
        },
      });
      return { ok: true, resource: row, change: { id: row.id, revision: row.rowRevision, kind: "routine_draft_created" } } as const;
    });
  }

  async function activateRoutine(
    principal: CustomerWorkflowPrincipal,
    input: ActivateRoutineInput,
  ) {
    const routineId = requiredString(input?.routineId);
    const expectedRowRevision = revision(input?.expectedRowRevision);
    return db.$transaction(async (tx) => {
      const membership = await requireWorkflowPermission(tx, principal, "workflow.manage");
      await tx.$queryRaw`SELECT "id" FROM "Routine" WHERE "id" = ${routineId} AND "ownerId" = ${principal.ownerId} FOR UPDATE`;
      const routine = await tx.routine.findFirst({
        where: { id: routineId, ownerId: principal.ownerId },
      });
      if (!routine) fail("RESOURCE_NOT_FOUND");
      if (
        routine.status !== "draft" ||
        routine.supersedesRoutineId !== null ||
        routine.rowRevision !== expectedRowRevision ||
        routine.killSwitchEngaged
      ) {
        fail("CAS_CONFLICT");
      }
      const definition = await tx.workflowDefinition.findFirst({
        where: {
          id: routine.workflowDefinitionId,
          ownerId: principal.ownerId,
          status: { not: "archived" },
        },
        select: { id: true },
      });
      if (!definition) fail("AUTHORITY_UNAVAILABLE");
      const workflowRevision = await tx.workflowRevision.findFirst({
        where: {
          id: routine.workflowRevisionId,
          ownerId: principal.ownerId,
          workflowDefinitionId: routine.workflowDefinitionId,
          validationState: "valid",
        },
      });
      if (!workflowRevision) fail("AUTHORITY_UNAVAILABLE");
      await assertLiveRevisionDependencies(tx, principal.ownerId, workflowRevision);
      await assertLiveRoutineScope(tx, principal.ownerId, routine.scopeJson);
      if (routine.maxCreditsPerRun !== 0 || routine.maxCreditsPerMonth !== 0) {
        fail("AUTHORITY_UNAVAILABLE");
      }
      const material = authorizationMaterial(routine, workflowRevision);
      const routineAuthorizationHash = authorizationHash(material);
      const changed = await tx.routine.updateMany({
        where: {
          id: routineId,
          ownerId: principal.ownerId,
          rowRevision: expectedRowRevision,
          status: "draft",
          killSwitchEngaged: false,
        },
        data: {
          status: "active",
          authorizationHash: routineAuthorizationHash,
          authorizedByMembershipId: membership.id,
          authorizedAt: now(),
          rowRevision: { increment: 1 },
        },
      });
      if (changed.count !== 1) fail("CAS_CONFLICT");
      const row = await tx.routine.findFirst({ where: { id: routineId, ownerId: principal.ownerId } });
      if (!row) fail("RESOURCE_NOT_FOUND");
      return { ok: true, resource: row, change: { id: row.id, revision: row.rowRevision, kind: "routine_activated" } } as const;
    });
  }

  async function killRoutine(principal: CustomerWorkflowPrincipal, input: KillRoutineInput) {
    const routineId = requiredString(input?.routineId);
    const expectedRowRevision = revision(input?.expectedRowRevision);
    const reasonCode = requiredToken(input?.reasonCode);
    return db.$transaction(async (tx) => {
      const membership = await requireWorkflowPermission(tx, principal, "workflow.manage");
      await tx.$queryRaw`SELECT "id" FROM "Routine" WHERE "id" = ${routineId} AND "ownerId" = ${principal.ownerId} FOR UPDATE`;
      const current = await tx.routine.findFirst({ where: { id: routineId, ownerId: principal.ownerId } });
      if (!current) fail("RESOURCE_NOT_FOUND");
      const changed = await tx.routine.updateMany({
        where: {
          id: routineId,
          ownerId: principal.ownerId,
          rowRevision: expectedRowRevision,
          killSwitchEngaged: false,
          status: { in: ["draft", "active", "paused"] },
        },
        data: {
          killSwitchEngaged: true,
          status: "paused",
          killedByMembershipId: membership.id,
          killedAt: now(),
          killReasonCode: reasonCode,
          rowRevision: { increment: 1 },
        },
      });
      if (changed.count !== 1) fail("CAS_CONFLICT");
      const row = await tx.routine.findFirst({ where: { id: routineId, ownerId: principal.ownerId } });
      if (!row) fail("RESOURCE_NOT_FOUND");
      return { ok: true, resource: row, change: { id: row.id, revision: row.rowRevision, kind: "routine_killed" } } as const;
    });
  }

  async function reauthorizeRoutine(
    principal: CustomerWorkflowPrincipal,
    input: ReauthorizeRoutineInput,
  ) {
    const routineId = requiredString(input?.routineId);
    const expectedRowRevision = revision(input?.expectedRowRevision);
    const workflowRevisionId = requiredString(input?.workflowRevisionId);
    const maxCreditsPerRun = nonNegative(input?.maxCreditsPerRun);
    const maxCreditsPerMonth = nonNegative(input?.maxCreditsPerMonth);
    if (maxCreditsPerRun !== 0 || maxCreditsPerMonth !== 0) fail("AUTHORITY_UNAVAILABLE");
    const expiresAt = optionalDate(input?.expiresAt);
    const scopeHash = routineScopeHash(input?.scopeJson);
    const summaryPolicy = summaryPolicyJson(input?.summaryPolicyJson);
    return db.$transaction(async (tx) => {
      const membership = await requireWorkflowPermission(tx, principal, "workflow.manage");
      await tx.$queryRaw`SELECT "id" FROM "Routine" WHERE "id" = ${routineId} AND "ownerId" = ${principal.ownerId} FOR UPDATE`;
      const old = await tx.routine.findFirst({ where: { id: routineId, ownerId: principal.ownerId } });
      if (!old) fail("RESOURCE_NOT_FOUND");
      if (
        old.rowRevision !== expectedRowRevision ||
        old.authorizationHash === null ||
        (old.status !== "active" && old.status !== "paused")
      ) {
        fail("CAS_CONFLICT");
      }
      const definition = await tx.workflowDefinition.findFirst({
        where: {
          id: old.workflowDefinitionId,
          ownerId: principal.ownerId,
          status: { not: "archived" },
        },
        select: { id: true },
      });
      if (!definition) fail("AUTHORITY_UNAVAILABLE");
      const workflowRevision = await tx.workflowRevision.findFirst({
        where: {
          id: workflowRevisionId,
          ownerId: principal.ownerId,
          workflowDefinitionId: old.workflowDefinitionId,
          validationState: "valid",
        },
      });
      if (!workflowRevision) fail("RESOURCE_NOT_FOUND");
      await assertLiveRevisionDependencies(tx, principal.ownerId, workflowRevision);
      await assertLiveRoutineScope(tx, principal.ownerId, input.scopeJson);
      const nextId = issueId();
      const draft = {
        ownerId: principal.ownerId,
        routineKey: old.routineKey,
        workflowDefinitionId: old.workflowDefinitionId,
        workflowRevisionId,
        scopeJson: input.scopeJson,
        maxCreditsPerRun,
        maxCreditsPerMonth,
        summaryPolicyJson: input.summaryPolicyJson,
        authorizationRevision: old.authorizationRevision + 1,
        expiresAt,
      };
      const material = authorizationMaterial(draft, workflowRevision);
      const routineAuthorizationHash = authorizationHash(material);
      const revoked = await tx.routine.updateMany({
        where: {
          id: old.id,
          ownerId: principal.ownerId,
          rowRevision: expectedRowRevision,
          status: { in: ["active", "paused"] },
        },
        data: { status: "revoked", rowRevision: { increment: 1 } },
      });
      if (revoked.count !== 1) fail("CAS_CONFLICT");
      const row = await tx.routine.create({
        data: {
          id: nextId,
          ownerId: principal.ownerId,
          workflowDefinitionId: old.workflowDefinitionId,
          workflowRevisionId,
          routineKey: old.routineKey,
          supersedesRoutineId: old.id,
          status: "active",
          scopeJson: inputJson(input.scopeJson),
          scopeHash,
          maxCreditsPerRun,
          maxCreditsPerMonth,
          summaryPolicyJson: summaryPolicy,
          authorizationRevision: old.authorizationRevision + 1,
          authorizationHash: routineAuthorizationHash,
          authorizedByMembershipId: membership.id,
          authorizedAt: now(),
          expiresAt,
          killSwitchEngaged: false,
          createdByMembershipId: membership.id,
        },
      });
      return { ok: true, resource: row, change: { id: row.id, revision: row.rowRevision, kind: "routine_reauthorized" } } as const;
    });
  }

  async function createWorkflowRun(
    context: CustomerWorkflowWorkerContext,
    input: CreateWorkflowRunInput,
  ): Promise<CreateRoutineRunResult> {
    const ownerId = await requireWorker(context);
    const routineId = requiredString(input?.routineId);
    try {
      return await db.$transaction(async (tx) => {
        if (input.trigger?.kind === "customer_message") {
          const message = await tx.customerMessage.findFirst({
            where: {
              id: input.trigger.triggerEventRef,
              ownerId,
              sourceEventKey: input.trigger.sourceEventKey,
              direction: "inbound",
              actorKind: "customer",
            },
            select: { id: true },
          });
          if (!message) fail("AUTHORITY_UNAVAILABLE");
        }
        return createRoutineRunInTransaction(tx, {
          id: issueId(),
          ownerId,
          routineId,
          trigger: input.trigger,
          trustedTriggerPayload: input.trustedTriggerPayload,
          now: now(),
        });
      });
    } catch (error) {
      return translateCoreError(error);
    }
  }

  async function transitionWorkflowRun(
    context: CustomerWorkflowWorkerContext,
    input: TransitionWorkflowRunInput,
  ): Promise<RoutineRunRecord> {
    const ownerId = await requireWorker(context);
    try {
      return await transitionRoutineRun(db, { ...input, ownerId, now: now() });
    } catch (error) {
      return translateCoreError(error);
    }
  }

  async function requireWorker(context: CustomerWorkflowWorkerContext): Promise<string> {
    if (!options.resolveWorkerContext) fail("AUTHORITY_UNAVAILABLE");
    const verified = await options.resolveWorkerContext(context);
    if (!verified) fail("NOT_AUTHORIZED");
    requiredString(verified.queueJobId);
    requiredString(verified.leaseId);
    requiredString(verified.fencingToken);
    return requiredString(verified.ownerId);
  }

  async function enrollWorkflowJourney(
    context: CustomerWorkflowWorkerContext,
    input: EnrollWorkflowJourneyInput,
  ) {
    const ownerId = await requireWorker(context);
    try {
      return await enrollContactJourney(db, {
        ...input,
        id: issueId(),
        ownerId,
        now: now(),
      });
    } catch (error) {
      return translateCoreError(error);
    }
  }

  async function advanceWorkflowJourney(
    context: CustomerWorkflowWorkerContext,
    input: AdvanceWorkflowJourneyInput,
  ) {
    const ownerId = await requireWorker(context);
    try {
      return await advanceContactJourney(db, { ...input, ownerId, now: now() });
    } catch (error) {
      return translateCoreError(error);
    }
  }

  async function enterWorkflowJourneyWait(
    context: CustomerWorkflowWorkerContext,
    input: EnterWorkflowJourneyWaitInput,
  ) {
    const ownerId = await requireWorker(context);
    try {
      return await enterJourneyWait(db, { ...input, ownerId, now: now() });
    } catch (error) {
      return translateCoreError(error);
    }
  }

  async function createWorkflowJourneyDueRun(
    context: CustomerWorkflowWorkerContext,
    input: CreateWorkflowJourneyDueRunInput,
  ) {
    const ownerId = await requireWorker(context);
    try {
      return await createJourneyDueRun(db, {
        ...input,
        ownerId,
        routineRunId: issueId(),
        now: now(),
      });
    } catch (error) {
      return translateCoreError(error);
    }
  }

  function canonicalizeWorkflowBusinessHoursPolicy(input: {
    timeZone: unknown;
    weeklyWindows: unknown;
  }) {
    return canonicalizeBusinessHoursPolicy(input);
  }

  async function evaluateWorkflowBusinessHours(
    context: CustomerWorkflowWorkerContext,
    input: EvaluateWorkflowBusinessHoursInput,
  ) {
    const ownerId = await requireWorker(context);
    const workflowRevisionId = requiredString(input?.workflowRevisionId);
    const conditionIndex = nonNegative(input?.conditionIndex);
    if (conditionIndex >= 16) fail("INVALID_ARGUMENT");
    return db.$transaction(async (tx) => {
      const workflowRevision = await tx.workflowRevision.findFirst({
        where: { id: workflowRevisionId, ownerId, validationState: "valid" },
      });
      if (!workflowRevision) fail("RESOURCE_NOT_FOUND");
      await assertLiveRevisionDependencies(tx, ownerId, workflowRevision);
      const compiled = workflowRevision.compiledRuleJson;
      if (!isRecord(compiled) || !Array.isArray(compiled.conditions)) {
        fail("AUTHORITY_UNAVAILABLE");
      }
      const condition = compiled.conditions[conditionIndex];
      if (
        !isRecord(condition) ||
        condition.type !== "outside_business_hours" ||
        !isRecord(condition.dependency) ||
        condition.dependency.kind !== "business_hours_policy" ||
        typeof condition.dependency.resourceId !== "string" ||
        !Number.isSafeInteger(condition.dependency.resourceRevision) ||
        typeof condition.dependency.contentHash !== "string"
      ) {
        fail("AUTHORITY_UNAVAILABLE");
      }
      const expected = {
        ownerId,
        id: condition.dependency.resourceId,
        revision: condition.dependency.resourceRevision as number,
        contentHash: condition.dependency.contentHash,
      };
      const policy = await tx.businessHoursPolicy.findFirst({
        where: {
          id: expected.id,
          ownerId,
          status: { in: ["published", "archived"] },
        },
        select: {
          id: true,
          ownerId: true,
          revision: true,
          contentHash: true,
          timeZone: true,
          weeklyWindowsJson: true,
        },
      });
      const evaluation: BusinessHoursEvaluationInput = { expected, policy };
      return evaluateBusinessHours(evaluation, clock);
    });
  }

  async function dispatchWorkflowStep(
    context: CustomerWorkflowWorkerContext,
    input: DispatchWorkflowStepInput,
  ) {
    const ownerId = await requireWorker(context);
    const routineRunId = requiredString(input?.routineRunId);
    const stepKey = requiredToken(input?.stepKey);
    return db.$transaction(async (tx) => {
      const dispatchAt = now();
      let loaded: Awaited<ReturnType<typeof verifyRoutineRunAuthorityInTransaction>>;
      try {
        loaded = await verifyRoutineRunAuthorityInTransaction(tx, ownerId, routineRunId, dispatchAt);
      } catch (error) {
        return translateCoreError(error);
      }
      const revisionRow = await tx.workflowRevision.findFirst({
        where: {
          id: loaded.run.workflowRevisionId,
          ownerId,
          workflowDefinitionId: loaded.run.workflowDefinitionId,
          validationState: "valid",
        },
      });
      if (!revisionRow) fail("RESOURCE_NOT_FOUND");
      if (
        !isRecord(revisionRow.compiledRuleJson) ||
        !isRecord(revisionRow.compiledRuleJson.trigger) ||
        revisionRow.compiledRuleJson.trigger.type !== loaded.run.triggerKind
      ) {
        fail("AUTHORITY_UNAVAILABLE");
      }
      const action = compiledCustomerAction(revisionRow.compiledRuleJson, stepKey);
      if (!action) fail("AUTHORITY_UNAVAILABLE");
      const reserveUnavailableStep = async (
        reason: "workflow_dependency_unavailable" | "workflow_target_unavailable",
      ) => {
        try {
          const reservation = await reserveWorkflowStepInTransaction(tx, {
            id: issueId(),
            ownerId,
            routineRunId,
            stepKey,
            actionKind: action.action.type,
            actionPayload: action,
            actionOccurrence: null,
            target: null,
            preDispatchUnavailableReason: reason,
            now: dispatchAt,
          });
          if (reservation.execution.status !== "reserved") return reservation.execution;
          return await settleWorkflowStepInTransaction(tx, {
            ownerId,
            stepExecutionId: reservation.execution.id,
            settlement: { status: "unavailable", reasonCode: reason },
            now: dispatchAt,
          });
        } catch (error) {
          return translateCoreError(error);
        }
      };
      if (!loaded.authority.ok) {
        try {
          const blocked = await reserveWorkflowStepInTransaction(tx, {
            id: issueId(),
            ownerId,
            routineRunId,
            stepKey,
            actionKind: action.action.type,
            actionPayload: action,
            actionOccurrence: null,
            target: null,
            now: dispatchAt,
          });
          return blocked.execution;
        } catch (error) {
          return translateCoreError(error);
        }
      }
      try {
        await assertLiveRevisionDependencies(tx, ownerId, revisionRow);
      } catch (error) {
        if (prismaCode(error) === "AUTHORITY_UNAVAILABLE") {
          return reserveUnavailableStep("workflow_dependency_unavailable");
        }
        throw error;
      }
      let broadcastPurpose: "marketing" | null = null;
      if (action.action.type === "broadcast_run") {
        const template = await tx.customerMessageTemplateVersion.findFirst({
          where: {
            id: action.action.dependency.resourceId,
            ownerId,
            revision: action.action.dependency.resourceRevision,
            contentHash: action.action.dependency.contentHash,
          },
          select: { category: true, purposeClass: true },
        });
        if (!template) {
          return reserveUnavailableStep("workflow_dependency_unavailable");
        }
        broadcastPurpose = broadcastPurposeFromTemplateClassification(template);
        if (!broadcastPurpose) {
          return reserveUnavailableStep("workflow_dependency_unavailable");
        }
      }
      const scope = canonicalizeRoutineScope(loaded.routine.scopeJson);
      if (
        !scope ||
        loaded.routine.maxCreditsPerRun !== 0 ||
        loaded.routine.maxCreditsPerMonth !== 0 ||
        loaded.run.reservedCredits !== 0 ||
        loaded.run.settledCredits !== 0
      ) {
        return reserveUnavailableStep("workflow_dependency_unavailable");
      }
      if (loaded.run.triggerKind === "manual" || loaded.run.triggerKind === "schedule") {
        return reserveUnavailableStep("workflow_target_unavailable");
      }
      let contactId: string;
      let contactIdentityId: string;
      let channel: string;
      let channelScopeId: string;
      let conversationAutomationState: string | null = null;
      let actionOccurrence: WorkflowActionOccurrence;
      let businessHoursResult: ReturnType<typeof evaluateBusinessHours> | null = null;

      if (loaded.run.triggerKind === "journey_due" && loaded.run.contactJourneyStateId) {
        const journey = await tx.contactJourneyState.findFirst({
          where: {
            id: loaded.run.contactJourneyStateId,
            ownerId,
            routineId: loaded.routine.id,
            workflowRevisionId: loaded.run.workflowRevisionId,
          },
        });
        if (!journey || !journey.contactIdentityId) {
          return reserveUnavailableStep("workflow_target_unavailable");
        }
        const identity = await tx.contactIdentity.findFirst({
          where: {
            id: journey.contactIdentityId,
            contactId: journey.contactId,
            ownerId,
            deletedAt: null,
          },
          select: { id: true, contactId: true, channel: true, channelScopeId: true },
        });
        if (!identity || !identity.channelScopeId) {
          return reserveUnavailableStep("workflow_target_unavailable");
        }
        contactId = identity.contactId;
        contactIdentityId = identity.id;
        channel = identity.channel;
        channelScopeId = identity.channelScopeId;
        if (action.action.type === "conversation_reply") {
          const conversation = await tx.customerConversation.findFirst({
            where: { ownerId, contactIdentityId: identity.id },
            select: { automationState: true },
          });
          conversationAutomationState = conversation?.automationState ?? null;
        }
        actionOccurrence = {
          kind: "journey_step",
          ownerId,
          workflowDefinitionId: loaded.run.workflowDefinitionId,
          contactJourneyStateId: journey.id,
          stepKey,
        };
      } else if (
        loaded.run.triggerKind === "customer_message" &&
        loaded.run.triggerEventRef &&
        action.action.type === "conversation_reply"
      ) {
        const message = await tx.customerMessage.findFirst({
          where: { id: loaded.run.triggerEventRef, ownerId },
          select: {
            id: true,
            conversationId: true,
            direction: true,
            actorKind: true,
            sourceEventKey: true,
          },
        });
        if (
          !message ||
          typeof message.sourceEventKey !== "string" ||
          message.sourceEventKey.length === 0 ||
          message.direction !== "inbound" ||
          message.actorKind !== "customer" ||
          loaded.run.triggerOccurrenceRef !== `message:${message.sourceEventKey}`
        ) {
          return reserveUnavailableStep("workflow_target_unavailable");
        }
        const conversation = await tx.customerConversation.findFirst({
          where: { id: message.conversationId, ownerId },
          select: { id: true, contactIdentityId: true, automationState: true },
        });
        if (!conversation) return reserveUnavailableStep("workflow_target_unavailable");
        const identity = await tx.contactIdentity.findFirst({
          where: {
            id: conversation.contactIdentityId,
            ownerId,
            deletedAt: null,
          },
          select: { id: true, contactId: true, channel: true, channelScopeId: true },
        });
        if (
          !identity ||
          !identity.channelScopeId
        ) {
          return reserveUnavailableStep("workflow_target_unavailable");
        }
        const compiled = revisionRow.compiledRuleJson;
        if (!isRecord(compiled) || !Array.isArray(compiled.conditions)) {
          return reserveUnavailableStep("workflow_dependency_unavailable");
        }
        const businessHoursConditions = compiled.conditions.filter(
          (condition): condition is Prisma.JsonObject =>
            isRecord(condition) && condition.type === "outside_business_hours",
        );
        if (businessHoursConditions.length !== 1) {
          return reserveUnavailableStep("workflow_dependency_unavailable");
        }
        const condition = businessHoursConditions[0]!;
        if (
          !isRecord(condition.dependency) ||
          condition.dependency.kind !== "business_hours_policy" ||
          typeof condition.dependency.resourceId !== "string" ||
          !Number.isSafeInteger(condition.dependency.resourceRevision) ||
          typeof condition.dependency.contentHash !== "string"
        ) {
          return reserveUnavailableStep("workflow_dependency_unavailable");
        }
        const expectedPolicy = {
          ownerId,
          id: condition.dependency.resourceId,
          revision: condition.dependency.resourceRevision as number,
          contentHash: condition.dependency.contentHash,
        };
        const policy = await tx.businessHoursPolicy.findFirst({
          where: {
            id: expectedPolicy.id,
            ownerId,
            status: { in: ["published", "archived"] },
          },
          select: {
            id: true,
            ownerId: true,
            revision: true,
            contentHash: true,
            timeZone: true,
            weeklyWindowsJson: true,
          },
        });
        businessHoursResult = evaluateBusinessHours(
          { expected: expectedPolicy, policy },
          () => dispatchAt,
        );
        contactId = identity.contactId;
        contactIdentityId = identity.id;
        channel = identity.channel;
        channelScopeId = identity.channelScopeId;
        conversationAutomationState = conversation.automationState;
        actionOccurrence = {
          kind: "business_hours_auto_reply",
          ownerId,
          conversationId: conversation.id,
          customerMessageSourceEventKey: message.sourceEventKey,
          channel: identity.channel,
        };
      } else {
        return reserveUnavailableStep("workflow_target_unavailable");
      }

      const authorizedChannels = scope.channelScopes.filter((entry) => entry.channel === channel);
      if (authorizedChannels.length !== 1) {
        return reserveUnavailableStep("workflow_target_unavailable");
      }
      const providerConnectionId = authorizedChannels[0]!.providerConnectionId;
      if (providerConnectionId) {
        const connection = await tx.channelConnection.findFirst({
          where: { id: providerConnectionId, ownerId, kind: channel, status: "active" },
          select: { id: true, channelScopeId: true },
        });
        if (!connection || connection.channelScopeId !== channelScopeId) {
          return reserveUnavailableStep("workflow_target_unavailable");
        }
      }
      // $executeRaw: pg_advisory_xact_lock returns void, which $queryRaw cannot deserialize.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`c7-dispatch:${ownerId}:${routineRunId}`}, 0))`;
      const callerClass = "unconfirmed_automatic" as const;
      const purpose =
        action.action.type === "broadcast_run"
          ? broadcastPurpose!
          : "strict_classification_unavailable";
      const eligibilityInput = {
        ownerId,
        contactId,
        contactIdentityId,
        channel,
        providerConnectionId,
        purpose,
        callerClass,
      };
      let reservation: Awaited<ReturnType<typeof reserveWorkflowStepInTransaction>>;
      try {
        reservation = await reserveWorkflowStepInTransaction(tx, {
          id: issueId(),
          ownerId,
          routineRunId,
          stepKey,
          actionKind: action.action.type,
          actionPayload: action,
          actionOccurrence,
          target: {
            contactId,
            contactIdentityId,
            channel,
            providerConnectionId,
            purpose,
          },
          now: dispatchAt,
        });
      } catch (error) {
        return translateCoreError(error);
      }
      if (!reservation.shouldCallDownstream) return reservation.execution;

      const verdict =
        action.action.type === "broadcast_run"
          ? await evaluateSendEligibility(tx, {
              ownerId,
              contactId,
              contactIdentityId,
              channel,
              providerConnectionId,
              purpose: broadcastPurpose!,
              callerClass,
            })
          : unavailableConversationEligibility(dispatchAt.toISOString());
      let settlement: SettleWorkflowStepInput["settlement"];
      if (conversationAutomationState === "paused_by_human") {
        settlement = {
          status: "blocked",
          reasonCode: "HUMAN_TAKEOVER_AUTOMATION_PAUSED",
          eligibilityInput,
          eligibilityVerdict: verdict,
        };
      } else if (businessHoursResult?.status === "inside") {
        settlement = {
          status: "blocked",
          reasonCode: "BUSINESS_HOURS_INSIDE",
          eligibilityInput,
          eligibilityVerdict: verdict,
        };
      } else if (businessHoursResult?.status === "unavailable") {
        settlement = {
          status: "unavailable",
          reasonCode: `BUSINESS_HOURS_${businessHoursResult.reason}`,
          eligibilityInput,
          eligibilityVerdict: verdict,
        };
      } else if (!allAxesPass(verdict)) {
        settlement = {
          status: action.action.type === "conversation_reply" ? "unavailable" : "blocked",
          reasonCode:
            action.action.type === "conversation_reply"
              ? "CONVERSATION_STRICT_CLASSIFICATION_UNAVAILABLE"
              : firstNonPass(verdict),
          eligibilityInput,
          eligibilityVerdict: verdict,
        };
      } else {
        settlement = {
          status: "unavailable",
          reasonCode: "BROADCAST_ONE_MEMBER_SUBMIT_SEAM_UNAVAILABLE",
          eligibilityInput,
          eligibilityVerdict: verdict,
        };
      }
      try {
        return await settleWorkflowStepInTransaction(tx, {
          ownerId,
          stepExecutionId: reservation.execution.id,
          settlement,
          now: dispatchAt,
        });
      } catch (error) {
        return translateCoreError(error);
      }
    });
  }

  return {
    listRoutines,
    getRoutine,
    listRoutineRuns,
    getContactJourneyStates,
    listBusinessHoursPolicies,
    getBusinessHoursPolicy,
    createWorkflowDefinition,
    getWorkflowDefinition,
    listWorkflowDefinitions,
    updateWorkflowDefinition,
    archiveWorkflowDefinition,
    validateWorkflowRules,
    saveWorkflowRevision,
    listWorkflowRevisions,
    publishWorkflowRevision,
    createRoutineDraft,
    activateRoutine,
    killRoutine,
    reauthorizeRoutine,
    createWorkflowRun,
    transitionWorkflowRun,
    enrollWorkflowJourney,
    advanceWorkflowJourney,
    enterWorkflowJourneyWait,
    createWorkflowJourneyDueRun,
    canonicalizeWorkflowBusinessHoursPolicy,
    evaluateWorkflowBusinessHours,
    dispatchWorkflowStep,
  };
}
