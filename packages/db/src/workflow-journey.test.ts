import { describe, expect, it } from "vitest";
import {
  computeRoutineAuthorizationHash,
  computeRoutineScopeHash,
  createRoutineRun,
  engageRoutineKillSwitch,
  type RoutineAuthorityRow,
  type RoutineRunRecord,
  type WorkflowEngineDb,
  type WorkflowRevisionAuthorityRow,
} from "./workflow-engine.js";
import {
  WorkflowJourneyError,
  advanceContactJourney,
  createJourneyDueRun,
  deriveActionIdempotencyKey,
  deriveEnrollmentIdempotencyKey,
  deriveNoTargetActionIdempotencyKey,
  deriveStepIdempotencyKey,
  enrollContactJourney,
  enterJourneyWait,
  reserveWorkflowStep,
  settleWorkflowStep,
  type ContactJourneyRecord,
  type WorkflowJourneyDb,
  type WorkflowStepExecutionRecord,
} from "./workflow-journey.js";

const NOW = new Date("2026-07-22T10:00:00.000Z");
const SCOPE = {
  actionKinds: ["complete", "conversation_reply", "wait"],
  channelScopes: [{ channel: "whatsapp", providerConnectionId: null }],
  contactIds: ["contact-1", "contact-2"],
  segmentIds: [],
  maxActions: 5,
  maxRecipients: 1,
};

function authRows(): { routine: RoutineAuthorityRow; revision: WorkflowRevisionAuthorityRow } {
  const revision: WorkflowRevisionAuthorityRow = {
    id: "revision-1",
    ownerId: "owner-1",
    workflowDefinitionId: "definition-1",
    revision: 1,
    contentHash: "content-1",
    dependencyHash: "dependency-1",
    compiledRuleJson: {
      trigger: { type: "journey_due" },
      steps: ["wait-1", "wait-2", "reply-1", "complete", "reply", "reply-unavailable"].map((key) => ({ key })),
    },
    validationState: "valid",
  };
  const routine: RoutineAuthorityRow = {
    id: "routine-1",
    ownerId: "owner-1",
    routineKey: "routine-key-1",
    workflowDefinitionId: "definition-1",
    workflowRevisionId: "revision-1",
    status: "active",
    scopeJson: SCOPE,
    scopeHash: computeRoutineScopeHash(SCOPE),
    maxCreditsPerRun: 0,
    maxCreditsPerMonth: 0,
    summaryPolicyJson: { destination: "run_history" },
    authorizationRevision: 1,
    authorizationHash: null,
    authorizedByMembershipId: "membership-1",
    authorizedAt: NOW,
    expiresAt: new Date("2026-08-01T00:00:00.000Z"),
    killSwitchEngaged: false,
    rowRevision: 0,
  };
  routine.authorizationHash = computeRoutineAuthorizationHash({
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
  });
  return { routine, revision };
}

function matches(row: Record<string, any>, where: Record<string, any>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return (value as Record<string, any>[]).some((part) => matches(row, part));
    if (value && typeof value === "object" && "in" in value) return value.in.includes(row[key]);
    if (value instanceof Date) return row[key] instanceof Date && row[key].getTime() === value.getTime();
    return row[key] === value;
  });
}

function applyData(row: Record<string, any>, data: Record<string, any>): void {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && "increment" in value) row[key] += value.increment;
    else row[key] = value;
  }
}

class JourneyFixture {
  routines: RoutineAuthorityRow[] = [];
  revisions: WorkflowRevisionAuthorityRow[] = [];
  runs: RoutineRunRecord[] = [];
  journeys: ContactJourneyRecord[] = [];
  steps: WorkflowStepExecutionRecord[] = [];
  contacts = [
    { id: "contact-1", ownerId: "owner-1" },
    { id: "contact-2", ownerId: "owner-1" },
    { id: "contact-3", ownerId: "owner-1" },
    { id: "contact-x", ownerId: "owner-x" },
  ];
  identities = [
    { id: "identity-1", ownerId: "owner-1", contactId: "contact-1", channel: "whatsapp", deletedAt: null },
    { id: "identity-2", ownerId: "owner-1", contactId: "contact-2", channel: "whatsapp", deletedAt: null },
    { id: "identity-email", ownerId: "owner-1", contactId: "contact-1", channel: "email", deletedAt: null },
  ];
  ownerFilters: string[] = [];
  tx: any = {
    $queryRaw: async (..._args: unknown[]) => [],
    $executeRaw: async (..._args: unknown[]) => 0,
  };

  constructor() {
    this.tx.routine = {
      findFirst: async ({ where }: any) => {
        this.ownerFilters.push(where.ownerId);
        return this.routines.find((row) => matches(row as any, where)) ?? null;
      },
      updateMany: async ({ where, data }: any) => {
        this.ownerFilters.push(where.ownerId);
        const row = this.routines.find((item) => matches(item as any, where));
        if (!row) return { count: 0 };
        applyData(row as any, data);
        return { count: 1 };
      },
    };
    this.tx.workflowRevision = {
      findFirst: async ({ where }: any) => {
        this.ownerFilters.push(where.ownerId);
        return this.revisions.find((row) => matches(row as any, where)) ?? null;
      },
    };
    this.tx.routineRun = {
      findFirst: async ({ where }: any) => {
        this.ownerFilters.push(where.ownerId);
        return this.runs.find((row) => matches(row as any, where)) ?? null;
      },
      createMany: async ({ data }: any) => {
        const item = data[0];
        if (this.runs.some((row) => row.ownerId === item.ownerId && row.runIdempotencyKey === item.runIdempotencyKey)) return { count: 0 };
        this.runs.push({
          ...item,
          currentStepKey: null,
          rowRevision: 0,
          summaryJson: null,
          blockReason: null,
          errorCode: null,
          startedAt: null,
          finishedAt: null,
        });
        return { count: 1 };
      },
      updateMany: async ({ where, data }: any) => {
        const row = this.runs.find((item) => matches(item as any, where));
        if (!row) return { count: 0 };
        applyData(row as any, data);
        return { count: 1 };
      },
    };
    this.tx.contact = {
      findFirst: async ({ where }: any) => {
        this.ownerFilters.push(where.ownerId);
        return this.contacts.find((row) => matches(row, where)) ?? null;
      },
    };
    this.tx.contactIdentity = {
      findFirst: async ({ where }: any) => {
        this.ownerFilters.push(where.ownerId);
        return this.identities.find((row) => matches(row, where)) ?? null;
      },
    };
    this.tx.contactJourneyState = {
      findFirst: async ({ where }: any) => {
        this.ownerFilters.push(where.ownerId);
        return this.journeys.find((row) => matches(row as any, where)) ?? null;
      },
      createMany: async ({ data }: any) => {
        const item = data[0];
        if (this.journeys.some((row) => row.ownerId === item.ownerId && row.enrollmentIdempotencyKey === item.enrollmentIdempotencyKey)) return { count: 0 };
        this.journeys.push({
          ...item,
          nextEligibleAt: item.nextEligibleAt ?? null,
          lastRoutineRunId: null,
          rowRevision: 0,
          terminalAt: null,
        });
        return { count: 1 };
      },
      updateMany: async ({ where, data }: any) => {
        this.ownerFilters.push(where.ownerId);
        const row = this.journeys.find((item) => matches(item as any, where));
        if (!row) return { count: 0 };
        applyData(row as any, data);
        return { count: 1 };
      },
    };
    this.tx.workflowStepExecution = {
      findFirst: async ({ where }: any) => {
        this.ownerFilters.push(where.ownerId);
        return this.steps.find((row) => matches(row as any, where)) ?? null;
      },
      findMany: async ({ where }: any) => {
        this.ownerFilters.push(where.ownerId);
        return this.steps.filter((row) => matches(row as any, where));
      },
      createMany: async ({ data }: any) => {
        const item = data[0];
        if (
          this.steps.some(
            (row) =>
              row.ownerId === item.ownerId &&
              (row.stepIdempotencyKey === item.stepIdempotencyKey ||
                (item.actionIdempotencyKey !== null && row.actionIdempotencyKey === item.actionIdempotencyKey)),
          )
        ) return { count: 0 };
        this.steps.push({
          ...item,
          eligibilityInputHash: null,
          eligibilityVerdictJson: null,
          eligibilityVerdictHash: null,
          downstreamRef: null,
          errorCode: null,
          delegatedAt: null,
        });
        return { count: 1 };
      },
      updateMany: async ({ where, data }: any) => {
        this.ownerFilters.push(where.ownerId);
        const row = this.steps.find((item) => matches(item as any, where));
        if (!row) return { count: 0 };
        applyData(row as any, data);
        return { count: 1 };
      },
    };
  }

  db(): WorkflowJourneyDb & WorkflowEngineDb {
    return { $transaction: async (callback: any) => callback(this.tx) } as unknown as WorkflowJourneyDb & WorkflowEngineDb;
  }

  seedAuthority(): void {
    const rows = authRows();
    this.routines.push(rows.routine);
    this.revisions.push(rows.revision);
  }
}

async function enroll(fixture: JourneyFixture, id = "journey-1", occurrence = "enroll-1") {
  return enrollContactJourney(fixture.db(), {
    id,
    ownerId: "owner-1",
    routineId: "routine-1",
    contactId: "contact-1",
    contactIdentityId: "identity-1",
    enrollmentOccurrenceRef: occurrence,
    initialStepKey: "wait-1",
    initialStateJson: {},
    now: NOW,
  });
}

function eligibilityInput(
  purpose = "marketing",
  contactId = "contact-1",
  contactIdentityId = "identity-1",
) {
  return {
    ownerId: "owner-1",
    contactId,
    contactIdentityId,
    channel: "whatsapp",
    providerConnectionId: null,
    purpose,
    callerClass: "unconfirmed_automatic",
  };
}

function eligibilityVerdict(statuses: Partial<Record<"consentStop" | "doNotDisturb" | "providerRefusal" | "frequency", string>> = {}) {
  const checkedAt = NOW.toISOString();
  const axis = (name: string) => ({
    status: statuses[name as keyof typeof statuses] ?? "pass",
    source: `${name}_authority`,
    checkedAt,
  });
  return {
    consentStop: axis("consentStop"),
    doNotDisturb: axis("doNotDisturb"),
    providerRefusal: axis("providerRefusal"),
    frequency: axis("frequency"),
    aggregate: { status: "unavailable", reason: "SEND_PATH_UNAVAILABLE" },
    checkedAt,
  };
}

describe("C7 journey enrollment, CAS and wait/due", () => {
  it("replays one enrollment, denies any later re-entry, and scopes every lookup by owner", async () => {
    const fixture = new JourneyFixture();
    fixture.seedAuthority();
    const first = await enroll(fixture);
    expect(first.kind).toBe("created");
    await expect(enroll(fixture, "journey-retry")).resolves.toMatchObject({ kind: "replayed", journey: { id: "journey-1" } });
    await expect(advanceContactJourney(fixture.db(), {
      ownerId: "owner-1", journeyId: "journey-1", expectedRowRevision: 0,
      expectedCurrentStepKey: "wait-1", nextStepKey: null, now: NOW,
    })).resolves.toMatchObject({ status: "completed", currentStepKey: null, terminalAt: NOW });
    await expect(enroll(fixture, "terminal-replay")).resolves.toMatchObject({ kind: "replayed", journey: { id: "journey-1" } });
    await expect(enroll(fixture, "journey-terminal-reentry", "enroll-3")).rejects.toMatchObject({
      code: "LIVE_ENROLLMENT_EXISTS",
    });
    await expect(enrollContactJourney(fixture.db(), {
      id: "foreign", ownerId: "owner-1", routineId: "routine-1", contactId: "contact-x", contactIdentityId: null,
      enrollmentOccurrenceRef: "foreign", initialStepKey: null, initialStateJson: {}, now: NOW,
    })).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    expect(fixture.ownerFilters.every((value) => value === "owner-1")).toBe(true);
    expect(deriveEnrollmentIdempotencyKey({ ownerId: "owner-1", workflowDefinitionId: "definition-1", contactId: "contact-1", enrollmentOccurrenceRef: "enroll-1" })).toBe(first.journey.enrollmentIdempotencyKey);
  });

  it("rejects arbitrary initial journey state until a closed vocabulary is approved", async () => {
    const fixture = new JourneyFixture();
    fixture.seedAuthority();
    await expect(enrollContactJourney(fixture.db(), {
      id: "journey-shadow", ownerId: "owner-1", routineId: "routine-1", contactId: "contact-1",
      contactIdentityId: "identity-1", enrollmentOccurrenceRef: "shadow", initialStepKey: "wait-1",
      initialStateJson: { consent: "verified", phone: "+60123456789" }, now: NOW,
    })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(fixture.journeys).toHaveLength(0);
    await expect(enrollContactJourney(fixture.db(), {
      id: "journey-unknown-step", ownerId: "owner-1", routineId: "routine-1", contactId: "contact-1",
      contactIdentityId: "identity-1", enrollmentOccurrenceRef: "unknown-step", initialStepKey: "not-compiled",
      initialStateJson: {}, now: NOW,
    })).rejects.toMatchObject({ code: "AUTHORITY_UNAVAILABLE" });
    await expect(enrollContactJourney(fixture.db(), {
      id: "journey-outside-contact", ownerId: "owner-1", routineId: "routine-1", contactId: "contact-3",
      contactIdentityId: null, enrollmentOccurrenceRef: "outside-contact", initialStepKey: "wait-1",
      initialStateJson: {}, now: NOW,
    })).rejects.toMatchObject({ code: "AUTHORITY_UNAVAILABLE" });
    await expect(enrollContactJourney(fixture.db(), {
      id: "journey-outside-channel", ownerId: "owner-1", routineId: "routine-1", contactId: "contact-1",
      contactIdentityId: "identity-email", enrollmentOccurrenceRef: "outside-channel", initialStepKey: "wait-1",
      initialStateJson: {}, now: NOW,
    })).rejects.toMatchObject({ code: "AUTHORITY_UNAVAILABLE" });
    expect(fixture.journeys).toHaveLength(0);
    await expect(enrollContactJourney(fixture.db(), {
      id: "journey-no-identity", ownerId: "owner-1", routineId: "routine-1", contactId: "contact-1",
      contactIdentityId: null, enrollmentOccurrenceRef: "no-identity", initialStepKey: "wait-1",
      initialStateJson: {}, now: NOW,
    })).resolves.toMatchObject({ kind: "created", journey: { contactIdentityId: null } });
  });

  it("CAS-advances once; an exact wait retry keeps generation, a new wait increments it", async () => {
    const fixture = new JourneyFixture();
    fixture.seedAuthority();
    await enroll(fixture);
    await expect(advanceContactJourney(fixture.db(), {
      ownerId: "owner-1", journeyId: "journey-1", expectedRowRevision: 0,
      expectedCurrentStepKey: "wait-1", nextStepKey: "not-compiled", now: NOW,
    })).rejects.toMatchObject({ code: "AUTHORITY_UNAVAILABLE" });
    await expect(advanceContactJourney(fixture.db(), {
      ownerId: "owner-1", journeyId: "journey-1", expectedRowRevision: 0, expectedCurrentStepKey: "wait-1", nextStepKey: "wait-2", now: NOW,
    })).resolves.toMatchObject({ rowRevision: 1, currentStepKey: "wait-2" });
    await expect(advanceContactJourney(fixture.db(), {
      ownerId: "owner-1", journeyId: "journey-1", expectedRowRevision: 0, expectedCurrentStepKey: "wait-1", nextStepKey: "wait-2", now: NOW,
    })).rejects.toMatchObject({ code: "CAS_CONFLICT" });
    const due = new Date("2026-07-22T11:00:00.000Z");
    const waitInput = {
      ownerId: "owner-1", journeyId: "journey-1", expectedRowRevision: 1, expectedWaitGeneration: 0,
      expectedCurrentStepKey: "wait-2", resumeStepKey: "reply-1", nextEligibleAt: due, now: NOW,
    };
    await expect(enterJourneyWait(fixture.db(), {
      ...waitInput,
      resumeStepKey: "not-compiled",
    })).rejects.toMatchObject({ code: "AUTHORITY_UNAVAILABLE" });
    await expect(enterJourneyWait(fixture.db(), waitInput)).resolves.toMatchObject({ kind: "entered", journey: { waitGeneration: 1 } });
    await expect(enterJourneyWait(fixture.db(), waitInput)).resolves.toMatchObject({ kind: "replayed", journey: { waitGeneration: 1 } });
    await expect(createJourneyDueRun(fixture.db(), {
      ownerId: "owner-1", journeyId: "journey-1", routineRunId: "run-too-early", trustedTriggerPayload: {}, now: NOW,
    })).resolves.toEqual({ kind: "not_due" });
    const dueResult = await createJourneyDueRun(fixture.db(), {
      ownerId: "owner-1", journeyId: "journey-1", routineRunId: "run-due", trustedTriggerPayload: { waitGeneration: 1 }, now: due,
    });
    expect(dueResult).toMatchObject({ kind: "created", journey: { status: "active", waitGeneration: 1 }, run: { triggerOccurrenceRef: "journey:journey-1:1:2026-07-22T11:00:00.000Z" } });
    expect(fixture.runs).toHaveLength(1);
    await expect(createJourneyDueRun(fixture.db(), {
      ownerId: "owner-1", journeyId: "journey-1", routineRunId: "run-due-retry", trustedTriggerPayload: { waitGeneration: 1 }, now: due,
    })).resolves.toEqual({ kind: "not_due" });
    await expect(enterJourneyWait(fixture.db(), {
      ownerId: "owner-1", journeyId: "journey-1", expectedRowRevision: 3, expectedWaitGeneration: 1,
      expectedCurrentStepKey: "reply-1", resumeStepKey: "complete", nextEligibleAt: new Date("2026-07-22T12:00:00Z"), now: NOW,
    })).resolves.toMatchObject({ journey: { waitGeneration: 2 } });
  });

  it("kill prevents advance and wait without changing journey state", async () => {
    const fixture = new JourneyFixture();
    fixture.seedAuthority();
    await enroll(fixture);
    await engageRoutineKillSwitch(fixture.db(), {
      ownerId: "owner-1", routineId: "routine-1", expectedRowRevision: 0,
      killedByMembershipId: "membership-1", killReasonCode: "merchant_kill", now: NOW,
    });
    const before = { ...fixture.journeys[0] };
    await expect(advanceContactJourney(fixture.db(), {
      ownerId: "owner-1", journeyId: "journey-1", expectedRowRevision: 0,
      expectedCurrentStepKey: "wait-1", nextStepKey: "wait-2", now: NOW,
    })).rejects.toMatchObject({ code: "AUTHORITY_UNAVAILABLE" });
    await expect(enterJourneyWait(fixture.db(), {
      ownerId: "owner-1", journeyId: "journey-1", expectedRowRevision: 0, expectedWaitGeneration: 0,
      expectedCurrentStepKey: "wait-1", resumeStepKey: "reply-1",
      nextEligibleAt: new Date("2026-07-22T11:00:00Z"), now: NOW,
    })).rejects.toMatchObject({ code: "AUTHORITY_UNAVAILABLE" });
    expect(fixture.journeys[0]).toEqual(before);
  });
});

describe("C7 step ledger", () => {
  it("derives the exact step and three cross-run action formula families", () => {
    expect(deriveStepIdempotencyKey({ ownerId: "owner-1", routineRunId: "run-1", contactJourneyStateId: "journey-1", stepKey: "reply" })).not.toBe(
      deriveStepIdempotencyKey({ ownerId: "owner-1", routineRunId: "run-2", contactJourneyStateId: "journey-1", stepKey: "reply" }),
    );
    const journey = deriveActionIdempotencyKey({ kind: "journey_step", ownerId: "owner-1", workflowDefinitionId: "definition-1", contactJourneyStateId: "journey-1", stepKey: "reply" });
    const scheduled = deriveActionIdempotencyKey({ kind: "scheduled_routine", ownerId: "owner-1", workflowDefinitionId: "definition-1", routineKey: "routine-key-1", scheduledFor: "2026-07-22T18:00:00+08:00", stepKey: "reply" });
    const inbound = deriveActionIdempotencyKey({ kind: "business_hours_auto_reply", ownerId: "owner-1", conversationId: "conversation-1", customerMessageSourceEventKey: "source-1", channel: "whatsapp" });
    expect(new Set([journey, scheduled, inbound]).size).toBe(3);
    expect(scheduled).toBe(deriveActionIdempotencyKey({ kind: "scheduled_routine", ownerId: "owner-1", workflowDefinitionId: "definition-1", routineKey: "routine-key-1", scheduledFor: "2026-07-22T10:00:00Z", stepKey: "reply" }));
  });

  it("records targetless manual and scheduled customer steps as honestly unavailable", async () => {
    const fixture = new JourneyFixture();
    fixture.seedAuthority();
    (fixture.revisions[0]!.compiledRuleJson as { trigger: { type: string } }).trigger.type = "schedule";
    await createRoutineRun(fixture.db(), {
      id: "run-schedule", ownerId: "owner-1", routineId: "routine-1",
      trigger: { kind: "schedule", scheduledFor: NOW }, trustedTriggerPayload: {}, now: NOW,
    });
    const scheduled = await reserveWorkflowStep(fixture.db(), {
      id: "step-schedule", ownerId: "owner-1", routineRunId: "run-schedule", stepKey: "reply",
      actionKind: "conversation_reply", actionPayload: { templateVersionId: "template-v1" },
      actionOccurrence: {
        kind: "scheduled_routine", ownerId: "owner-1", workflowDefinitionId: "definition-1",
        routineKey: "routine-key-1", scheduledFor: NOW, stepKey: "reply",
      },
      target: null, preDispatchUnavailableReason: "workflow_target_unavailable", now: NOW,
    });
    expect(scheduled).toMatchObject({
      shouldCallDownstream: false,
      execution: { status: "unavailable", reasonCode: "workflow_target_unavailable" },
    });
    expect(scheduled.execution.actionIdempotencyKey).toMatch(/^[a-f0-9]{64}$/);

    (fixture.revisions[0]!.compiledRuleJson as { trigger: { type: string } }).trigger.type = "manual";
    const manualRun = await createRoutineRun(fixture.db(), {
      id: "run-manual-unavailable", ownerId: "owner-1", routineId: "routine-1",
      trigger: { kind: "manual", operationId: "manual-unavailable" }, trustedTriggerPayload: {}, now: NOW,
    });
    if (manualRun.kind === "blocked") throw new Error("Expected manual run");
    const manual = await reserveWorkflowStep(fixture.db(), {
      id: "step-manual-unavailable", ownerId: "owner-1", routineRunId: "run-manual-unavailable", stepKey: "reply",
      actionKind: "conversation_reply", actionPayload: { templateVersionId: "template-v1" },
      actionOccurrence: null, target: null,
      preDispatchUnavailableReason: "workflow_target_unavailable", now: NOW,
    });
    expect(manual).toMatchObject({
      shouldCallDownstream: false,
      execution: {
        status: "unavailable",
        reasonCode: "workflow_target_unavailable",
      },
    });
    expect(manual.execution.actionIdempotencyKey).toBe(deriveNoTargetActionIdempotencyKey({
      ownerId: "owner-1",
      workflowDefinitionId: manualRun.run.workflowDefinitionId,
      routineKey: manualRun.run.routineKey,
      triggerKind: manualRun.run.triggerKind,
      triggerOccurrenceRef: manualRun.run.triggerOccurrenceRef,
      contactJourneyStateId: manualRun.run.contactJourneyStateId,
      scheduledFor: manualRun.run.scheduledFor,
      stepKey: "reply",
    }));
  });

  it("replays a killed customer step with one stable blocked identity", async () => {
    const fixture = new JourneyFixture();
    fixture.seedAuthority();
    fixture.journeys.push({
      id: "journey-killed", ownerId: "owner-1", contactId: "contact-1", contactIdentityId: "identity-1",
      workflowDefinitionId: "definition-1", workflowRevisionId: "revision-1", routineId: "routine-1",
      enrollmentIdempotencyKey: "enrollment-killed", status: "active", currentStepKey: "reply", nextEligibleAt: null,
      waitGeneration: 1, stateJson: {}, lastRoutineRunId: null, rowRevision: 0, enrolledAt: NOW, terminalAt: null,
    });
    const run = await createRoutineRun(fixture.db(), {
      id: "run-killed", ownerId: "owner-1", routineId: "routine-1",
      trigger: { kind: "journey_due", contactJourneyStateId: "journey-killed", waitGeneration: 1, nextEligibleAt: NOW },
      trustedTriggerPayload: { generation: 1 }, now: NOW,
    });
    if (run.kind === "blocked") throw new Error("Expected journey run");
    await engageRoutineKillSwitch(fixture.db(), {
      ownerId: "owner-1", routineId: "routine-1", expectedRowRevision: 0,
      killedByMembershipId: "membership-1", killReasonCode: "owner_stop", now: NOW,
    });
    const input = {
      id: "step-killed", ownerId: "owner-1", routineRunId: run.run.id, stepKey: "reply",
      actionKind: "conversation_reply" as const, actionPayload: { templateVersionId: "template-v1" },
      actionOccurrence: null, target: null, now: NOW,
    };
    const first = await reserveWorkflowStep(fixture.db(), input);
    const second = await reserveWorkflowStep(fixture.db(), { ...input, id: "step-killed-retry" });
    await expect(reserveWorkflowStep(fixture.db(), {
      ...input,
      id: "step-killed-conflict",
      actionPayload: { templateVersionId: "template-v2" },
    })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const expectedKey = deriveNoTargetActionIdempotencyKey({
      ownerId: "owner-1",
      workflowDefinitionId: run.run.workflowDefinitionId,
      routineKey: run.run.routineKey,
      triggerKind: run.run.triggerKind,
      triggerOccurrenceRef: run.run.triggerOccurrenceRef,
      contactJourneyStateId: run.run.contactJourneyStateId,
      scheduledFor: run.run.scheduledFor,
      stepKey: "reply",
    });
    expect(first).toMatchObject({
      kind: "created", shouldCallDownstream: false,
      execution: { id: "step-killed", status: "blocked", actionIdempotencyKey: expectedKey },
    });
    expect(second).toMatchObject({
      kind: "replayed", shouldCallDownstream: false,
      execution: { id: "step-killed", status: "blocked", actionIdempotencyKey: expectedKey },
    });
    expect(fixture.steps).toHaveLength(1);
  });

  it("reserves before call, resumes after a crash, persists blocked four-axis facts, and dedups across runs", async () => {
    const fixture = new JourneyFixture();
    fixture.seedAuthority();
    fixture.journeys.push({
      id: "journey-1", ownerId: "owner-1", contactId: "contact-1", contactIdentityId: "identity-1",
      workflowDefinitionId: "definition-1", workflowRevisionId: "revision-1", routineId: "routine-1",
      enrollmentIdempotencyKey: "enrollment-1", status: "active", currentStepKey: "reply", nextEligibleAt: null,
      waitGeneration: 1, stateJson: {}, lastRoutineRunId: null, rowRevision: 0, enrolledAt: NOW, terminalAt: null,
    });
    await createRoutineRun(fixture.db(), {
      id: "run-1", ownerId: "owner-1", routineId: "routine-1",
      trigger: { kind: "journey_due", contactJourneyStateId: "journey-1", waitGeneration: 1, nextEligibleAt: NOW },
      trustedTriggerPayload: { generation: 1 }, now: NOW,
    });
    const reserveInput = {
      id: "step-1", ownerId: "owner-1", routineRunId: "run-1", stepKey: "reply", actionKind: "conversation_reply" as const,
      actionPayload: { templateVersionId: "template-v1" },
      actionOccurrence: { kind: "journey_step" as const, ownerId: "owner-1", workflowDefinitionId: "definition-1", contactJourneyStateId: "journey-1", stepKey: "reply" },
      target: { contactId: "contact-1", contactIdentityId: "identity-1", channel: "whatsapp", providerConnectionId: null, purpose: "marketing" },
      now: NOW,
    };
    const reserved = await reserveWorkflowStep(fixture.db(), reserveInput);
    expect(reserved).toMatchObject({ kind: "created", shouldCallDownstream: true, execution: { status: "reserved" } });
    expect(fixture.steps).toHaveLength(1);
    await expect(reserveWorkflowStep(fixture.db(), { ...reserveInput, id: "step-crash-retry" })).resolves.toMatchObject({ kind: "replayed", execution: { id: "step-1", status: "reserved" } });
    await expect(reserveWorkflowStep(fixture.db(), { ...reserveInput, actionPayload: { templateVersionId: "changed" } })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    await expect(reserveWorkflowStep(fixture.db(), {
      ...reserveInput,
      id: "step-reactive",
      stepKey: "reactive",
      actionOccurrence: { ...reserveInput.actionOccurrence, stepKey: "reactive" },
      target: { ...reserveInput.target, purpose: "reactive_service_reply" },
    })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    const frozenEligibilityInput = eligibilityInput();
    const blockedVerdict = eligibilityVerdict({ consentStop: "block" });
    await expect(settleWorkflowStep(fixture.db(), {
      ownerId: "owner-1", stepExecutionId: "step-1", now: NOW,
      settlement: {
        status: "blocked", reasonCode: "consentStop:effective_revoke",
        eligibilityInput: { ...frozenEligibilityInput, contactId: "contact-2" }, eligibilityVerdict: blockedVerdict,
      },
    })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(settleWorkflowStep(fixture.db(), {
      ownerId: "owner-1", stepExecutionId: "step-1", now: NOW,
      settlement: {
        status: "blocked", reasonCode: "consentStop:effective_revoke",
        eligibilityInput: frozenEligibilityInput,
        eligibilityVerdict: { ...blockedVerdict, mergedSuppression: true },
      },
    })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(settleWorkflowStep(fixture.db(), {
      ownerId: "owner-1", stepExecutionId: "step-1", now: NOW,
      settlement: {
        status: "simulated", eligibilityInput: frozenEligibilityInput, eligibilityVerdict: blockedVerdict,
      },
    })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(settleWorkflowStep(fixture.db(), {
      ownerId: "owner-1", stepExecutionId: "step-1", now: NOW,
      settlement: {
        status: "delegated", downstreamKind: "conversation_reply", downstreamRef: "unsafe",
        eligibilityInput: frozenEligibilityInput, eligibilityVerdict: blockedVerdict,
      },
    })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    const blocked = await settleWorkflowStep(fixture.db(), {
      ownerId: "owner-1", stepExecutionId: "step-1", now: NOW,
      settlement: { status: "blocked", reasonCode: "consentStop:effective_revoke", eligibilityInput: frozenEligibilityInput, eligibilityVerdict: blockedVerdict },
    });
    expect(blocked).toMatchObject({ status: "blocked", reasonCode: "consentStop:effective_revoke", eligibilityVerdictJson: blockedVerdict, downstreamKind: "none" });
    expect(blocked.eligibilityInputHash).toBeTruthy();
    expect(blocked.eligibilityVerdictHash).toBeTruthy();
    expect(blocked.settledAt?.toISOString()).toBe(NOW.toISOString());
    await expect(settleWorkflowStep(fixture.db(), {
      ownerId: "owner-1", stepExecutionId: "step-1", now: new Date("2026-07-22T10:01:00Z"),
      settlement: { status: "blocked", reasonCode: "consentStop:effective_revoke", eligibilityInput: frozenEligibilityInput, eligibilityVerdict: blockedVerdict },
    })).resolves.toMatchObject({ settledAt: NOW });

    await createRoutineRun(fixture.db(), {
      id: "run-2", ownerId: "owner-1", routineId: "routine-1",
      trigger: { kind: "journey_due", contactJourneyStateId: "journey-1", waitGeneration: 2, nextEligibleAt: new Date("2026-07-22T11:00:00Z") },
      trustedTriggerPayload: { generation: 2 }, now: NOW,
    });
    await expect(reserveWorkflowStep(fixture.db(), { ...reserveInput, id: "step-2", routineRunId: "run-2" })).resolves.toMatchObject({
      kind: "action_replayed", shouldCallDownstream: false, execution: { id: "step-1" },
    });
    expect(fixture.steps).toHaveLength(1);

    await reserveWorkflowStep(fixture.db(), {
      ...reserveInput,
      id: "step-unavailable",
      routineRunId: "run-2",
      stepKey: "reply-unavailable",
      actionOccurrence: { ...reserveInput.actionOccurrence, stepKey: "reply-unavailable" },
      target: { ...reserveInput.target, purpose: "strict_classification_unavailable" },
    });
    const unavailableInput = eligibilityInput("strict_classification_unavailable");
    const unavailableVerdict = eligibilityVerdict({
      consentStop: "unavailable",
      doNotDisturb: "unavailable",
      providerRefusal: "unavailable",
      frequency: "unavailable",
    });
    await expect(settleWorkflowStep(fixture.db(), {
      ownerId: "owner-1", stepExecutionId: "step-unavailable", now: NOW,
      settlement: {
        status: "delegated", downstreamKind: "conversation_reply", downstreamRef: "must-not-delegate",
        eligibilityInput: unavailableInput,
        eligibilityVerdict: eligibilityVerdict(),
      },
    })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    const unavailable = await settleWorkflowStep(fixture.db(), {
      ownerId: "owner-1",
      stepExecutionId: "step-unavailable",
      now: NOW,
      settlement: {
        status: "unavailable",
        reasonCode: "SEND_PATH_UNAVAILABLE",
        eligibilityInput: unavailableInput,
        eligibilityVerdict: unavailableVerdict,
      },
    });
    expect(unavailable).toMatchObject({ status: "unavailable", reasonCode: "SEND_PATH_UNAVAILABLE", downstreamKind: "none" });
    expect(unavailable.eligibilityVerdictHash).toBeTruthy();
  });

  it("enforces maxRecipients against distinct prior run contacts", async () => {
    const fixture = new JourneyFixture();
    fixture.seedAuthority();
    (fixture.revisions[0]!.compiledRuleJson as { trigger: { type: string } }).trigger.type = "customer_message";
    await createRoutineRun(fixture.db(), {
      id: "run-recipient-cap", ownerId: "owner-1", routineId: "routine-1",
      trigger: { kind: "customer_message", sourceEventKey: "source-1", triggerEventRef: "message-1" },
      trustedTriggerPayload: {}, now: NOW,
    });
    const base = {
      ownerId: "owner-1", routineRunId: "run-recipient-cap", actionKind: "conversation_reply" as const,
      actionPayload: { templateVersionId: "template-v1" }, now: NOW,
    };
    await expect(reserveWorkflowStep(fixture.db(), {
      ...base, id: "step-recipient-1", stepKey: "recipient-1",
      actionOccurrence: {
        kind: "business_hours_auto_reply" as const, ownerId: "owner-1", conversationId: "conversation-1",
        customerMessageSourceEventKey: "source-1", channel: "whatsapp",
      },
      target: { contactId: "contact-1", contactIdentityId: "identity-1", channel: "whatsapp", providerConnectionId: null, purpose: "marketing" },
    })).resolves.toMatchObject({ shouldCallDownstream: true, execution: { status: "reserved" } });
    await expect(reserveWorkflowStep(fixture.db(), {
      ...base, id: "step-recipient-2", stepKey: "recipient-2",
      actionOccurrence: {
        kind: "business_hours_auto_reply" as const, ownerId: "owner-1", conversationId: "conversation-2",
        customerMessageSourceEventKey: "source-1", channel: "whatsapp",
      },
      target: { contactId: "contact-2", contactIdentityId: "identity-2", channel: "whatsapp", providerConnectionId: null, purpose: "marketing" },
    })).resolves.toMatchObject({
      shouldCallDownstream: false,
      execution: { status: "blocked", reasonCode: "routine_scope_denied" },
    });
  });

  it("a kill between reservation and settlement blocks the step; delegated settlement anchors both times", async () => {
    const fixture = new JourneyFixture();
    fixture.seedAuthority();
    (fixture.revisions[0]!.compiledRuleJson as { trigger: { type: string } }).trigger.type = "manual";
    await createRoutineRun(fixture.db(), {
      id: "run-manual", ownerId: "owner-1", routineId: "routine-1",
      trigger: { kind: "manual", operationId: "operation-1" }, trustedTriggerPayload: {}, now: NOW,
    });
    await reserveWorkflowStep(fixture.db(), {
      id: "step-wait", ownerId: "owner-1", routineRunId: "run-manual", stepKey: "wait", actionKind: "wait",
      actionPayload: { until: "later" }, actionOccurrence: null, target: null, now: NOW,
    });
    await engageRoutineKillSwitch(fixture.db(), {
      ownerId: "owner-1", routineId: "routine-1", expectedRowRevision: 0,
      killedByMembershipId: "membership-1", killReasonCode: "merchant_kill", now: NOW,
    });
    await expect(settleWorkflowStep(fixture.db(), {
      ownerId: "owner-1", stepExecutionId: "step-wait", settlement: { status: "simulated" }, now: NOW,
    })).resolves.toMatchObject({ status: "blocked", reasonCode: "routine_authority_kill", downstreamRef: null, settledAt: NOW });

    const rows = authRows();
    rows.routine.id = "routine-2";
    rows.routine.routineKey = "routine-key-2";
    rows.routine.authorizationHash = computeRoutineAuthorizationHash({
      ownerId: rows.routine.ownerId, routineKey: rows.routine.routineKey, workflowDefinitionId: rows.routine.workflowDefinitionId,
      workflowRevisionId: rows.routine.workflowRevisionId, workflowRevision: rows.revision.revision, workflowContentHash: rows.revision.contentHash,
      dependencyHash: rows.revision.dependencyHash, scopeJson: rows.routine.scopeJson, maxCreditsPerRun: 0, maxCreditsPerMonth: 0,
      expiresAt: rows.routine.expiresAt, summaryPolicyJson: rows.routine.summaryPolicyJson, authorizationRevision: 1,
    });
    fixture.routines.push(rows.routine);
    (fixture.revisions[0]!.compiledRuleJson as { trigger: { type: string } }).trigger.type = "customer_message";
    await createRoutineRun(fixture.db(), {
      id: "run-delegated", ownerId: "owner-1", routineId: "routine-2",
      trigger: { kind: "customer_message", sourceEventKey: "source-1", triggerEventRef: "message-1" },
      trustedTriggerPayload: {}, now: NOW,
    });
    await reserveWorkflowStep(fixture.db(), {
      id: "step-complete", ownerId: "owner-1", routineRunId: "run-delegated", stepKey: "reply", actionKind: "conversation_reply",
      actionPayload: { templateVersionId: "template-v1" },
      actionOccurrence: { kind: "business_hours_auto_reply", ownerId: "owner-1", conversationId: "conversation-1", customerMessageSourceEventKey: "source-1", channel: "whatsapp" },
      target: { contactId: "contact-1", contactIdentityId: "identity-1", channel: "whatsapp", providerConnectionId: null, purpose: "marketing" },
      now: NOW,
    });
    const completed = await settleWorkflowStep(fixture.db(), {
      ownerId: "owner-1", stepExecutionId: "step-complete",
      settlement: {
        status: "delegated", downstreamKind: "conversation_reply", downstreamRef: "conversation-action-1",
        eligibilityInput: eligibilityInput(),
        eligibilityVerdict: eligibilityVerdict(),
      },
      now: NOW,
    });
    expect(completed.settledAt?.toISOString()).toBe(NOW.toISOString());
    expect(completed.delegatedAt?.toISOString()).toBe(NOW.toISOString());
  });
});

it("exports a stable typed journey error", () => {
  expect(new WorkflowJourneyError("CAS_CONFLICT")).toMatchObject({ name: "WorkflowJourneyError", code: "CAS_CONFLICT" });
});
