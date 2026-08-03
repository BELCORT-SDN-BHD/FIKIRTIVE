/**
 * C7-M1 — additive workflows/lifecycle storage contract only.
 *
 * These tests prove the seven exact carriers, tenant-qualified pins, Restrict posture, semantic
 * uniques, partial indexes, immutable envelopes, and storage-only boundaries. They intentionally
 * add no compiler, engine, queue, sender, provider adapter, receipt, retention job, or UI.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./index.js";
import { TENANT_MODELS } from "./tenant-guard.js";

const ORG_A = "c7-m1-org-a";
const ORG_B = "c7-m1-org-b";
const USER_A = "c7-m1-user-a";
const USER_B = "c7-m1-user-b";
const MEMBER_A = "c7-m1-member-a";
const MEMBER_B = "c7-m1-member-b";
const CONTACT_A = "c7-m1-contact-a";
const CONTACT_B = "c7-m1-contact-b";
const IDENTITY_A = "c7-m1-identity-a";
const IDENTITY_B = "c7-m1-identity-b";
const SCOPE_A = "c7-m1-scope-a";
const SCOPE_B = "c7-m1-scope-b";
const CONNECTION_A = "c7-m1-connection-a";
const CONNECTION_B = "c7-m1-connection-b";
const NOW = new Date("2026-07-22T08:00:00.123Z");
const SCHEMA = path.resolve(__dirname, "../prisma/schema.prisma");
const MIGRATION = path.resolve(
  __dirname,
  "../prisma/migrations/20260722130000_c7_m1_workflow_carriers/migration.sql",
);

const C7_MODELS = [
  "WorkflowDefinition",
  "WorkflowRevision",
  "Routine",
  "RoutineRun",
  "ContactJourneyState",
  "WorkflowStepExecution",
  "BusinessHoursPolicy",
] as const;

type TenantFixture = {
  ownerId: string;
  membershipId: string;
  contactId: string;
  contactIdentityId: string;
  connectionId: string;
};

const TENANT_A: TenantFixture = {
  ownerId: ORG_A,
  membershipId: MEMBER_A,
  contactId: CONTACT_A,
  contactIdentityId: IDENTITY_A,
  connectionId: CONNECTION_A,
};

const TENANT_B: TenantFixture = {
  ownerId: ORG_B,
  membershipId: MEMBER_B,
  contactId: CONTACT_B,
  contactIdentityId: IDENTITY_B,
  connectionId: CONNECTION_B,
};

beforeEach(async () => {
  await prisma.organization.createMany({ data: [{ id: ORG_A }, { id: ORG_B }] });
  await prisma.user.createMany({
    data: [
      { id: USER_A, email: "c7-m1-a@example.test" },
      { id: USER_B, email: "c7-m1-b@example.test" },
    ],
    skipDuplicates: true,
  });
  await prisma.membership.createMany({
    data: [
      { id: MEMBER_A, userId: USER_A, orgId: ORG_A },
      { id: MEMBER_B, userId: USER_B, orgId: ORG_B },
    ],
  });
  await prisma.contact.createMany({
    data: [
      {
        id: CONTACT_A,
        ownerId: ORG_A,
        name: "Aisyah",
        source: "whatsapp",
        firstTouchAt: NOW,
        lastSeenAt: NOW,
      },
      {
        id: CONTACT_B,
        ownerId: ORG_B,
        name: "Mei",
        source: "whatsapp",
        firstTouchAt: NOW,
        lastSeenAt: NOW,
      },
    ],
  });
  await prisma.channelScope.createMany({
    data: [
      { id: SCOPE_A, ownerId: ORG_A, channel: "whatsapp", scopeKey: "waba-a" },
      { id: SCOPE_B, ownerId: ORG_B, channel: "whatsapp", scopeKey: "waba-b" },
    ],
  });
  await prisma.contactIdentity.createMany({
    data: [
      {
        id: IDENTITY_A,
        ownerId: ORG_A,
        contactId: CONTACT_A,
        channelScopeId: SCOPE_A,
        channel: "whatsapp",
        externalId: "+60111111111",
      },
      {
        id: IDENTITY_B,
        ownerId: ORG_B,
        contactId: CONTACT_B,
        channelScopeId: SCOPE_B,
        channel: "whatsapp",
        externalId: "+60222222222",
      },
    ],
  });
  await prisma.channelConnection.createMany({
    data: [
      {
        id: CONNECTION_A,
        ownerId: ORG_A,
        kind: "whatsapp",
        channelScopeId: SCOPE_A,
        externalId: "wa-business-a",
        accessTokenEnc: "ciphertext-a",
      },
      {
        id: CONNECTION_B,
        ownerId: ORG_B,
        kind: "whatsapp",
        channelScopeId: SCOPE_B,
        externalId: "wa-business-b",
        accessTokenEnc: "ciphertext-b",
      },
    ],
  });
});

function modelBlock(modelName: string): string {
  const schema = fs.readFileSync(SCHEMA, "utf8");
  const start = schema.indexOf(`model ${modelName} {`);
  expect(start, `${modelName} must exist in schema.prisma`).toBeGreaterThanOrEqual(0);
  return schema.slice(start, schema.indexOf("\n}", start));
}

function routineData(
  id: string,
  tenant: TenantFixture,
  workflowDefinitionId: string,
  workflowRevisionId: string,
  overrides: {
    routineKey?: string;
    status?: string;
    maxCreditsPerRun?: number;
    authorizationRevision?: number;
    authorizationHash?: string | null;
    authorizedByMembershipId?: string | null;
    authorizedAt?: Date | null;
  } = {},
) {
  return {
    id,
    ownerId: tenant.ownerId,
    workflowDefinitionId,
    workflowRevisionId,
    routineKey: `routine:${id}`,
    status: "active",
    scopeJson: { schemaVersion: 1, channels: ["whatsapp"], maxRecipients: 1 },
    scopeHash: `v1:scope:${id}`,
    maxCreditsPerRun: 0,
    maxCreditsPerMonth: 0,
    summaryPolicyJson: { schemaVersion: 1, destination: "run_history" },
    authorizationRevision: 1,
    authorizationHash: `v1:authorization:${id}`,
    authorizedByMembershipId: tenant.membershipId,
    authorizedAt: NOW,
    killSwitchEngaged: false,
    createdByMembershipId: tenant.membershipId,
    ...overrides,
  };
}

async function createGraph(
  label: string,
  tenant: TenantFixture = TENANT_A,
  semanticLabel = label,
) {
  const definitionId = `c7-definition-${label}`;
  const revisionId = `c7-revision-${label}`;
  const routineId = `c7-routine-${label}`;
  const journeyId = `c7-journey-${label}`;
  const runId = `c7-run-${label}`;
  const stepId = `c7-step-${label}`;
  const policyId = `c7-policy-${label}`;
  const authorizationHash = `v1:authorization:${routineId}`;
  const routineKey = `routine:${semanticLabel}`;

  await prisma.workflowDefinition.create({
    data: {
      id: definitionId,
      ownerId: tenant.ownerId,
      slug: `workflow-${semanticLabel}`,
      name: `Workflow ${label}`,
      definitionKind: "journey",
      originKind: "custom",
      status: "draft",
      createdByMembershipId: tenant.membershipId,
    },
  });
  await prisma.workflowRevision.create({
    data: {
      id: revisionId,
      ownerId: tenant.ownerId,
      workflowDefinitionId: definitionId,
      revision: 1,
      formatVersion: "fikirtive-workflow/v1",
      rulesSource: "version: fikirtive-workflow/v1\nsteps: []\n",
      compiledRuleJson: { schemaVersion: 1, steps: [] },
      dependencyManifestJson: { schemaVersion: 1, entries: [] },
      dependencyHash: `v1:dependencies:${semanticLabel}`,
      compilerVersion: "c7-test-compiler/1",
      contentHash: `v1:content:${semanticLabel}`,
      validationState: "valid",
      validationErrorsJson: [],
      createdByMembershipId: tenant.membershipId,
    },
  });
  await prisma.workflowDefinition.update({
    where: { id: definitionId, ownerId: tenant.ownerId },
    data: { currentRevision: 1, status: "published", rowRevision: { increment: 1 } },
  });
  await prisma.routine.create({
    data: routineData(routineId, tenant, definitionId, revisionId, { routineKey }),
  });
  await prisma.contactJourneyState.create({
    data: {
      id: journeyId,
      ownerId: tenant.ownerId,
      contactId: tenant.contactId,
      contactIdentityId: tenant.contactIdentityId,
      workflowDefinitionId: definitionId,
      workflowRevisionId: revisionId,
      routineId,
      enrollmentIdempotencyKey: `enrollment:${semanticLabel}`,
      status: "active",
      waitGeneration: 0,
      stateJson: { schemaVersion: 1, refs: [] },
      enrolledAt: NOW,
    },
  });
  await prisma.routineRun.create({
    data: {
      id: runId,
      ownerId: tenant.ownerId,
      routineId,
      routineKey,
      workflowDefinitionId: definitionId,
      workflowRevisionId: revisionId,
      contactJourneyStateId: journeyId,
      triggerKind: "manual",
      triggerOccurrenceRef: `manual:operation:${semanticLabel}`,
      runIdempotencyKey: `run:${semanticLabel}`,
      triggerPayloadHash: `v1:trigger:${semanticLabel}`,
      authorizationRevision: 1,
      authorizationHash,
      authorizationSnapshotJson: {
        schemaVersion: 1,
        workflowRevisionId: revisionId,
        scopeHash: `v1:scope:${routineId}`,
      },
      status: "running",
      simulated: true,
      reservedCredits: 0,
      settledCredits: 0,
    },
  });
  await prisma.contactJourneyState.update({
    where: { id: journeyId, ownerId: tenant.ownerId },
    data: { lastRoutineRunId: runId, rowRevision: { increment: 1 } },
  });
  await prisma.workflowStepExecution.create({
    data: {
      id: stepId,
      ownerId: tenant.ownerId,
      routineRunId: runId,
      contactJourneyStateId: journeyId,
      workflowRevisionId: revisionId,
      contactId: tenant.contactId,
      contactIdentityId: tenant.contactIdentityId,
      channel: "whatsapp",
      providerConnectionId: tenant.connectionId,
      stepKey: "reply_once",
      actionKind: "conversation_reply",
      actionPayloadHash: `v1:action:${semanticLabel}`,
      stepIdempotencyKey: `step:${semanticLabel}`,
      actionIdempotencyKey: `action:${semanticLabel}`,
      status: "simulated",
      purpose: "workflow_customer_action",
      callerClass: "unconfirmed_automatic",
      eligibilityInputHash: `v1:eligibility-input:${semanticLabel}`,
      eligibilityVerdictJson: {
        consentStop: "pass",
        doNotDisturb: "pass",
        providerRefusal: "pass",
        frequency: "pass",
      },
      eligibilityVerdictHash: `v1:eligibility-verdict:${semanticLabel}`,
      downstreamKind: "none",
      simulated: true,
    },
  });
  await prisma.businessHoursPolicy.create({
    data: {
      id: policyId,
      ownerId: tenant.ownerId,
      policyKey: `business-hours:${semanticLabel}`,
      revision: 1,
      name: `Business hours ${label}`,
      timeZone: "Asia/Kuala_Lumpur",
      weeklyWindowsJson: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
      status: "published",
      contentHash: `v1:business-hours:${semanticLabel}`,
      createdByMembershipId: tenant.membershipId,
    },
  });

  return {
    definitionId,
    revisionId,
    routineId,
    journeyId,
    runId,
    stepId,
    policyId,
    authorizationHash,
    routineKey,
  };
}

describe("C7-M1 tenant guard and owner isolation", () => {
  it("registers all seven carriers and rejects unscoped reads", async () => {
    for (const model of C7_MODELS) expect(TENANT_MODELS.has(model)).toBe(true);

    const unscopedQueries = [
      () => prisma.workflowDefinition.findMany({ where: {} }),
      () => prisma.workflowRevision.findMany({ where: {} }),
      () => prisma.routine.findMany({ where: {} }),
      () => prisma.routineRun.findMany({ where: {} }),
      () => prisma.contactJourneyState.findMany({ where: {} }),
      () => prisma.workflowStepExecution.findMany({ where: {} }),
      () => prisma.businessHoursPolicy.findMany({ where: {} }),
    ];
    for (const query of unscopedQueries) await expect(query()).rejects.toThrow(/tenant-guard/);
  });

  it("keeps another owner's filtered reads empty", async () => {
    await createGraph("owner-a");

    const ownerBReads = [
      prisma.workflowDefinition.findMany({ where: { ownerId: ORG_B } }),
      prisma.workflowRevision.findMany({ where: { ownerId: ORG_B } }),
      prisma.routine.findMany({ where: { ownerId: ORG_B } }),
      prisma.routineRun.findMany({ where: { ownerId: ORG_B } }),
      prisma.contactJourneyState.findMany({ where: { ownerId: ORG_B } }),
      prisma.workflowStepExecution.findMany({ where: { ownerId: ORG_B } }),
      prisma.businessHoursPolicy.findMany({ where: { ownerId: ORG_B } }),
    ];
    for (const read of ownerBReads) await expect(read).resolves.toHaveLength(0);
  });

  it("rejects cross-tenant relations before they can form a carrier graph", async () => {
    const graph = await createGraph("tenant-pin");
    const graphB = await createGraph("tenant-pin-b", TENANT_B);

    await expect(
      prisma.workflowDefinition.create({
        data: {
          id: "definition-cross-author",
          ownerId: ORG_A,
          slug: "cross-author",
          name: "Cross author",
          definitionKind: "rule",
          originKind: "custom",
          createdByMembershipId: MEMBER_B,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });

    await expect(
      prisma.workflowRevision.create({
        data: {
          id: "revision-cross-definition",
          ownerId: ORG_B,
          workflowDefinitionId: graph.definitionId,
          revision: 2,
          formatVersion: "fikirtive-workflow/v1",
          rulesSource: "version: fikirtive-workflow/v1\nsteps: []\n",
          compiledRuleJson: {},
          dependencyManifestJson: {},
          dependencyHash: "v1:cross",
          compilerVersion: "c7-test-compiler/1",
          contentHash: "v1:cross",
          validationState: "valid",
          validationErrorsJson: [],
          createdByMembershipId: MEMBER_B,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });

    await expect(
      prisma.routine.create({
        data: routineData(
          "routine-cross-revision",
          TENANT_B,
          graph.definitionId,
          graph.revisionId,
        ),
      }),
    ).rejects.toMatchObject({ code: "P2003" });

    await expect(
      prisma.contactJourneyState.create({
        data: {
          id: "journey-cross-contact",
          ownerId: ORG_A,
          contactId: CONTACT_B,
          workflowDefinitionId: graph.definitionId,
          workflowRevisionId: graph.revisionId,
          routineId: graph.routineId,
          enrollmentIdempotencyKey: "enrollment:cross-contact",
          status: "active",
          stateJson: {},
          enrolledAt: NOW,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });

    await expect(
      prisma.routineRun.create({
        data: {
          id: "run-cross-journey",
          ownerId: ORG_A,
          routineId: graph.routineId,
          routineKey: graph.routineKey,
          workflowDefinitionId: graph.definitionId,
          workflowRevisionId: graph.revisionId,
          contactJourneyStateId: graphB.journeyId,
          triggerKind: "manual",
          triggerOccurrenceRef: "manual:operation:cross-journey",
          runIdempotencyKey: "run:cross-journey",
          triggerPayloadHash: "v1:trigger:cross-journey",
          authorizationRevision: 1,
          authorizationHash: graph.authorizationHash,
          authorizationSnapshotJson: {},
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });

    await expect(
      prisma.contactJourneyState.update({
        where: { id: graph.journeyId, ownerId: ORG_A },
        data: { lastRoutineRunId: graphB.runId },
      }),
    ).rejects.toMatchObject({ code: "P2003" });

    await expect(
      prisma.workflowStepExecution.create({
        data: {
          id: "step-cross-identity",
          ownerId: ORG_A,
          routineRunId: graph.runId,
          contactJourneyStateId: graph.journeyId,
          workflowRevisionId: graph.revisionId,
          contactId: CONTACT_A,
          contactIdentityId: IDENTITY_B,
          channel: "whatsapp",
          providerConnectionId: CONNECTION_A,
          stepKey: "cross_identity",
          actionKind: "conversation_reply",
          actionPayloadHash: "v1:cross",
          stepIdempotencyKey: "step:cross-identity",
          actionIdempotencyKey: "action:cross-identity",
          purpose: "workflow_customer_action",
          callerClass: "unconfirmed_automatic",
          eligibilityInputHash: "v1:cross",
          eligibilityVerdictJson: { aggregate: "pass" },
          eligibilityVerdictHash: "v1:cross",
          downstreamKind: "none",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });

    await expect(
      prisma.workflowStepExecution.create({
        data: {
          id: "step-cross-connection",
          ownerId: ORG_A,
          routineRunId: graph.runId,
          contactJourneyStateId: graph.journeyId,
          workflowRevisionId: graph.revisionId,
          contactId: CONTACT_A,
          contactIdentityId: IDENTITY_A,
          channel: "whatsapp",
          providerConnectionId: CONNECTION_B,
          stepKey: "cross_connection",
          actionKind: "conversation_reply",
          actionPayloadHash: "v1:cross-connection",
          stepIdempotencyKey: "step:cross-connection",
          actionIdempotencyKey: "action:cross-connection",
          status: "simulated",
          purpose: "workflow_customer_action",
          callerClass: "unconfirmed_automatic",
          eligibilityInputHash: "v1:cross-connection",
          eligibilityVerdictJson: { aggregate: "pass" },
          eligibilityVerdictHash: "v1:cross-connection",
          downstreamKind: "none",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });

    await expect(
      prisma.businessHoursPolicy.create({
        data: {
          id: "policy-cross-author",
          ownerId: ORG_A,
          policyKey: "business-hours:cross-author",
          revision: 1,
          name: "Cross author",
          timeZone: "Asia/Kuala_Lumpur",
          weeklyWindowsJson: [],
          contentHash: "v1:cross-author",
          createdByMembershipId: MEMBER_B,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });

    await expect(
      prisma.workflowStepExecution.findMany({ where: { ownerId: ORG_A, id: "step-cross-identity" } }),
    ).resolves.toHaveLength(0);
  });
});

describe("C7-M1 semantic uniqueness", () => {
  it("enforces every semantic key within an owner and permits the same key for another owner", async () => {
    const graphA = await createGraph("unique", TENANT_A);

    await expect(
      prisma.workflowDefinition.create({
        data: {
          id: "definition-duplicate-live-slug",
          ownerId: ORG_A,
          slug: "workflow-unique",
          name: "Duplicate slug",
          definitionKind: "rule",
          originKind: "custom",
          createdByMembershipId: MEMBER_A,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    await expect(
      prisma.workflowRevision.create({
        data: {
          id: "revision-duplicate-content",
          ownerId: ORG_A,
          workflowDefinitionId: graphA.definitionId,
          revision: 2,
          formatVersion: "fikirtive-workflow/v1",
          rulesSource: "version: fikirtive-workflow/v1\nsteps: []\n",
          compiledRuleJson: {},
          dependencyManifestJson: {},
          dependencyHash: "v1:duplicate",
          compilerVersion: "c7-test-compiler/1",
          contentHash: "v1:content:unique",
          validationState: "valid",
          validationErrorsJson: [],
          createdByMembershipId: MEMBER_A,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    await expect(
      prisma.routine.create({
        data: routineData(
          "routine-duplicate-active",
          TENANT_A,
          graphA.definitionId,
          graphA.revisionId,
          {
            routineKey: graphA.routineKey,
            authorizationRevision: 2,
            authorizationHash: "v1:authorization:duplicate-active",
          },
        ),
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    await expect(
      prisma.routineRun.create({
        data: {
          id: "run-duplicate-key",
          ownerId: ORG_A,
          routineId: graphA.routineId,
          routineKey: graphA.routineKey,
          workflowDefinitionId: graphA.definitionId,
          workflowRevisionId: graphA.revisionId,
          triggerKind: "manual",
          triggerOccurrenceRef: "manual:operation:duplicate",
          runIdempotencyKey: "run:unique",
          triggerPayloadHash: "v1:trigger:duplicate",
          authorizationRevision: 1,
          authorizationHash: graphA.authorizationHash,
          authorizationSnapshotJson: {},
          status: "queued",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    await expect(
      prisma.contactJourneyState.create({
        data: {
          id: "journey-duplicate-enrollment",
          ownerId: ORG_A,
          contactId: CONTACT_A,
          workflowDefinitionId: graphA.definitionId,
          workflowRevisionId: graphA.revisionId,
          routineId: graphA.routineId,
          enrollmentIdempotencyKey: "enrollment:unique",
          status: "active",
          stateJson: {},
          enrolledAt: NOW,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    await expect(
      prisma.workflowStepExecution.create({
        data: {
          id: "step-duplicate-action-key",
          ownerId: ORG_A,
          routineRunId: graphA.runId,
          contactJourneyStateId: graphA.journeyId,
          workflowRevisionId: graphA.revisionId,
          contactId: CONTACT_A,
          contactIdentityId: IDENTITY_A,
          channel: "whatsapp",
          providerConnectionId: CONNECTION_A,
          stepKey: "second_step",
          actionKind: "conversation_reply",
          actionPayloadHash: "v1:action:second",
          stepIdempotencyKey: "step:second",
          actionIdempotencyKey: "action:unique",
          purpose: "workflow_customer_action",
          callerClass: "unconfirmed_automatic",
          eligibilityInputHash: "v1:eligibility:second",
          eligibilityVerdictJson: { aggregate: "pass" },
          eligibilityVerdictHash: "v1:eligibility:second",
          downstreamKind: "none",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    await expect(
      prisma.businessHoursPolicy.create({
        data: {
          id: "policy-duplicate-content",
          ownerId: ORG_A,
          policyKey: "business-hours:unique",
          revision: 2,
          name: "Duplicate content",
          timeZone: "Asia/Kuala_Lumpur",
          weeklyWindowsJson: [],
          contentHash: "v1:business-hours:unique",
          createdByMembershipId: MEMBER_A,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    await expect(createGraph("unique-owner-b", TENANT_B, "unique")).resolves.toMatchObject({
      routineKey: graphA.routineKey,
    });
  });
});

type ForeignKeyRow = {
  tableName: string;
  constraintName: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  deleteAction: string;
  updateAction: string;
};

type IndexRow = {
  tableName: string;
  indexName: string;
  isUnique: boolean;
  columns: string[];
  predicate: string | null;
};

type ExpectedIndex = readonly [
  indexName: string,
  tableName: string,
  isUnique: boolean,
  columns: readonly string[],
  predicateColumn?: string,
];

const EXPECTED_FOREIGN_KEYS = [
  ["WorkflowDefinition", ["ownerId"], "Organization", ["id"]],
  ["WorkflowDefinition", ["createdByMembershipId", "ownerId"], "Membership", ["id", "orgId"]],
  ["WorkflowDefinition", ["ownerId", "id", "currentRevision"], "WorkflowRevision", ["ownerId", "workflowDefinitionId", "revision"]],
  ["WorkflowRevision", ["ownerId"], "Organization", ["id"]],
  ["WorkflowRevision", ["workflowDefinitionId", "ownerId"], "WorkflowDefinition", ["id", "ownerId"]],
  ["WorkflowRevision", ["createdByMembershipId", "ownerId"], "Membership", ["id", "orgId"]],
  ["Routine", ["ownerId"], "Organization", ["id"]],
  ["Routine", ["workflowDefinitionId", "ownerId"], "WorkflowDefinition", ["id", "ownerId"]],
  ["Routine", ["workflowRevisionId", "ownerId", "workflowDefinitionId"], "WorkflowRevision", ["id", "ownerId", "workflowDefinitionId"]],
  ["Routine", ["supersedesRoutineId", "ownerId", "routineKey", "workflowDefinitionId"], "Routine", ["id", "ownerId", "routineKey", "workflowDefinitionId"]],
  ["Routine", ["authorizedByMembershipId", "ownerId"], "Membership", ["id", "orgId"]],
  ["Routine", ["killedByMembershipId", "ownerId"], "Membership", ["id", "orgId"]],
  ["Routine", ["createdByMembershipId", "ownerId"], "Membership", ["id", "orgId"]],
  ["RoutineRun", ["ownerId"], "Organization", ["id"]],
  ["RoutineRun", ["routineId", "ownerId", "routineKey", "workflowDefinitionId", "workflowRevisionId", "authorizationRevision", "authorizationHash"], "Routine", ["id", "ownerId", "routineKey", "workflowDefinitionId", "workflowRevisionId", "authorizationRevision", "authorizationHash"]],
  ["RoutineRun", ["contactJourneyStateId", "ownerId", "routineId", "workflowRevisionId"], "ContactJourneyState", ["id", "ownerId", "routineId", "workflowRevisionId"]],
  ["ContactJourneyState", ["ownerId"], "Organization", ["id"]],
  ["ContactJourneyState", ["contactId", "ownerId"], "Contact", ["id", "ownerId"]],
  ["ContactJourneyState", ["contactIdentityId", "contactId", "ownerId"], "ContactIdentity", ["id", "contactId", "ownerId"]],
  ["ContactJourneyState", ["workflowRevisionId", "ownerId", "workflowDefinitionId"], "WorkflowRevision", ["id", "ownerId", "workflowDefinitionId"]],
  ["ContactJourneyState", ["routineId", "ownerId", "workflowRevisionId"], "Routine", ["id", "ownerId", "workflowRevisionId"]],
  ["ContactJourneyState", ["lastRoutineRunId", "ownerId", "id"], "RoutineRun", ["id", "ownerId", "contactJourneyStateId"]],
  ["WorkflowStepExecution", ["ownerId"], "Organization", ["id"]],
  ["WorkflowStepExecution", ["routineRunId", "ownerId", "workflowRevisionId"], "RoutineRun", ["id", "ownerId", "workflowRevisionId"]],
  ["WorkflowStepExecution", ["routineRunId", "ownerId", "workflowRevisionId", "contactJourneyStateId"], "RoutineRun", ["id", "ownerId", "workflowRevisionId", "contactJourneyStateId"]],
  ["WorkflowStepExecution", ["contactJourneyStateId", "ownerId", "workflowRevisionId"], "ContactJourneyState", ["id", "ownerId", "workflowRevisionId"]],
  ["WorkflowStepExecution", ["contactId", "ownerId"], "Contact", ["id", "ownerId"]],
  ["WorkflowStepExecution", ["contactIdentityId", "contactId", "ownerId", "channel"], "ContactIdentity", ["id", "contactId", "ownerId", "channel"]],
  ["WorkflowStepExecution", ["providerConnectionId", "ownerId", "channel"], "ChannelConnection", ["id", "ownerId", "kind"]],
  ["BusinessHoursPolicy", ["ownerId"], "Organization", ["id"]],
  ["BusinessHoursPolicy", ["supersedesPolicyId", "ownerId", "policyKey"], "BusinessHoursPolicy", ["id", "ownerId", "policyKey"]],
  ["BusinessHoursPolicy", ["createdByMembershipId", "ownerId"], "Membership", ["id", "orgId"]],
] as const;

const EXPECTED_INDEXES = [
  ["WorkflowDefinition_id_ownerId_key", "WorkflowDefinition", true, ["id", "ownerId"]],
  ["WorkflowDefinition_owner_status_updated_idx", "WorkflowDefinition", false, ["ownerId", "status", "updatedAt", "id"]],
  ["WorkflowDefinition_owner_slug_live_key", "WorkflowDefinition", true, ["ownerId", "slug"], "archivedAt"],
  ["WorkflowRevision_id_ownerId_key", "WorkflowRevision", true, ["id", "ownerId"]],
  ["WorkflowRevision_id_owner_definition_key", "WorkflowRevision", true, ["id", "ownerId", "workflowDefinitionId"]],
  ["WorkflowRevision_owner_definition_revision_key", "WorkflowRevision", true, ["ownerId", "workflowDefinitionId", "revision"]],
  ["WorkflowRevision_owner_definition_content_key", "WorkflowRevision", true, ["ownerId", "workflowDefinitionId", "contentHash"]],
  ["WorkflowRevision_owner_definition_revision_idx", "WorkflowRevision", false, ["ownerId", "workflowDefinitionId", "revision", "id"]],
  ["Routine_id_ownerId_key", "Routine", true, ["id", "ownerId"]],
  ["Routine_id_owner_definition_key", "Routine", true, ["id", "ownerId", "workflowDefinitionId"]],
  ["Routine_id_owner_revision_key", "Routine", true, ["id", "ownerId", "workflowRevisionId"]],
  ["Routine_id_owner_key_definition_key", "Routine", true, ["id", "ownerId", "routineKey", "workflowDefinitionId"]],
  ["Routine_id_owner_definition_revision_key", "Routine", true, ["id", "ownerId", "workflowDefinitionId", "workflowRevisionId"]],
  ["Routine_id_owner_key_definition_revision_key", "Routine", true, ["id", "ownerId", "routineKey", "workflowDefinitionId", "workflowRevisionId"]],
  ["Routine_authorization_proof_key", "Routine", true, ["id", "ownerId", "routineKey", "workflowDefinitionId", "workflowRevisionId", "authorizationRevision", "authorizationHash"]],
  ["Routine_owner_definition_key_authorization_revision_key", "Routine", true, ["ownerId", "workflowDefinitionId", "routineKey", "authorizationRevision"]],
  ["Routine_owner_status_expires_idx", "Routine", false, ["ownerId", "status", "expiresAt", "id"]],
  ["Routine_owner_definition_status_idx", "Routine", false, ["ownerId", "workflowDefinitionId", "status", "id"]],
  ["Routine_owner_definition_key_active_key", "Routine", true, ["ownerId", "workflowDefinitionId", "routineKey"], "status"],
  ["RoutineRun_id_ownerId_key", "RoutineRun", true, ["id", "ownerId"]],
  ["RoutineRun_id_owner_revision_key", "RoutineRun", true, ["id", "ownerId", "workflowRevisionId"]],
  ["RoutineRun_id_owner_journey_key", "RoutineRun", true, ["id", "ownerId", "contactJourneyStateId"]],
  ["RoutineRun_id_owner_revision_journey_key", "RoutineRun", true, ["id", "ownerId", "workflowRevisionId", "contactJourneyStateId"]],
  ["RoutineRun_ownerId_runIdempotencyKey_key", "RoutineRun", true, ["ownerId", "runIdempotencyKey"]],
  ["RoutineRun_owner_routine_status_created_idx", "RoutineRun", false, ["ownerId", "routineId", "status", "createdAt", "id"]],
  ["RoutineRun_owner_status_scheduled_idx", "RoutineRun", false, ["ownerId", "status", "scheduledFor", "id"]],
  ["ContactJourneyState_id_ownerId_key", "ContactJourneyState", true, ["id", "ownerId"]],
  ["ContactJourneyState_id_owner_revision_key", "ContactJourneyState", true, ["id", "ownerId", "workflowRevisionId"]],
  ["ContactJourneyState_id_owner_routine_revision_key", "ContactJourneyState", true, ["id", "ownerId", "routineId", "workflowRevisionId"]],
  ["ContactJourneyState_ownerId_enrollmentIdempotencyKey_key", "ContactJourneyState", true, ["ownerId", "enrollmentIdempotencyKey"]],
  ["ContactJourneyState_owner_status_due_idx", "ContactJourneyState", false, ["ownerId", "status", "nextEligibleAt", "id"]],
  ["ContactJourneyState_owner_contact_updated_idx", "ContactJourneyState", false, ["ownerId", "contactId", "updatedAt", "id"]],
  ["WorkflowStepExecution_id_ownerId_key", "WorkflowStepExecution", true, ["id", "ownerId"]],
  ["WorkflowStepExecution_ownerId_stepIdempotencyKey_key", "WorkflowStepExecution", true, ["ownerId", "stepIdempotencyKey"]],
  ["WorkflowStepExecution_owner_action_live_key", "WorkflowStepExecution", true, ["ownerId", "actionIdempotencyKey"], "actionIdempotencyKey"],
  ["WorkflowStepExecution_owner_run_status_idx", "WorkflowStepExecution", false, ["ownerId", "routineRunId", "status", "id"]],
  ["WorkflowStepExecution_owner_journey_created_idx", "WorkflowStepExecution", false, ["ownerId", "contactJourneyStateId", "createdAt", "id"]],
  ["BusinessHoursPolicy_id_ownerId_key", "BusinessHoursPolicy", true, ["id", "ownerId"]],
  ["BusinessHoursPolicy_id_owner_policy_key", "BusinessHoursPolicy", true, ["id", "ownerId", "policyKey"]],
  ["BusinessHoursPolicy_ownerId_policyKey_revision_key", "BusinessHoursPolicy", true, ["ownerId", "policyKey", "revision"]],
  ["BusinessHoursPolicy_ownerId_policyKey_contentHash_key", "BusinessHoursPolicy", true, ["ownerId", "policyKey", "contentHash"]],
  ["BusinessHoursPolicy_owner_policy_revision_idx", "BusinessHoursPolicy", false, ["ownerId", "policyKey", "revision", "id"]],
  ["BusinessHoursPolicy_owner_status_updated_idx", "BusinessHoursPolicy", false, ["ownerId", "status", "updatedAt", "id"]],
  ["ContactIdentity_id_contactId_ownerId_channel_key", "ContactIdentity", true, ["id", "contactId", "ownerId", "channel"]],
  ["ChannelConnection_id_ownerId_kind_key", "ChannelConnection", true, ["id", "ownerId", "kind"]],
] as const satisfies readonly ExpectedIndex[];

describe("C7-M1 database catalog contract", () => {
  it("has the exact 32 tenant-qualified historical foreign keys, all Restrict", async () => {
    const rows = await prisma.$queryRaw<ForeignKeyRow[]>`
      SELECT source.relname AS "tableName",
             constraint_row.conname AS "constraintName",
             ARRAY(
               SELECT source_column.attname
               FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, ordinal)
               JOIN pg_attribute AS source_column
                 ON source_column.attrelid = constraint_row.conrelid
                AND source_column.attnum = key_column.attnum
               ORDER BY key_column.ordinal
             )::text[] AS columns,
             target.relname AS "referencedTable",
             ARRAY(
               SELECT target_column.attname
               FROM unnest(constraint_row.confkey) WITH ORDINALITY AS key_column(attnum, ordinal)
               JOIN pg_attribute AS target_column
                 ON target_column.attrelid = constraint_row.confrelid
                AND target_column.attnum = key_column.attnum
               ORDER BY key_column.ordinal
             )::text[] AS "referencedColumns",
             constraint_row.confdeltype::text AS "deleteAction",
             constraint_row.confupdtype::text AS "updateAction"
      FROM pg_constraint AS constraint_row
      JOIN pg_class AS source ON source.oid = constraint_row.conrelid
      JOIN pg_class AS target ON target.oid = constraint_row.confrelid
      WHERE constraint_row.contype = 'f'
        AND source.relnamespace = (
          SELECT oid FROM pg_namespace WHERE nspname = current_schema()
        )
        AND source.relname IN (
          'WorkflowDefinition', 'WorkflowRevision', 'Routine', 'RoutineRun',
          'ContactJourneyState', 'WorkflowStepExecution', 'BusinessHoursPolicy'
        )
    `;

    expect(rows).toHaveLength(EXPECTED_FOREIGN_KEYS.length);
    for (const [tableName, columns, referencedTable, referencedColumns] of EXPECTED_FOREIGN_KEYS) {
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            tableName,
            columns,
            referencedTable,
            referencedColumns,
            deleteAction: "r",
            updateAction: "c",
          }),
        ]),
      );
    }
  });

  it("has every unconditional, ordered, candidate, and required partial index", async () => {
    const rows = await prisma.$queryRaw<IndexRow[]>`
      SELECT table_row.relname AS "tableName",
             index_row.relname AS "indexName",
             index_meta.indisunique AS "isUnique",
             ARRAY(
               SELECT column_row.attname
               FROM unnest(index_meta.indkey) WITH ORDINALITY AS index_column(attnum, ordinal)
               JOIN pg_attribute AS column_row
                 ON column_row.attrelid = index_meta.indrelid
                AND column_row.attnum = index_column.attnum
               WHERE index_column.attnum > 0
               ORDER BY index_column.ordinal
             )::text[] AS columns,
             pg_get_expr(index_meta.indpred, index_meta.indrelid) AS predicate
      FROM pg_index AS index_meta
      JOIN pg_class AS table_row ON table_row.oid = index_meta.indrelid
      JOIN pg_class AS index_row ON index_row.oid = index_meta.indexrelid
      WHERE (
          table_row.relname IN (
            'WorkflowDefinition', 'WorkflowRevision', 'Routine', 'RoutineRun',
            'ContactJourneyState', 'WorkflowStepExecution', 'BusinessHoursPolicy'
          )
          OR index_row.relname IN (
            'ContactIdentity_id_contactId_ownerId_channel_key',
            'ChannelConnection_id_ownerId_kind_key'
          )
        )
        AND table_row.relnamespace = (
          SELECT oid FROM pg_namespace WHERE nspname = current_schema()
        )
        AND index_row.relname NOT IN (
          'WorkflowDefinition_pkey', 'WorkflowRevision_pkey', 'Routine_pkey', 'RoutineRun_pkey',
          'ContactJourneyState_pkey', 'WorkflowStepExecution_pkey', 'BusinessHoursPolicy_pkey'
        )
    `;

    expect(rows).toHaveLength(EXPECTED_INDEXES.length);
    for (const [indexName, tableName, isUnique, columns, predicateColumn] of EXPECTED_INDEXES) {
      const row = rows.find((candidate) => candidate.indexName === indexName);
      expect(row).toMatchObject({ tableName, indexName, isUnique, columns });
      // pg_get_expr only quotes an identifier when case-folding would otherwise change it;
      // an all-lowercase column (e.g. "status") round-trips unquoted.
      if (predicateColumn) {
        const rendered = /[A-Z]/.test(predicateColumn) ? `"${predicateColumn}"` : predicateColumn;
        expect(row?.predicate).toContain(rendered);
      }
      else expect(row?.predicate).toBeNull();
    }
  });

  it("stores the exact ordered field-table columns and Timestamptz(6) pins", async () => {
    const rows = await prisma.$queryRaw<Array<{ tableName: string; columnName: string }>>`
      SELECT table_name AS "tableName", column_name AS "columnName"
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name IN (
          'WorkflowDefinition', 'WorkflowRevision', 'Routine', 'RoutineRun',
          'ContactJourneyState', 'WorkflowStepExecution', 'BusinessHoursPolicy'
        )
      ORDER BY table_name, ordinal_position
    `;

    const expectedColumns: Record<string, string[]> = {
      WorkflowDefinition: ["id", "ownerId", "slug", "name", "definitionKind", "originKind", "recipeKey", "recipeCatalogVersion", "currentRevision", "rowRevision", "status", "createdByMembershipId", "archivedAt", "createdAt", "updatedAt"],
      WorkflowRevision: ["id", "ownerId", "workflowDefinitionId", "revision", "formatVersion", "rulesSource", "compiledRuleJson", "dependencyManifestJson", "dependencyHash", "compilerVersion", "contentHash", "validationState", "validationErrorsJson", "createdByMembershipId", "createdAt"],
      Routine: ["id", "ownerId", "workflowDefinitionId", "workflowRevisionId", "routineKey", "supersedesRoutineId", "status", "scopeJson", "scopeHash", "maxCreditsPerRun", "maxCreditsPerMonth", "summaryPolicyJson", "authorizationRevision", "authorizationHash", "authorizedByMembershipId", "authorizedAt", "expiresAt", "killSwitchEngaged", "killedByMembershipId", "killedAt", "killReasonCode", "rowRevision", "createdByMembershipId", "createdAt", "updatedAt"],
      RoutineRun: ["id", "ownerId", "routineId", "routineKey", "workflowDefinitionId", "workflowRevisionId", "contactJourneyStateId", "triggerKind", "triggerOccurrenceRef", "triggerEventRef", "scheduledFor", "runIdempotencyKey", "triggerPayloadHash", "authorizationRevision", "authorizationHash", "authorizationSnapshotJson", "status", "currentStepKey", "rowRevision", "simulated", "reservedCredits", "settledCredits", "creditReservationRef", "summaryJson", "blockReason", "errorCode", "startedAt", "finishedAt", "createdAt", "updatedAt"],
      ContactJourneyState: ["id", "ownerId", "contactId", "contactIdentityId", "workflowDefinitionId", "workflowRevisionId", "routineId", "enrollmentIdempotencyKey", "status", "currentStepKey", "nextEligibleAt", "waitGeneration", "stateJson", "lastRoutineRunId", "rowRevision", "enrolledAt", "terminalAt", "createdAt", "updatedAt"],
      WorkflowStepExecution: ["id", "ownerId", "routineRunId", "contactJourneyStateId", "workflowRevisionId", "contactId", "contactIdentityId", "channel", "providerConnectionId", "stepKey", "actionKind", "actionPayloadHash", "stepIdempotencyKey", "actionIdempotencyKey", "status", "purpose", "callerClass", "eligibilityInputHash", "eligibilityVerdictJson", "eligibilityVerdictHash", "downstreamKind", "downstreamRef", "simulated", "reasonCode", "errorCode", "reservedAt", "delegatedAt", "settledAt", "createdAt", "updatedAt"],
      BusinessHoursPolicy: ["id", "ownerId", "policyKey", "revision", "supersedesPolicyId", "name", "timeZone", "weeklyWindowsJson", "status", "rowRevision", "contentHash", "createdByMembershipId", "archivedAt", "createdAt", "updatedAt"],
    };

    for (const [tableName, columns] of Object.entries(expectedColumns)) {
      expect(rows.filter((row) => row.tableName === tableName).map((row) => row.columnName)).toEqual(columns);
    }

    const timeRows = await prisma.$queryRaw<Array<{ tableName: string; columnName: string; dataType: string; precision: number }>>`
      SELECT table_name AS "tableName", column_name AS "columnName",
             data_type AS "dataType", datetime_precision AS precision
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND (
          (table_name = 'RoutineRun' AND column_name = 'scheduledFor')
          OR (table_name = 'ContactJourneyState' AND column_name = 'nextEligibleAt')
        )
    `;
    expect(timeRows).toEqual(
      expect.arrayContaining([
        { tableName: "RoutineRun", columnName: "scheduledFor", dataType: "timestamp with time zone", precision: 6 },
        { tableName: "ContactJourneyState", columnName: "nextEligibleAt", dataType: "timestamp with time zone", precision: 6 },
      ]),
    );
  });
});

describe("C7-M1 checks and immutable envelopes", () => {
  it("rejects negative budgets and invalid conditional trigger/journey/step shapes", async () => {
    const graph = await createGraph("checks");

    await expect(
      prisma.routine.create({
        data: routineData("routine-negative", TENANT_A, graph.definitionId, graph.revisionId, {
          routineKey: "routine:negative",
          status: "draft",
          maxCreditsPerRun: -1,
          authorizationHash: null,
          authorizedByMembershipId: null,
          authorizedAt: null,
        }),
      }),
    ).rejects.toThrow();

    await expect(
      prisma.routineRun.create({
        data: {
          id: "run-invalid-occurrence-prefix",
          ownerId: ORG_A,
          routineId: graph.routineId,
          routineKey: graph.routineKey,
          workflowDefinitionId: graph.definitionId,
          workflowRevisionId: graph.revisionId,
          triggerKind: "manual",
          triggerOccurrenceRef: "message:wrong-kind",
          runIdempotencyKey: "run:invalid-occurrence-prefix",
          triggerPayloadHash: "v1:invalid-prefix",
          authorizationRevision: 1,
          authorizationHash: graph.authorizationHash,
          authorizationSnapshotJson: {},
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.routineRun.create({
        data: {
          id: "run-invalid-schedule",
          ownerId: ORG_A,
          routineId: graph.routineId,
          routineKey: graph.routineKey,
          workflowDefinitionId: graph.definitionId,
          workflowRevisionId: graph.revisionId,
          triggerKind: "schedule",
          triggerOccurrenceRef: "schedule:missing-time",
          runIdempotencyKey: "run:invalid-schedule",
          triggerPayloadHash: "v1:invalid",
          authorizationRevision: 1,
          authorizationHash: graph.authorizationHash,
          authorizationSnapshotJson: {},
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.contactJourneyState.create({
        data: {
          id: "journey-invalid-wait",
          ownerId: ORG_A,
          contactId: CONTACT_A,
          workflowDefinitionId: graph.definitionId,
          workflowRevisionId: graph.revisionId,
          routineId: graph.routineId,
          enrollmentIdempotencyKey: "enrollment:invalid-wait",
          status: "waiting",
          stateJson: {},
          enrolledAt: NOW,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.workflowStepExecution.create({
        data: {
          id: "step-invalid-customer-shape",
          ownerId: ORG_A,
          routineRunId: graph.runId,
          contactJourneyStateId: graph.journeyId,
          workflowRevisionId: graph.revisionId,
          stepKey: "invalid_customer_shape",
          actionKind: "conversation_reply",
          actionPayloadHash: "v1:invalid",
          stepIdempotencyKey: "step:invalid-customer-shape",
          downstreamKind: "none",
        },
      }),
    ).rejects.toThrow();

    const reservedStep = await prisma.workflowStepExecution.create({
      data: {
        id: "step-reserved-before-eligibility",
        ownerId: ORG_A,
        routineRunId: graph.runId,
        contactJourneyStateId: graph.journeyId,
        workflowRevisionId: graph.revisionId,
        stepKey: "reserve_before_eligibility",
        actionKind: "conversation_reply",
        actionPayloadHash: "v1:reserved-before-eligibility",
        stepIdempotencyKey: "step:reserved-before-eligibility",
        actionIdempotencyKey: "action:reserved-before-eligibility",
        downstreamKind: "none",
      },
    });
    expect(reservedStep.status).toBe("reserved");
    expect(reservedStep.eligibilityVerdictHash).toBeNull();

    await expect(
      prisma.workflowStepExecution.update({
        where: { id: reservedStep.id, ownerId: ORG_A },
        data: { status: "delegated" },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.workflowStepExecution.update({
        where: { id: reservedStep.id, ownerId: ORG_A },
        data: { status: "unavailable", reasonCode: "exact_identity_unavailable" },
      }),
    ).resolves.toMatchObject({
      status: "unavailable",
      reasonCode: "exact_identity_unavailable",
      contactIdentityId: null,
    });

    await expect(
      prisma.workflowStepExecution.create({
        data: {
          id: "step-blocked-before-eligibility",
          ownerId: ORG_A,
          routineRunId: graph.runId,
          contactJourneyStateId: graph.journeyId,
          workflowRevisionId: graph.revisionId,
          stepKey: "blocked_before_eligibility",
          actionKind: "conversation_reply",
          actionPayloadHash: "v1:blocked-before-eligibility",
          stepIdempotencyKey: "step:blocked-before-eligibility",
          actionIdempotencyKey: "action:blocked-before-eligibility",
          status: "blocked",
          reasonCode: "routine_authority_unavailable",
          downstreamKind: "none",
        },
      }),
    ).resolves.toMatchObject({ status: "blocked", contactIdentityId: null });

    await expect(
      prisma.workflowStepExecution.create({
        data: {
          id: "step-invalid-internal-target",
          ownerId: ORG_A,
          routineRunId: graph.runId,
          contactJourneyStateId: graph.journeyId,
          workflowRevisionId: graph.revisionId,
          contactId: CONTACT_A,
          stepKey: "wait_with_contact_shadow",
          actionKind: "wait",
          actionPayloadHash: "v1:invalid-internal-target",
          stepIdempotencyKey: "step:invalid-internal-target",
          downstreamKind: "none",
        },
      }),
    ).rejects.toThrow();
  });

  it("keeps WorkflowRevision, authorized Routine, and published policy content immutable", async () => {
    const graph = await createGraph("immutable");

    await expect(
      prisma.workflowRevision.update({
        where: { id: graph.revisionId, ownerId: ORG_A },
        data: { rulesSource: "version: changed" },
      }),
    ).rejects.toThrow(/immutable|WorkflowRevision/i);

    await expect(
      prisma.routine.update({
        where: { id: graph.routineId, ownerId: ORG_A },
        data: { maxCreditsPerRun: 1 },
      }),
    ).rejects.toThrow(/immutable|authorized Routine/i);

    await expect(
      prisma.routine.update({
        where: { id: graph.routineId, ownerId: ORG_A },
        data: {
          killSwitchEngaged: true,
          killedByMembershipId: MEMBER_A,
          killedAt: NOW,
          killReasonCode: "merchant_kill",
          rowRevision: { increment: 1 },
        },
      }),
    ).resolves.toMatchObject({ killSwitchEngaged: true, killReasonCode: "merchant_kill" });

    await expect(
      prisma.routineRun.create({
        data: {
          id: "run-after-kill",
          ownerId: ORG_A,
          routineId: graph.routineId,
          routineKey: graph.routineKey,
          workflowDefinitionId: graph.definitionId,
          workflowRevisionId: graph.revisionId,
          triggerKind: "manual",
          triggerOccurrenceRef: "manual:after-kill",
          runIdempotencyKey: "run:after-kill",
          triggerPayloadHash: "v1:after-kill",
          authorizationRevision: 1,
          authorizationHash: graph.authorizationHash,
          authorizationSnapshotJson: {},
        },
      }),
    ).rejects.toThrow(/inactive|killed|expired|drifted/i);

    await expect(
      prisma.businessHoursPolicy.update({
        where: { id: graph.policyId, ownerId: ORG_A },
        data: { timeZone: "UTC" },
      }),
    ).rejects.toThrow(/immutable|BusinessHoursPolicy/i);

    await expect(
      prisma.businessHoursPolicy.update({
        where: { id: graph.policyId, ownerId: ORG_A },
        data: { status: "archived", archivedAt: NOW, rowRevision: { increment: 1 } },
      }),
    ).resolves.toMatchObject({ status: "archived" });
  });

  it("serializes a new Run against a concurrent kill and rejects the killed authority", async () => {
    const graph = await createGraph("kill-race");
    let signalKillLocked: (() => void) | undefined;
    let releaseKill: (() => void) | undefined;
    const killLocked = new Promise<void>((resolve) => {
      signalKillLocked = resolve;
    });
    const holdKill = new Promise<void>((resolve) => {
      releaseKill = resolve;
    });

    const killTransaction = prisma.$transaction(async (tx) => {
      await tx.routine.update({
        where: { id: graph.routineId, ownerId: ORG_A },
        data: {
          killSwitchEngaged: true,
          killedByMembershipId: MEMBER_A,
          killedAt: NOW,
          killReasonCode: "concurrent_merchant_kill",
          rowRevision: { increment: 1 },
        },
      });
      signalKillLocked?.();
      await holdKill;
    });

    await killLocked;
    try {
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '100ms'");
          await tx.routineRun.create({
            data: {
              id: "run-concurrent-kill-lock-probe",
              ownerId: ORG_A,
              routineId: graph.routineId,
              routineKey: graph.routineKey,
              workflowDefinitionId: graph.definitionId,
              workflowRevisionId: graph.revisionId,
              triggerKind: "manual",
              triggerOccurrenceRef: "manual:concurrent-kill-lock-probe",
              runIdempotencyKey: "run:concurrent-kill-lock-probe",
              triggerPayloadHash: "v1:concurrent-kill-lock-probe",
              authorizationRevision: 1,
              authorizationHash: graph.authorizationHash,
              authorizationSnapshotJson: {},
            },
          });
        }),
      ).rejects.toThrow(/55P03|lock timeout|canceling statement/i);
    } finally {
      releaseKill?.();
      await killTransaction;
    }

    await expect(
      prisma.routineRun.create({
        data: {
          id: "run-after-concurrent-kill",
          ownerId: ORG_A,
          routineId: graph.routineId,
          routineKey: graph.routineKey,
          workflowDefinitionId: graph.definitionId,
          workflowRevisionId: graph.revisionId,
          triggerKind: "manual",
          triggerOccurrenceRef: "manual:after-concurrent-kill",
          runIdempotencyKey: "run:after-concurrent-kill",
          triggerPayloadHash: "v1:after-concurrent-kill",
          authorizationRevision: 1,
          authorizationHash: graph.authorizationHash,
          authorizationSnapshotJson: {},
        },
      }),
    ).rejects.toThrow(/inactive|killed|expired|drifted/i);
    await expect(
      prisma.routineRun.findMany({
        where: {
          ownerId: ORG_A,
          id: { in: ["run-concurrent-kill-lock-probe", "run-after-concurrent-kill"] },
        },
      }),
    ).resolves.toHaveLength(0);
  });
});

describe("C7-M1 Restrict and storage-only boundaries", () => {
  it("prevents deleting every referenced historical parent", async () => {
    const graph = await createGraph("restrict");
    const successorPolicyId = "c7-policy-restrict-v2";
    await prisma.businessHoursPolicy.create({
      data: {
        id: successorPolicyId,
        ownerId: ORG_A,
        policyKey: "business-hours:restrict",
        revision: 2,
        supersedesPolicyId: graph.policyId,
        name: "Business hours restrict v2",
        timeZone: "Asia/Kuala_Lumpur",
        weeklyWindowsJson: [{ weekday: 2, startMinute: 540, endMinute: 1020 }],
        status: "draft",
        contentHash: "v1:business-hours:restrict-v2",
        createdByMembershipId: MEMBER_A,
      },
    });

    const deletes = [
      () => prisma.organization.delete({ where: { id: ORG_A } }),
      () => prisma.membership.delete({ where: { id: MEMBER_A, orgId: ORG_A } }),
      () => prisma.contact.delete({ where: { id: CONTACT_A, ownerId: ORG_A } }),
      () => prisma.contactIdentity.delete({ where: { id: IDENTITY_A, ownerId: ORG_A } }),
      () => prisma.channelConnection.delete({ where: { id: CONNECTION_A, ownerId: ORG_A } }),
      () => prisma.workflowDefinition.delete({ where: { id: graph.definitionId, ownerId: ORG_A } }),
      () => prisma.workflowRevision.delete({ where: { id: graph.revisionId, ownerId: ORG_A } }),
      () => prisma.routine.delete({ where: { id: graph.routineId, ownerId: ORG_A } }),
      () => prisma.routineRun.delete({ where: { id: graph.runId, ownerId: ORG_A } }),
      () => prisma.contactJourneyState.delete({ where: { id: graph.journeyId, ownerId: ORG_A } }),
      () => prisma.businessHoursPolicy.delete({ where: { id: graph.policyId, ownerId: ORG_A } }),
    ];
    for (const remove of deletes) await expect(remove()).rejects.toMatchObject({ code: "P2003" });

    await expect(
      prisma.workflowStepExecution.findMany({ where: { ownerId: ORG_A, id: graph.stepId } }),
    ).resolves.toHaveLength(1);
  });

  it("uses code-validated Strings, excludes raw payload fields, and contains only additive DDL", () => {
    const taxonomyFields: Record<string, string[]> = {
      WorkflowDefinition: ["definitionKind", "originKind", "status"],
      WorkflowRevision: ["formatVersion", "validationState"],
      Routine: ["status"],
      RoutineRun: ["triggerKind", "status"],
      ContactJourneyState: ["status"],
      WorkflowStepExecution: ["actionKind", "status", "downstreamKind"],
      BusinessHoursPolicy: ["status", "timeZone"],
    };
    for (const [modelName, fields] of Object.entries(taxonomyFields)) {
      const block = modelBlock(modelName);
      for (const field of fields) expect(block).toMatch(new RegExp(`^\\s+${field}\\s+String`, "m"));
      expect(block).not.toMatch(/^\s+(?:rawPayload|phone|messageBody|providerPayload|token|signature|receiptRef)\s/m);
    }
    expect(modelBlock("WorkflowRevision")).not.toMatch(/^\s+(?:updatedAt|deletedAt)\s/m);

    const migration = fs.readFileSync(MIGRATION, "utf8").replace(/^--.*$/gm, "").trim();
    expect(migration.startsWith("BEGIN;")).toBe(true);
    expect(migration.endsWith("COMMIT;")).toBe(true);
    expect(migration).not.toMatch(/^\s*(?:DROP|DELETE|UPDATE|INSERT|TRUNCATE)\b/im);
    expect(migration).not.toMatch(/CREATE\s+TYPE|ON DELETE CASCADE/i);
    expect(migration).toContain('"expiresAt" > statement_timestamp()');
    expect(migration).not.toContain('"expiresAt" > CURRENT_TIMESTAMP');

    const createdTables = [...migration.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1]);
    expect(createdTables).toEqual(C7_MODELS);

    const alteredTables = [...migration.matchAll(/ALTER TABLE "([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(alteredTables)).toEqual(new Set(C7_MODELS));

    const functions = [...migration.matchAll(/CREATE FUNCTION "([^"]+)"/g)].map((match) => match[1]);
    expect(functions).toEqual([
      "c7_reject_workflow_revision_update",
      "c7_guard_routine_authorization_update",
      "c7_validate_new_routine_run",
      "c7_guard_business_hours_policy_update",
    ]);
    const triggers = [...migration.matchAll(/CREATE TRIGGER "([^"]+)"/g)].map((match) => match[1]);
    expect(triggers).toEqual([
      "WorkflowRevision_immutable_update",
      "Routine_authorization_immutable_update",
      "RoutineRun_live_authority_insert",
      "BusinessHoursPolicy_published_content_update",
    ]);

    for (const forbidden of [
      "InboxRecipe",
      "WorkflowSend",
      "WorkflowOutbox",
      "WorkflowReceipt",
      "WorkflowSuppression",
      "WorkflowConsent",
      "WorkflowFrequency",
      "WorkflowAttribution",
    ]) {
      expect(migration).not.toContain(`CREATE TABLE "${forbidden}"`);
    }
  });
});
