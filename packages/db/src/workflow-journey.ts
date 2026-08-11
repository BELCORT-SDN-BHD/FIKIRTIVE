import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { canonicalHash, canonicalJson } from "./workflow-compiler.js";
import {
  WORKFLOW_ACTION_KINDS,
  createRoutineRunInTransaction,
  readRoutineAuthorityInTransaction,
  verifyRoutineRunAuthorityInTransaction,
  type CreateRoutineRunResult,
  type RoutineAuthorizationScope,
  type RoutineAuthorityFailure,
  type RoutineRunRecord,
  type WorkflowActionKind,
  type WorkflowEngineTransaction,
} from "./workflow-engine.js";

export const WORKFLOW_JOURNEY_ERROR_CODES = {
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  CAS_CONFLICT: "CAS_CONFLICT",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  AUTHORITY_UNAVAILABLE: "AUTHORITY_UNAVAILABLE",
  LIVE_ENROLLMENT_EXISTS: "LIVE_ENROLLMENT_EXISTS",
  JOURNEY_TERMINAL: "JOURNEY_TERMINAL",
  RUN_TERMINAL: "RUN_TERMINAL",
  STEP_NOT_RESERVED: "STEP_NOT_RESERVED",
} as const;

export type WorkflowJourneyErrorCode =
  (typeof WORKFLOW_JOURNEY_ERROR_CODES)[keyof typeof WORKFLOW_JOURNEY_ERROR_CODES];

export class WorkflowJourneyError extends Error {
  constructor(public readonly code: WorkflowJourneyErrorCode) {
    super(code);
    this.name = "WorkflowJourneyError";
  }
}

export type WorkflowJourneyDb = Pick<PrismaClient, "$transaction">;
export type WorkflowJourneyTransaction = Prisma.TransactionClient;

export type ContactJourneyRecord = {
  id: string;
  ownerId: string;
  contactId: string;
  contactIdentityId: string | null;
  workflowDefinitionId: string;
  workflowRevisionId: string;
  routineId: string;
  enrollmentIdempotencyKey: string;
  status: string;
  currentStepKey: string | null;
  nextEligibleAt: Date | null;
  waitGeneration: number;
  stateJson: unknown;
  lastRoutineRunId: string | null;
  rowRevision: number;
  enrolledAt: Date;
  terminalAt: Date | null;
};

const TERMINAL_JOURNEY_STATUSES = new Set(["completed", "exited", "blocked", "failed"]);
const TERMINAL_RUN_STATUSES = new Set(["completed", "blocked", "cancelled", "failed"]);
const SETTLED_STEP_STATUSES = new Set(["blocked", "simulated", "delegated", "unavailable", "failed"]);
const ELIGIBILITY_AXES = ["consentStop", "doNotDisturb", "providerRefusal", "frequency"] as const;
const ELIGIBILITY_AXIS_STATUSES = new Set(["pass", "block", "risk", "unknown", "unavailable"]);
const REACTIVE_SERVICE_REPLY = "reactive_service_reply";
const STRICT_CLASSIFICATION_UNAVAILABLE = "strict_classification_unavailable";
const NO_TARGET_SENTINEL = "target:none";
const WORKFLOW_PURPOSES = new Set([
  "marketing",
  "review_request",
  "transactional",
  STRICT_CLASSIFICATION_UNAVAILABLE,
]);

function fail(code: WorkflowJourneyErrorCode): never {
  throw new WorkflowJourneyError(code);
}

function compact(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f\s]/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function canonicalOrInvalid(value: unknown): string {
  try {
    return canonicalJson(value);
  } catch {
    return fail("INVALID_ARGUMENT");
  }
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function finiteDate(value: Date | string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) fail("INVALID_ARGUMENT");
  return date;
}

function sameInstant(left: Date | null, right: Date | null): boolean {
  return left === null ? right === null : right !== null && left.getTime() === right.getTime();
}

export function deriveEnrollmentIdempotencyKey(input: {
  ownerId: string;
  workflowDefinitionId: string;
  contactId: string;
  enrollmentOccurrenceRef: string;
}): string {
  if (
    !compact(input.ownerId) ||
    !compact(input.workflowDefinitionId) ||
    !compact(input.contactId) ||
    !compact(input.enrollmentOccurrenceRef)
  ) {
    fail("INVALID_ARGUMENT");
  }
  return canonicalHash("c7-journey-enrollment:v1", [
    input.ownerId,
    input.workflowDefinitionId,
    input.contactId,
    input.enrollmentOccurrenceRef,
  ]);
}

export type EnrollContactJourneyInput = {
  id: string;
  ownerId: string;
  routineId: string;
  contactId: string;
  contactIdentityId: string | null;
  enrollmentOccurrenceRef: string;
  initialStepKey: string | null;
  initialStateJson: unknown;
  now: Date;
};

export type EnrollContactJourneyResult = {
  kind: "created" | "replayed";
  journey: ContactJourneyRecord;
};

async function lockJourney(
  tx: WorkflowJourneyTransaction,
  ownerId: string,
  journeyId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "ContactJourneyState" WHERE "id" = ${journeyId} AND "ownerId" = ${ownerId} FOR UPDATE`;
}

async function readJourney(
  tx: WorkflowJourneyTransaction,
  ownerId: string,
  journeyId: string,
): Promise<ContactJourneyRecord> {
  const row = (await tx.contactJourneyState.findFirst({
    where: { id: journeyId, ownerId },
  })) as ContactJourneyRecord | null;
  if (!row) fail("RESOURCE_NOT_FOUND");
  return row;
}

function sameEnrollment(left: ContactJourneyRecord, right: ContactJourneyRecord): boolean {
  return (
    left.ownerId === right.ownerId &&
    left.contactId === right.contactId &&
    left.contactIdentityId === right.contactIdentityId &&
    left.workflowDefinitionId === right.workflowDefinitionId &&
    left.workflowRevisionId === right.workflowRevisionId &&
    left.routineId === right.routineId
  );
}

function revisionHasStep(compiledRuleJson: unknown, stepKey: string): boolean {
  if (!isRecord(compiledRuleJson) || !Array.isArray(compiledRuleJson.steps)) return false;
  return compiledRuleJson.steps.some(
    (step) => isRecord(step) && step.key === stepKey,
  );
}

function journeyMatchesAuthority(
  journey: ContactJourneyRecord,
  routine: { id: string; workflowDefinitionId: string; workflowRevisionId: string },
): boolean {
  return (
    journey.routineId === routine.id &&
    journey.workflowDefinitionId === routine.workflowDefinitionId &&
    journey.workflowRevisionId === routine.workflowRevisionId
  );
}

export async function enrollContactJourney(
  db: WorkflowJourneyDb,
  input: EnrollContactJourneyInput,
): Promise<EnrollContactJourneyResult> {
  if (
    !compact(input.id) ||
    !compact(input.ownerId) ||
    !compact(input.routineId) ||
    !compact(input.contactId) ||
    (input.contactIdentityId !== null && !compact(input.contactIdentityId)) ||
    (input.initialStepKey !== null && !compact(input.initialStepKey))
  ) {
    fail("INVALID_ARGUMENT");
  }
  const now = finiteDate(input.now);
  // M2 has no approved journey-state vocabulary. Empty is the only safe initial state; a
  // future field requires a Founder-approved closed schema rather than arbitrary JSON shadowing.
  if (!isRecord(input.initialStateJson) || canonicalOrInvalid(input.initialStateJson) !== "{}") {
    fail("INVALID_ARGUMENT");
  }
  return db.$transaction(async (tx) => {
    const loaded = await readRoutineAuthorityInTransaction(tx, input.ownerId, input.routineId, now);
    if (!loaded.authority.ok) fail("AUTHORITY_UNAVAILABLE");
    if (
      input.initialStepKey !== null &&
      (!loaded.revision || !revisionHasStep(loaded.revision.compiledRuleJson, input.initialStepKey))
    ) {
      fail("AUTHORITY_UNAVAILABLE");
    }

    const contact = await tx.contact.findFirst({ where: { id: input.contactId, ownerId: input.ownerId } });
    if (!contact) fail("RESOURCE_NOT_FOUND");
    if (!loaded.authority.snapshot.scopeJson.contactIds.includes(input.contactId)) {
      fail("AUTHORITY_UNAVAILABLE");
    }
    if (input.contactIdentityId !== null) {
      const identity = await tx.contactIdentity.findFirst({
        where: {
          id: input.contactIdentityId,
          ownerId: input.ownerId,
          contactId: input.contactId,
          deletedAt: null,
        },
      });
      if (!identity) fail("RESOURCE_NOT_FOUND");
      if (!loaded.authority.snapshot.scopeJson.channelScopes.some((scope) => scope.channel === identity.channel)) {
        fail("AUTHORITY_UNAVAILABLE");
      }
    }

    const enrollmentIdempotencyKey = deriveEnrollmentIdempotencyKey({
      ownerId: input.ownerId,
      workflowDefinitionId: loaded.routine.workflowDefinitionId,
      contactId: input.contactId,
      enrollmentOccurrenceRef: input.enrollmentOccurrenceRef,
    });
    const expected: ContactJourneyRecord = {
      id: input.id,
      ownerId: input.ownerId,
      contactId: input.contactId,
      contactIdentityId: input.contactIdentityId,
      workflowDefinitionId: loaded.routine.workflowDefinitionId,
      workflowRevisionId: loaded.routine.workflowRevisionId,
      routineId: loaded.routine.id,
      enrollmentIdempotencyKey,
      status: "active",
      currentStepKey: input.initialStepKey,
      nextEligibleAt: null,
      waitGeneration: 0,
      stateJson: input.initialStateJson,
      lastRoutineRunId: null,
      rowRevision: 0,
      enrolledAt: now,
      terminalAt: null,
    };

    const existing = (await tx.contactJourneyState.findFirst({
      where: { ownerId: input.ownerId, enrollmentIdempotencyKey },
    })) as ContactJourneyRecord | null;
    if (existing) {
      if (!sameEnrollment(existing, expected)) fail("IDEMPOTENCY_CONFLICT");
      return { kind: "replayed", journey: existing };
    }

    // Founder has not approved automatic re-entry after any prior journey for the same
    // Definition/contact. Recheck exact replay after the lock before the broader prior query.
    // $executeRaw: pg_advisory_xact_lock returns void, which $queryRaw cannot deserialize.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`c7-enrollment:${input.ownerId}:${loaded.routine.workflowDefinitionId}:${input.contactId}`}, 0))`;
    const replayAfterLock = (await tx.contactJourneyState.findFirst({
      where: { ownerId: input.ownerId, enrollmentIdempotencyKey },
    })) as ContactJourneyRecord | null;
    if (replayAfterLock) {
      if (!sameEnrollment(replayAfterLock, expected)) fail("IDEMPOTENCY_CONFLICT");
      return { kind: "replayed", journey: replayAfterLock };
    }
    const prior = await tx.contactJourneyState.findFirst({
      where: {
        ownerId: input.ownerId,
        workflowDefinitionId: loaded.routine.workflowDefinitionId,
        contactId: input.contactId,
      },
    });
    if (prior) fail("LIVE_ENROLLMENT_EXISTS");

    const inserted = await tx.contactJourneyState.createMany({
      data: [
        {
          id: expected.id,
          ownerId: expected.ownerId,
          contactId: expected.contactId,
          contactIdentityId: expected.contactIdentityId,
          workflowDefinitionId: expected.workflowDefinitionId,
          workflowRevisionId: expected.workflowRevisionId,
          routineId: expected.routineId,
          enrollmentIdempotencyKey,
          status: "active",
          currentStepKey: expected.currentStepKey,
          nextEligibleAt: null,
          waitGeneration: 0,
          stateJson: expected.stateJson as Prisma.InputJsonValue,
          enrolledAt: now,
        },
      ],
      skipDuplicates: true,
    });
    const persisted = (await tx.contactJourneyState.findFirst({
      where: { ownerId: input.ownerId, enrollmentIdempotencyKey },
    })) as ContactJourneyRecord | null;
    if (!persisted) fail("RESOURCE_NOT_FOUND");
    if (!sameEnrollment(persisted, expected)) fail("IDEMPOTENCY_CONFLICT");
    return { kind: inserted.count === 1 ? "created" : "replayed", journey: persisted };
  });
}

export type AdvanceContactJourneyInput = {
  ownerId: string;
  journeyId: string;
  expectedRowRevision: number;
  expectedCurrentStepKey: string | null;
  nextStepKey: string | null;
  lastRoutineRunId?: string;
  now: Date;
};

export async function advanceContactJourney(
  db: WorkflowJourneyDb,
  input: AdvanceContactJourneyInput,
): Promise<ContactJourneyRecord> {
  if (
    !compact(input.ownerId) ||
    !compact(input.journeyId) ||
    !nonNegativeInteger(input.expectedRowRevision) ||
    (input.expectedCurrentStepKey !== null && !compact(input.expectedCurrentStepKey)) ||
    (input.nextStepKey !== null && !compact(input.nextStepKey)) ||
    (input.lastRoutineRunId !== undefined && !compact(input.lastRoutineRunId))
  ) {
    fail("INVALID_ARGUMENT");
  }
  const now = finiteDate(input.now);
  return db.$transaction(async (tx) => {
    const hint = await readJourney(tx, input.ownerId, input.journeyId);
    const loaded = await readRoutineAuthorityInTransaction(tx, input.ownerId, hint.routineId, now);
    if (!loaded.authority.ok || !journeyMatchesAuthority(hint, loaded.routine)) {
      fail("AUTHORITY_UNAVAILABLE");
    }
    if (
      input.nextStepKey !== null &&
      (!loaded.revision || !revisionHasStep(loaded.revision.compiledRuleJson, input.nextStepKey))
    ) {
      fail("AUTHORITY_UNAVAILABLE");
    }
    // All multi-row mutation paths lock Routine before Journey.
    await lockJourney(tx, input.ownerId, input.journeyId);
    const locked = await readJourney(tx, input.ownerId, input.journeyId);
    if (!journeyMatchesAuthority(locked, loaded.routine)) fail("AUTHORITY_UNAVAILABLE");
    const terminal = input.nextStepKey === null;
    const updated = await tx.contactJourneyState.updateMany({
      where: {
        id: input.journeyId,
        ownerId: input.ownerId,
        status: "active",
        rowRevision: input.expectedRowRevision,
        currentStepKey: input.expectedCurrentStepKey,
      },
      data: {
        ...(terminal ? { status: "completed", terminalAt: now, nextEligibleAt: null } : {}),
        currentStepKey: input.nextStepKey,
        ...(input.lastRoutineRunId !== undefined ? { lastRoutineRunId: input.lastRoutineRunId } : {}),
        rowRevision: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      const current = await readJourney(tx, input.ownerId, input.journeyId);
      if (TERMINAL_JOURNEY_STATUSES.has(current.status)) fail("JOURNEY_TERMINAL");
      fail("CAS_CONFLICT");
    }
    return readJourney(tx, input.ownerId, input.journeyId);
  });
}

export type EnterJourneyWaitInput = {
  ownerId: string;
  journeyId: string;
  expectedRowRevision: number;
  expectedWaitGeneration: number;
  expectedCurrentStepKey: string;
  resumeStepKey: string;
  nextEligibleAt: Date;
  lastRoutineRunId?: string;
  now: Date;
};

export type EnterJourneyWaitResult = {
  kind: "entered" | "replayed";
  journey: ContactJourneyRecord;
};

export async function enterJourneyWait(
  db: WorkflowJourneyDb,
  input: EnterJourneyWaitInput,
): Promise<EnterJourneyWaitResult> {
  if (
    !compact(input.ownerId) ||
    !compact(input.journeyId) ||
    !compact(input.expectedCurrentStepKey) ||
    !compact(input.resumeStepKey) ||
    !nonNegativeInteger(input.expectedRowRevision) ||
    !nonNegativeInteger(input.expectedWaitGeneration) ||
    (input.lastRoutineRunId !== undefined && !compact(input.lastRoutineRunId))
  ) {
    fail("INVALID_ARGUMENT");
  }
  const due = finiteDate(input.nextEligibleAt);
  const now = finiteDate(input.now);
  return db.$transaction(async (tx) => {
    const hint = await readJourney(tx, input.ownerId, input.journeyId);
    const loaded = await readRoutineAuthorityInTransaction(tx, input.ownerId, hint.routineId, now);
    if (!loaded.authority.ok || !journeyMatchesAuthority(hint, loaded.routine)) {
      fail("AUTHORITY_UNAVAILABLE");
    }
    if (!loaded.revision || !revisionHasStep(loaded.revision.compiledRuleJson, input.resumeStepKey)) {
      fail("AUTHORITY_UNAVAILABLE");
    }
    // All multi-row mutation paths lock Routine before Journey.
    await lockJourney(tx, input.ownerId, input.journeyId);
    const current = await readJourney(tx, input.ownerId, input.journeyId);
    if (!journeyMatchesAuthority(current, loaded.routine)) fail("AUTHORITY_UNAVAILABLE");
    if (
      current.status === "waiting" &&
      current.rowRevision === input.expectedRowRevision + 1 &&
      current.waitGeneration === input.expectedWaitGeneration + 1 &&
      current.currentStepKey === input.resumeStepKey &&
      sameInstant(current.nextEligibleAt, due) &&
      (input.lastRoutineRunId === undefined || current.lastRoutineRunId === input.lastRoutineRunId)
    ) {
      return { kind: "replayed", journey: current };
    }
    if (TERMINAL_JOURNEY_STATUSES.has(current.status)) fail("JOURNEY_TERMINAL");
    if (
      current.status !== "active" ||
      current.rowRevision !== input.expectedRowRevision ||
      current.waitGeneration !== input.expectedWaitGeneration ||
      current.currentStepKey !== input.expectedCurrentStepKey
    ) {
      fail("CAS_CONFLICT");
    }
    const updated = await tx.contactJourneyState.updateMany({
      where: {
        id: input.journeyId,
        ownerId: input.ownerId,
        status: "active",
        rowRevision: input.expectedRowRevision,
        waitGeneration: input.expectedWaitGeneration,
        currentStepKey: input.expectedCurrentStepKey,
      },
      data: {
        status: "waiting",
        currentStepKey: input.resumeStepKey,
        nextEligibleAt: due,
        waitGeneration: { increment: 1 },
        ...(input.lastRoutineRunId !== undefined ? { lastRoutineRunId: input.lastRoutineRunId } : {}),
        rowRevision: { increment: 1 },
      },
    });
    if (updated.count !== 1) fail("CAS_CONFLICT");
    return { kind: "entered", journey: await readJourney(tx, input.ownerId, input.journeyId) };
  });
}

export type CreateJourneyDueRunInput = {
  ownerId: string;
  journeyId: string;
  routineRunId: string;
  trustedTriggerPayload: unknown;
  now: Date;
};

export type CreateJourneyDueRunResult =
  | { kind: "not_due" | "terminal" }
  | { kind: "blocked"; reason: RoutineAuthorityFailure }
  | {
      kind: "created" | "replayed";
      journey: ContactJourneyRecord;
      run: RoutineRunRecord;
      shouldDispatch: boolean;
    };

export async function createJourneyDueRun(
  db: WorkflowJourneyDb,
  input: CreateJourneyDueRunInput,
): Promise<CreateJourneyDueRunResult> {
  if (!compact(input.ownerId) || !compact(input.journeyId) || !compact(input.routineRunId)) {
    fail("INVALID_ARGUMENT");
  }
  const now = finiteDate(input.now);
  // DB lifecycle wrapper only. A returned shouldDispatch flag is consumed solely by the
  // shared workflow service; this raw helper is not an independent dispatch seam.
  return db.$transaction(async (tx) => {
    const hint = await readJourney(tx, input.ownerId, input.journeyId);
    await readRoutineAuthorityInTransaction(tx, input.ownerId, hint.routineId, now);
    // Routine is locked first; the journey due facts are then re-read under its own lock.
    await lockJourney(tx, input.ownerId, input.journeyId);
    const journey = await readJourney(tx, input.ownerId, input.journeyId);
    if (journey.routineId !== hint.routineId) fail("CAS_CONFLICT");
    if (TERMINAL_JOURNEY_STATUSES.has(journey.status)) return { kind: "terminal" };
    if (
      journey.status !== "waiting" ||
      journey.nextEligibleAt === null ||
      journey.nextEligibleAt.getTime() > now.getTime()
    ) {
      return { kind: "not_due" };
    }

    const runResult: CreateRoutineRunResult = await createRoutineRunInTransaction(
      tx as WorkflowEngineTransaction,
      {
        id: input.routineRunId,
        ownerId: input.ownerId,
        routineId: journey.routineId,
        trigger: {
          kind: "journey_due",
          contactJourneyStateId: journey.id,
          waitGeneration: journey.waitGeneration,
          nextEligibleAt: journey.nextEligibleAt,
        },
        trustedTriggerPayload: input.trustedTriggerPayload,
        now,
      },
    );
    if (runResult.kind === "blocked") return runResult;
    if (runResult.blockedReason) return { kind: "blocked", reason: runResult.blockedReason };

    const advanced = await tx.contactJourneyState.updateMany({
      where: {
        id: journey.id,
        ownerId: journey.ownerId,
        status: "waiting",
        rowRevision: journey.rowRevision,
        waitGeneration: journey.waitGeneration,
        nextEligibleAt: journey.nextEligibleAt,
      },
      data: {
        status: "active",
        nextEligibleAt: null,
        lastRoutineRunId: runResult.run.id,
        rowRevision: { increment: 1 },
      },
    });
    if (advanced.count !== 1) fail("CAS_CONFLICT");
    return {
      kind: runResult.kind,
      journey: await readJourney(tx, input.ownerId, input.journeyId),
      run: runResult.run,
      shouldDispatch: runResult.shouldDispatch,
    };
  });
}

export function deriveStepIdempotencyKey(input: {
  ownerId: string;
  routineRunId: string;
  contactJourneyStateId: string | null;
  stepKey: string;
}): string {
  if (
    !compact(input.ownerId) ||
    !compact(input.routineRunId) ||
    !compact(input.stepKey) ||
    (input.contactJourneyStateId !== null && !compact(input.contactJourneyStateId))
  ) {
    fail("INVALID_ARGUMENT");
  }
  return canonicalHash("c7-workflow-step:v1", [
    input.ownerId,
    input.routineRunId,
    input.contactJourneyStateId,
    input.stepKey,
  ]);
}

export type WorkflowActionOccurrence =
  | {
      kind: "journey_step";
      ownerId: string;
      workflowDefinitionId: string;
      contactJourneyStateId: string;
      stepKey: string;
    }
  | {
      kind: "scheduled_routine";
      ownerId: string;
      workflowDefinitionId: string;
      routineKey: string;
      scheduledFor: Date | string;
      stepKey: string;
    }
  | {
      kind: "business_hours_auto_reply";
      ownerId: string;
      conversationId: string;
      customerMessageSourceEventKey: string;
      channel: string;
    };

/** Exact §7.7 formula tuples; all revisions, authorization facts, run IDs and payload hashes stay out. */
export function deriveActionIdempotencyKey(occurrence: WorkflowActionOccurrence): string {
  switch (occurrence.kind) {
    case "journey_step":
      if (
        !compact(occurrence.ownerId) ||
        !compact(occurrence.workflowDefinitionId) ||
        !compact(occurrence.contactJourneyStateId) ||
        !compact(occurrence.stepKey)
      ) {
        fail("INVALID_ARGUMENT");
      }
      return canonicalHash("c7-action-journey-step:v1", [
        occurrence.ownerId,
        occurrence.workflowDefinitionId,
        occurrence.contactJourneyStateId,
        occurrence.stepKey,
      ]);
    case "scheduled_routine": {
      if (
        !compact(occurrence.ownerId) ||
        !compact(occurrence.workflowDefinitionId) ||
        !compact(occurrence.routineKey) ||
        !compact(occurrence.stepKey)
      ) {
        fail("INVALID_ARGUMENT");
      }
      const scheduledFor = finiteDate(occurrence.scheduledFor).toISOString();
      return canonicalHash("c7-action-scheduled-routine:v1", [
        occurrence.ownerId,
        occurrence.workflowDefinitionId,
        occurrence.routineKey,
        "schedule",
        scheduledFor,
        occurrence.stepKey,
      ]);
    }
    case "business_hours_auto_reply":
      if (
        !compact(occurrence.ownerId) ||
        !compact(occurrence.conversationId) ||
        !compact(occurrence.customerMessageSourceEventKey) ||
        !compact(occurrence.channel)
      ) {
        fail("INVALID_ARGUMENT");
      }
      return canonicalHash("c7-action-business-hours-auto-reply:v1", [
        occurrence.ownerId,
        occurrence.conversationId,
        occurrence.customerMessageSourceEventKey,
        occurrence.channel,
        "business_hours_auto_reply",
      ]);
  }
}

export type WorkflowNoTargetActionOccurrence = {
  ownerId: string;
  workflowDefinitionId: string;
  routineKey: string;
  triggerKind: string;
  triggerOccurrenceRef: string;
  contactJourneyStateId: string | null;
  scheduledFor: Date | string | null;
  stepKey: string;
};

/** Stable customer-action occurrence key when dispatch stops before a target can be bound. */
export function deriveNoTargetActionIdempotencyKey(
  occurrence: WorkflowNoTargetActionOccurrence,
): string {
  if (
    !compact(occurrence.ownerId) ||
    !compact(occurrence.workflowDefinitionId) ||
    !compact(occurrence.routineKey) ||
    !compact(occurrence.triggerOccurrenceRef) ||
    !compact(occurrence.stepKey)
  ) {
    fail("INVALID_ARGUMENT");
  }
  switch (occurrence.triggerKind) {
    case "journey_due":
      if (
        occurrence.scheduledFor !== null ||
        !compact(occurrence.contactJourneyStateId) ||
        !occurrence.triggerOccurrenceRef.startsWith(`journey:${occurrence.contactJourneyStateId}:`)
      ) {
        fail("INVALID_ARGUMENT");
      }
      return deriveActionIdempotencyKey({
        kind: "journey_step",
        ownerId: occurrence.ownerId,
        workflowDefinitionId: occurrence.workflowDefinitionId,
        contactJourneyStateId: occurrence.contactJourneyStateId,
        stepKey: occurrence.stepKey,
      });
    case "schedule": {
      if (occurrence.contactJourneyStateId !== null || occurrence.scheduledFor === null) {
        fail("INVALID_ARGUMENT");
      }
      const scheduledFor = finiteDate(occurrence.scheduledFor);
      if (occurrence.triggerOccurrenceRef !== `schedule:${scheduledFor.toISOString()}`) {
        fail("INVALID_ARGUMENT");
      }
      return deriveActionIdempotencyKey({
        kind: "scheduled_routine",
        ownerId: occurrence.ownerId,
        workflowDefinitionId: occurrence.workflowDefinitionId,
        routineKey: occurrence.routineKey,
        scheduledFor,
        stepKey: occurrence.stepKey,
      });
    }
    case "customer_message": {
      if (
        occurrence.contactJourneyStateId !== null ||
        occurrence.scheduledFor !== null ||
        !occurrence.triggerOccurrenceRef.startsWith("message:")
      ) {
        fail("INVALID_ARGUMENT");
      }
      const sourceEventKey = occurrence.triggerOccurrenceRef.slice("message:".length);
      if (!compact(sourceEventKey)) fail("INVALID_ARGUMENT");
      return canonicalHash("c7-action-business-hours-auto-reply:v1", [
        occurrence.ownerId,
        NO_TARGET_SENTINEL,
        sourceEventKey,
        NO_TARGET_SENTINEL,
        "business_hours_auto_reply",
      ]);
    }
    case "manual":
      if (
        occurrence.contactJourneyStateId !== null ||
        occurrence.scheduledFor !== null ||
        !occurrence.triggerOccurrenceRef.startsWith("manual:") ||
        !compact(occurrence.triggerOccurrenceRef.slice("manual:".length))
      ) {
        fail("INVALID_ARGUMENT");
      }
      return canonicalHash("c7-action-manual-routine-no-target:v1", [
        occurrence.ownerId,
        occurrence.workflowDefinitionId,
        occurrence.routineKey,
        "manual",
        occurrence.triggerOccurrenceRef,
        occurrence.stepKey,
        NO_TARGET_SENTINEL,
      ]);
    default:
      return fail("INVALID_ARGUMENT");
  }
}

export type WorkflowStepTarget = {
  contactId: string;
  contactIdentityId: string;
  channel: string;
  providerConnectionId: string | null;
  purpose: string;
};

/**
 * The closed set of reasons a step can be recorded as unavailable BEFORE anything is
 * dispatched. A VALUE, not just a type — the merchant reads one of these on the monitoring
 * panel, and workflow-format's copy pinboard reads this list to prove each has a sentence
 * (#811).
 */
export const WORKFLOW_PRE_DISPATCH_UNAVAILABLE_REASONS = [
  "workflow_dependency_unavailable",
  "workflow_target_unavailable",
] as const;

type PreDispatchUnavailableReason = (typeof WORKFLOW_PRE_DISPATCH_UNAVAILABLE_REASONS)[number];

export type ReserveWorkflowStepInput = {
  id: string;
  ownerId: string;
  routineRunId: string;
  stepKey: string;
  actionKind: WorkflowActionKind;
  actionPayload: unknown;
  actionOccurrence: WorkflowActionOccurrence | null;
  target: WorkflowStepTarget | null;
  preDispatchUnavailableReason?: PreDispatchUnavailableReason;
  now: Date;
};

function isPreDispatchUnavailableReason(
  value: string | null,
): value is PreDispatchUnavailableReason {
  return (WORKFLOW_PRE_DISPATCH_UNAVAILABLE_REASONS as readonly string[]).includes(value ?? "");
}

export type WorkflowStepExecutionRecord = {
  id: string;
  ownerId: string;
  routineRunId: string;
  contactJourneyStateId: string | null;
  workflowRevisionId: string;
  contactId: string | null;
  contactIdentityId: string | null;
  channel: string | null;
  providerConnectionId: string | null;
  stepKey: string;
  actionKind: string;
  actionPayloadHash: string;
  stepIdempotencyKey: string;
  actionIdempotencyKey: string | null;
  status: string;
  purpose: string | null;
  callerClass: string | null;
  eligibilityInputHash: string | null;
  eligibilityVerdictJson: unknown | null;
  eligibilityVerdictHash: string | null;
  downstreamKind: string;
  downstreamRef: string | null;
  simulated: boolean;
  reasonCode: string | null;
  errorCode: string | null;
  reservedAt: Date;
  delegatedAt: Date | null;
  settledAt: Date | null;
};

export type ReserveWorkflowStepResult = {
  kind: "created" | "replayed" | "action_replayed";
  execution: WorkflowStepExecutionRecord;
  shouldCallDownstream: boolean;
};

function actionKeyForReservation(
  input: ReserveWorkflowStepInput,
  run: RoutineRunRecord,
): string | null {
  const customerFacing = input.actionKind === "conversation_reply" || input.actionKind === "broadcast_run";
  if (!customerFacing) {
    if (input.actionOccurrence !== null || input.target !== null) fail("INVALID_ARGUMENT");
    return null;
  }
  if (!input.actionOccurrence || !input.target) fail("INVALID_ARGUMENT");
  if (
    !compact(input.target.contactId) ||
    !compact(input.target.contactIdentityId) ||
    !compact(input.target.channel) ||
    (input.target.providerConnectionId !== null && !compact(input.target.providerConnectionId)) ||
    !compact(input.target.purpose) ||
    !WORKFLOW_PURPOSES.has(input.target.purpose)
  ) {
    fail("INVALID_ARGUMENT");
  }
  const occurrence = input.actionOccurrence;
  if (occurrence.ownerId !== input.ownerId) fail("INVALID_ARGUMENT");
  if (occurrence.kind === "journey_step") {
    if (
      occurrence.workflowDefinitionId !== run.workflowDefinitionId ||
      occurrence.contactJourneyStateId !== run.contactJourneyStateId ||
      occurrence.stepKey !== input.stepKey
    ) {
      fail("INVALID_ARGUMENT");
    }
  } else if (occurrence.kind === "scheduled_routine") {
    if (
      run.triggerKind !== "schedule" ||
      run.scheduledFor === null ||
      occurrence.workflowDefinitionId !== run.workflowDefinitionId ||
      occurrence.routineKey !== run.routineKey ||
      occurrence.stepKey !== input.stepKey ||
      finiteDate(occurrence.scheduledFor).getTime() !== run.scheduledFor.getTime()
    ) {
      fail("INVALID_ARGUMENT");
    }
  } else if (
    run.triggerKind !== "customer_message" ||
    run.triggerEventRef === null ||
    run.triggerOccurrenceRef !== `message:${occurrence.customerMessageSourceEventKey}` ||
    occurrence.channel !== input.target.channel
  ) {
    fail("INVALID_ARGUMENT");
  }
  return deriveActionIdempotencyKey(occurrence);
}

function unavailableActionKey(
  input: ReserveWorkflowStepInput,
  run: RoutineRunRecord,
): string {
  if (
    (input.preDispatchUnavailableReason !== "workflow_dependency_unavailable" &&
      input.preDispatchUnavailableReason !== "workflow_target_unavailable") ||
    input.target !== null ||
    input.actionOccurrence !== null ||
    (input.actionKind !== "conversation_reply" && input.actionKind !== "broadcast_run")
  ) {
    fail("INVALID_ARGUMENT");
  }
  return deriveNoTargetActionIdempotencyKey({
    ownerId: input.ownerId,
    workflowDefinitionId: run.workflowDefinitionId,
    routineKey: run.routineKey,
    triggerKind: run.triggerKind,
    triggerOccurrenceRef: run.triggerOccurrenceRef,
    contactJourneyStateId: run.contactJourneyStateId,
    scheduledFor: run.scheduledFor,
    stepKey: input.stepKey,
  });
}

function sameStepReservation(
  row: WorkflowStepExecutionRecord,
  expected: WorkflowStepExecutionRecord,
): boolean {
  return (
    row.routineRunId === expected.routineRunId &&
    row.contactJourneyStateId === expected.contactJourneyStateId &&
    row.workflowRevisionId === expected.workflowRevisionId &&
    row.stepKey === expected.stepKey &&
    row.actionKind === expected.actionKind &&
    row.actionPayloadHash === expected.actionPayloadHash &&
    row.actionIdempotencyKey === expected.actionIdempotencyKey &&
    row.contactId === expected.contactId &&
    row.contactIdentityId === expected.contactIdentityId &&
    row.channel === expected.channel &&
    row.providerConnectionId === expected.providerConnectionId &&
    row.purpose === expected.purpose &&
    (!isPreDispatchUnavailableReason(expected.reasonCode) ||
      row.reasonCode === expected.reasonCode)
  );
}

function scopeAllowsStep(
  scope: RoutineAuthorizationScope,
  input: ReserveWorkflowStepInput,
  existingRunStepCount: number,
  existingRunRecipientIds: ReadonlySet<string>,
): boolean {
  if (!scope.actionKinds.includes(input.actionKind) || existingRunStepCount >= scope.maxActions) return false;
  if (input.target === null) return true;
  if (
    !scope.contactIds.includes(input.target.contactId) ||
    (!existingRunRecipientIds.has(input.target.contactId) && existingRunRecipientIds.size >= scope.maxRecipients)
  ) {
    return false;
  }
  return scope.channelScopes.some(
    (entry) =>
      entry.channel === input.target!.channel &&
      entry.providerConnectionId === input.target!.providerConnectionId,
  );
}

export async function reserveWorkflowStepInTransaction(
  tx: WorkflowJourneyTransaction,
  input: ReserveWorkflowStepInput,
): Promise<ReserveWorkflowStepResult> {
  if (
    !compact(input.id) ||
    !compact(input.ownerId) ||
    !compact(input.routineRunId) ||
    !compact(input.stepKey) ||
    !(WORKFLOW_ACTION_KINDS as readonly unknown[]).includes(input.actionKind)
  ) {
    fail("INVALID_ARGUMENT");
  }
  const now = finiteDate(input.now);
  const actionPayloadHash = canonicalHash("c7-workflow-action-payload:v1", input.actionPayload);
  const loaded = await verifyRoutineRunAuthorityInTransaction(
      tx as WorkflowEngineTransaction,
      input.ownerId,
      input.routineRunId,
      now,
    );
    if (TERMINAL_RUN_STATUSES.has(loaded.run.status)) fail("RUN_TERMINAL");
    const customerFacing = input.actionKind === "conversation_reply" || input.actionKind === "broadcast_run";
    const actionIdempotencyKey = input.preDispatchUnavailableReason
      ? unavailableActionKey(input, loaded.run)
      : !loaded.authority.ok && customerFacing && input.actionOccurrence === null && input.target === null
        ? deriveNoTargetActionIdempotencyKey({
            ownerId: input.ownerId,
            workflowDefinitionId: loaded.run.workflowDefinitionId,
            routineKey: loaded.run.routineKey,
            triggerKind: loaded.run.triggerKind,
            triggerOccurrenceRef: loaded.run.triggerOccurrenceRef,
            contactJourneyStateId: loaded.run.contactJourneyStateId,
            scheduledFor: loaded.run.scheduledFor,
            stepKey: input.stepKey,
          })
        : actionKeyForReservation(input, loaded.run);
    const stepIdempotencyKey = deriveStepIdempotencyKey({
      ownerId: input.ownerId,
      routineRunId: input.routineRunId,
      contactJourneyStateId: loaded.run.contactJourneyStateId,
      stepKey: input.stepKey,
    });
    const runSteps = (await tx.workflowStepExecution.findMany({
      where: { ownerId: input.ownerId, routineRunId: input.routineRunId },
    })) as WorkflowStepExecutionRecord[];
    const priorRunSteps = runSteps.filter((row) => row.stepIdempotencyKey !== stepIdempotencyKey);
    const priorRunRecipientIds = new Set(
      priorRunSteps.flatMap((row) => row.contactId === null ? [] : [row.contactId]),
    );
    const scopeAllowed = loaded.authority.ok && scopeAllowsStep(
      loaded.authority.snapshot.scopeJson,
      input,
      priorRunSteps.length,
      priorRunRecipientIds,
    );
    const expected: WorkflowStepExecutionRecord = {
      id: input.id,
      ownerId: input.ownerId,
      routineRunId: input.routineRunId,
      contactJourneyStateId: loaded.run.contactJourneyStateId,
      workflowRevisionId: loaded.run.workflowRevisionId,
      contactId: input.target?.contactId ?? null,
      contactIdentityId: input.target?.contactIdentityId ?? null,
      channel: input.target?.channel ?? null,
      providerConnectionId: input.target?.providerConnectionId ?? null,
      stepKey: input.stepKey,
      actionKind: input.actionKind,
      actionPayloadHash,
      stepIdempotencyKey,
      actionIdempotencyKey,
      status: !loaded.authority.ok
        ? "blocked"
        : scopeAllowed
          ? "reserved"
          : "blocked",
      purpose: input.target?.purpose ?? null,
      callerClass: input.target ? "unconfirmed_automatic" : null,
      eligibilityInputHash: null,
      eligibilityVerdictJson: null,
      eligibilityVerdictHash: null,
      downstreamKind: "none",
      downstreamRef: null,
      simulated: true,
      reasonCode: !loaded.authority.ok
        ? `routine_authority_${loaded.authority.reason}`
        : scopeAllowed
          ? input.preDispatchUnavailableReason ?? null
          : "routine_scope_denied",
      errorCode: null,
      reservedAt: now,
      delegatedAt: null,
      settledAt: loaded.authority.ok && scopeAllowed ? null : now,
    };

    const existingRows = (await tx.workflowStepExecution.findMany({
      where: {
        ownerId: input.ownerId,
        OR: [
          { stepIdempotencyKey },
          ...(actionIdempotencyKey === null ? [] : [{ actionIdempotencyKey }]),
        ],
      },
    })) as WorkflowStepExecutionRecord[];
    const byStep = existingRows.find((row) => row.stepIdempotencyKey === stepIdempotencyKey);
    const byAction = actionIdempotencyKey === null
      ? undefined
      : existingRows.find((row) => row.actionIdempotencyKey === actionIdempotencyKey);
    if (byStep && byAction && byStep.id !== byAction.id) fail("IDEMPOTENCY_CONFLICT");
    if (byStep) {
      if (!sameStepReservation(byStep, expected)) fail("IDEMPOTENCY_CONFLICT");
      return {
        kind: "replayed",
        execution: byStep,
        shouldCallDownstream:
          byStep.status === "reserved" &&
          loaded.authority.ok &&
          scopeAllowed &&
          !input.preDispatchUnavailableReason,
      };
    }
    if (byAction) {
      if (byAction.actionPayloadHash !== actionPayloadHash || byAction.actionKind !== input.actionKind) {
        fail("IDEMPOTENCY_CONFLICT");
      }
      return { kind: "action_replayed", execution: byAction, shouldCallDownstream: false };
    }

    const inserted = await tx.workflowStepExecution.createMany({
      data: [
        {
          id: expected.id,
          ownerId: expected.ownerId,
          routineRunId: expected.routineRunId,
          contactJourneyStateId: expected.contactJourneyStateId,
          workflowRevisionId: expected.workflowRevisionId,
          contactId: expected.contactId,
          contactIdentityId: expected.contactIdentityId,
          channel: expected.channel,
          providerConnectionId: expected.providerConnectionId,
          stepKey: expected.stepKey,
          actionKind: expected.actionKind,
          actionPayloadHash,
          stepIdempotencyKey,
          actionIdempotencyKey,
          status: expected.status,
          purpose: expected.purpose,
          callerClass: expected.callerClass,
          downstreamKind: "none",
          simulated: true,
          reasonCode: expected.reasonCode,
          reservedAt: now,
          settledAt: expected.settledAt,
        },
      ],
      skipDuplicates: true,
    });
    const rows = (await tx.workflowStepExecution.findMany({
      where: {
        ownerId: input.ownerId,
        OR: [
          { stepIdempotencyKey },
          ...(actionIdempotencyKey === null ? [] : [{ actionIdempotencyKey }]),
        ],
      },
    })) as WorkflowStepExecutionRecord[];
    const persistedByStep = rows.find((row) => row.stepIdempotencyKey === stepIdempotencyKey);
    const persistedByAction = actionIdempotencyKey === null
      ? undefined
      : rows.find((row) => row.actionIdempotencyKey === actionIdempotencyKey);
    if (persistedByStep) {
      if (!sameStepReservation(persistedByStep, expected)) fail("IDEMPOTENCY_CONFLICT");
      return {
        kind: inserted.count === 1 ? "created" : "replayed",
        execution: persistedByStep,
        shouldCallDownstream:
          persistedByStep.status === "reserved" &&
          loaded.authority.ok &&
          scopeAllowed &&
          !input.preDispatchUnavailableReason,
      };
    }
    if (persistedByAction) {
      if (persistedByAction.actionPayloadHash !== actionPayloadHash) fail("IDEMPOTENCY_CONFLICT");
      return { kind: "action_replayed", execution: persistedByAction, shouldCallDownstream: false };
    }
  fail("RESOURCE_NOT_FOUND");
}

export async function reserveWorkflowStep(
  db: WorkflowJourneyDb,
  input: ReserveWorkflowStepInput,
): Promise<ReserveWorkflowStepResult> {
  // DB lifecycle wrapper only. The shared workflow service remains the sole dispatch seam.
  return db.$transaction((tx) => reserveWorkflowStepInTransaction(tx, input));
}

export type WorkflowStepSettlement =
  | {
      status: "blocked";
      reasonCode: string;
      eligibilityInput?: unknown;
      eligibilityVerdict?: unknown;
    }
  | {
      status: "unavailable";
      reasonCode: string;
      eligibilityInput?: unknown;
      eligibilityVerdict?: unknown;
    }
  | { status: "failed"; errorCode: string }
  | {
      status: "simulated";
      eligibilityInput?: unknown;
      eligibilityVerdict?: unknown;
    }
  | {
      status: "delegated";
      downstreamKind: "conversation_reply" | "broadcast_run";
      downstreamRef: string;
      eligibilityInput: unknown;
      eligibilityVerdict: unknown;
    };

export type SettleWorkflowStepInput = {
  ownerId: string;
  stepExecutionId: string;
  settlement: WorkflowStepSettlement;
  now: Date;
};

type EligibilityEvidence = {
  inputHash: string;
  verdictJson: unknown;
  verdictHash: string;
  allAxesPass: boolean;
};

function customerEligibilityEvidence(
  row: WorkflowStepExecutionRecord,
  eligibilityInput: unknown,
  eligibilityVerdict: unknown,
): EligibilityEvidence {
  if (
    row.contactId === null ||
    row.contactIdentityId === null ||
    row.channel === null ||
    row.purpose === null ||
    row.callerClass !== "unconfirmed_automatic" ||
    row.purpose === REACTIVE_SERVICE_REPLY
  ) {
    fail("INVALID_ARGUMENT");
  }
  const expectedInput = {
    ownerId: row.ownerId,
    contactId: row.contactId,
    contactIdentityId: row.contactIdentityId,
    channel: row.channel,
    providerConnectionId: row.providerConnectionId,
    purpose: row.purpose,
    callerClass: "unconfirmed_automatic",
  };
  const inputJson = canonicalOrInvalid(eligibilityInput);
  if (
    inputJson !== canonicalOrInvalid(expectedInput) ||
    !isRecord(eligibilityVerdict) ||
    !hasExactKeys(eligibilityVerdict, [...ELIGIBILITY_AXES, "aggregate", "checkedAt"]) ||
    typeof eligibilityVerdict.checkedAt !== "string" ||
    !Number.isFinite(new Date(eligibilityVerdict.checkedAt).getTime()) ||
    !isRecord(eligibilityVerdict.aggregate) ||
    !hasExactKeys(eligibilityVerdict.aggregate, ["status", "reason"]) ||
    eligibilityVerdict.aggregate.status !== "unavailable" ||
    eligibilityVerdict.aggregate.reason !== "SEND_PATH_UNAVAILABLE"
  ) {
    fail("INVALID_ARGUMENT");
  }

  let allAxesPass = true;
  for (const axisName of ELIGIBILITY_AXES) {
    const axis = eligibilityVerdict[axisName];
    if (
      !isRecord(axis) ||
      !hasExactKeys(axis, ["status", "source", "checkedAt"], ["reason"]) ||
      !ELIGIBILITY_AXIS_STATUSES.has(axis.status as string) ||
      !compact(axis.source) ||
      typeof axis.checkedAt !== "string" ||
      !Number.isFinite(new Date(axis.checkedAt).getTime()) ||
      axis.checkedAt !== eligibilityVerdict.checkedAt ||
      (axis.reason !== undefined && !compact(axis.reason))
    ) {
      fail("INVALID_ARGUMENT");
    }
    if (axis.status !== "pass") allAxesPass = false;
  }
  canonicalOrInvalid(eligibilityVerdict);
  return {
    inputHash: canonicalHash("c7-eligibility-input:v1", expectedInput),
    verdictJson: eligibilityVerdict,
    verdictHash: canonicalHash("c7-eligibility-verdict:v1", eligibilityVerdict),
    allAxesPass,
  };
}

function eligibilityEvidence(
  row: WorkflowStepExecutionRecord,
  eligibilityInput: unknown | undefined,
  eligibilityVerdict: unknown | undefined,
): EligibilityEvidence | null {
  const customerFacing = row.actionKind === "conversation_reply" || row.actionKind === "broadcast_run";
  if (!customerFacing) {
    if (eligibilityInput !== undefined || eligibilityVerdict !== undefined) fail("INVALID_ARGUMENT");
    return null;
  }
  if (eligibilityInput === undefined || eligibilityVerdict === undefined) fail("INVALID_ARGUMENT");
  return customerEligibilityEvidence(row, eligibilityInput, eligibilityVerdict);
}

function plannedSettlement(
  row: WorkflowStepExecutionRecord,
  settlement: WorkflowStepSettlement,
  now: Date,
): Partial<WorkflowStepExecutionRecord> {
  if (settlement.status === "blocked" || settlement.status === "unavailable") {
    if (!compact(settlement.reasonCode)) fail("INVALID_ARGUMENT");
    const targetlessUnavailable =
      settlement.status === "unavailable" &&
      (row.actionKind === "conversation_reply" || row.actionKind === "broadcast_run") &&
      row.contactId === null &&
      row.contactIdentityId === null &&
      row.channel === null &&
      row.purpose === null &&
      row.callerClass === null &&
      settlement.eligibilityInput === undefined &&
      settlement.eligibilityVerdict === undefined;
    if (
      targetlessUnavailable &&
      isPreDispatchUnavailableReason(row.reasonCode) &&
      settlement.reasonCode !== row.reasonCode
    ) {
      fail("IDEMPOTENCY_CONFLICT");
    }
    const evidence = targetlessUnavailable
      ? null
      : eligibilityEvidence(row, settlement.eligibilityInput, settlement.eligibilityVerdict);
    return {
      status: settlement.status,
      reasonCode: settlement.reasonCode,
      eligibilityInputHash: evidence?.inputHash ?? null,
      eligibilityVerdictJson: evidence?.verdictJson ?? null,
      eligibilityVerdictHash: evidence?.verdictHash ?? null,
      downstreamKind: "none",
      downstreamRef: null,
      settledAt: now,
    };
  }
  if (settlement.status === "failed") {
    if (!compact(settlement.errorCode)) fail("INVALID_ARGUMENT");
    return {
      status: "failed",
      errorCode: settlement.errorCode,
      downstreamKind: "none",
      downstreamRef: null,
      settledAt: now,
    };
  }

  const customerFacing = row.actionKind === "conversation_reply" || row.actionKind === "broadcast_run";
  const evidence = eligibilityEvidence(row, settlement.eligibilityInput, settlement.eligibilityVerdict);
  if (settlement.status === "simulated") {
    if (customerFacing && !evidence?.allAxesPass) fail("INVALID_ARGUMENT");
    return {
      status: "simulated",
      eligibilityInputHash: evidence?.inputHash ?? null,
      eligibilityVerdictJson: evidence?.verdictJson ?? null,
      eligibilityVerdictHash: evidence?.verdictHash ?? null,
      downstreamKind: "none",
      downstreamRef: null,
      settledAt: now,
    };
  }
  if (!customerFacing || settlement.downstreamKind !== row.actionKind) fail("INVALID_ARGUMENT");
  if (!evidence?.allAxesPass || row.purpose === STRICT_CLASSIFICATION_UNAVAILABLE) fail("INVALID_ARGUMENT");
  if (!compact(settlement.downstreamRef)) fail("INVALID_ARGUMENT");
  return {
    status: "delegated",
    eligibilityInputHash: evidence.inputHash,
    eligibilityVerdictJson: evidence.verdictJson,
    eligibilityVerdictHash: evidence.verdictHash,
    downstreamKind: settlement.downstreamKind,
    downstreamRef: settlement.downstreamRef,
    delegatedAt: now,
    settledAt: now,
  };
}

function settlementComparison(row: Partial<WorkflowStepExecutionRecord>): unknown {
  return {
    status: row.status ?? null,
    reasonCode: row.reasonCode ?? null,
    errorCode: row.errorCode ?? null,
    eligibilityInputHash: row.eligibilityInputHash ?? null,
    eligibilityVerdictJson: row.eligibilityVerdictJson ?? null,
    eligibilityVerdictHash: row.eligibilityVerdictHash ?? null,
    downstreamKind: row.downstreamKind ?? "none",
    downstreamRef: row.downstreamRef ?? null,
    delegated: row.delegatedAt !== null && row.delegatedAt !== undefined,
    settled: row.settledAt !== null && row.settledAt !== undefined,
  };
}

function sameSettlement(
  row: WorkflowStepExecutionRecord,
  expected: Partial<WorkflowStepExecutionRecord>,
): boolean {
  return canonicalJson(settlementComparison(row)) === canonicalJson(settlementComparison(expected));
}

function isLateDelegationAuthorityReason(value: string | null): boolean {
  return value !== null && /^delegated_then_routine_authority_(?:kill|status|expired|hash_drift|budget_unavailable)$/.test(value);
}

function replaySettlement(
  row: WorkflowStepExecutionRecord,
  expected: Partial<WorkflowStepExecutionRecord>,
): Partial<WorkflowStepExecutionRecord> {
  return row.status === "delegated" &&
    expected.status === "delegated" &&
    isLateDelegationAuthorityReason(row.reasonCode)
    ? { ...expected, reasonCode: row.reasonCode }
    : expected;
}

export async function settleWorkflowStepInTransaction(
  tx: WorkflowJourneyTransaction,
  input: SettleWorkflowStepInput,
): Promise<WorkflowStepExecutionRecord> {
  if (!compact(input.ownerId) || !compact(input.stepExecutionId)) fail("INVALID_ARGUMENT");
  const now = finiteDate(input.now);
  const current = (await tx.workflowStepExecution.findFirst({
      where: { id: input.stepExecutionId, ownerId: input.ownerId },
    })) as WorkflowStepExecutionRecord | null;
    if (!current) fail("RESOURCE_NOT_FOUND");
    const requested = plannedSettlement(current, input.settlement, now);
    if (current.status !== "reserved") {
      if (!SETTLED_STEP_STATUSES.has(current.status)) fail("STEP_NOT_RESERVED");
      const replayExpected = replaySettlement(current, requested);
      if (!sameSettlement(current, replayExpected)) fail("IDEMPOTENCY_CONFLICT");
      return current;
    }

    const loaded = await verifyRoutineRunAuthorityInTransaction(
      tx as WorkflowEngineTransaction,
      input.ownerId,
      current.routineRunId,
      now,
    );
    const effective: Partial<WorkflowStepExecutionRecord> = loaded.authority.ok
      ? requested
      : input.settlement.status === "delegated"
        ? {
            ...requested,
            status: "delegated",
            reasonCode: `delegated_then_routine_authority_${loaded.authority.reason}`,
            errorCode: null,
            settledAt: now,
          }
        : {
            status: "blocked",
            reasonCode: `routine_authority_${loaded.authority.reason}`,
            errorCode: null,
            eligibilityInputHash: null,
            eligibilityVerdictJson: null,
            eligibilityVerdictHash: null,
            downstreamKind: "none",
            downstreamRef: null,
            delegatedAt: null,
            settledAt: now,
          };
    const updated = await tx.workflowStepExecution.updateMany({
      where: { id: current.id, ownerId: input.ownerId, status: "reserved" },
      data: {
        status: effective.status!,
        reasonCode: effective.reasonCode ?? null,
        errorCode: effective.errorCode ?? null,
        eligibilityInputHash: effective.eligibilityInputHash ?? null,
        eligibilityVerdictJson:
          effective.eligibilityVerdictJson === null || effective.eligibilityVerdictJson === undefined
            ? Prisma.DbNull
            : effective.eligibilityVerdictJson as Prisma.InputJsonValue,
        eligibilityVerdictHash: effective.eligibilityVerdictHash ?? null,
        downstreamKind: effective.downstreamKind ?? "none",
        downstreamRef: effective.downstreamRef ?? null,
        delegatedAt: effective.delegatedAt ?? null,
        settledAt: now,
      },
    });
    if (updated.count !== 1) {
      const raced = (await tx.workflowStepExecution.findFirst({
        where: { id: current.id, ownerId: input.ownerId },
      })) as WorkflowStepExecutionRecord | null;
      if (!raced) fail("RESOURCE_NOT_FOUND");
      if (!sameSettlement(raced, replaySettlement(raced, effective))) fail("IDEMPOTENCY_CONFLICT");
      return raced;
    }
    const settled = (await tx.workflowStepExecution.findFirst({
      where: { id: current.id, ownerId: input.ownerId },
    })) as WorkflowStepExecutionRecord | null;
    if (!settled) fail("RESOURCE_NOT_FOUND");
  return settled;
}

export async function settleWorkflowStep(
  db: WorkflowJourneyDb,
  input: SettleWorkflowStepInput,
): Promise<WorkflowStepExecutionRecord> {
  // DB lifecycle wrapper only. The shared workflow service remains the sole dispatch seam.
  return db.$transaction((tx) => settleWorkflowStepInTransaction(tx, input));
}
