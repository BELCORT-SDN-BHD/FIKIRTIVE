import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { canonicalHash, canonicalJson } from "./workflow-compiler.js";

export const WORKFLOW_ENGINE_ERROR_CODES = {
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  CAS_CONFLICT: "CAS_CONFLICT",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  RUN_TERMINAL: "RUN_TERMINAL",
  SUMMARY_REQUIRED: "SUMMARY_REQUIRED",
} as const;

export type WorkflowEngineErrorCode =
  (typeof WORKFLOW_ENGINE_ERROR_CODES)[keyof typeof WORKFLOW_ENGINE_ERROR_CODES];

export class WorkflowEngineError extends Error {
  constructor(public readonly code: WorkflowEngineErrorCode) {
    super(code);
    this.name = "WorkflowEngineError";
  }
}

/** The exact, ordered §5.2 fail-closed enumeration. Do not add policy aliases here. */
export const ROUTINE_AUTHORITY_FAILURES = [
  "kill",
  "status",
  "expired",
  "hash_drift",
  "budget_unavailable",
] as const;
export type RoutineAuthorityFailure = (typeof ROUTINE_AUTHORITY_FAILURES)[number];

export const WORKFLOW_ACTION_KINDS = [
  "conversation_reply",
  "broadcast_run",
  "wait",
  "complete",
] as const;
export type WorkflowActionKind = (typeof WORKFLOW_ACTION_KINDS)[number];

export type RoutineChannelScope = {
  channel: string;
  providerConnectionId: string | null;
};

/**
 * Conservative M2 authorization scope. Every key is required and unknown keys are denied.
 * Empty arrays and zero limits authorize nothing; they never mean "all" or "unlimited".
 */
export type RoutineAuthorizationScope = {
  actionKinds: WorkflowActionKind[];
  channelScopes: RoutineChannelScope[];
  contactIds: string[];
  segmentIds: string[];
  maxActions: number;
  maxRecipients: number;
};

export type RoutineAuthorizationMaterial = {
  ownerId: string;
  routineKey: string;
  workflowDefinitionId: string;
  workflowRevisionId: string;
  workflowRevision: number;
  workflowContentHash: string;
  dependencyHash: string;
  scopeJson: unknown;
  maxCreditsPerRun: number;
  maxCreditsPerMonth: number;
  expiresAt: Date | string | null;
  summaryPolicyJson: unknown;
  authorizationRevision: number;
};

export type RoutineAuthorizationSnapshot = {
  version: "fikirtive-routine-authorization/v1";
  ownerId: string;
  routineKey: string;
  workflowDefinitionId: string;
  workflowRevisionId: string;
  workflowRevision: number;
  workflowContentHash: string;
  dependencyHash: string;
  scopeJson: RoutineAuthorizationScope;
  maxCreditsPerRun: number;
  maxCreditsPerMonth: number;
  expiresAt: string | null;
  summaryPolicyJson: unknown;
  authorizationRevision: number;
};

export type RoutineAuthorityRow = {
  id: string;
  ownerId: string;
  routineKey: string;
  workflowDefinitionId: string;
  workflowRevisionId: string;
  status: string;
  scopeJson: unknown;
  scopeHash: string;
  maxCreditsPerRun: number;
  maxCreditsPerMonth: number;
  summaryPolicyJson: unknown;
  authorizationRevision: number;
  authorizationHash: string | null;
  authorizedByMembershipId?: string | null;
  authorizedAt?: Date | null;
  expiresAt: Date | null;
  killSwitchEngaged: boolean;
  rowRevision: number;
};

export type WorkflowRevisionAuthorityRow = {
  id: string;
  ownerId: string;
  workflowDefinitionId: string;
  revision: number;
  contentHash: string;
  dependencyHash: string;
  compiledRuleJson: unknown;
  validationState: string;
};

export type RoutineAuthorityResult =
  | {
      ok: true;
      snapshot: RoutineAuthorizationSnapshot;
      authorizationHash: string;
      scopeHash: string;
    }
  | { ok: false; reason: RoutineAuthorityFailure };

const TOKEN = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const MAX_SUMMARY_JSON_BYTES = 32 * 1024;
const TERMINAL_RUN_STATUSES = new Set(["completed", "blocked", "cancelled", "failed"]);
const RUN_TRANSITIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  queued: new Set(["running", "blocked", "cancelled", "failed"]),
  running: new Set(["waiting", "completed", "blocked", "cancelled", "failed"]),
  waiting: new Set(["running", "completed", "blocked", "cancelled", "failed"]),
};

function fail(code: WorkflowEngineErrorCode): never {
  throw new WorkflowEngineError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort(codeUnitCompare);
  const wanted = [...expected].sort(codeUnitCompare);
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compact(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f\s]/.test(value);
}

function finiteDate(value: Date | string, field: string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) fail("INVALID_ARGUMENT");
  if (field.length === 0) fail("INVALID_ARGUMENT");
  return date;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function normalizeUniqueStrings(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every(compact)) return null;
  const normalized = [...value].sort(codeUnitCompare);
  if (normalized.some((item, index) => index > 0 && item === normalized[index - 1])) return null;
  return normalized;
}

export function canonicalizeRoutineScope(value: unknown): RoutineAuthorizationScope | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "actionKinds",
      "channelScopes",
      "contactIds",
      "segmentIds",
      "maxActions",
      "maxRecipients",
    ])
  ) {
    return null;
  }

  if (!Array.isArray(value.actionKinds)) return null;
  const actions = value.actionKinds as unknown[];
  if (!actions.every((action) => (WORKFLOW_ACTION_KINDS as readonly unknown[]).includes(action))) return null;
  const actionKinds = [...(actions as WorkflowActionKind[])].sort(codeUnitCompare);
  if (actionKinds.some((item, index) => index > 0 && item === actionKinds[index - 1])) return null;

  if (!Array.isArray(value.channelScopes)) return null;
  const channelScopes: RoutineChannelScope[] = [];
  for (const entry of value.channelScopes) {
    if (!isRecord(entry) || !exactKeys(entry, ["channel", "providerConnectionId"])) return null;
    if (typeof entry.channel !== "string" || !TOKEN.test(entry.channel)) return null;
    if (entry.providerConnectionId !== null && !compact(entry.providerConnectionId)) return null;
    channelScopes.push({
      channel: entry.channel,
      providerConnectionId: entry.providerConnectionId as string | null,
    });
  }
  channelScopes.sort(
    (left, right) =>
      codeUnitCompare(left.channel, right.channel) ||
      codeUnitCompare(left.providerConnectionId ?? "", right.providerConnectionId ?? ""),
  );
  if (
    channelScopes.some(
      (entry, index) =>
        index > 0 &&
        entry.channel === channelScopes[index - 1]!.channel &&
        entry.providerConnectionId === channelScopes[index - 1]!.providerConnectionId,
    )
  ) {
    return null;
  }

  const contactIds = normalizeUniqueStrings(value.contactIds);
  const segmentIds = normalizeUniqueStrings(value.segmentIds);
  if (!contactIds || !segmentIds) return null;
  if (!nonNegativeInteger(value.maxActions) || !nonNegativeInteger(value.maxRecipients)) return null;

  return {
    actionKinds,
    channelScopes,
    contactIds,
    segmentIds,
    maxActions: value.maxActions,
    maxRecipients: value.maxRecipients,
  };
}

function validSummaryPolicy(value: unknown): boolean {
  if (!isRecord(value) || Object.keys(value).length === 0) return false;
  try {
    return new TextEncoder().encode(canonicalJson(value)).byteLength <= MAX_SUMMARY_JSON_BYTES;
  } catch {
    return false;
  }
}

export function computeRoutineScopeHash(scope: unknown): string {
  const normalized = canonicalizeRoutineScope(scope);
  if (!normalized) fail("INVALID_ARGUMENT");
  return canonicalHash("c7-routine-scope:v1", normalized);
}

export function createRoutineAuthorizationSnapshot(
  material: RoutineAuthorizationMaterial,
): RoutineAuthorizationSnapshot {
  const scopeJson = canonicalizeRoutineScope(material.scopeJson);
  if (
    !compact(material.ownerId) ||
    !compact(material.routineKey) ||
    !compact(material.workflowDefinitionId) ||
    !compact(material.workflowRevisionId) ||
    !compact(material.workflowContentHash) ||
    !compact(material.dependencyHash) ||
    !positiveInteger(material.workflowRevision) ||
    !positiveInteger(material.authorizationRevision) ||
    !nonNegativeInteger(material.maxCreditsPerRun) ||
    !nonNegativeInteger(material.maxCreditsPerMonth) ||
    !scopeJson ||
    !validSummaryPolicy(material.summaryPolicyJson)
  ) {
    fail("INVALID_ARGUMENT");
  }

  return {
    version: "fikirtive-routine-authorization/v1",
    ownerId: material.ownerId,
    routineKey: material.routineKey,
    workflowDefinitionId: material.workflowDefinitionId,
    workflowRevisionId: material.workflowRevisionId,
    workflowRevision: material.workflowRevision,
    workflowContentHash: material.workflowContentHash,
    dependencyHash: material.dependencyHash,
    scopeJson,
    maxCreditsPerRun: material.maxCreditsPerRun,
    maxCreditsPerMonth: material.maxCreditsPerMonth,
    expiresAt: material.expiresAt === null ? null : finiteDate(material.expiresAt, "expiresAt").toISOString(),
    summaryPolicyJson: material.summaryPolicyJson,
    authorizationRevision: material.authorizationRevision,
  };
}

export function computeRoutineAuthorizationHash(material: RoutineAuthorizationMaterial): string {
  return canonicalHash("c7-routine-authorization:v1", createRoutineAuthorizationSnapshot(material));
}

function authorizationMaterial(
  routine: RoutineAuthorityRow,
  revision: WorkflowRevisionAuthorityRow,
): RoutineAuthorizationMaterial {
  return {
    ownerId: routine.ownerId,
    routineKey: routine.routineKey,
    workflowDefinitionId: routine.workflowDefinitionId,
    workflowRevisionId: routine.workflowRevisionId,
    workflowRevision: revision.revision,
    workflowContentHash: revision.contentHash,
    dependencyHash: revision.dependencyHash,
    scopeJson: routine.scopeJson,
    maxCreditsPerRun: routine.maxCreditsPerRun,
    maxCreditsPerMonth: routine.maxCreditsPerMonth,
    expiresAt: routine.expiresAt,
    summaryPolicyJson: routine.summaryPolicyJson,
    authorizationRevision: routine.authorizationRevision,
  };
}

export function verifyRoutineAuthorization(
  routine: RoutineAuthorityRow,
  revision: WorkflowRevisionAuthorityRow | null,
  at: Date,
): RoutineAuthorityResult {
  if (routine.killSwitchEngaged) return { ok: false, reason: "kill" };
  if (routine.status !== "active") return { ok: false, reason: "status" };
  const now = finiteDate(at, "at");
  if (routine.expiresAt !== null && routine.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  const scope = canonicalizeRoutineScope(routine.scopeJson);
  if (
    !revision ||
    revision.id !== routine.workflowRevisionId ||
    revision.ownerId !== routine.ownerId ||
    revision.workflowDefinitionId !== routine.workflowDefinitionId ||
    revision.validationState !== "valid" ||
    !scope ||
    !compact(routine.authorizationHash) ||
    !compact(routine.scopeHash) ||
    !routine.authorizedByMembershipId ||
    !routine.authorizedAt ||
    !validSummaryPolicy(routine.summaryPolicyJson)
  ) {
    return { ok: false, reason: "hash_drift" };
  }

  let snapshot: RoutineAuthorizationSnapshot;
  let authorizationHash: string;
  let scopeHash: string;
  try {
    snapshot = createRoutineAuthorizationSnapshot(authorizationMaterial(routine, revision));
    authorizationHash = canonicalHash("c7-routine-authorization:v1", snapshot);
    scopeHash = canonicalHash("c7-routine-scope:v1", scope);
  } catch {
    if (!nonNegativeInteger(routine.maxCreditsPerRun) || !nonNegativeInteger(routine.maxCreditsPerMonth)) {
      return { ok: false, reason: "budget_unavailable" };
    }
    return { ok: false, reason: "hash_drift" };
  }
  if (authorizationHash !== routine.authorizationHash || scopeHash !== routine.scopeHash) {
    return { ok: false, reason: "hash_drift" };
  }
  // M1-M3 is simulation-only. Any non-zero cap requires the separately gated ledger path.
  if (routine.maxCreditsPerRun !== 0 || routine.maxCreditsPerMonth !== 0) {
    return { ok: false, reason: "budget_unavailable" };
  }
  return { ok: true, snapshot, authorizationHash, scopeHash };
}

export type WorkflowTrigger =
  | { kind: "manual"; operationId: string }
  | { kind: "schedule"; scheduledFor: Date | string }
  | { kind: "customer_message"; sourceEventKey: string; triggerEventRef: string }
  | {
      kind: "journey_due";
      contactJourneyStateId: string;
      waitGeneration: number;
      nextEligibleAt: Date | string;
    };

export type DerivedWorkflowTrigger = {
  triggerKind: WorkflowTrigger["kind"];
  triggerOccurrenceRef: string;
  triggerEventRef: string | null;
  scheduledFor: Date | null;
  contactJourneyStateId: string | null;
};

export function deriveTriggerOccurrence(trigger: WorkflowTrigger): DerivedWorkflowTrigger {
  if (!isRecord(trigger)) fail("INVALID_ARGUMENT");
  switch (trigger.kind) {
    case "manual":
      if (!exactKeys(trigger, ["kind", "operationId"]) || !compact(trigger.operationId)) fail("INVALID_ARGUMENT");
      return {
        triggerKind: "manual",
        triggerOccurrenceRef: `manual:${trigger.operationId}`,
        triggerEventRef: null,
        scheduledFor: null,
        contactJourneyStateId: null,
      };
    case "schedule": {
      if (!exactKeys(trigger, ["kind", "scheduledFor"])) fail("INVALID_ARGUMENT");
      const scheduledFor = finiteDate(trigger.scheduledFor, "scheduledFor");
      return {
        triggerKind: "schedule",
        triggerOccurrenceRef: `schedule:${scheduledFor.toISOString()}`,
        triggerEventRef: null,
        scheduledFor,
        contactJourneyStateId: null,
      };
    }
    case "customer_message":
      if (
        !exactKeys(trigger, ["kind", "sourceEventKey", "triggerEventRef"]) ||
        !compact(trigger.sourceEventKey) ||
        !compact(trigger.triggerEventRef)
      ) {
        fail("INVALID_ARGUMENT");
      }
      return {
        triggerKind: "customer_message",
        triggerOccurrenceRef: `message:${trigger.sourceEventKey}`,
        triggerEventRef: trigger.triggerEventRef,
        scheduledFor: null,
        contactJourneyStateId: null,
      };
    case "journey_due": {
      if (
        !exactKeys(trigger, ["kind", "contactJourneyStateId", "waitGeneration", "nextEligibleAt"]) ||
        !compact(trigger.contactJourneyStateId) ||
        !nonNegativeInteger(trigger.waitGeneration)
      ) {
        fail("INVALID_ARGUMENT");
      }
      const due = finiteDate(trigger.nextEligibleAt, "nextEligibleAt");
      return {
        triggerKind: "journey_due",
        triggerOccurrenceRef: `journey:${trigger.contactJourneyStateId}:${trigger.waitGeneration}:${due.toISOString()}`,
        triggerEventRef: null,
        scheduledFor: null,
        contactJourneyStateId: trigger.contactJourneyStateId,
      };
    }
    default:
      return fail("INVALID_ARGUMENT");
  }
}

export function deriveRunIdempotencyKey(input: {
  ownerId: string;
  workflowDefinitionId: string;
  routineKey: string;
  triggerKind: WorkflowTrigger["kind"];
  triggerOccurrenceRef: string;
}): string {
  if (
    !compact(input.ownerId) ||
    !compact(input.workflowDefinitionId) ||
    !compact(input.routineKey) ||
    !compact(input.triggerOccurrenceRef)
  ) {
    fail("INVALID_ARGUMENT");
  }
  return canonicalHash("c7-routine-run-key:v1", [
    input.ownerId,
    input.workflowDefinitionId,
    input.routineKey,
    input.triggerKind,
    input.triggerOccurrenceRef,
  ]);
}

function assertCompiledTrigger(
  revision: WorkflowRevisionAuthorityRow | null,
  triggerKind: WorkflowTrigger["kind"],
): void {
  if (
    !revision ||
    !isRecord(revision.compiledRuleJson) ||
    !isRecord(revision.compiledRuleJson.trigger) ||
    !exactKeys(revision.compiledRuleJson.trigger, ["type"]) ||
    revision.compiledRuleJson.trigger.type !== triggerKind
  ) {
    fail("INVALID_ARGUMENT");
  }
}

export type WorkflowEngineDb = Pick<PrismaClient, "$transaction">;
export type WorkflowEngineTransaction = Prisma.TransactionClient;

export type CreateRoutineRunInput = {
  id: string;
  ownerId: string;
  routineId: string;
  trigger: WorkflowTrigger;
  trustedTriggerPayload: unknown;
  now: Date;
};

export type RoutineRunRecord = {
  id: string;
  ownerId: string;
  routineId: string;
  routineKey: string;
  workflowDefinitionId: string;
  workflowRevisionId: string;
  contactJourneyStateId: string | null;
  triggerKind: string;
  triggerOccurrenceRef: string;
  triggerEventRef: string | null;
  scheduledFor: Date | null;
  runIdempotencyKey: string;
  triggerPayloadHash: string;
  authorizationRevision: number;
  authorizationHash: string;
  authorizationSnapshotJson: unknown;
  status: string;
  currentStepKey: string | null;
  rowRevision: number;
  simulated: boolean;
  reservedCredits: number;
  settledCredits: number;
  creditReservationRef: string | null;
  summaryJson: unknown | null;
  blockReason: string | null;
  errorCode: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
};

export type CreateRoutineRunResult =
  | {
      kind: "created" | "replayed";
      run: RoutineRunRecord;
      /** Caller may enqueue only after this transaction has committed. */
      shouldDispatch: boolean;
      blockedReason?: RoutineAuthorityFailure;
    }
  | { kind: "blocked"; reason: RoutineAuthorityFailure };

async function lockRoutine(tx: WorkflowEngineTransaction, ownerId: string, routineId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Routine" WHERE "id" = ${routineId} AND "ownerId" = ${ownerId} FOR UPDATE`;
}

export async function readRoutineAuthorityInTransaction(
  tx: WorkflowEngineTransaction,
  ownerId: string,
  routineId: string,
  now: Date,
): Promise<{
  routine: RoutineAuthorityRow;
  revision: WorkflowRevisionAuthorityRow | null;
  authority: RoutineAuthorityResult;
}> {
  if (!compact(ownerId) || !compact(routineId)) fail("INVALID_ARGUMENT");
  await lockRoutine(tx, ownerId, routineId);
  const routine = (await tx.routine.findFirst({ where: { id: routineId, ownerId } })) as RoutineAuthorityRow | null;
  if (!routine) fail("RESOURCE_NOT_FOUND");
  const revision = (await tx.workflowRevision.findFirst({
    where: {
      id: routine.workflowRevisionId,
      ownerId,
      workflowDefinitionId: routine.workflowDefinitionId,
    },
  })) as WorkflowRevisionAuthorityRow | null;
  return { routine, revision, authority: verifyRoutineAuthorization(routine, revision, now) };
}

function runComparison(row: RoutineRunRecord): unknown {
  return {
    routineId: row.routineId,
    routineKey: row.routineKey,
    workflowDefinitionId: row.workflowDefinitionId,
    workflowRevisionId: row.workflowRevisionId,
    contactJourneyStateId: row.contactJourneyStateId,
    triggerKind: row.triggerKind,
    triggerOccurrenceRef: row.triggerOccurrenceRef,
    triggerEventRef: row.triggerEventRef,
    scheduledFor: row.scheduledFor?.toISOString() ?? null,
    triggerPayloadHash: row.triggerPayloadHash,
    authorizationRevision: row.authorizationRevision,
    authorizationHash: row.authorizationHash,
    authorizationSnapshotJson: row.authorizationSnapshotJson,
  };
}

function sameRunComparison(left: RoutineRunRecord, right: RoutineRunRecord): boolean {
  return canonicalJson(runComparison(left)) === canonicalJson(runComparison(right));
}

export async function createRoutineRunInTransaction(
  tx: WorkflowEngineTransaction,
  input: CreateRoutineRunInput,
): Promise<CreateRoutineRunResult> {
  if (!compact(input.id) || !compact(input.ownerId) || !compact(input.routineId)) fail("INVALID_ARGUMENT");
  const now = finiteDate(input.now, "now");
  const derived = deriveTriggerOccurrence(input.trigger);
  const { routine, revision, authority } = await readRoutineAuthorityInTransaction(
    tx,
    input.ownerId,
    input.routineId,
    now,
  );
  if (authority.ok) assertCompiledTrigger(revision, derived.triggerKind);
  const runIdempotencyKey = deriveRunIdempotencyKey({
    ownerId: input.ownerId,
    workflowDefinitionId: routine.workflowDefinitionId,
    routineKey: routine.routineKey,
    triggerKind: derived.triggerKind,
    triggerOccurrenceRef: derived.triggerOccurrenceRef,
  });
  const triggerPayloadHash = canonicalHash("c7-routine-trigger-payload:v1", input.trustedTriggerPayload);

  let comparisonSnapshot: unknown = {};
  let comparisonAuthorizationHash = routine.authorizationHash ?? "";
  if (revision) {
    try {
      comparisonSnapshot = createRoutineAuthorizationSnapshot(authorizationMaterial(routine, revision));
      comparisonAuthorizationHash = canonicalHash("c7-routine-authorization:v1", comparisonSnapshot);
    } catch {
      // A malformed/missing envelope is hash_drift. Keeping the empty comparison snapshot makes
      // a pre-existing occurrence conflict unless it was itself created from that exact bad fact.
    }
  }
  const expected: RoutineRunRecord = {
    id: input.id,
    ownerId: input.ownerId,
    routineId: routine.id,
    routineKey: routine.routineKey,
    workflowDefinitionId: routine.workflowDefinitionId,
    workflowRevisionId: routine.workflowRevisionId,
    contactJourneyStateId: derived.contactJourneyStateId,
    triggerKind: derived.triggerKind,
    triggerOccurrenceRef: derived.triggerOccurrenceRef,
    triggerEventRef: derived.triggerEventRef,
    scheduledFor: derived.scheduledFor,
    runIdempotencyKey,
    triggerPayloadHash,
    authorizationRevision: routine.authorizationRevision,
    authorizationHash: comparisonAuthorizationHash,
    authorizationSnapshotJson: comparisonSnapshot,
    status: "queued",
    currentStepKey: null,
    rowRevision: 0,
    simulated: true,
    reservedCredits: 0,
    settledCredits: 0,
    creditReservationRef: null,
    summaryJson: null,
    blockReason: null,
    errorCode: null,
    startedAt: null,
    finishedAt: null,
  };

  const existing = (await tx.routineRun.findFirst({
    where: { ownerId: input.ownerId, runIdempotencyKey },
  })) as RoutineRunRecord | null;
  if (existing && !sameRunComparison(existing, expected)) fail("IDEMPOTENCY_CONFLICT");
  if (!authority.ok) {
    if (!existing) return { kind: "blocked", reason: authority.reason };
    return {
      kind: "replayed",
      run: existing,
      shouldDispatch: false,
      blockedReason: authority.reason,
    };
  }

  // Authority-ok replays deliberately reach the database uniqueness boundary. This makes a
  // concurrent double tick exercise the same ON CONFLICT path as a queue replay instead of
  // relying on an earlier read that cannot itself provide exactly-once exclusion.
  const inserted = await tx.routineRun.createMany({
    data: [
      {
        id: expected.id,
        ownerId: expected.ownerId,
        routineId: expected.routineId,
        routineKey: expected.routineKey,
        workflowDefinitionId: expected.workflowDefinitionId,
        workflowRevisionId: expected.workflowRevisionId,
        contactJourneyStateId: expected.contactJourneyStateId,
        triggerKind: expected.triggerKind,
        triggerOccurrenceRef: expected.triggerOccurrenceRef,
        triggerEventRef: expected.triggerEventRef,
        scheduledFor: expected.scheduledFor,
        runIdempotencyKey: expected.runIdempotencyKey,
        triggerPayloadHash: expected.triggerPayloadHash,
        authorizationRevision: expected.authorizationRevision,
        authorizationHash: expected.authorizationHash,
        authorizationSnapshotJson: expected.authorizationSnapshotJson as Prisma.InputJsonValue,
        status: "queued",
        simulated: true,
        reservedCredits: 0,
        settledCredits: 0,
        creditReservationRef: null,
      },
    ],
    skipDuplicates: true,
  });
  const persisted = (await tx.routineRun.findFirst({
    where: { ownerId: input.ownerId, runIdempotencyKey },
  })) as RoutineRunRecord | null;
  if (!persisted) fail("RESOURCE_NOT_FOUND");
  if (!sameRunComparison(persisted, expected)) fail("IDEMPOTENCY_CONFLICT");
  return {
    kind: inserted.count === 1 ? "created" : "replayed",
    run: persisted,
    shouldDispatch: persisted.status === "queued",
  };
}

export async function createRoutineRun(
  db: WorkflowEngineDb,
  input: CreateRoutineRunInput,
): Promise<CreateRoutineRunResult> {
  // DB lifecycle wrapper only. The shared workflow service remains the sole dispatch seam.
  return db.$transaction((tx) => createRoutineRunInTransaction(tx, input));
}

export type TransitionRoutineRunInput = {
  ownerId: string;
  routineRunId: string;
  expectedRowRevision: number;
  toStatus: "running" | "waiting" | "completed" | "blocked" | "cancelled" | "failed";
  currentStepKey?: string | null;
  summaryJson?: unknown;
  summaryUnavailableReason?: string;
  blockReason?: string;
  errorCode?: string;
  now: Date;
};

function terminalSummary(input: TransitionRoutineRunInput): unknown | undefined {
  if (!TERMINAL_RUN_STATUSES.has(input.toStatus)) return input.summaryJson;
  if (input.summaryJson !== undefined) {
    if (input.summaryJson === null) fail("INVALID_ARGUMENT");
    let encoded: string;
    try {
      encoded = canonicalJson(input.summaryJson);
    } catch {
      return fail("INVALID_ARGUMENT");
    }
    if (new TextEncoder().encode(encoded).byteLength > MAX_SUMMARY_JSON_BYTES) {
      fail("INVALID_ARGUMENT");
    }
    return input.summaryJson;
  }
  if (compact(input.summaryUnavailableReason)) {
    return { status: "summary_unavailable", reason: input.summaryUnavailableReason };
  }
  return fail("SUMMARY_REQUIRED");
}

export async function transitionRoutineRun(
  db: WorkflowEngineDb,
  input: TransitionRoutineRunInput,
): Promise<RoutineRunRecord> {
  if (
    !compact(input.ownerId) ||
    !compact(input.routineRunId) ||
    !nonNegativeInteger(input.expectedRowRevision)
  ) {
    fail("INVALID_ARGUMENT");
  }
  const now = finiteDate(input.now, "now");
  return db.$transaction(async (tx) => {
    const loaded = await verifyRoutineRunAuthorityInTransaction(
      tx,
      input.ownerId,
      input.routineRunId,
      now,
    );
    const current = loaded.run;
    if (current.rowRevision !== input.expectedRowRevision) fail("CAS_CONFLICT");
    if (TERMINAL_RUN_STATUSES.has(current.status)) fail("RUN_TERMINAL");
    const authorityBlockReason = !loaded.authority.ok
      ? `routine_authority_${loaded.authority.reason}`
      : null;
    const effectiveStatus = authorityBlockReason === null ? input.toStatus : "blocked";
    if (!RUN_TRANSITIONS[current.status]?.has(effectiveStatus)) fail("INVALID_ARGUMENT");
    const terminal = TERMINAL_RUN_STATUSES.has(effectiveStatus);
    const summaryJson = authorityBlockReason === null
      ? terminalSummary(input)
      : { status: "summary_unavailable", reason: authorityBlockReason };
    const update = await tx.routineRun.updateMany({
      where: {
        id: input.routineRunId,
        ownerId: input.ownerId,
        rowRevision: input.expectedRowRevision,
        status: current.status,
      },
      data: {
        status: effectiveStatus,
        ...(input.currentStepKey !== undefined ? { currentStepKey: input.currentStepKey } : {}),
        ...(effectiveStatus === "running" && current.startedAt === null ? { startedAt: now } : {}),
        ...(terminal ? { finishedAt: now, summaryJson: summaryJson as Prisma.InputJsonValue } : {}),
        ...(authorityBlockReason !== null
          ? { blockReason: authorityBlockReason }
          : input.blockReason !== undefined
            ? { blockReason: input.blockReason }
            : {}),
        ...(input.errorCode !== undefined ? { errorCode: input.errorCode } : {}),
        rowRevision: { increment: 1 },
      },
    });
    if (update.count !== 1) fail("CAS_CONFLICT");
    const transitioned = (await tx.routineRun.findFirst({
      where: { id: input.routineRunId, ownerId: input.ownerId },
    })) as RoutineRunRecord | null;
    if (!transitioned) fail("RESOURCE_NOT_FOUND");
    return transitioned;
  });
}

export type EngageRoutineKillSwitchInput = {
  ownerId: string;
  routineId: string;
  expectedRowRevision: number;
  killedByMembershipId: string;
  killReasonCode: string;
  now: Date;
};

export async function engageRoutineKillSwitch(
  db: WorkflowEngineDb,
  input: EngageRoutineKillSwitchInput,
): Promise<RoutineAuthorityRow> {
  if (
    !compact(input.ownerId) ||
    !compact(input.routineId) ||
    !compact(input.killedByMembershipId) ||
    !compact(input.killReasonCode) ||
    !nonNegativeInteger(input.expectedRowRevision)
  ) {
    fail("INVALID_ARGUMENT");
  }
  const now = finiteDate(input.now, "now");
  return db.$transaction(async (tx) => {
    const updated = await tx.routine.updateMany({
      where: {
        id: input.routineId,
        ownerId: input.ownerId,
        rowRevision: input.expectedRowRevision,
        killSwitchEngaged: false,
        status: { in: ["draft", "active", "paused"] },
      },
      data: {
        killSwitchEngaged: true,
        status: "paused",
        killedByMembershipId: input.killedByMembershipId,
        killedAt: now,
        killReasonCode: input.killReasonCode,
        rowRevision: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      const row = await tx.routine.findFirst({ where: { id: input.routineId, ownerId: input.ownerId } });
      if (!row) fail("RESOURCE_NOT_FOUND");
      fail("CAS_CONFLICT");
    }
    const row = (await tx.routine.findFirst({
      where: { id: input.routineId, ownerId: input.ownerId },
    })) as RoutineAuthorityRow | null;
    if (!row) fail("RESOURCE_NOT_FOUND");
    return row;
  });
}

export async function verifyRoutineRunAuthorityInTransaction(
  tx: WorkflowEngineTransaction,
  ownerId: string,
  routineRunId: string,
  now: Date,
): Promise<{
  run: RoutineRunRecord;
  routine: RoutineAuthorityRow;
  authority: RoutineAuthorityResult;
}> {
  const run = (await tx.routineRun.findFirst({ where: { id: routineRunId, ownerId } })) as RoutineRunRecord | null;
  if (!run) fail("RESOURCE_NOT_FOUND");
  const loaded = await readRoutineAuthorityInTransaction(tx, ownerId, run.routineId, now);
  let authority = loaded.authority;
  if (
    authority.ok &&
    (run.routineKey !== loaded.routine.routineKey ||
      run.workflowDefinitionId !== loaded.routine.workflowDefinitionId ||
      run.workflowRevisionId !== loaded.routine.workflowRevisionId ||
      run.authorizationRevision !== loaded.routine.authorizationRevision ||
      run.authorizationHash !== authority.authorizationHash ||
      canonicalJson(run.authorizationSnapshotJson) !== canonicalJson(authority.snapshot))
  ) {
    authority = { ok: false, reason: "hash_drift" };
  }
  return { run, routine: loaded.routine, authority };
}
