import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockListWorkflowDefinitions,
  mockGetWorkflowDefinition,
  mockListWorkflowRevisions,
  mockListRoutines,
  mockGetRoutine,
  mockListRoutineRuns,
  mockGetContactJourneyStates,
  mockListBusinessHoursPolicies,
  mockGetBusinessHoursPolicy,
  mockCreateWorkflowDefinition,
  mockValidateWorkflowRules,
  mockSaveWorkflowRevision,
  mockPublishWorkflowRevision,
  mockCreateRoutineDraft,
} = vi.hoisted(() => ({
  mockListWorkflowDefinitions: vi.fn(),
  mockGetWorkflowDefinition: vi.fn(),
  mockListWorkflowRevisions: vi.fn(),
  mockListRoutines: vi.fn(),
  mockGetRoutine: vi.fn(),
  mockListRoutineRuns: vi.fn(),
  mockGetContactJourneyStates: vi.fn(),
  mockListBusinessHoursPolicies: vi.fn(),
  mockGetBusinessHoursPolicy: vi.fn(),
  mockCreateWorkflowDefinition: vi.fn(),
  mockValidateWorkflowRules: vi.fn(),
  mockSaveWorkflowRevision: vi.fn(),
  mockPublishWorkflowRevision: vi.fn(),
  mockCreateRoutineDraft: vi.fn(),
}));

vi.mock("../customer-workflow-ui-actions", () => ({
  listWorkflowDefinitions: mockListWorkflowDefinitions,
  getWorkflowDefinition: mockGetWorkflowDefinition,
  listWorkflowRevisions: mockListWorkflowRevisions,
  listRoutines: mockListRoutines,
  getRoutine: mockGetRoutine,
  listRoutineRuns: mockListRoutineRuns,
  getContactJourneyStates: mockGetContactJourneyStates,
  listBusinessHoursPolicies: mockListBusinessHoursPolicies,
  getBusinessHoursPolicy: mockGetBusinessHoursPolicy,
  createWorkflowDefinition: mockCreateWorkflowDefinition,
  validateWorkflowRules: mockValidateWorkflowRules,
  saveWorkflowRevision: mockSaveWorkflowRevision,
  publishWorkflowRevision: mockPublishWorkflowRevision,
  createRoutineDraft: mockCreateRoutineDraft,
}));

import { makeOttoWorkflowsPort } from "../otto-workflows-port";

const DEFINITION_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const REVISION_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const ROUTINE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAX";
const PREDECESSOR_ROUTINE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAY";
const RUN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAZ";
const JOURNEY_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB0";
const POLICY_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB1";
const NEXT_CURSOR = "01ARZ3NDEKTSV4RRFFQ69G5FB2";
const CREATED_AT = new Date("2026-07-22T01:02:03.000Z");
const UPDATED_AT = new Date("2026-07-23T04:05:06.000Z");
const EXPIRES_AT = new Date("2026-08-31T00:00:00.000Z");

const scopeJson = {
  actionKinds: ["complete" as const],
  channelScopes: [],
  contactIds: [],
  segmentIds: [],
  maxActions: 1,
  maxRecipients: 0,
};

const definitionRow = {
  id: DEFINITION_ID,
  ownerId: "owner-secret",
  slug: "follow-up",
  name: "Follow up",
  definitionKind: "rule",
  originKind: "custom",
  recipeKey: null,
  recipeCatalogVersion: null,
  currentRevision: null,
  rowRevision: 0,
  status: "draft",
  createdByMembershipId: "member-secret",
  archivedAt: null,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  futureDefinitionSecret: "must-not-leak",
};

const publishedDefinitionRow = {
  ...definitionRow,
  currentRevision: 1,
  rowRevision: 1,
  status: "published",
};

const validationRow = {
  formatVersion: "fikirtive-workflow/v1",
  compiledRuleJson: { internal: true },
  dependencyManifestJson: [{ ownerId: "owner-secret" }],
  dependencyHash: "dependency-secret",
  compilerVersion: "c7-workflow-compiler/1",
  contentHash: "content-secret",
  validationState: "invalid",
  validationErrorsJson: [{
    code: "INVALID_VALUE",
    path: "$.steps[0]",
    line: 4,
    column: 3,
    futureDiagnosticSecret: "must-not-leak",
  }],
  futureValidationSecret: "must-not-leak",
};

const revisionRow = {
  id: REVISION_ID,
  ownerId: "owner-secret",
  workflowDefinitionId: DEFINITION_ID,
  revision: 1,
  formatVersion: "fikirtive-workflow/v1",
  rulesSource: "version: fikirtive-workflow/v1\nsteps: []\n",
  compiledRuleJson: { internal: true },
  dependencyManifestJson: [{ ownerId: "owner-secret" }],
  dependencyHash: "dependency-secret",
  compilerVersion: "c7-workflow-compiler/1",
  contentHash: "content-secret",
  validationState: "valid",
  validationErrorsJson: [],
  createdByMembershipId: "member-secret",
  createdAt: CREATED_AT,
  futureRevisionSecret: "must-not-leak",
};

const draftRoutineRow = {
  id: ROUTINE_ID,
  ownerId: "owner-secret",
  workflowDefinitionId: DEFINITION_ID,
  workflowRevisionId: REVISION_ID,
  routineKey: "weekly_follow_up",
  supersedesRoutineId: null,
  status: "draft",
  scopeJson: { ...scopeJson, futureScopeSecret: "must-not-leak" },
  scopeHash: "scope-secret",
  maxCreditsPerRun: 0,
  maxCreditsPerMonth: 0,
  summaryPolicyJson: {
    mode: "counts_only",
    scope: "workflow_activity",
    futureSummarySecret: "must-not-leak",
  },
  authorizationRevision: 1,
  authorizationHash: null,
  authorizedByMembershipId: null,
  authorizedAt: null,
  expiresAt: EXPIRES_AT,
  killSwitchEngaged: false,
  killedByMembershipId: null,
  killedAt: null,
  killReasonCode: null,
  rowRevision: 0,
  createdByMembershipId: "member-secret",
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  futureRoutineSecret: "must-not-leak",
};

const routineSummaryRow = {
  id: ROUTINE_ID,
  ownerId: "owner-secret",
  routineKey: "weekly_follow_up",
  supersedesRoutineId: PREDECESSOR_ROUTINE_ID,
  status: "active",
  workflowDefinition: {
    id: DEFINITION_ID,
    slug: "follow-up",
    name: "Follow up",
    definitionKind: "rule",
    status: "published",
    futureDefinitionRefSecret: "must-not-leak",
  },
  workflowRevision: {
    id: REVISION_ID,
    revision: 1,
    validationState: "valid",
    futureRevisionRefSecret: "must-not-leak",
  },
  authorization: {
    revision: 2,
    authorized: true,
    authorizedAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
    authorizationHash: "must-not-leak",
  },
  scopeSummary: {
    actionKinds: ["complete"],
    channelCount: 0,
    contactCount: 0,
    segmentCount: 0,
    maxActions: 1,
    maxRecipients: 0,
    futureScopeSummarySecret: "must-not-leak",
  },
  maxCreditsPerRun: 0,
  maxCreditsPerMonth: 0,
  summaryPolicy: {
    mode: "counts_only",
    scope: "workflow_activity",
    futureSummaryPolicySecret: "must-not-leak",
  },
  killSwitchEngaged: false,
  killedAt: null,
  killReasonCode: null,
  rowRevision: 2,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  authorizedByMembershipId: "member-secret",
  futureRoutineReadSecret: "must-not-leak",
};

const predecessorRoutineRow = {
  ...routineSummaryRow,
  id: PREDECESSOR_ROUTINE_ID,
  supersedesRoutineId: null,
  status: "revoked",
  authorization: { ...routineSummaryRow.authorization, revision: 1 },
  rowRevision: 3,
};

const routineDetailRow = {
  routine: {
    ...routineSummaryRow,
    scope: {
      ...scopeJson,
      futureScopeSecret: "must-not-leak",
    },
  },
  predecessors: [predecessorRoutineRow],
  futureRoutineDetailSecret: "must-not-leak",
};

const routineRunRow = {
  id: RUN_ID,
  ownerId: "owner-secret",
  routineId: ROUTINE_ID,
  routineKey: "weekly_follow_up",
  workflowDefinitionId: DEFINITION_ID,
  workflowRevisionId: REVISION_ID,
  contactJourneyStateId: JOURNEY_ID,
  triggerKind: "journey_due",
  scheduledFor: CREATED_AT,
  status: "blocked",
  currentStepKey: "send_offer",
  rowRevision: 3,
  simulated: true,
  reservedCredits: 0,
  settledCredits: 0,
  summary: { attempted: 1, simulated: true, omitted: null },
  summaryJson: { rawMessage: "must-not-leak" },
  blockReason: "CONSENT_STOP",
  errorCode: null,
  startedAt: CREATED_AT,
  finishedAt: UPDATED_AT,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  runIdempotencyKey: "must-not-leak",
  authorizationSnapshotJson: { ownerId: "owner-secret" },
  triggerPayloadHash: "must-not-leak",
  futureRunSecret: "must-not-leak",
};

const journeyRow = {
  id: JOURNEY_ID,
  ownerId: "owner-secret",
  contact: { id: "01ARZ3NDEKTSV4RRFFQ69G5FB3", name: "Aisyah", phone: "must-not-leak" },
  workflowDefinitionId: DEFINITION_ID,
  workflowRevisionId: REVISION_ID,
  routineId: ROUTINE_ID,
  status: "waiting",
  currentStepKey: "send_offer",
  nextEligibleAt: EXPIRES_AT,
  waitGeneration: 1,
  lastRoutineRunId: RUN_ID,
  lastRoutineRun: {
    id: RUN_ID,
    status: "blocked",
    blockReason: "CONSENT_STOP",
    errorCode: null,
    startedAt: CREATED_AT,
    finishedAt: UPDATED_AT,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    futureLastRunSecret: "must-not-leak",
  },
  rowRevision: 2,
  enrolledAt: CREATED_AT,
  terminalAt: null,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  stateJson: { raw: "must-not-leak" },
  enrollmentIdempotencyKey: "must-not-leak",
  futureJourneySecret: "must-not-leak",
};

const policySummaryRow = {
  id: POLICY_ID,
  ownerId: "owner-secret",
  policyKey: "weekday_hours",
  revision: 1,
  supersedesPolicyId: null,
  name: "Weekday hours",
  timeZone: "Asia/Kuala_Lumpur",
  status: "published",
  rowRevision: 0,
  archivedAt: null,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  contentHash: "must-not-leak",
  createdByMembershipId: "member-secret",
  futurePolicySecret: "must-not-leak",
};

const policyDetailRow = {
  ...policySummaryRow,
  weeklyWindows: [{
    weekday: 3,
    startMinute: 540,
    endMinute: 1020,
    futureWindowSecret: "must-not-leak",
  }],
};

const definitionDto = {
  id: DEFINITION_ID,
  slug: "follow-up",
  name: "Follow up",
  definitionKind: "rule",
  originKind: "custom",
  recipeKey: null,
  recipeCatalogVersion: null,
  currentRevision: null,
  rowRevision: 0,
  status: "draft",
  archivedAt: null,
  createdAt: CREATED_AT.toISOString(),
  updatedAt: UPDATED_AT.toISOString(),
};

const publishedDefinitionDto = {
  ...definitionDto,
  currentRevision: 1,
  rowRevision: 1,
  status: "published",
};

const revisionDto = {
  id: REVISION_ID,
  workflowDefinitionId: DEFINITION_ID,
  revision: 1,
  formatVersion: "fikirtive-workflow/v1",
  rulesSource: "version: fikirtive-workflow/v1\nsteps: []\n",
  compilerVersion: "c7-workflow-compiler/1",
  validationState: "valid",
  validationErrorsJson: [],
  createdAt: CREATED_AT.toISOString(),
};

const routineDto = {
  id: ROUTINE_ID,
  workflowDefinitionId: DEFINITION_ID,
  workflowRevisionId: REVISION_ID,
  routineKey: "weekly_follow_up",
  supersedesRoutineId: null,
  status: "draft",
  scopeJson,
  maxCreditsPerRun: 0,
  maxCreditsPerMonth: 0,
  summaryPolicyJson: { mode: "counts_only", scope: "workflow_activity" },
  authorizationRevision: 1,
  expiresAt: EXPIRES_AT.toISOString(),
  killSwitchEngaged: false,
  rowRevision: 0,
  createdAt: CREATED_AT.toISOString(),
  updatedAt: UPDATED_AT.toISOString(),
};

function change(kind: string, revision: number, id = DEFINITION_ID) {
  return { id, revision, kind, futureChangeSecret: "must-not-leak" };
}

function expectNoSensitiveFields(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(
    /ownerId|MembershipId|compiledRuleJson|dependencyManifestJson|dependencyHash|contentHash|scopeHash|authorizationHash|snapshot|summaryJson|stateJson|payload|idempotency|phone|future[A-Z]/i,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListWorkflowDefinitions.mockResolvedValue({ ok: true, resource: [definitionRow] });
  mockGetWorkflowDefinition.mockResolvedValue({ ok: true, resource: definitionRow });
  mockListWorkflowRevisions.mockResolvedValue({ ok: true, resource: [revisionRow] });
  mockListRoutines.mockResolvedValue({
    ok: true,
    resource: { items: [routineSummaryRow], nextCursor: NEXT_CURSOR },
  });
  mockGetRoutine.mockResolvedValue({ ok: true, resource: routineDetailRow });
  mockListRoutineRuns.mockResolvedValue({
    ok: true,
    resource: { items: [routineRunRow], nextCursor: null },
  });
  mockGetContactJourneyStates.mockResolvedValue({
    ok: true,
    resource: { items: [journeyRow], nextCursor: null },
  });
  mockListBusinessHoursPolicies.mockResolvedValue({
    ok: true,
    resource: { items: [policySummaryRow], nextCursor: null },
  });
  mockGetBusinessHoursPolicy.mockResolvedValue({ ok: true, resource: policyDetailRow });
  mockCreateWorkflowDefinition.mockResolvedValue({
    ok: true,
    resource: definitionRow,
    change: change("created", 0),
  });
  mockValidateWorkflowRules.mockResolvedValue({ ok: true, resource: validationRow });
  mockSaveWorkflowRevision.mockResolvedValue({
    ok: true,
    resource: revisionRow,
    change: change("saved", 1, REVISION_ID),
  });
  mockPublishWorkflowRevision.mockResolvedValue({
    ok: true,
    resource: publishedDefinitionRow,
    change: change("published", 1),
  });
  mockCreateRoutineDraft.mockResolvedValue({
    ok: true,
    resource: draftRoutineRow,
    change: change("routine_draft_created", 0, ROUTINE_ID),
  });
});

describe("makeOttoWorkflowsPort", () => {
  it("returns exactly the fourteen authenticated read/draft methods", () => {
    const port = makeOttoWorkflowsPort();
    expect(Object.keys(port).sort()).toEqual([
      "createRoutineDraft",
      "createWorkflowDefinition",
      "getBusinessHoursPolicy",
      "getContactJourneyStates",
      "getRoutine",
      "getWorkflowDefinition",
      "listBusinessHoursPolicies",
      "listRoutineRuns",
      "listRoutines",
      "listWorkflowDefinitions",
      "listWorkflowRevisions",
      "publishWorkflowRevision",
      "saveWorkflowRevision",
      "validateWorkflowRules",
    ]);
    for (const forbidden of [
      "activateRoutine",
      "authorizeRoutine",
      "reauthorizeRoutine",
      "killRoutine",
      "createWorkflowRun",
      "enrollWorkflowJourney",
      "dispatchWorkflowStep",
      "send",
      "spend",
    ]) {
      expect(port).not.toHaveProperty(forbidden);
    }
  });

  it("passes owner-free operation-specific inputs only to the authenticated UI actions", async () => {
    const port = makeOttoWorkflowsPort();
    await port.listWorkflowDefinitions({ limit: 10 });
    await port.getWorkflowDefinition({ workflowDefinitionId: DEFINITION_ID });
    await port.listWorkflowRevisions({ workflowDefinitionId: DEFINITION_ID, limit: 5 });
    await port.listRoutines({
      workflowDefinitionId: DEFINITION_ID,
      status: "active",
      cursor: NEXT_CURSOR,
      limit: 4,
    });
    await port.getRoutine({ routineId: ROUTINE_ID });
    await port.listRoutineRuns({ routineId: ROUTINE_ID, status: "blocked", limit: 3 });
    await port.getContactJourneyStates({
      workflowDefinitionId: DEFINITION_ID,
      status: "waiting",
      limit: 2,
    });
    await port.listBusinessHoursPolicies({ status: "published", limit: 6 });
    await port.getBusinessHoursPolicy({ businessHoursPolicyId: POLICY_ID });
    await port.createWorkflowDefinition({
      slug: "follow-up",
      name: "Follow up",
      definitionKind: "rule",
      originKind: "custom",
    });
    await port.validateWorkflowRules({ workflowDefinitionId: DEFINITION_ID, rulesSource: "rules" });
    await port.saveWorkflowRevision({ workflowDefinitionId: DEFINITION_ID, rulesSource: "rules" });
    await port.publishWorkflowRevision({
      workflowDefinitionId: DEFINITION_ID,
      workflowRevisionId: REVISION_ID,
      expectedRowRevision: 0,
    });

    expect(mockListWorkflowDefinitions).toHaveBeenCalledWith({ limit: 10 });
    expect(mockGetWorkflowDefinition).toHaveBeenCalledWith({ workflowDefinitionId: DEFINITION_ID });
    expect(mockListWorkflowRevisions).toHaveBeenCalledWith({
      workflowDefinitionId: DEFINITION_ID,
      limit: 5,
    });
    expect(mockListRoutines).toHaveBeenCalledWith({
      workflowDefinitionId: DEFINITION_ID,
      status: "active",
      cursor: NEXT_CURSOR,
      limit: 4,
    });
    expect(mockGetRoutine).toHaveBeenCalledWith({ routineId: ROUTINE_ID });
    expect(mockListRoutineRuns).toHaveBeenCalledWith({
      routineId: ROUTINE_ID,
      status: "blocked",
      limit: 3,
    });
    expect(mockGetContactJourneyStates).toHaveBeenCalledWith({
      workflowDefinitionId: DEFINITION_ID,
      status: "waiting",
      limit: 2,
    });
    expect(mockListBusinessHoursPolicies).toHaveBeenCalledWith({
      status: "published",
      limit: 6,
    });
    expect(mockGetBusinessHoursPolicy).toHaveBeenCalledWith({
      businessHoursPolicyId: POLICY_ID,
    });
    expect(mockCreateWorkflowDefinition).toHaveBeenCalledWith({
      slug: "follow-up",
      name: "Follow up",
      definitionKind: "rule",
      originKind: "custom",
    });
    expect(mockValidateWorkflowRules).toHaveBeenCalledWith({
      workflowDefinitionId: DEFINITION_ID,
      rulesSource: "rules",
    });
    expect(mockSaveWorkflowRevision).toHaveBeenCalledWith({
      workflowDefinitionId: DEFINITION_ID,
      rulesSource: "rules",
    });
    expect(mockPublishWorkflowRevision).toHaveBeenCalledWith({
      workflowDefinitionId: DEFINITION_ID,
      workflowRevisionId: REVISION_ID,
      expectedRowRevision: 0,
    });
    expect(JSON.stringify([
      ...mockListWorkflowDefinitions.mock.calls,
      ...mockGetWorkflowDefinition.mock.calls,
      ...mockListWorkflowRevisions.mock.calls,
      ...mockListRoutines.mock.calls,
      ...mockGetRoutine.mock.calls,
      ...mockListRoutineRuns.mock.calls,
      ...mockGetContactJourneyStates.mock.calls,
      ...mockListBusinessHoursPolicies.mock.calls,
      ...mockGetBusinessHoursPolicy.mock.calls,
      ...mockCreateWorkflowDefinition.mock.calls,
      ...mockValidateWorkflowRules.mock.calls,
      ...mockSaveWorkflowRevision.mock.calls,
      ...mockPublishWorkflowRevision.mock.calls,
    ])).not.toMatch(/ownerId|membershipId|tenantId/);
  });

  it("projects definition reads and mutations to exact DTOs with ISO dates and safe changes", async () => {
    const port = makeOttoWorkflowsPort();
    const results = await Promise.all([
      port.listWorkflowDefinitions({ limit: 10 }),
      port.getWorkflowDefinition({ workflowDefinitionId: DEFINITION_ID }),
      port.createWorkflowDefinition({
        slug: "follow-up",
        name: "Follow up",
        definitionKind: "rule",
        originKind: "custom",
      }),
      port.publishWorkflowRevision({
        workflowDefinitionId: DEFINITION_ID,
        workflowRevisionId: REVISION_ID,
        expectedRowRevision: 0,
      }),
    ]);

    expect(results).toEqual([
      { ok: true, resource: [definitionDto] },
      { ok: true, resource: definitionDto },
      { ok: true, resource: definitionDto, change: { id: DEFINITION_ID, revision: 0, kind: "created" } },
      {
        ok: true,
        resource: publishedDefinitionDto,
        change: { id: DEFINITION_ID, revision: 1, kind: "published" },
      },
    ]);
    expectNoSensitiveFields(results);
  });

  it("projects validation and revisions without compiled rules, dependencies, hashes, or future fields", async () => {
    const port = makeOttoWorkflowsPort();
    const results = await Promise.all([
      port.validateWorkflowRules({ workflowDefinitionId: DEFINITION_ID, rulesSource: "rules" }),
      port.listWorkflowRevisions({ workflowDefinitionId: DEFINITION_ID, limit: 5 }),
      port.saveWorkflowRevision({ workflowDefinitionId: DEFINITION_ID, rulesSource: "rules" }),
    ]);

    expect(results).toEqual([
      {
        ok: true,
        resource: {
          formatVersion: "fikirtive-workflow/v1",
          compilerVersion: "c7-workflow-compiler/1",
          validationState: "invalid",
          validationErrorsJson: [{ code: "INVALID_VALUE", path: "$.steps[0]", line: 4, column: 3 }],
        },
      },
      { ok: true, resource: [revisionDto] },
      {
        ok: true,
        resource: revisionDto,
        change: { id: REVISION_ID, revision: 1, kind: "saved" },
      },
    ]);
    expectNoSensitiveFields(results);
  });

  it("projects all six lifecycle reads to explicit DTOs with ISO dates and no raw internals", async () => {
    const port = makeOttoWorkflowsPort();
    const [routines, routine, runs, journeys, policies, policy] = await Promise.all([
      port.listRoutines({ workflowDefinitionId: DEFINITION_ID }),
      port.getRoutine({ routineId: ROUTINE_ID }),
      port.listRoutineRuns({ routineId: ROUTINE_ID }),
      port.getContactJourneyStates({ workflowDefinitionId: DEFINITION_ID }),
      port.listBusinessHoursPolicies({ status: "published" }),
      port.getBusinessHoursPolicy({ businessHoursPolicyId: POLICY_ID }),
    ]) as Array<{ ok: true; resource: Record<string, unknown> }>;

    const routineItem = (routines.resource.items as Record<string, unknown>[])[0]!;
    expect(Object.keys(routineItem).sort()).toEqual([
      "authorization", "createdAt", "id", "killReasonCode", "killSwitchEngaged", "killedAt",
      "maxCreditsPerMonth", "maxCreditsPerRun", "routineKey", "rowRevision", "scopeSummary",
      "status", "summaryPolicy", "supersedesRoutineId", "updatedAt", "workflowDefinition",
      "workflowRevision",
    ]);
    expect(routineItem).toMatchObject({
      id: ROUTINE_ID,
      status: "active",
      authorization: {
        revision: 2,
        authorized: true,
        authorizedAt: CREATED_AT.toISOString(),
        expiresAt: EXPIRES_AT.toISOString(),
      },
      workflowDefinition: { id: DEFINITION_ID, status: "published" },
      workflowRevision: { id: REVISION_ID, revision: 1, validationState: "valid" },
      createdAt: CREATED_AT.toISOString(),
      updatedAt: UPDATED_AT.toISOString(),
    });
    expect(routines.resource).toMatchObject({ nextCursor: NEXT_CURSOR });
    expect(routine.resource).toMatchObject({
      routine: {
        id: ROUTINE_ID,
        scope: scopeJson,
      },
      predecessors: [{ id: PREDECESSOR_ROUTINE_ID, status: "revoked" }],
    });

    const runItem = (runs.resource.items as Record<string, unknown>[])[0]!;
    expect(Object.keys(runItem).sort()).toEqual([
      "blockReason", "contactJourneyStateId", "createdAt", "currentStepKey", "errorCode",
      "finishedAt", "id", "reservedCredits", "routineId", "routineKey", "rowRevision",
      "scheduledFor", "settledCredits", "simulated", "startedAt", "status", "summary",
      "triggerKind", "updatedAt", "workflowDefinitionId", "workflowRevisionId",
    ]);
    expect(runItem).toMatchObject({
      id: RUN_ID,
      status: "blocked",
      blockReason: "CONSENT_STOP",
      summary: { attempted: 1, simulated: true, omitted: null },
      scheduledFor: CREATED_AT.toISOString(),
      finishedAt: UPDATED_AT.toISOString(),
    });

    const journeyItem = (journeys.resource.items as Record<string, unknown>[])[0]!;
    expect(journeyItem).toMatchObject({
      id: JOURNEY_ID,
      contact: { id: "01ARZ3NDEKTSV4RRFFQ69G5FB3", name: "Aisyah" },
      status: "waiting",
      nextEligibleAt: EXPIRES_AT.toISOString(),
      lastRoutineRun: {
        id: RUN_ID,
        status: "blocked",
        blockReason: "CONSENT_STOP",
        finishedAt: UPDATED_AT.toISOString(),
      },
    });

    const policyItem = (policies.resource.items as Record<string, unknown>[])[0]!;
    expect(policyItem).toEqual({
      id: POLICY_ID,
      policyKey: "weekday_hours",
      revision: 1,
      supersedesPolicyId: null,
      name: "Weekday hours",
      timeZone: "Asia/Kuala_Lumpur",
      status: "published",
      rowRevision: 0,
      archivedAt: null,
      createdAt: CREATED_AT.toISOString(),
      updatedAt: UPDATED_AT.toISOString(),
    });
    expect(policy.resource).toEqual({
      ...policyItem,
      weeklyWindows: [{ weekday: 3, startMinute: 540, endMinute: 1020 }],
    });
    expectNoSensitiveFields([routines, routine, runs, journeys, policies, policy]);
  });

  it("fails closed when lifecycle read pages, statuses, dates, summaries, or windows are malformed", async () => {
    mockListRoutines.mockResolvedValue({
      ok: true,
      resource: { items: [{ ...routineSummaryRow, status: "future_status" }], nextCursor: null },
    });
    mockListRoutineRuns.mockResolvedValue({
      ok: true,
      resource: {
        items: [{ ...routineRunRow, summary: { rawMessage: "unsafe" } }],
        nextCursor: null,
      },
    });
    mockGetContactJourneyStates.mockResolvedValue({
      ok: true,
      resource: { items: [{ ...journeyRow, updatedAt: "not-a-date" }], nextCursor: null },
    });
    mockGetBusinessHoursPolicy.mockResolvedValue({
      ok: true,
      resource: { ...policyDetailRow, weeklyWindows: [{ weekday: 8, startMinute: 0, endMinute: 1 }] },
    });
    mockListBusinessHoursPolicies.mockResolvedValue({
      ok: true,
      resource: { items: [policySummaryRow], nextCursor: "guessed" },
    });
    const port = makeOttoWorkflowsPort();
    for (const result of await Promise.all([
      port.listRoutines(),
      port.listRoutineRuns({ routineId: ROUTINE_ID }),
      port.getContactJourneyStates({ workflowDefinitionId: DEFINITION_ID }),
      port.listBusinessHoursPolicies(),
      port.getBusinessHoursPolicy({ businessHoursPolicyId: POLICY_ID }),
    ])) {
      expect(result).toEqual({ ok: false, error: "AUTHORITY_UNAVAILABLE" });
    }
  });

  it("hard-codes the closed draft envelope and projects only the Routine DTO allowlist", async () => {
    const port = makeOttoWorkflowsPort();
    const result = await port.createRoutineDraft({
      workflowDefinitionId: DEFINITION_ID,
      workflowRevisionId: REVISION_ID,
      routineKey: "weekly_follow_up",
      scopeJson,
      expiresAt: EXPIRES_AT.toISOString(),
    });

    expect(mockCreateRoutineDraft).toHaveBeenCalledWith({
      workflowDefinitionId: DEFINITION_ID,
      workflowRevisionId: REVISION_ID,
      routineKey: "weekly_follow_up",
      scopeJson,
      maxCreditsPerRun: 0,
      maxCreditsPerMonth: 0,
      summaryPolicyJson: { mode: "counts_only", scope: "workflow_activity" },
      expiresAt: EXPIRES_AT,
    });
    expect(result).toEqual({
      ok: true,
      resource: routineDto,
      change: { id: ROUTINE_ID, revision: 0, kind: "routine_draft_created" },
    });
    expectNoSensitiveFields(result);
  });

  it.each([
    { status: "active" },
    { maxCreditsPerRun: 1 },
    { maxCreditsPerMonth: 1 },
    { authorizationRevision: 2 },
    { authorizationHash: "forged" },
    { authorizedAt: new Date("2026-07-23T00:00:00.000Z") },
    { authorizedByMembershipId: "member-forged" },
    { supersedesRoutineId: "routine-forged" },
    { summaryPolicyJson: { mode: "full", scope: "everything" } },
    { killSwitchEngaged: true },
    { killedByMembershipId: "member-forged" },
    { killedAt: new Date("2026-07-23T00:00:00.000Z") },
    { killReasonCode: "forged" },
  ])("rejects an impossible successful authorized/non-draft response: %o", async (changed) => {
    mockCreateRoutineDraft.mockResolvedValue({
      ok: true,
      resource: { ...draftRoutineRow, ...changed },
      change: change("routine_draft_created", 0, ROUTINE_ID),
    });
    await expect(makeOttoWorkflowsPort().createRoutineDraft({
      workflowDefinitionId: DEFINITION_ID,
      workflowRevisionId: REVISION_ID,
      routineKey: "weekly_follow_up",
      scopeJson,
    })).resolves.toEqual({ ok: false, error: "AUTHORITY_UNAVAILABLE" });
  });

  it("fails closed on malformed successes and strips extra fields from failures", async () => {
    mockGetWorkflowDefinition.mockResolvedValue({
      ok: true,
      resource: { ...definitionRow, updatedAt: "not-a-date" },
    });
    mockValidateWorkflowRules.mockResolvedValue({
      ok: true,
      resource: { ...validationRow, validationErrorsJson: "malformed" },
    });
    mockListWorkflowRevisions.mockResolvedValue({
      ok: true,
      resource: [{ ...revisionRow, createdAt: "not-a-date" }],
    });
    mockCreateWorkflowDefinition.mockResolvedValue({
      ok: true,
      resource: definitionRow,
      change: null,
    });

    const port = makeOttoWorkflowsPort();
    await expect(port.getWorkflowDefinition({ workflowDefinitionId: DEFINITION_ID }))
      .resolves.toEqual({ ok: false, error: "AUTHORITY_UNAVAILABLE" });
    await expect(port.validateWorkflowRules({ workflowDefinitionId: DEFINITION_ID, rulesSource: "rules" }))
      .resolves.toEqual({ ok: false, error: "AUTHORITY_UNAVAILABLE" });
    await expect(port.listWorkflowRevisions({ workflowDefinitionId: DEFINITION_ID }))
      .resolves.toEqual({ ok: false, error: "AUTHORITY_UNAVAILABLE" });
    await expect(port.createWorkflowDefinition({
      slug: "follow-up",
      name: "Follow up",
      definitionKind: "rule",
      originKind: "custom",
    })).resolves.toEqual({ ok: false, error: "AUTHORITY_UNAVAILABLE" });

    mockGetWorkflowDefinition.mockResolvedValue({
      ok: false,
      error: "RESOURCE_NOT_FOUND",
      ownerId: "owner-secret",
      futureFailureSecret: "must-not-leak",
    });
    await expect(port.getWorkflowDefinition({ workflowDefinitionId: DEFINITION_ID }))
      .resolves.toEqual({ ok: false, error: "RESOURCE_NOT_FOUND" });
  });

  it("rejects an invalid expiry without calling the UI action", async () => {
    await expect(makeOttoWorkflowsPort().createRoutineDraft({
      workflowDefinitionId: DEFINITION_ID,
      workflowRevisionId: REVISION_ID,
      routineKey: "weekly_follow_up",
      scopeJson,
      expiresAt: "not-a-date",
    })).resolves.toEqual({ ok: false, error: "INVALID_ARGUMENT" });
    expect(mockCreateRoutineDraft).not.toHaveBeenCalled();
  });
});
