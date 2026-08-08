import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveNoTargetActionIdempotencyKey,
  prisma,
  type Prisma,
  type PrismaClient,
} from "@fikirtive/db";
import * as gateway from "../customer-workflow-gateway";
import {
  workflowLifecycleService,
  type CustomerWorkflowPrincipal,
} from "../customer-workflow-service";

const auth = vi.hoisted(() => ({
  ownerId: "c7-m1-test-org-a",
  email: "c7-m1-owner-a@example.test",
  impersonating: false,
}));

vi.mock("../auth-guard", () => ({
  requireOwner: vi.fn(async () => ({ ownerId: auth.ownerId, email: auth.email })),
}));
vi.mock("../better-auth/compat", () => ({
  isImpersonating: vi.fn(async () => auth.impersonating),
}));

const NOW = new Date("2026-07-22T08:00:00.000Z");
const ORG_A = "c7-m1-test-org-a";
const ORG_B = "c7-m1-test-org-b";
const USER_A = "c7-m1-test-user-a";
const USER_ADMIN = "c7-m1-test-user-admin";
const USER_B = "c7-m1-test-user-b";
const OWNER_A = "c7-m1-test-owner-a";
const ADMIN_A = "c7-m1-test-admin-a";
const OWNER_B = "c7-m1-test-owner-b";
const SCOPE_A = "c7-m1-test-scope-a";
const SCOPE_B = "c7-m1-test-scope-b";
const CONTACT_KILL = "c7-m1-test-contact-kill";
const CONTACT_BLOCK = "c7-m1-test-contact-block";
const CONTACT_PASS = "c7-m1-test-contact-pass";
const CONTACT_B = "c7-m1-test-contact-b";
const IDENTITY_KILL = "c7-m1-test-identity-kill";
const IDENTITY_BLOCK = "c7-m1-test-identity-block";
const IDENTITY_PASS = "c7-m1-test-identity-pass";
const IDENTITY_B = "c7-m1-test-identity-b";
const TEMPLATE_A = "c7-m1-test-template-a";
const TEMPLATE_B = "c7-m1-test-template-b";
const TEMPLATE_VERSION_A = "c7-m1-test-template-version-a";
const TEMPLATE_VERSION_B = "c7-m1-test-template-version-b";
const POLICY_B = "c7-m1-test-policy-b";
const REAL_TEMPLATE_TAXONOMY = Object.freeze({
  purposeClass: "proactive_non_transactional",
  category: "marketing",
});
const OWNERS = [ORG_A, ORG_B];

const principalA: CustomerWorkflowPrincipal = {
  ownerId: ORG_A,
  membershipId: OWNER_A,
  impersonating: false,
};
const principalB: CustomerWorkflowPrincipal = {
  ownerId: ORG_B,
  membershipId: OWNER_B,
  impersonating: false,
};
const adminA: CustomerWorkflowPrincipal = {
  ownerId: ORG_A,
  membershipId: ADMIN_A,
  impersonating: false,
};
const workerA = Object.freeze({ claim: "queue-claim-a" });
const workerB = Object.freeze({ claim: "queue-claim-b" });

function resolveWorkerContext(context: unknown) {
  if (context === workerA) {
    return { ownerId: ORG_A, queueJobId: "job-a", leaseId: "lease-a", fencingToken: "fence-a" };
  }
  if (context === workerB) {
    return { ownerId: ORG_B, queueJobId: "job-b", leaseId: "lease-b", fencingToken: "fence-b" };
  }
  return null;
}

let sequence = 0;
let workflows = workflowLifecycleService(prisma, {
  clock: () => NOW,
  id: () => `c7-m1-test-generated-${++sequence}`,
  resolveWorkerContext,
});

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected ${code}`);
  } catch (error) {
    if (error instanceof Error && error.message === `Expected ${code}`) throw error;
    expect(errorCode(error)).toBe(code);
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function captureOutcome<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ kind: "fulfilled" as const, value }),
    (error: unknown) => ({ kind: "rejected" as const, error }),
  );
}

function createTransactionBarrierHarness(
  wrapTransaction: (tx: Prisma.TransactionClient) => Prisma.TransactionClient,
  backendPids: number[] = [],
  onTransactionStart?: () => Promise<void>,
): PrismaClient {
  return new Proxy(prisma, {
    get(target, prop, receiver) {
      if (prop === "$transaction") {
        return async <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
          target.$transaction(async (tx) => {
            const connection = await tx.$queryRaw<Array<{ backendPid: number }>>`
              SELECT pg_backend_pid()::int AS "backendPid"
            `;
            backendPids.push(connection[0]!.backendPid);
            await onTransactionStart?.();
            return callback(wrapTransaction(tx));
          });
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as PrismaClient;
}

function proxyDelegateMethod(
  tx: Prisma.TransactionClient,
  delegateName: string,
  methodName: string,
  around: (invoke: () => Promise<unknown>, args: unknown[]) => Promise<unknown>,
): Prisma.TransactionClient {
  const delegate = (tx as unknown as Record<string, unknown>)[delegateName] as object;
  const delegateProxy = new Proxy(delegate, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === methodName && typeof value === "function") {
        return (...args: unknown[]) => around(
          () => Reflect.apply(value, target, args) as Promise<unknown>,
          args,
        );
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return new Proxy(tx, {
    get(target, prop, receiver) {
      if (prop === delegateName) return delegateProxy;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function proxyTransactionMethod(
  tx: Prisma.TransactionClient,
  methodName: "$queryRaw" | "$executeRaw",
  afterInvoke: () => void,
): Prisma.TransactionClient {
  return new Proxy(tx, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === methodName && typeof value === "function") {
        return (...args: unknown[]) => {
          const pending = Promise.resolve(Reflect.apply(value, target, args));
          queueMicrotask(afterInvoke);
          return pending;
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function expectPostgresBlockedBy(blockedPid: number, blockerPid: number): Promise<void> {
  let observed = false;
  for (let attempt = 0; attempt < 50 && !observed; attempt += 1) {
    const rows = await prisma.$queryRaw<Array<{ isBlocked: boolean }>>`
      SELECT ${blockerPid}::int = ANY(pg_blocking_pids(${blockedPid}::int)) AS "isBlocked"
    `;
    observed = rows[0]?.isBlocked === true;
  }
  expect(observed).toBe(true);
}

function source(
  templateVersionId: string,
  action: "broadcast_run" | "conversation_reply",
  trigger: "manual" | "schedule" | "journey_due" = "journey_due",
) {
  return [
    "version: fikirtive-workflow/v1",
    `name: ${action}`,
    "trigger:",
    `  type: ${trigger}`,
    "conditions: []",
    "steps:",
    "  - key: send_offer",
    "    action:",
    `      type: ${action}`,
    `      templateVersionRef: ${templateVersionId}`,
  ].join("\n");
}

function customerMessageSource(templateVersionId: string, policyId: string) {
  return [
    "version: fikirtive-workflow/v1",
    "name: business_hours_auto_reply",
    "trigger:",
    "  type: customer_message",
    "conditions:",
    "  - type: outside_business_hours",
    `    policyRef: ${policyId}`,
    "steps:",
    "  - key: send_offer",
    "    action:",
    "      type: conversation_reply",
    `      templateVersionRef: ${templateVersionId}`,
  ].join("\n");
}

function routineScope(
  action: "broadcast_run" | "conversation_reply",
  contactIds: string[],
) {
  return {
    actionKinds: [action],
    channelScopes: [{ channel: "whatsapp", providerConnectionId: null }],
    contactIds,
    segmentIds: [],
    maxActions: 8,
    maxRecipients: 8,
  };
}

async function cleanup(): Promise<void> {
  await prisma.workflowStepExecution.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.contactJourneyState.updateMany({
    where: { ownerId: { in: OWNERS } },
    data: { lastRoutineRunId: null },
  });
  await prisma.routineRun.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.contactJourneyState.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.routine.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.workflowDefinition.updateMany({
    where: { ownerId: { in: OWNERS } },
    data: { currentRevision: null, status: "draft" },
  });
  await prisma.workflowRevision.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.workflowDefinition.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.businessHoursPolicy.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.contactSendFrequencyEvent.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.consentStateProjection.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.customerMessageTemplateVersion.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.customerMessageTemplate.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.customerMessage.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.customerConversation.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.contactIdentity.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.channelScope.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.contact.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.membership.deleteMany({ where: { orgId: { in: OWNERS } } });
  await prisma.organization.deleteMany({ where: { id: { in: OWNERS } } });
  await prisma.user.deleteMany({ where: { id: { in: [USER_A, USER_ADMIN, USER_B] } } });
}

async function seed(): Promise<void> {
  await prisma.organization.createMany({ data: [{ id: ORG_A }, { id: ORG_B }] });
  await prisma.user.createMany({
    data: [
      { id: USER_A, email: "c7-m1-owner-a@example.test" },
      { id: USER_ADMIN, email: "c7-m1-admin-a@example.test" },
      { id: USER_B, email: "c7-m1-owner-b@example.test" },
    ],
  });
  await prisma.membership.createMany({
    data: [
      { id: OWNER_A, userId: USER_A, orgId: ORG_A, role: "owner" },
      { id: ADMIN_A, userId: USER_ADMIN, orgId: ORG_A, role: "admin" },
      { id: OWNER_B, userId: USER_B, orgId: ORG_B, role: "owner" },
    ],
  });
  await prisma.membershipRole.createMany({
    data: [
      { membershipId: OWNER_A, role: "owner" },
      { membershipId: ADMIN_A, role: "admin" },
      { membershipId: OWNER_B, role: "owner" },
    ],
  });
  await prisma.contact.createMany({
    data: [
      { id: CONTACT_KILL, ownerId: ORG_A, name: "Kill target", source: "whatsapp", firstTouchAt: NOW, lastSeenAt: NOW },
      { id: CONTACT_BLOCK, ownerId: ORG_A, name: "Blocked target", source: "whatsapp", firstTouchAt: NOW, lastSeenAt: NOW },
      { id: CONTACT_PASS, ownerId: ORG_A, name: "Passing target", source: "whatsapp", firstTouchAt: NOW, lastSeenAt: NOW },
      { id: CONTACT_B, ownerId: ORG_B, name: "Tenant B target", source: "whatsapp", firstTouchAt: NOW, lastSeenAt: NOW },
    ],
  });
  await prisma.channelScope.createMany({
    data: [
      { id: SCOPE_A, ownerId: ORG_A, channel: "whatsapp", scopeKey: "c7-waba-a" },
      { id: SCOPE_B, ownerId: ORG_B, channel: "whatsapp", scopeKey: "c7-waba-b" },
    ],
  });
  await prisma.contactIdentity.createMany({
    data: [
      { id: IDENTITY_KILL, ownerId: ORG_A, contactId: CONTACT_KILL, channelScopeId: SCOPE_A, channel: "whatsapp", externalId: "+60170000001" },
      { id: IDENTITY_BLOCK, ownerId: ORG_A, contactId: CONTACT_BLOCK, channelScopeId: SCOPE_A, channel: "whatsapp", externalId: "+60170000002" },
      { id: IDENTITY_PASS, ownerId: ORG_A, contactId: CONTACT_PASS, channelScopeId: SCOPE_A, channel: "whatsapp", externalId: "+60170000003" },
      { id: IDENTITY_B, ownerId: ORG_B, contactId: CONTACT_B, channelScopeId: SCOPE_B, channel: "whatsapp", externalId: "+60170000004" },
    ],
  });
  await prisma.customerMessageTemplate.createMany({
    data: [
      { id: TEMPLATE_A, ownerId: ORG_A, channelScopeId: SCOPE_A, channel: "whatsapp", name: "c7_offer_a", locale: "en_MY" },
      { id: TEMPLATE_B, ownerId: ORG_B, channelScopeId: SCOPE_B, channel: "whatsapp", name: "c7_offer_b", locale: "en_MY" },
    ],
  });
  await prisma.customerMessageTemplateVersion.createMany({
    data: [
      {
        id: TEMPLATE_VERSION_A,
        ownerId: ORG_A,
        templateId: TEMPLATE_A,
        revision: 1,
        ...REAL_TEMPLATE_TAXONOMY,
        definitionJson: { schemaVersion: 1, body: "Hello {{name}}", variables: [{ key: "name", sample: "Aisyah" }] },
        contentHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        createdByMembershipId: OWNER_A,
      },
      {
        id: TEMPLATE_VERSION_B,
        ownerId: ORG_B,
        templateId: TEMPLATE_B,
        revision: 1,
        ...REAL_TEMPLATE_TAXONOMY,
        definitionJson: { schemaVersion: 1, body: "Private B", variables: [] },
        contentHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        createdByMembershipId: OWNER_B,
      },
    ],
  });
  await prisma.businessHoursPolicy.create({
    data: {
      id: POLICY_B,
      ownerId: ORG_B,
      policyKey: "hours_b",
      revision: 1,
      name: "Tenant B private hours",
      timeZone: "Asia/Kuala_Lumpur",
      weeklyWindowsJson: [{ weekday: 3, startMinute: 540, endMinute: 1020 }],
      status: "published",
      contentHash: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      createdByMembershipId: OWNER_B,
    },
  });
  await prisma.consentStateProjection.createMany({
    data: [
      {
        ownerId: ORG_A,
        contactId: CONTACT_PASS,
        channel: "whatsapp",
        purpose: "marketing",
        state: "verified_grant",
        lastEventId: "c7-m1-test-consent-a",
        lastReceivedAt: NOW,
        stateActorKind: "customer",
        stateSourceKind: "explicit_inbox_optin",
        evidenceStatus: "verified",
      },
    ],
  });
}

type Lifecycle = Awaited<ReturnType<typeof createLifecycle>>;

async function createLifecycle(
  principal: CustomerWorkflowPrincipal,
  suffix: string,
  templateVersionId: string,
  action: "broadcast_run" | "conversation_reply",
  contactIds: string[],
  rulesSource = source(templateVersionId, action),
) {
  const definition = await workflows.createWorkflowDefinition(principal, {
    slug: `workflow-${suffix}`,
    name: `Workflow ${suffix}`,
    definitionKind: "journey",
    originKind: "custom",
  });
  const saved = await workflows.saveWorkflowRevision(principal, {
    workflowDefinitionId: definition.resource.id,
    rulesSource,
  });
  expect(saved.resource.validationState).toBe("valid");
  await workflows.publishWorkflowRevision(principal, {
    workflowDefinitionId: definition.resource.id,
    workflowRevisionId: saved.resource.id,
    expectedRowRevision: 0,
  });
  const draft = await workflows.createRoutineDraft(principal, {
    workflowDefinitionId: definition.resource.id,
    workflowRevisionId: saved.resource.id,
    routineKey: `routine_${suffix}`,
    scopeJson: routineScope(action, contactIds),
    maxCreditsPerRun: 0,
    maxCreditsPerMonth: 0,
    summaryPolicyJson: { mode: "counts_only" },
  });
  const activated = await workflows.activateRoutine(principal, {
    routineId: draft.resource.id,
    expectedRowRevision: 0,
  });
  return {
    definition: definition.resource,
    revision: saved.resource,
    routine: activated.resource,
    action,
    contactIds,
  };
}

async function dueRun(
  worker: typeof workerA | typeof workerB,
  lifecycle: Lifecycle,
  contactId: string,
  contactIdentityId: string,
  occurrence: string,
) {
  const enrolled = await workflows.enrollWorkflowJourney(worker, {
    routineId: lifecycle.routine.id,
    contactId,
    contactIdentityId,
    enrollmentOccurrenceRef: occurrence,
    initialStepKey: "send_offer",
    initialStateJson: {},
  });
  await workflows.enterWorkflowJourneyWait(worker, {
    journeyId: enrolled.journey.id,
    expectedRowRevision: 0,
    expectedWaitGeneration: 0,
    expectedCurrentStepKey: "send_offer",
    resumeStepKey: "send_offer",
    nextEligibleAt: NOW,
  });
  const due = await workflows.createWorkflowJourneyDueRun(worker, {
    journeyId: enrolled.journey.id,
    trustedTriggerPayload: { source: "test_due" },
  });
  if (due.kind !== "created" && due.kind !== "replayed") {
    throw new Error(`Expected due run, received ${due.kind}`);
  }
  return due.run;
}

beforeEach(async () => {
  await cleanup();
  await seed();
  sequence = 0;
  workflows = workflowLifecycleService(prisma, {
    clock: () => NOW,
    id: () => `c7-m1-test-generated-${++sequence}`,
    resolveWorkerContext,
  });
  auth.ownerId = ORG_A;
  auth.email = "c7-m1-owner-a@example.test";
  auth.impersonating = false;
  vi.clearAllMocks();
});

afterAll(cleanup);

describe("customer workflow lifecycle and dispatch", () => {
  // #720 — a routine key that is already taken is a naming collision, not an optimistic-lock
  // race. Returning CAS_CONFLICT made the UI tell the merchant "this workflow changed in
  // another session, refresh before trying again", which is false and points at a fix that can
  // never work. The two conditions must be distinguishable by code.
  it("reports a duplicate Routine key as ROUTINE_KEY_IN_USE, not as a concurrent-change conflict", async () => {
    const lifecycle = await createLifecycle(
      principalA,
      "dupkey",
      TEMPLATE_VERSION_A,
      "broadcast_run",
      [CONTACT_PASS],
    );
    await expectCode(
      workflows.createRoutineDraft(principalA, {
        workflowDefinitionId: lifecycle.definition.id,
        workflowRevisionId: lifecycle.revision.id,
        routineKey: lifecycle.routine.routineKey,
        scopeJson: routineScope("broadcast_run", [CONTACT_PASS]),
        maxCreditsPerRun: 0,
        maxCreditsPerMonth: 0,
        summaryPolicyJson: { mode: "counts_only" },
      }),
      "ROUTINE_KEY_IN_USE",
    );
    // A free key on the same workflow still works — the collision is about the key alone.
    const fresh = await workflows.createRoutineDraft(principalA, {
      workflowDefinitionId: lifecycle.definition.id,
      workflowRevisionId: lifecycle.revision.id,
      routineKey: "routine_dupkey_second",
      scopeJson: routineScope("broadcast_run", [CONTACT_PASS]),
      maxCreditsPerRun: 0,
      maxCreditsPerMonth: 0,
      summaryPolicyJson: { mode: "counts_only" },
    });
    expect(fresh.resource.status).toBe("draft");
  });

  // #721 — the exact behaviour the archived-workflow status line has to describe. Archiving is
  // not an off switch in any sense: the Routine stays active AND new runs keep being created
  // for it. Only killing the Routine stops it. Any UI copy claiming archive prevents runs is
  // false in the safe-sounding direction, which is the direction that gets merchants hurt.
  it("archiving stops nothing: the Routine stays active and new runs are still created", async () => {
    const lifecycle = await createLifecycle(
      principalA,
      "archivedruns",
      TEMPLATE_VERSION_A,
      "broadcast_run",
      [CONTACT_PASS],
    );
    await workflows.archiveWorkflowDefinition(principalA, {
      workflowDefinitionId: lifecycle.definition.id,
      expectedRowRevision: 1,
      acknowledgement: {
        message: "Archiving does not stop these 1 active Routines",
        routines: [{ id: lifecycle.routine.id, routineKey: lifecycle.routine.routineKey }],
      },
    });

    const archived = await prisma.workflowDefinition.findFirst({
      where: { id: lifecycle.definition.id, ownerId: ORG_A },
      select: { status: true },
    });
    expect(archived?.status).toBe("archived");

    const afterArchive = await prisma.routine.findFirst({
      where: { id: lifecycle.routine.id, ownerId: ORG_A },
      select: { status: true, killSwitchEngaged: true, rowRevision: true },
    });
    expect(afterArchive?.status).toBe("active");
    expect(afterArchive?.killSwitchEngaged).toBe(false);

    // A brand-new run, created after the workflow was archived.
    const run = await dueRun(workerA, lifecycle, CONTACT_PASS, IDENTITY_PASS, "archived-still-runs");
    expect(run.id).toBeTruthy();

    // The only thing that stops it is killing the Routine.
    const killed = await workflows.killRoutine(principalA, {
      routineId: lifecycle.routine.id,
      expectedRowRevision: afterArchive!.rowRevision,
      reasonCode: "merchant_kill_switch",
    });
    expect(killed.resource.killSwitchEngaged).toBe(true);
  });

  it("requires a real owner for activation and creates a new immutable envelope on reauthorization", async () => {
    const lifecycle = await createLifecycle(
      principalA,
      "owner",
      TEMPLATE_VERSION_A,
      "broadcast_run",
      [CONTACT_PASS],
    );
    const secondDraft = await workflows.createRoutineDraft(principalA, {
      workflowDefinitionId: lifecycle.definition.id,
      workflowRevisionId: lifecycle.revision.id,
      routineKey: "routine_owner_second",
      scopeJson: routineScope("broadcast_run", [CONTACT_PASS]),
      maxCreditsPerRun: 0,
      maxCreditsPerMonth: 0,
      summaryPolicyJson: { mode: "counts_only" },
    });
    await expectCode(
      workflows.activateRoutine(adminA, {
        routineId: secondDraft.resource.id,
        expectedRowRevision: 0,
      }),
      "ACTION_DENIED",
    );
    const reauthorized = await workflows.reauthorizeRoutine(principalA, {
      routineId: lifecycle.routine.id,
      expectedRowRevision: lifecycle.routine.rowRevision,
      workflowRevisionId: lifecycle.revision.id,
      scopeJson: routineScope("broadcast_run", [CONTACT_PASS]),
      maxCreditsPerRun: 0,
      maxCreditsPerMonth: 0,
      summaryPolicyJson: { mode: "counts_only" },
    });
    expect(reauthorized.resource.id).not.toBe(lifecycle.routine.id);
    expect(reauthorized.resource.supersedesRoutineId).toBe(lifecycle.routine.id);
    expect(reauthorized.resource.authorizationRevision).toBe(2);
    const old = await prisma.routine.findFirst({ where: { id: lifecycle.routine.id, ownerId: ORG_A } });
    expect(old?.status).toBe("revoked");
    expect(old?.authorizationHash).toBe(lifecycle.routine.authorizationHash);

    await expectCode(
      workflows.archiveWorkflowDefinition(principalA, {
        workflowDefinitionId: lifecycle.definition.id,
        expectedRowRevision: 1,
      }),
      "ACTIVE_ROUTINE_ACKNOWLEDGEMENT_REQUIRED",
    );
    await workflows.archiveWorkflowDefinition(principalA, {
      workflowDefinitionId: lifecycle.definition.id,
      expectedRowRevision: 1,
      acknowledgement: {
        message: "Archiving does not stop these 1 active Routines",
        routines: [
          { id: reauthorized.resource.id, routineKey: reauthorized.resource.routineKey },
        ],
      },
    });
    lifecycle.routine = reauthorized.resource;
    const continuedRun = await dueRun(
      workerA,
      lifecycle,
      CONTACT_PASS,
      IDENTITY_PASS,
      "archived-continued",
    );
    expect((await workflows.dispatchWorkflowStep(workerA, {
      routineRunId: continuedRun.id,
      stepKey: "send_offer",
    })).status).toBe("unavailable");
    await expectCode(
      workflows.reauthorizeRoutine(principalA, {
        routineId: reauthorized.resource.id,
        expectedRowRevision: reauthorized.resource.rowRevision,
        workflowRevisionId: lifecycle.revision.id,
        scopeJson: routineScope("broadcast_run", [CONTACT_PASS]),
        maxCreditsPerRun: 0,
        maxCreditsPerMonth: 0,
        summaryPolicyJson: { mode: "counts_only" },
      }),
      "AUTHORITY_UNAVAILABLE",
    );

    auth.email = "c7-m1-admin-a@example.test";
    await expect(gateway.createWorkflowDefinition({
      slug: "gateway-admin-denied",
      name: "Denied",
      definitionKind: "rule",
      originKind: "custom",
    })).resolves.toEqual({ ok: false, error: "ACTION_DENIED" });
    auth.email = "c7-m1-owner-a@example.test";
    auth.impersonating = true;
    await expect(gateway.listWorkflowDefinitions()).resolves.toEqual({
      ok: false,
      error: "ACTION_DENIED",
    });
  });

  it("requires an injected queue-lease verifier and ignores structurally forged worker context", async () => {
    const lifecycle = await createLifecycle(
      principalA,
      "worker-fence",
      TEMPLATE_VERSION_A,
      "broadcast_run",
      [CONTACT_PASS],
      source(TEMPLATE_VERSION_A, "broadcast_run", "manual"),
    );
    const noVerifier = workflowLifecycleService(prisma, { clock: () => NOW });
    const input = {
      routineId: lifecycle.routine.id,
      trigger: { kind: "manual" as const, operationId: "worker-fence" },
      trustedTriggerPayload: {},
    };
    await expectCode(noVerifier.createWorkflowRun(workerA, input), "AUTHORITY_UNAVAILABLE");
    await expectCode(
      workflows.createWorkflowRun({ claim: "queue-claim-a" }, input),
      "NOT_AUTHORIZED",
    );
    expect(await prisma.routineRun.count({ where: { ownerId: ORG_A } })).toBe(0);
  });

  it("pins all runs to the compiled trigger and records honest manual/schedule target unavailability", async () => {
    const manual = await createLifecycle(
      principalA,
      "manual",
      TEMPLATE_VERSION_A,
      "broadcast_run",
      [CONTACT_PASS],
      source(TEMPLATE_VERSION_A, "broadcast_run", "manual"),
    );
    await expectCode(
      workflows.createWorkflowRun(workerA, {
        routineId: manual.routine.id,
        trigger: { kind: "schedule", scheduledFor: NOW },
        trustedTriggerPayload: {},
      }),
      "INVALID_ARGUMENT",
    );
    const manualRun = await workflows.createWorkflowRun(workerA, {
      routineId: manual.routine.id,
      trigger: { kind: "manual", operationId: "manual-1" },
      trustedTriggerPayload: {},
    });
    if (manualRun.kind === "blocked") throw new Error("Expected manual run");
    const manualStep = await workflows.dispatchWorkflowStep(workerA, {
      routineRunId: manualRun.run.id,
      stepKey: "send_offer",
    });
    expect(manualStep).toMatchObject({
      status: "unavailable",
      reasonCode: "workflow_target_unavailable",
    });
    expect(manualStep.actionIdempotencyKey).toBe(deriveNoTargetActionIdempotencyKey({
      ownerId: ORG_A,
      workflowDefinitionId: manualRun.run.workflowDefinitionId,
      routineKey: manualRun.run.routineKey,
      triggerKind: manualRun.run.triggerKind,
      triggerOccurrenceRef: manualRun.run.triggerOccurrenceRef,
      contactJourneyStateId: manualRun.run.contactJourneyStateId,
      scheduledFor: manualRun.run.scheduledFor,
      stepKey: "send_offer",
    }));

    const schedule = await createLifecycle(
      principalA,
      "schedule",
      TEMPLATE_VERSION_A,
      "broadcast_run",
      [CONTACT_PASS],
      source(TEMPLATE_VERSION_A, "broadcast_run", "schedule"),
    );
    const scheduledRun = await workflows.createWorkflowRun(workerA, {
      routineId: schedule.routine.id,
      trigger: { kind: "schedule", scheduledFor: NOW },
      trustedTriggerPayload: {},
    });
    if (scheduledRun.kind === "blocked") throw new Error("Expected scheduled run");
    const scheduledStep = await workflows.dispatchWorkflowStep(workerA, {
      routineRunId: scheduledRun.run.id,
      stepKey: "send_offer",
    });
    expect(scheduledStep).toMatchObject({
      status: "unavailable",
      reasonCode: "workflow_target_unavailable",
    });
    expect(scheduledStep.actionIdempotencyKey).toBe(deriveNoTargetActionIdempotencyKey({
      ownerId: ORG_A,
      workflowDefinitionId: scheduledRun.run.workflowDefinitionId,
      routineKey: scheduledRun.run.routineKey,
      triggerKind: scheduledRun.run.triggerKind,
      triggerOccurrenceRef: scheduledRun.run.triggerOccurrenceRef,
      contactJourneyStateId: scheduledRun.run.contactJourneyStateId,
      scheduledFor: scheduledRun.run.scheduledFor,
      stepKey: "send_offer",
    }));
  });

  it("maps the real template-writer taxonomy into all four C5 eligibility axes", async () => {
    expect(await prisma.customerMessageTemplateVersion.findFirst({
      where: { id: TEMPLATE_VERSION_A, ownerId: ORG_A },
      select: { category: true, purposeClass: true },
    })).toEqual(REAL_TEMPLATE_TAXONOMY);
    const lifecycle = await createLifecycle(
      principalA,
      "real-template-taxonomy",
      TEMPLATE_VERSION_A,
      "broadcast_run",
      [CONTACT_PASS],
    );
    const run = await dueRun(
      workerA,
      lifecycle,
      CONTACT_PASS,
      IDENTITY_PASS,
      "real-template-taxonomy-1",
    );
    const execution = await workflows.dispatchWorkflowStep(workerA, {
      routineRunId: run.id,
      stepKey: "send_offer",
    });
    expect(execution).toMatchObject({
      status: "unavailable",
      reasonCode: "BROADCAST_ONE_MEMBER_SUBMIT_SEAM_UNAVAILABLE",
      purpose: "marketing",
      callerClass: "unconfirmed_automatic",
      eligibilityVerdictJson: {
        consentStop: { status: "pass" },
        doNotDisturb: { status: "pass" },
        providerRefusal: { status: "pass" },
        frequency: { status: "pass" },
      },
    });
  });

  it("persists unavailable for the known non-broadcast C4 transactional tuple", async () => {
    const purposeClass = "transactional";
    const category = "utility";
    const lifecycle = await createLifecycle(
      principalA,
      `unmapped-template-${category}-${purposeClass}`,
      TEMPLATE_VERSION_A,
      "broadcast_run",
      [CONTACT_PASS],
    );
    const run = await dueRun(
      workerA,
      lifecycle,
      CONTACT_PASS,
      IDENTITY_PASS,
      `unmapped-template-${category}-${purposeClass}`,
    );
    await prisma.customerMessageTemplateVersion.update({
      where: { id: TEMPLATE_VERSION_A, ownerId: ORG_A },
      data: { purposeClass, category },
    });
    const execution = await workflows.dispatchWorkflowStep(workerA, {
      routineRunId: run.id,
      stepKey: "send_offer",
    });
    expect(execution).toMatchObject({
      status: "unavailable",
      reasonCode: "workflow_dependency_unavailable",
      contactId: null,
      contactIdentityId: null,
      purpose: null,
      downstreamKind: "none",
      downstreamRef: null,
    });
    expect(execution.actionIdempotencyKey).toBe(deriveNoTargetActionIdempotencyKey({
      ownerId: ORG_A,
      workflowDefinitionId: run.workflowDefinitionId,
      routineKey: run.routineKey,
      triggerKind: run.triggerKind,
      triggerOccurrenceRef: run.triggerOccurrenceRef,
      contactJourneyStateId: run.contactJourneyStateId,
      scheduledFor: run.scheduledFor,
      stepKey: "send_offer",
    }));
    expect((await workflows.dispatchWorkflowStep(workerA, {
      routineRunId: run.id,
      stepKey: "send_offer",
    })).id).toBe(execution.id);
    expect(await prisma.workflowStepExecution.count({
      where: { ownerId: ORG_A, routineRunId: run.id },
    })).toBe(1);
    expect(await prisma.broadcastRun.count({ where: { ownerId: ORG_A } })).toBe(0);
    expect(await prisma.contactSendFrequencyEvent.count({ where: { ownerId: ORG_A } })).toBe(0);
  });

  it("kills before dispatch, records real separate axes, and keeps every downstream seam unavailable", async () => {
    const lifecycle = await createLifecycle(
      principalA,
      "dispatch",
      TEMPLATE_VERSION_A,
      "broadcast_run",
      [CONTACT_KILL, CONTACT_BLOCK, CONTACT_PASS],
    );
    const killedRun = await dueRun(workerA, lifecycle, CONTACT_KILL, IDENTITY_KILL, "kill-1");
    const killed = await workflows.killRoutine(principalA, {
      routineId: lifecycle.routine.id,
      expectedRowRevision: lifecycle.routine.rowRevision,
      reasonCode: "owner_stop",
    });
    const killedStep = await workflows.dispatchWorkflowStep(workerA, {
      routineRunId: killedRun.id,
      stepKey: "send_offer",
    });
    expect(killedStep).toMatchObject({
      status: "blocked",
      reasonCode: "routine_authority_kill",
      downstreamKind: "none",
      downstreamRef: null,
    });
    const killedKey = deriveNoTargetActionIdempotencyKey({
      ownerId: ORG_A,
      workflowDefinitionId: killedRun.workflowDefinitionId,
      routineKey: killedRun.routineKey,
      triggerKind: killedRun.triggerKind,
      triggerOccurrenceRef: killedRun.triggerOccurrenceRef,
      contactJourneyStateId: killedRun.contactJourneyStateId,
      scheduledFor: killedRun.scheduledFor,
      stepKey: "send_offer",
    });
    expect(killedStep.actionIdempotencyKey).toBe(killedKey);
    const killedReplay = await workflows.dispatchWorkflowStep(workerA, {
      routineRunId: killedRun.id,
      stepKey: "send_offer",
    });
    expect(killedReplay).toMatchObject({
      id: killedStep.id,
      status: "blocked",
      actionIdempotencyKey: killedKey,
      downstreamKind: "none",
      downstreamRef: null,
    });
    expect(await prisma.workflowStepExecution.count({ where: { ownerId: ORG_A } })).toBe(1);

    const reauthorized = await workflows.reauthorizeRoutine(principalA, {
      routineId: killed.resource.id,
      expectedRowRevision: killed.resource.rowRevision,
      workflowRevisionId: lifecycle.revision.id,
      scopeJson: routineScope("broadcast_run", [CONTACT_KILL, CONTACT_BLOCK, CONTACT_PASS]),
      maxCreditsPerRun: 0,
      maxCreditsPerMonth: 0,
      summaryPolicyJson: { mode: "counts_only" },
    });
    lifecycle.routine = reauthorized.resource;

    const blockedRun = await dueRun(workerA, lifecycle, CONTACT_BLOCK, IDENTITY_BLOCK, "block-1");
    const blocked = await workflows.dispatchWorkflowStep(workerA, {
      routineRunId: blockedRun.id,
      stepKey: "send_offer",
    });
    expect(blocked.status).toBe("blocked");
    expect(blocked.downstreamKind).toBe("none");
    expect(blocked.downstreamRef).toBeNull();
    expect(blocked.eligibilityVerdictHash).toMatch(/^[a-f0-9]{64}$/);
    expect(blocked.eligibilityVerdictJson).toMatchObject({
      consentStop: { status: "block" },
      doNotDisturb: { status: "pass" },
      providerRefusal: { status: "pass" },
      frequency: { status: "pass" },
    });

    const passRun = await dueRun(workerA, lifecycle, CONTACT_PASS, IDENTITY_PASS, "pass-1");
    const unavailable = await workflows.dispatchWorkflowStep(workerA, {
      routineRunId: passRun.id,
      stepKey: "send_offer",
    });
    expect(unavailable.status).toBe("unavailable");
    expect(unavailable.reasonCode).toBe("BROADCAST_ONE_MEMBER_SUBMIT_SEAM_UNAVAILABLE");
    expect(unavailable.downstreamKind).toBe("none");
    expect(unavailable.downstreamRef).toBeNull();
    expect(unavailable.eligibilityVerdictJson).toMatchObject({
      consentStop: { status: "pass" },
      doNotDisturb: { status: "pass" },
      providerRefusal: { status: "pass" },
      frequency: { status: "pass" },
    });
    expect(await prisma.broadcastRun.count({ where: { ownerId: ORG_A } })).toBe(0);
    expect(await prisma.contactSendFrequencyEvent.count({ where: { ownerId: ORG_A } })).toBe(0);
  });

  it("stops conversation actions at the missing strict-classification seam before C5", async () => {
    const lifecycle = await createLifecycle(
      principalA,
      "conversation",
      TEMPLATE_VERSION_A,
      "conversation_reply",
      [CONTACT_PASS],
    );
    const run = await dueRun(workerA, lifecycle, CONTACT_PASS, IDENTITY_PASS, "conversation-1");
    const result = await workflows.dispatchWorkflowStep(workerA, {
      routineRunId: run.id,
      stepKey: "send_offer",
    });
    expect(result.status).toBe("unavailable");
    expect(result.reasonCode).toBe("CONVERSATION_STRICT_CLASSIFICATION_UNAVAILABLE");
    expect(result.eligibilityVerdictJson).toMatchObject({
      consentStop: { status: "unavailable", reason: "strict_classification_unavailable" },
      doNotDisturb: { status: "unavailable" },
      providerRefusal: { status: "unavailable" },
      frequency: { status: "unavailable" },
    });
    expect(result.downstreamKind).toBe("none");
    expect(result.downstreamRef).toBeNull();

    await prisma.customerConversation.create({
      data: {
        id: "c7-m1-test-conversation-takeover",
        ownerId: ORG_A,
        contactIdentityId: IDENTITY_KILL,
        status: "open",
        automationState: "paused_by_human",
        revision: 0,
        lastActivityAt: NOW,
      },
    });
    const takeoverLifecycle = await createLifecycle(
      principalA,
      "takeover",
      TEMPLATE_VERSION_A,
      "conversation_reply",
      [CONTACT_KILL],
    );
    const takeoverRun = await dueRun(
      workerA,
      takeoverLifecycle,
      CONTACT_KILL,
      IDENTITY_KILL,
      "takeover-1",
    );
    const takeover = await workflows.dispatchWorkflowStep(workerA, {
      routineRunId: takeoverRun.id,
      stepKey: "send_offer",
    });
    expect(takeover.status).toBe("blocked");
    expect(takeover.reasonCode).toBe("HUMAN_TAKEOVER_AUTOMATION_PAUSED");
    expect(takeover.downstreamKind).toBe("none");
  });

  it("re-resolves exact pinned dependencies before reserving a step", async () => {
    const lifecycle = await createLifecycle(
      principalA,
      "dependency-drift",
      TEMPLATE_VERSION_A,
      "broadcast_run",
      [CONTACT_PASS],
    );
    const run = await dueRun(workerA, lifecycle, CONTACT_PASS, IDENTITY_PASS, "drift-1");
    await prisma.customerMessageTemplateVersion.update({
      where: { id: TEMPLATE_VERSION_A, ownerId: ORG_A },
      data: { contentHash: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" },
    });
    const unavailable = await workflows.dispatchWorkflowStep(workerA, {
      routineRunId: run.id,
      stepKey: "send_offer",
    });
    expect(unavailable).toMatchObject({
      status: "unavailable",
      reasonCode: "workflow_dependency_unavailable",
      downstreamKind: "none",
      downstreamRef: null,
    });
    expect(unavailable.actionIdempotencyKey).toBe(deriveNoTargetActionIdempotencyKey({
      ownerId: ORG_A,
      workflowDefinitionId: run.workflowDefinitionId,
      routineKey: run.routineKey,
      triggerKind: run.triggerKind,
      triggerOccurrenceRef: run.triggerOccurrenceRef,
      contactJourneyStateId: run.contactJourneyStateId,
      scheduledFor: run.scheduledFor,
      stepKey: "send_offer",
    }));
    expect((await workflows.dispatchWorkflowStep(workerA, {
      routineRunId: run.id,
      stepKey: "send_offer",
    })).id).toBe(unavailable.id);
    expect(await prisma.workflowStepExecution.count({
      where: { ownerId: ORG_A, routineRunId: run.id },
    })).toBe(1);
  });

  it("persists the customer-message target:none sentinel when the frozen target disappears", async () => {
    const canonical = workflows.canonicalizeWorkflowBusinessHoursPolicy({
      timeZone: "Asia/Kuala_Lumpur",
      weeklyWindows: [{ weekday: 3, startMinute: 540, endMinute: 720 }],
    });
    if (!canonical.ok) throw new Error("Expected canonical policy");
    const policyId = "c7-m1-test-policy-message-sentinel";
    const conversationId = "c7-m1-test-conversation-message-sentinel";
    const messageId = "c7-m1-test-message-sentinel";
    const sourceEventKey = "scope-a:message-sentinel";
    await prisma.businessHoursPolicy.create({
      data: {
        id: policyId,
        ownerId: ORG_A,
        policyKey: "message_sentinel_hours",
        revision: 1,
        name: "Message sentinel hours",
        timeZone: canonical.value.timeZone,
        weeklyWindowsJson: canonical.value.weeklyWindowsJson,
        status: "published",
        contentHash: canonical.value.contentHash,
        createdByMembershipId: OWNER_A,
      },
    });
    await prisma.customerConversation.create({
      data: {
        id: conversationId,
        ownerId: ORG_A,
        contactIdentityId: IDENTITY_PASS,
        status: "open",
        automationState: "otto_active",
        revision: 0,
        lastActivityAt: NOW,
      },
    });
    await prisma.customerMessage.create({
      data: {
        id: messageId,
        ownerId: ORG_A,
        conversationId,
        direction: "inbound",
        actorKind: "customer",
        kind: "text",
        contentJson: { schemaVersion: 1, type: "text", text: "Sentinel" },
        searchText: "Sentinel",
        contentHash: "message-sentinel-content",
        sourceEventKey,
        sourcePayloadHash: "message-sentinel-payload",
        canonicalizationVersion: "v1",
        receivedAt: NOW,
      },
    });
    const lifecycle = await createLifecycle(
      principalA,
      "message-sentinel",
      TEMPLATE_VERSION_A,
      "conversation_reply",
      [CONTACT_PASS],
      customerMessageSource(TEMPLATE_VERSION_A, policyId),
    );
    const created = await workflows.createWorkflowRun(workerA, {
      routineId: lifecycle.routine.id,
      trigger: { kind: "customer_message", sourceEventKey, triggerEventRef: messageId },
      trustedTriggerPayload: { source: "verified_inbox" },
    });
    if (created.kind === "blocked") throw new Error("Expected customer-message run");
    await prisma.contactIdentity.update({
      where: { id: IDENTITY_PASS, ownerId: ORG_A },
      data: { deletedAt: NOW },
    });
    const unavailable = await workflows.dispatchWorkflowStep(workerA, {
      routineRunId: created.run.id,
      stepKey: "send_offer",
    });
    expect(unavailable).toMatchObject({
      status: "unavailable",
      reasonCode: "workflow_target_unavailable",
      contactId: null,
      downstreamKind: "none",
      downstreamRef: null,
    });
    expect(unavailable.actionIdempotencyKey).toBe(deriveNoTargetActionIdempotencyKey({
      ownerId: ORG_A,
      workflowDefinitionId: created.run.workflowDefinitionId,
      routineKey: created.run.routineKey,
      triggerKind: created.run.triggerKind,
      triggerOccurrenceRef: created.run.triggerOccurrenceRef,
      contactJourneyStateId: created.run.contactJourneyStateId,
      scheduledFor: created.run.scheduledFor,
      stepKey: "send_offer",
    }));
    expect((await workflows.dispatchWorkflowStep(workerA, {
      routineRunId: created.run.id,
      stepKey: "send_offer",
    })).id).toBe(unavailable.id);
    expect(await prisma.workflowStepExecution.count({
      where: { ownerId: ORG_A, routineRunId: created.run.id },
    })).toBe(1);
  });

  it("uses the frozen customer-message occurrence and business-hours pin without reaching C4", async () => {
    const inside = workflows.canonicalizeWorkflowBusinessHoursPolicy({
      timeZone: "Asia/Kuala_Lumpur",
      weeklyWindows: [{ weekday: 3, startMinute: 540, endMinute: 1020 }],
    });
    const outside = workflows.canonicalizeWorkflowBusinessHoursPolicy({
      timeZone: "Asia/Kuala_Lumpur",
      weeklyWindows: [{ weekday: 3, startMinute: 540, endMinute: 720 }],
    });
    if (!inside.ok || !outside.ok) throw new Error("Expected canonical policies");
    const insidePolicyId = "c7-m1-test-policy-inside";
    const outsidePolicyId = "c7-m1-test-policy-outside";
    await prisma.businessHoursPolicy.createMany({
      data: [
        {
          id: insidePolicyId,
          ownerId: ORG_A,
          policyKey: "inside_hours",
          revision: 1,
          name: "Inside hours",
          timeZone: inside.value.timeZone,
          weeklyWindowsJson: inside.value.weeklyWindowsJson,
          status: "published",
          contentHash: inside.value.contentHash,
          createdByMembershipId: OWNER_A,
        },
        {
          id: outsidePolicyId,
          ownerId: ORG_A,
          policyKey: "outside_hours",
          revision: 1,
          name: "Outside hours",
          timeZone: outside.value.timeZone,
          weeklyWindowsJson: outside.value.weeklyWindowsJson,
          status: "published",
          contentHash: outside.value.contentHash,
          createdByMembershipId: OWNER_A,
        },
      ],
    });
    const conversationId = "c7-m1-test-conversation-business-hours";
    await prisma.customerConversation.create({
      data: {
        id: conversationId,
        ownerId: ORG_A,
        contactIdentityId: IDENTITY_PASS,
        status: "open",
        automationState: "otto_active",
        revision: 0,
        lastActivityAt: NOW,
      },
    });
    await prisma.customerMessage.createMany({
      data: [
        {
          id: "c7-m1-test-message-inside",
          ownerId: ORG_A,
          conversationId,
          direction: "inbound",
          actorKind: "customer",
          kind: "text",
          contentJson: { schemaVersion: 1, type: "text", text: "Inside" },
          searchText: "Inside",
          contentHash: "inside-message-content",
          sourceEventKey: "scope-a:inside-message",
          sourcePayloadHash: "inside-message-payload",
          canonicalizationVersion: "v1",
          receivedAt: NOW,
        },
        {
          id: "c7-m1-test-message-outside",
          ownerId: ORG_A,
          conversationId,
          direction: "inbound",
          actorKind: "customer",
          kind: "text",
          contentJson: { schemaVersion: 1, type: "text", text: "Outside" },
          searchText: "Outside",
          contentHash: "outside-message-content",
          sourceEventKey: "scope-a:outside-message",
          sourcePayloadHash: "outside-message-payload",
          canonicalizationVersion: "v1",
          receivedAt: NOW,
        },
      ],
    });

    const insideLifecycle = await createLifecycle(
      principalA,
      "message-inside",
      TEMPLATE_VERSION_A,
      "conversation_reply",
      [CONTACT_PASS],
      customerMessageSource(TEMPLATE_VERSION_A, insidePolicyId),
    );
    const insideRunResult = await workflows.createWorkflowRun(workerA, {
      routineId: insideLifecycle.routine.id,
      trigger: {
        kind: "customer_message",
        sourceEventKey: "scope-a:inside-message",
        triggerEventRef: "c7-m1-test-message-inside",
      },
      trustedTriggerPayload: { source: "verified_inbox" },
    });
    if (insideRunResult.kind === "blocked") throw new Error("Expected inside run");
    const insideStep = await workflows.dispatchWorkflowStep(workerA, {
      routineRunId: insideRunResult.run.id,
      stepKey: "send_offer",
    });
    expect(insideStep.status).toBe("blocked");
    expect(insideStep.reasonCode).toBe("BUSINESS_HOURS_INSIDE");

    const outsideLifecycle = await createLifecycle(
      principalA,
      "message-outside",
      TEMPLATE_VERSION_A,
      "conversation_reply",
      [CONTACT_PASS],
      customerMessageSource(TEMPLATE_VERSION_A, outsidePolicyId),
    );
    const outsideRunResult = await workflows.createWorkflowRun(workerA, {
      routineId: outsideLifecycle.routine.id,
      trigger: {
        kind: "customer_message",
        sourceEventKey: "scope-a:outside-message",
        triggerEventRef: "c7-m1-test-message-outside",
      },
      trustedTriggerPayload: { source: "verified_inbox" },
    });
    if (outsideRunResult.kind === "blocked") throw new Error("Expected outside run");
    const outsideStep = await workflows.dispatchWorkflowStep(workerA, {
      routineRunId: outsideRunResult.run.id,
      stepKey: "send_offer",
    });
    expect(outsideStep.status).toBe("unavailable");
    expect(outsideStep.reasonCode).toBe("CONVERSATION_STRICT_CLASSIFICATION_UNAVAILABLE");
    expect(outsideStep.actionIdempotencyKey).toMatch(/^[a-f0-9]{64}$/);
    expect((await workflows.dispatchWorkflowStep(workerA, {
      routineRunId: outsideRunResult.run.id,
      stepKey: "send_offer",
    })).id).toBe(outsideStep.id);
    expect(await prisma.workflowStepExecution.count({
      where: { ownerId: ORG_A, routineRunId: outsideRunResult.run.id },
    })).toBe(1);
    const runCount = await prisma.routineRun.count({ where: { ownerId: ORG_A } });
    await prisma.customerMessage.update({
      where: { id: "c7-m1-test-message-outside", ownerId: ORG_A },
      data: { direction: "outbound" },
    });
    await expectCode(
      workflows.createWorkflowRun(workerA, {
        routineId: outsideLifecycle.routine.id,
        trigger: {
          kind: "customer_message",
          sourceEventKey: "scope-a:outside-message",
          triggerEventRef: "c7-m1-test-message-outside",
        },
        trustedTriggerPayload: { source: "self_echo" },
      }),
      "AUTHORITY_UNAVAILABLE",
    );
    await prisma.customerMessage.update({
      where: { id: "c7-m1-test-message-outside", ownerId: ORG_A },
      data: { direction: "inbound", actorKind: "merchant" },
    });
    await expectCode(
      workflows.createWorkflowRun(workerA, {
        routineId: outsideLifecycle.routine.id,
        trigger: {
          kind: "customer_message",
          sourceEventKey: "scope-a:outside-message",
          triggerEventRef: "c7-m1-test-message-outside",
        },
        trustedTriggerPayload: { source: "merchant_echo" },
      }),
      "AUTHORITY_UNAVAILABLE",
    );
    expect(await prisma.routineRun.count({ where: { ownerId: ORG_A } })).toBe(runCount);
    expect(await prisma.workflowStepExecution.count({ where: { ownerId: ORG_A } })).toBe(2);
    expect(await prisma.customerMessage.count({ where: { ownerId: ORG_A, direction: "outbound" } })).toBe(0);
  });

  it("commits a kill before an in-flight dispatch and records zero downstream work", async () => {
    const lifecycle = await createLifecycle(
      principalA,
      "concurrent-kill",
      TEMPLATE_VERSION_A,
      "broadcast_run",
      [CONTACT_PASS],
    );
    const run = await dueRun(
      workerA,
      lifecycle,
      CONTACT_PASS,
      IDENTITY_PASS,
      "concurrent-kill-1",
    );
    const killStaged = deferred<void>();
    const releaseKill = deferred<void>();
    const dispatchReachedAuthorityLock = deferred<void>();
    const dispatchBackendPids: number[] = [];
    const killBackendPids: number[] = [];
    let dispatchSequence = 0;
    let killSequence = 0;
    const dispatchWorkflows = workflowLifecycleService(
      createTransactionBarrierHarness(
        (tx) => proxyTransactionMethod(
          tx,
          "$queryRaw",
          () => dispatchReachedAuthorityLock.resolve(undefined),
        ),
        dispatchBackendPids,
      ),
      {
        clock: () => NOW,
        id: () => `c7-m1-concurrent-dispatch-${++dispatchSequence}`,
        resolveWorkerContext,
      },
    );
    const killWorkflows = workflowLifecycleService(
      createTransactionBarrierHarness(
        (tx) => proxyDelegateMethod(
          tx,
          "routine",
          "updateMany",
          async (invoke) => {
            const updated = await invoke();
            killStaged.resolve(undefined);
            await releaseKill.promise;
            return updated;
          },
        ),
        killBackendPids,
      ),
      {
        clock: () => NOW,
        id: () => `c7-m1-concurrent-kill-${++killSequence}`,
        resolveWorkerContext,
      },
    );
    const killPromise = killWorkflows.killRoutine(principalA, {
      routineId: lifecycle.routine.id,
      expectedRowRevision: lifecycle.routine.rowRevision,
      reasonCode: "concurrent_owner_stop",
    });
    await Promise.race([
      killStaged.promise,
      killPromise.then(
        () => { throw new Error("Kill committed before its transaction barrier"); },
        (error: unknown) => { throw error; },
      ),
    ]);
    const dispatchPromise = dispatchWorkflows.dispatchWorkflowStep(workerA, {
      routineRunId: run.id,
      stepKey: "send_offer",
    });
    try {
      await Promise.race([
        dispatchReachedAuthorityLock.promise,
        dispatchPromise.then(
          () => { throw new Error("Dispatch completed before reaching the authority lock"); },
          (error: unknown) => { throw error; },
        ),
      ]);
      expect(dispatchBackendPids).toHaveLength(1);
      expect(killBackendPids).toHaveLength(1);
      expect(dispatchBackendPids[0]).not.toBe(killBackendPids[0]);
      await expectPostgresBlockedBy(dispatchBackendPids[0]!, killBackendPids[0]!);
    } finally {
      releaseKill.resolve(undefined);
    }
    const [killed, execution] = await Promise.all([killPromise, dispatchPromise]);
    expect(killed.resource).toMatchObject({ status: "paused", killSwitchEngaged: true });
    expect(execution).toMatchObject({
      status: "blocked",
      reasonCode: "routine_authority_kill",
      downstreamKind: "none",
      downstreamRef: null,
    });
    expect(await prisma.workflowStepExecution.count({
      where: { ownerId: ORG_A, routineRunId: run.id },
    })).toBe(1);
    expect(await prisma.broadcastRun.count({ where: { ownerId: ORG_A } })).toBe(0);
    expect(await prisma.contactSendFrequencyEvent.count({ where: { ownerId: ORG_A } })).toBe(0);
  });

  it("races duplicate schedule ticks through the RoutineRun uniqueness boundary", async () => {
    const lifecycle = await createLifecycle(
      principalA,
      "concurrent-schedule",
      TEMPLATE_VERSION_A,
      "broadcast_run",
      [CONTACT_PASS],
      source(TEMPLATE_VERSION_A, "broadcast_run", "schedule"),
    );
    const bothTransactionsStarted = deferred<void>();
    const backendPids: number[] = [];
    let createManyCalls = 0;
    let scheduleSequence = 0;
    const concurrentWorkflows = workflowLifecycleService(createTransactionBarrierHarness(
      (tx) => proxyDelegateMethod(
        tx,
        "routineRun",
        "createMany",
        async (invoke) => {
          createManyCalls += 1;
          return invoke();
        },
      ),
      backendPids,
      async () => {
        if (backendPids.length === 2) bothTransactionsStarted.resolve(undefined);
        await bothTransactionsStarted.promise;
      },
    ), {
      clock: () => NOW,
      id: () => `c7-m1-concurrent-schedule-${++scheduleSequence}`,
      resolveWorkerContext,
    });
    const input = {
      routineId: lifecycle.routine.id,
      trigger: { kind: "schedule" as const, scheduledFor: NOW },
      trustedTriggerPayload: { source: "double_tick" },
    };
    const results = await Promise.all([
      concurrentWorkflows.createWorkflowRun(workerA, input),
      concurrentWorkflows.createWorkflowRun(workerA, input),
    ]);
    expect(new Set(backendPids).size).toBe(2);
    expect(createManyCalls).toBe(2);
    expect(results.map((result) => result.kind).sort()).toEqual(["created", "replayed"]);
    const runIds = results.map((result) => {
      if (result.kind === "blocked") throw new Error("Expected created/replayed schedule runs");
      return result.run.id;
    });
    expect(new Set(runIds).size).toBe(1);
    expect(await prisma.routineRun.count({
      where: { ownerId: ORG_A, routineId: lifecycle.routine.id },
    })).toBe(1);
  });

  it("serializes concurrent enrollment across two Routines on the advisory lock", async () => {
    const lifecycle = await createLifecycle(
      principalA,
      "concurrent-enrollment",
      TEMPLATE_VERSION_A,
      "broadcast_run",
      [CONTACT_PASS],
    );
    const secondDraft = await workflows.createRoutineDraft(principalA, {
      workflowDefinitionId: lifecycle.definition.id,
      workflowRevisionId: lifecycle.revision.id,
      routineKey: "routine_concurrent_enrollment_second",
      scopeJson: routineScope("broadcast_run", [CONTACT_PASS]),
      maxCreditsPerRun: 0,
      maxCreditsPerMonth: 0,
      summaryPolicyJson: { mode: "counts_only" },
    });
    const secondRoutine = await workflows.activateRoutine(principalA, {
      routineId: secondDraft.resource.id,
      expectedRowRevision: 0,
    });
    const firstInserted = deferred<void>();
    const releaseFirstEnrollment = deferred<void>();
    const secondReachedAdvisoryLock = deferred<void>();
    const leftBackendPids: number[] = [];
    const rightBackendPids: number[] = [];
    let leftSequence = 0;
    let rightSequence = 0;
    const left = workflowLifecycleService(createTransactionBarrierHarness(
      (tx) => proxyDelegateMethod(
        tx,
        "contactJourneyState",
        "createMany",
        async (invoke) => {
          const result = await invoke();
          firstInserted.resolve(undefined);
          await releaseFirstEnrollment.promise;
          return result;
        },
      ),
      leftBackendPids,
    ), {
      clock: () => NOW,
      id: () => `c7-m1-concurrent-enrollment-left-${++leftSequence}`,
      resolveWorkerContext,
    });
    const right = workflowLifecycleService(createTransactionBarrierHarness(
      (tx) => proxyTransactionMethod(
        tx,
        "$executeRaw",
        () => secondReachedAdvisoryLock.resolve(undefined),
      ),
      rightBackendPids,
    ), {
      clock: () => NOW,
      id: () => `c7-m1-concurrent-enrollment-right-${++rightSequence}`,
      resolveWorkerContext,
    });
    const firstPromise = captureOutcome(left.enrollWorkflowJourney(workerA, {
      routineId: lifecycle.routine.id,
      contactId: CONTACT_PASS,
      contactIdentityId: IDENTITY_PASS,
      enrollmentOccurrenceRef: "concurrent-enrollment-left",
      initialStepKey: "send_offer",
      initialStateJson: {},
    }));
    await Promise.race([
      firstInserted.promise,
      firstPromise.then(() => { throw new Error("First enrollment completed before its transaction barrier"); }),
    ]);
    const secondPromise = captureOutcome(right.enrollWorkflowJourney(workerA, {
      routineId: secondRoutine.resource.id,
      contactId: CONTACT_PASS,
      contactIdentityId: IDENTITY_PASS,
      enrollmentOccurrenceRef: "concurrent-enrollment-right",
      initialStepKey: "send_offer",
      initialStateJson: {},
    }));
    try {
      await Promise.race([
        secondReachedAdvisoryLock.promise,
        secondPromise.then(() => { throw new Error("Second enrollment completed before reaching the advisory lock"); }),
      ]);
      expect(leftBackendPids).toHaveLength(1);
      expect(rightBackendPids).toHaveLength(1);
      expect(leftBackendPids[0]).not.toBe(rightBackendPids[0]);
      await expectPostgresBlockedBy(rightBackendPids[0]!, leftBackendPids[0]!);
    } finally {
      releaseFirstEnrollment.resolve(undefined);
    }
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first).toMatchObject({ kind: "fulfilled", value: { kind: "created" } });
    expect(second.kind).toBe("rejected");
    if (second.kind !== "rejected") throw new Error("Expected the second enrollment to fail");
    expect(errorCode(second.error)).toBe("LIVE_ENROLLMENT_EXISTS");
    expect(await prisma.contactJourneyState.count({
      where: {
        ownerId: ORG_A,
        workflowDefinitionId: lifecycle.definition.id,
        contactId: CONTACT_PASS,
      },
    })).toBe(1);
  });

  it("reads paged owner-scoped workflow state through safe service and gateway projections", async () => {
    const lifecycle = await createLifecycle(
      principalA,
      "read-surface",
      TEMPLATE_VERSION_A,
      "broadcast_run",
      [CONTACT_PASS],
    );
    const run = await dueRun(
      workerA,
      lifecycle,
      CONTACT_PASS,
      IDENTITY_PASS,
      "read-surface-run",
    );
    await prisma.routineRun.update({
      where: { id: run.id, ownerId: ORG_A },
      data: { summaryJson: { actionCount: 2, simulated: true, skippedCount: 0 } },
    });
    await workflows.createRoutineDraft(principalA, {
      workflowDefinitionId: lifecycle.definition.id,
      workflowRevisionId: lifecycle.revision.id,
      routineKey: "routine_read_surface_draft",
      scopeJson: routineScope("broadcast_run", [CONTACT_PASS]),
      maxCreditsPerRun: 0,
      maxCreditsPerMonth: 0,
      summaryPolicyJson: { mode: "counts_only" },
    });
    const reauthorized = await workflows.reauthorizeRoutine(principalA, {
      routineId: lifecycle.routine.id,
      expectedRowRevision: lifecycle.routine.rowRevision,
      workflowRevisionId: lifecycle.revision.id,
      scopeJson: routineScope("broadcast_run", [CONTACT_PASS]),
      maxCreditsPerRun: 0,
      maxCreditsPerMonth: 0,
      summaryPolicyJson: { mode: "counts_only", scope: "workflow_activity" },
    });
    const canonical = workflows.canonicalizeWorkflowBusinessHoursPolicy({
      timeZone: "Asia/Kuala_Lumpur",
      weeklyWindows: [{ weekday: 3, startMinute: 540, endMinute: 1020 }],
    });
    if (!canonical.ok) throw new Error("Expected canonical business-hours policy");
    const policyId = "c7-m1-test-policy-read-surface";
    await prisma.businessHoursPolicy.create({
      data: {
        id: policyId,
        ownerId: ORG_A,
        policyKey: "read_surface_hours",
        revision: 1,
        name: "Read surface hours",
        timeZone: canonical.value.timeZone,
        weeklyWindowsJson: canonical.value.weeklyWindowsJson,
        status: "published",
        contentHash: canonical.value.contentHash,
        createdByMembershipId: OWNER_A,
      },
    });

    const firstRoutinePage = await workflows.listRoutines(principalA, {
      workflowDefinitionId: lifecycle.definition.id,
      limit: 1,
    });
    expect(firstRoutinePage.items).toHaveLength(1);
    expect(firstRoutinePage.nextCursor).toBe(firstRoutinePage.items[0]!.id);
    const secondRoutinePage = await workflows.listRoutines(principalA, {
      workflowDefinitionId: lifecycle.definition.id,
      cursor: firstRoutinePage.nextCursor!,
      limit: 2,
    });
    expect([
      ...firstRoutinePage.items.map((item) => item.id),
      ...secondRoutinePage.items.map((item) => item.id),
    ]).toEqual(expect.arrayContaining([
      lifecycle.routine.id,
      reauthorized.resource.id,
    ]));
    await expectCode(
      workflows.listRoutines(principalA, {
        status: firstRoutinePage.items[0]!.status === "draft" ? "active" : "draft",
        cursor: firstRoutinePage.items[0]!.id,
      }),
      "RESOURCE_NOT_FOUND",
    );

    const routine = await workflows.getRoutine(principalA, {
      routineId: reauthorized.resource.id,
    });
    expect(routine.routine).toMatchObject({
      id: reauthorized.resource.id,
      status: "active",
      authorization: { revision: 2, authorized: true },
      scope: { contactIds: [CONTACT_PASS], maxActions: 8, maxRecipients: 8 },
    });
    expect(routine.predecessors.map((item) => item.id)).toEqual([lifecycle.routine.id]);

    const runs = await workflows.listRoutineRuns(principalA, {
      routineId: lifecycle.routine.id,
      status: "queued",
      limit: 10,
    });
    expect(runs.items).toHaveLength(1);
    expect(runs.items[0]).toMatchObject({
      id: run.id,
      status: "queued",
      summary: { actionCount: 2, simulated: true, skippedCount: 0 },
    });
    for (const forbidden of [
      "ownerId",
      "runIdempotencyKey",
      "triggerOccurrenceRef",
      "triggerEventRef",
      "triggerPayloadHash",
      "authorizationHash",
      "authorizationSnapshotJson",
      "summaryJson",
    ]) {
      expect(runs.items[0]).not.toHaveProperty(forbidden);
    }
    await expectCode(
      workflows.listRoutineRuns(principalA, {
        routineId: reauthorized.resource.id,
        cursor: runs.items[0]!.id,
      }),
      "RESOURCE_NOT_FOUND",
    );
    await prisma.routineRun.update({
      where: { id: run.id, ownerId: ORG_A },
      data: { summaryJson: { rawMessage: "must not cross the read boundary" } },
    });
    expect((await workflows.listRoutineRuns(principalA, {
      routineId: lifecycle.routine.id,
    })).items[0]!.summary).toBeNull();

    const journeys = await workflows.getContactJourneyStates(principalA, {
      workflowDefinitionId: lifecycle.definition.id,
      limit: 10,
    });
    expect(journeys.items[0]).toMatchObject({
      contact: { id: CONTACT_PASS, name: "Passing target" },
      status: "active",
      currentStepKey: "send_offer",
      lastRoutineRun: { id: run.id, status: "queued", blockReason: null, errorCode: null },
    });
    expect(journeys.items[0]).not.toHaveProperty("stateJson");
    expect(journeys.items[0]).not.toHaveProperty("contactIdentityId");
    await expectCode(
      workflows.getContactJourneyStates(principalA, {
        routineId: reauthorized.resource.id,
        cursor: journeys.items[0]!.id,
      }),
      "RESOURCE_NOT_FOUND",
    );

    const policies = await workflows.listBusinessHoursPolicies(principalA, {
      status: "published",
      limit: 10,
    });
    expect(policies.items).toContainEqual(expect.objectContaining({
      id: policyId,
      status: "published",
      timeZone: "Asia/Kuala_Lumpur",
    }));
    await expectCode(
      workflows.listBusinessHoursPolicies(principalA, {
        status: "archived",
        cursor: policyId,
      }),
      "RESOURCE_NOT_FOUND",
    );
    const policy = await workflows.getBusinessHoursPolicy(principalA, {
      businessHoursPolicyId: policyId,
    });
    expect(policy).toMatchObject({
      id: policyId,
      status: "published",
      weeklyWindows: [{ weekday: 3, startMinute: 540, endMinute: 1020 }],
    });
    expect(policy).not.toHaveProperty("ownerId");
    expect(policy).not.toHaveProperty("contentHash");
    expect(policy).not.toHaveProperty("createdByMembershipId");

    await expect(gateway.listRoutines({
      workflowDefinitionId: lifecycle.definition.id,
      status: "active",
    })).resolves.toMatchObject({
      ok: true,
      resource: { items: [{ id: reauthorized.resource.id, status: "active" }] },
    });
    await expect(gateway.getBusinessHoursPolicy({
      businessHoursPolicyId: policyId,
    })).resolves.toMatchObject({
      ok: true,
      resource: { id: policyId, status: "published" },
    });
  });

  it("rejects foreign read filters, resources, and cursors without exposing tenant B", async () => {
    const a = await createLifecycle(
      principalA,
      "read-tenant-a",
      TEMPLATE_VERSION_A,
      "broadcast_run",
      [CONTACT_PASS],
    );
    const b = await createLifecycle(
      principalB,
      "read-tenant-b",
      TEMPLATE_VERSION_B,
      "broadcast_run",
      [CONTACT_B],
    );
    await dueRun(workerB, b, CONTACT_B, IDENTITY_B, "read-tenant-b-run");
    const bRoutinePage = await workflows.listRoutines(principalB, {
      workflowDefinitionId: b.definition.id,
      limit: 10,
    });
    const bPolicyPage = await workflows.listBusinessHoursPolicies(principalB, { limit: 10 });

    await expectCode(
      workflows.listRoutines(principalA, { workflowDefinitionId: b.definition.id }),
      "RESOURCE_NOT_FOUND",
    );
    await expectCode(
      workflows.getRoutine(principalA, { routineId: b.routine.id }),
      "RESOURCE_NOT_FOUND",
    );
    await expectCode(
      workflows.listRoutineRuns(principalA, { routineId: b.routine.id }),
      "RESOURCE_NOT_FOUND",
    );
    await expectCode(
      workflows.listRoutineRuns(principalA, { workflowDefinitionId: b.definition.id }),
      "RESOURCE_NOT_FOUND",
    );
    await expectCode(
      workflows.getContactJourneyStates(principalA, { routineId: b.routine.id }),
      "RESOURCE_NOT_FOUND",
    );
    await expectCode(
      workflows.getContactJourneyStates(principalA, {
        workflowDefinitionId: b.definition.id,
      }),
      "RESOURCE_NOT_FOUND",
    );
    await expectCode(
      workflows.getBusinessHoursPolicy(principalA, { businessHoursPolicyId: POLICY_B }),
      "RESOURCE_NOT_FOUND",
    );
    await expectCode(
      workflows.listRoutines(principalA, { cursor: bRoutinePage.items[0]!.id }),
      "RESOURCE_NOT_FOUND",
    );
    await expectCode(
      workflows.listBusinessHoursPolicies(principalA, {
        cursor: bPolicyPage.items[0]!.id,
      }),
      "RESOURCE_NOT_FOUND",
    );

    await expect(gateway.getRoutine({ routineId: b.routine.id })).resolves.toEqual({
      ok: false,
      error: "RESOURCE_NOT_FOUND",
    });
    await expect(gateway.listRoutineRuns({
      workflowDefinitionId: b.definition.id,
    })).resolves.toEqual({ ok: false, error: "RESOURCE_NOT_FOUND" });
    await expect(gateway.getContactJourneyStates({
      workflowDefinitionId: a.definition.id,
    })).resolves.toMatchObject({ ok: true, resource: { items: [] } });
  });

  it("fails every cross-tenant carrier swap without leaking or writing tenant B", async () => {
    const a = await createLifecycle(
      principalA,
      "tenant-a",
      TEMPLATE_VERSION_A,
      "broadcast_run",
      [CONTACT_PASS],
    );
    const b = await createLifecycle(
      principalB,
      "tenant-b",
      TEMPLATE_VERSION_B,
      "broadcast_run",
      [CONTACT_B],
    );
    const bRun = await dueRun(workerB, b, CONTACT_B, IDENTITY_B, "tenant-b-1");
    const bStep = await workflows.dispatchWorkflowStep(workerB, {
      routineRunId: bRun.id,
      stepKey: "send_offer",
    });
    const beforeB = {
      definitions: await prisma.workflowDefinition.count({ where: { ownerId: ORG_B } }),
      revisions: await prisma.workflowRevision.count({ where: { ownerId: ORG_B } }),
      routines: await prisma.routine.count({ where: { ownerId: ORG_B } }),
      runs: await prisma.routineRun.count({ where: { ownerId: ORG_B } }),
      journeys: await prisma.contactJourneyState.count({ where: { ownerId: ORG_B } }),
      steps: await prisma.workflowStepExecution.count({ where: { ownerId: ORG_B } }),
    };

    await expectCode(
      workflows.getWorkflowDefinition(principalA, { workflowDefinitionId: b.definition.id }),
      "RESOURCE_NOT_FOUND",
    );
    await expectCode(
      workflows.listWorkflowRevisions(principalA, { workflowDefinitionId: b.definition.id }),
      "RESOURCE_NOT_FOUND",
    );
    await expectCode(
      workflows.publishWorkflowRevision(principalA, {
        workflowDefinitionId: a.definition.id,
        workflowRevisionId: b.revision.id,
        expectedRowRevision: a.definition.rowRevision + 1,
      }),
      "RESOURCE_NOT_FOUND",
    );
    await expectCode(
      workflows.activateRoutine(principalA, {
        routineId: b.routine.id,
        expectedRowRevision: b.routine.rowRevision,
      }),
      "RESOURCE_NOT_FOUND",
    );
    await expectCode(
      workflows.dispatchWorkflowStep(workerA, { routineRunId: bRun.id, stepKey: "send_offer" }),
      "RESOURCE_NOT_FOUND",
    );
    await expectCode(
      workflows.enrollWorkflowJourney(workerA, {
        routineId: a.routine.id,
        contactId: CONTACT_B,
        contactIdentityId: IDENTITY_B,
        enrollmentOccurrenceRef: "foreign-contact",
        initialStepKey: "send_offer",
        initialStateJson: {},
      }),
      "RESOURCE_NOT_FOUND",
    );
    await expectCode(
      workflows.enrollWorkflowJourney(workerA, {
        routineId: a.routine.id,
        contactId: CONTACT_PASS,
        contactIdentityId: IDENTITY_B,
        enrollmentOccurrenceRef: "foreign-identity",
        initialStepKey: "send_offer",
        initialStateJson: {},
      }),
      "RESOURCE_NOT_FOUND",
    );
    await expectCode(
      workflows.advanceWorkflowJourney(workerA, {
        journeyId: bRun.contactJourneyStateId!,
        expectedRowRevision: 2,
        expectedCurrentStepKey: "send_offer",
        nextStepKey: null,
      }),
      "RESOURCE_NOT_FOUND",
    );
    await expectCode(
      workflows.enterWorkflowJourneyWait(workerA, {
        journeyId: bRun.contactJourneyStateId!,
        expectedRowRevision: 2,
        expectedWaitGeneration: 1,
        expectedCurrentStepKey: "send_offer",
        resumeStepKey: "send_offer",
        nextEligibleAt: NOW,
      }),
      "RESOURCE_NOT_FOUND",
    );
    const foreignPolicy = await workflows.validateWorkflowRules(principalA, {
      workflowDefinitionId: a.definition.id,
      rulesSource: [
        "version: fikirtive-workflow/v1",
        "name: foreign_policy",
        "trigger:",
        "  type: manual",
        "conditions:",
        "  - type: outside_business_hours",
        `    policyRef: ${POLICY_B}`,
        "steps:",
        "  - key: complete",
        "    action:",
        "      type: complete",
      ].join("\n"),
    });
    expect(foreignPolicy.validationState).toBe("unavailable");
    await expectCode(
      workflows.evaluateWorkflowBusinessHours(workerA, {
        workflowRevisionId: b.revision.id,
        conditionIndex: 0,
      }),
      "RESOURCE_NOT_FOUND",
    );
    const foreignTemplate = await workflows.validateWorkflowRules(principalA, {
      workflowDefinitionId: a.definition.id,
      rulesSource: source(TEMPLATE_VERSION_B, "broadcast_run"),
    });
    expect(foreignTemplate.validationState).toBe("unavailable");
    const foreignScopeDraft = await workflows.createRoutineDraft(principalA, {
      workflowDefinitionId: a.definition.id,
      workflowRevisionId: a.revision.id,
      routineKey: "foreign_contact_scope",
      scopeJson: routineScope("broadcast_run", [CONTACT_B]),
      maxCreditsPerRun: 0,
      maxCreditsPerMonth: 0,
      summaryPolicyJson: { mode: "counts_only" },
    });
    await expectCode(
      workflows.activateRoutine(principalA, {
        routineId: foreignScopeDraft.resource.id,
        expectedRowRevision: 0,
      }),
      "AUTHORITY_UNAVAILABLE",
    );

    expect(await prisma.workflowStepExecution.findFirst({
      where: { id: bStep.id, ownerId: ORG_A },
    })).toBeNull();
    expect({
      definitions: await prisma.workflowDefinition.count({ where: { ownerId: ORG_B } }),
      revisions: await prisma.workflowRevision.count({ where: { ownerId: ORG_B } }),
      routines: await prisma.routine.count({ where: { ownerId: ORG_B } }),
      runs: await prisma.routineRun.count({ where: { ownerId: ORG_B } }),
      journeys: await prisma.contactJourneyState.count({ where: { ownerId: ORG_B } }),
      steps: await prisma.workflowStepExecution.count({ where: { ownerId: ORG_B } }),
    }).toEqual(beforeB);
    expect(await prisma.broadcastRun.count({ where: { ownerId: { in: OWNERS } } })).toBe(0);
    expect(await prisma.contactSendFrequencyEvent.count({ where: { ownerId: { in: OWNERS } } })).toBe(0);
  });

  it("keeps forbidden seams and UI mutation surfaces absent", () => {
    const service = readFileSync(new URL("../customer-workflow-service.ts", import.meta.url), "utf8");
    const gatewaySource = readFileSync(new URL("../customer-workflow-gateway.ts", import.meta.url), "utf8");
    const dbIndex = readFileSync(
      new URL("../../../../packages/db/src/index.ts", import.meta.url),
      "utf8",
    );
    expect(service).not.toMatch(/executeBroadcastRun|submitBroadcastRun|submitConversationReply/);
    expect(service).not.toMatch(/customer-(?:broadcast|inbox)-service/);
    expect(service).not.toMatch(
      /\b(?:customerMessage|broadcastAudienceMember|contactSendFrequencyEvent|consent(?:Event|StateProjection)|providerRefusal(?:Event|Projection))\.(?:create|createMany|upsert|update|updateMany|delete|deleteMany)\b/,
    );
    expect(service).not.toMatch(/from\s+["'][^"']*(?:provider|twilio|whatsapp|sendgrid)[^"']*["']/i);
    expect(gatewaySource).not.toContain('"use server"');
    expect(gatewaySource).not.toMatch(/dispatchWorkflowStep|createWorkflowRun|WorkflowWorker/);
    expect(dbIndex).toContain('export * from "./workflow-business-hours.js"');
    expect(dbIndex).toContain('export * from "./workflow-engine.js"');
    expect(dbIndex).toContain('export * from "./workflow-journey.js"');
  });
});
