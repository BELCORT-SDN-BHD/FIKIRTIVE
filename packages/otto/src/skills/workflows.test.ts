import type { RunContext } from "@openai/agents";
import { describe, expect, it, vi } from "vitest";
import type { OttoContext } from "../context.js";
import {
  draftWorkflowsParams,
  draftWorkflowsSkill,
  executeDraftWorkflows,
  workflowRoutineScopeSchema,
} from "./draft-workflows.js";
import {
  executeReadWorkflows,
  readWorkflowsParams,
  readWorkflowsSkill,
} from "./read-workflows.js";

const DEFINITION_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const REVISION_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const CONTACT_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAX";
const SEGMENT_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAY";
const CONNECTION_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAZ";

const rulesSource = [
  "version: fikirtive-workflow/v1",
  "name: Follow up",
  "trigger:",
  "  type: manual",
  "conditions: []",
  "steps:",
  "  - key: finish",
  "    action:",
  "      type: complete",
].join("\n");

const scopeJson = {
  actionKinds: ["complete" as const],
  channelScopes: [{ channel: "whatsapp", providerConnectionId: CONNECTION_ID }],
  contactIds: [CONTACT_ID],
  segmentIds: [SEGMENT_ID],
  maxActions: 1,
  maxRecipients: 1,
};

function ports() {
  return {
    listWorkflowDefinitions: vi.fn().mockResolvedValue({ ok: true, resource: [] }),
    getWorkflowDefinition: vi.fn().mockResolvedValue({ ok: true, resource: { id: DEFINITION_ID } }),
    listWorkflowRevisions: vi.fn().mockResolvedValue({ ok: true, resource: [] }),
    createWorkflowDefinition: vi.fn().mockResolvedValue({
      ok: true,
      resource: { id: DEFINITION_ID, status: "draft" },
    }),
    validateWorkflowRules: vi.fn().mockResolvedValue({
      ok: true,
      resource: { validationState: "valid" },
    }),
    saveWorkflowRevision: vi.fn().mockResolvedValue({
      ok: true,
      resource: { id: REVISION_ID, validationState: "valid" },
    }),
    publishWorkflowRevision: vi.fn().mockResolvedValue({
      ok: true,
      resource: { id: DEFINITION_ID, currentRevision: 1, status: "published" },
    }),
    createRoutineDraft: vi.fn().mockResolvedValue({
      ok: true,
      resource: {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FB0",
        status: "draft",
        maxCreditsPerRun: 0,
        maxCreditsPerMonth: 0,
        authorizationHash: null,
        authorizedAt: null,
        authorizedByMembershipId: null,
      },
    }),
  } as unknown as NonNullable<OttoContext["workflows"]>;
}

function runContext(workflows?: OttoContext["workflows"]): Pick<RunContext<OttoContext>, "context"> {
  return { context: { workflows } as OttoContext };
}

describe("C7 Workflow skills", () => {
  it("declares the exact free/internal read and draft-write classifications", () => {
    expect(readWorkflowsSkill).toMatchObject({
      name: "readWorkflows",
      cost: "free",
      effect: "read",
      reach: "internal",
      needsApproval: false,
    });
    expect(draftWorkflowsSkill).toMatchObject({
      name: "draftWorkflows",
      cost: "free",
      effect: "write",
      reach: "internal",
      needsApproval: false,
    });
    expect(draftWorkflowsSkill.description).toContain("NEVER activates or authorizes a Routine");
  });

  it("keeps both tool schemas strict and rejects identity or hidden authority/effect fields", () => {
    expect(readWorkflowsParams.safeParse({
      operation: "listWorkflowDefinitions",
      ownerId: "other-owner",
    }).success).toBe(false);

    const base = {
      operation: "createWorkflowDefinition",
      slug: "follow-up",
      name: "Follow up",
      definitionKind: "rule",
    };
    for (const hidden of [
      "ownerId",
      "activate",
      "authorize",
      "reauthorize",
      "kill",
      "dispatch",
      "send",
      "spend",
      "credits",
      "maxCreditsPerRun",
      "maxCreditsPerMonth",
      "summaryPolicyJson",
      "provider",
    ]) {
      expect(draftWorkflowsParams.safeParse({ ...base, [hidden]: true }).success, hidden).toBe(false);
    }
    expect(workflowRoutineScopeSchema.safeParse(scopeJson).success).toBe(true);
    expect(workflowRoutineScopeSchema.safeParse({ ...scopeJson, unlimited: true }).success).toBe(false);
    expect(workflowRoutineScopeSchema.safeParse({
      ...scopeJson,
      contactIds: [CONTACT_ID, CONTACT_ID],
    }).success).toBe(false);
  });

  it("routes all three reads and requires exact ids", async () => {
    const workflowPorts = ports();
    await executeReadWorkflows(
      { operation: "listWorkflowDefinitions", limit: 10 },
      runContext(workflowPorts),
    );
    await executeReadWorkflows(
      { operation: "getWorkflowDefinition", workflowDefinitionId: DEFINITION_ID },
      runContext(workflowPorts),
    );
    await executeReadWorkflows(
      { operation: "listWorkflowRevisions", workflowDefinitionId: DEFINITION_ID, limit: 5 },
      runContext(workflowPorts),
    );
    expect(workflowPorts.listWorkflowDefinitions).toHaveBeenCalledWith({ limit: 10 });
    expect(workflowPorts.getWorkflowDefinition).toHaveBeenCalledWith({
      workflowDefinitionId: DEFINITION_ID,
    });
    expect(workflowPorts.listWorkflowRevisions).toHaveBeenCalledWith({
      workflowDefinitionId: DEFINITION_ID,
      limit: 5,
    });

    await expect(executeReadWorkflows(
      { operation: "getWorkflowDefinition", workflowDefinitionId: "guessed" },
      runContext(workflowPorts),
    )).resolves.toMatchObject({ ok: false, error: expect.stringContaining("exact") });
    expect(workflowPorts.getWorkflowDefinition).toHaveBeenCalledTimes(1);
  });

  it("routes all five draft operations, with custom definitions and pointer-only publish", async () => {
    const workflowPorts = ports();
    await executeDraftWorkflows({
      operation: "createWorkflowDefinition",
      slug: "follow-up",
      name: "Follow up",
      definitionKind: "rule",
    }, runContext(workflowPorts));
    await executeDraftWorkflows({
      operation: "validateWorkflowRules",
      workflowDefinitionId: DEFINITION_ID,
      rulesSource,
    }, runContext(workflowPorts));
    await executeDraftWorkflows({
      operation: "saveWorkflowRevision",
      workflowDefinitionId: DEFINITION_ID,
      rulesSource,
    }, runContext(workflowPorts));
    await executeDraftWorkflows({
      operation: "publishWorkflowRevision",
      workflowDefinitionId: DEFINITION_ID,
      workflowRevisionId: REVISION_ID,
      expectedRowRevision: 0,
    }, runContext(workflowPorts));

    expect(workflowPorts.createWorkflowDefinition).toHaveBeenCalledWith({
      slug: "follow-up",
      name: "Follow up",
      definitionKind: "rule",
      originKind: "custom",
    });
    expect(workflowPorts.validateWorkflowRules).toHaveBeenCalledWith({
      workflowDefinitionId: DEFINITION_ID,
      rulesSource,
    });
    expect(workflowPorts.saveWorkflowRevision).toHaveBeenCalledWith({
      workflowDefinitionId: DEFINITION_ID,
      rulesSource,
    });
    expect(workflowPorts.publishWorkflowRevision).toHaveBeenCalledWith({
      workflowDefinitionId: DEFINITION_ID,
      workflowRevisionId: REVISION_ID,
      expectedRowRevision: 0,
    });
    expect(JSON.stringify((workflowPorts.publishWorkflowRevision as unknown as {
      mock: { calls: unknown[] };
    }).mock.calls)).not.toMatch(/activate|authorize|run|dispatch|send|provider|spend|credit/i);
  });

  it("creates only a closed Routine draft and exposes no execution or spend authority", async () => {
    const workflowPorts = ports();
    const result = await executeDraftWorkflows({
      operation: "createRoutineDraft",
      workflowDefinitionId: DEFINITION_ID,
      workflowRevisionId: REVISION_ID,
      routineKey: "weekly_follow_up",
      scopeJson,
      expiresAt: "2026-08-31T00:00:00.000Z",
    }, runContext(workflowPorts)) as {
      ok: true;
      resource: Record<string, unknown>;
    };

    expect(workflowPorts.createRoutineDraft).toHaveBeenCalledWith({
      workflowDefinitionId: DEFINITION_ID,
      workflowRevisionId: REVISION_ID,
      routineKey: "weekly_follow_up",
      scopeJson,
      expiresAt: "2026-08-31T00:00:00.000Z",
    });
    const [routineDraftInput] = (workflowPorts.createRoutineDraft as unknown as {
      mock: { calls: Array<[Record<string, unknown>]> };
    }).mock.calls.at(-1) ?? [];
    expect(Object.keys(routineDraftInput ?? {}).sort()).toEqual([
      "expiresAt",
      "routineKey",
      "scopeJson",
      "workflowDefinitionId",
      "workflowRevisionId",
    ]);
    expect(result.resource).toMatchObject({
      status: "draft",
      maxCreditsPerRun: 0,
      maxCreditsPerMonth: 0,
      authorizationHash: null,
      authorizedAt: null,
      authorizedByMembershipId: null,
    });
    for (const forbidden of ["routineRun", "workflowStep", "send", "dispatch", "spend"]) {
      expect(result.resource).not.toHaveProperty(forbidden);
    }

    expect(Object.keys(workflowPorts).sort()).toEqual([
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
      "dispatchWorkflowStep",
    ]) {
      expect(workflowPorts).not.toHaveProperty(forbidden);
    }
  });

  it("fails closed for missing ports, guessed ids, and operation-inappropriate fields", async () => {
    await expect(executeReadWorkflows(
      { operation: "listWorkflowDefinitions" },
      runContext(),
    )).resolves.toMatchObject({ ok: false });
    await expect(executeDraftWorkflows({
      operation: "createWorkflowDefinition",
      slug: "follow-up",
      name: "Follow up",
      definitionKind: "rule",
    }, runContext())).resolves.toMatchObject({ ok: false });

    const workflowPorts = ports();
    await expect(executeDraftWorkflows({
      operation: "publishWorkflowRevision",
      workflowDefinitionId: DEFINITION_ID,
      workflowRevisionId: "guessed",
      expectedRowRevision: 0,
    }, runContext(workflowPorts))).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("exact"),
    });
    await expect(executeDraftWorkflows({
      operation: "createWorkflowDefinition",
      slug: "follow-up",
      name: "Follow up",
      definitionKind: "rule",
      rulesSource,
    }, runContext(workflowPorts))).resolves.toMatchObject({ ok: false });
    expect(workflowPorts.publishWorkflowRevision).not.toHaveBeenCalled();
    expect(workflowPorts.createWorkflowDefinition).not.toHaveBeenCalled();
  });
});
