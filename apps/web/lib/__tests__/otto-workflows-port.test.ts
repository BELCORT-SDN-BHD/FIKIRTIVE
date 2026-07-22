import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockListWorkflowDefinitions,
  mockGetWorkflowDefinition,
  mockListWorkflowRevisions,
  mockCreateWorkflowDefinition,
  mockValidateWorkflowRules,
  mockSaveWorkflowRevision,
  mockPublishWorkflowRevision,
  mockCreateRoutineDraft,
} = vi.hoisted(() => ({
  mockListWorkflowDefinitions: vi.fn(),
  mockGetWorkflowDefinition: vi.fn(),
  mockListWorkflowRevisions: vi.fn(),
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
    /ownerId|MembershipId|compiledRuleJson|dependencyManifestJson|dependencyHash|contentHash|scopeHash|authorizationHash|future[A-Z]/,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListWorkflowDefinitions.mockResolvedValue({ ok: true, resource: [definitionRow] });
  mockGetWorkflowDefinition.mockResolvedValue({ ok: true, resource: definitionRow });
  mockListWorkflowRevisions.mockResolvedValue({ ok: true, resource: [revisionRow] });
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
  it("returns exactly the eight authenticated read/draft methods", () => {
    const port = makeOttoWorkflowsPort();
    expect(Object.keys(port).sort()).toEqual([
      "createRoutineDraft",
      "createWorkflowDefinition",
      "getWorkflowDefinition",
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

  it("passes owner-free definition/revision inputs only to the authenticated UI actions", async () => {
    const port = makeOttoWorkflowsPort();
    await port.listWorkflowDefinitions({ limit: 10 });
    await port.getWorkflowDefinition({ workflowDefinitionId: DEFINITION_ID });
    await port.listWorkflowRevisions({ workflowDefinitionId: DEFINITION_ID, limit: 5 });
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
