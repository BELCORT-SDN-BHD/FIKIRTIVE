import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const gateway = vi.hoisted(() => ({
  activateRoutine: vi.fn(async (input: unknown) => ({ ok: true, resource: input })),
  archiveWorkflowDefinition: vi.fn(async (input: unknown) => ({ ok: true, resource: input })),
  createRoutineDraft: vi.fn(async (input: unknown) => ({ ok: true, resource: input })),
  createWorkflowDefinition: vi.fn(async (input: unknown) => ({ ok: true, resource: input })),
  getBusinessHoursPolicy: vi.fn(async (input: unknown) => ({ ok: true, resource: input })),
  getContactJourneyStates: vi.fn(async (input: unknown) => ({ ok: true, resource: input })),
  getRoutine: vi.fn(async (input: unknown) => ({ ok: true, resource: input })),
  getWorkflowDefinition: vi.fn(async (input: unknown) => ({ ok: true, resource: input })),
  killRoutine: vi.fn(async (input: unknown) => ({ ok: true, resource: input })),
  listBusinessHoursPolicies: vi.fn(async (input: unknown) => ({ ok: true, resource: input })),
  listRoutineRuns: vi.fn(async (input: unknown) => ({ ok: true, resource: input })),
  listRoutines: vi.fn(async (input: unknown) => ({ ok: true, resource: input })),
  listWorkflowDefinitions: vi.fn(async (input: unknown) => ({ ok: true, resource: input })),
  listWorkflowRevisions: vi.fn(async (input: unknown) => ({ ok: true, resource: input })),
  publishWorkflowRevision: vi.fn(async (input: unknown) => ({ ok: true, resource: input })),
  reauthorizeRoutine: vi.fn(async (input: unknown) => ({ ok: true, resource: input })),
  saveWorkflowRevision: vi.fn(async (input: unknown) => ({ ok: true, resource: input })),
  validateWorkflowRules: vi.fn(async (input: unknown) => ({ ok: true, resource: input })),
}));

vi.mock("../customer-workflow-gateway", () => gateway);

import * as customerWorkflowUiActions from "../customer-workflow-ui-actions";

const APPROVED_EXPORTS = [
  "activateRoutine",
  "archiveWorkflowDefinition",
  "createRoutineDraft",
  "createWorkflowDefinition",
  "getBusinessHoursPolicy",
  "getContactJourneyStates",
  "getRoutine",
  "getWorkflowDefinition",
  "killRoutine",
  "listBusinessHoursPolicies",
  "listRoutineRuns",
  "listRoutines",
  "listWorkflowDefinitions",
  "listWorkflowRevisions",
  "publishWorkflowRevision",
  "reauthorizeRoutine",
  "saveWorkflowRevision",
  "validateWorkflowRules",
].sort();

const WORKER_ONLY_NAMES = [
  "advanceWorkflowJourney",
  "createWorkflowJourneyDueRun",
  "createWorkflowRun",
  "dispatchWorkflowStep",
  "enrollWorkflowJourney",
  "enterWorkflowJourneyWait",
  "evaluateWorkflowBusinessHours",
  "transitionWorkflowRun",
];

describe("customer-workflow-ui-actions pass-through", () => {
  it("passes a read input and result through unchanged", async () => {
    const reads = [
      ["listRoutines", { workflowDefinitionId: "definition-1", limit: 25 }],
      ["getRoutine", { routineId: "routine-1" }],
      ["listRoutineRuns", { routineId: "routine-1", limit: 25 }],
      ["getContactJourneyStates", { workflowDefinitionId: "definition-1", limit: 25 }],
      ["listBusinessHoursPolicies", { status: "published", limit: 25 }],
      ["getBusinessHoursPolicy", { businessHoursPolicyId: "policy-1" }],
    ] as const;

    for (const [name, input] of reads) {
      await expect(
        (customerWorkflowUiActions[name] as (value: typeof input) => Promise<unknown>)(input),
      ).resolves.toEqual({ ok: true, resource: input });
      expect(gateway[name]).toHaveBeenCalledWith(input);
    }
  });

  it("passes a human-only mutation input and result through unchanged", async () => {
    const input = { routineId: "routine-1", expectedRowRevision: 3 };
    await expect(customerWorkflowUiActions.activateRoutine(input)).resolves.toEqual({
      ok: true,
      resource: input,
    });
    expect(gateway.activateRoutine).toHaveBeenCalledWith(input);
  });
});

describe("customer-workflow-ui-actions surface", () => {
  it("exports only the approved UI calls and never imports worker-only dispatch functions", () => {
    expect(Object.keys(customerWorkflowUiActions).sort()).toEqual(APPROVED_EXPORTS);

    const sourcePath = path.resolve(__dirname, "../customer-workflow-ui-actions.ts");
    const source = fs.readFileSync(sourcePath, "utf8");
    const gatewayImports = [
      ...source.matchAll(
        /import\s*\{([^}]*)\}\s*from\s*["']\.\/customer-workflow-gateway["']/g,
      ),
    ];
    expect(gatewayImports).toHaveLength(1);

    const importedNames = gatewayImports.flatMap((match) =>
      match[1]!
        .split(",")
        .map((specifier) => specifier.trim())
        .filter(Boolean)
        .map((specifier) => specifier.split(/\s+as\s+/)[0]!.trim()),
    );
    expect(importedNames.sort()).toEqual(APPROVED_EXPORTS);

    for (const workerOnlyName of WORKER_ONLY_NAMES) {
      expect(
        importedNames.includes(workerOnlyName),
        `the UI wrapper must not import worker-only function "${workerOnlyName}"`,
      ).toBe(false);
    }
  });
});
