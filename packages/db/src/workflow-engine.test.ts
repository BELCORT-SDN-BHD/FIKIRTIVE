import { describe, expect, it } from "vitest";
import {
  WorkflowEngineError,
  canonicalizeRoutineScope,
  computeRoutineAuthorizationHash,
  computeRoutineScopeHash,
  createRoutineAuthorizationSnapshot,
  createRoutineRun,
  deriveRunIdempotencyKey,
  deriveTriggerOccurrence,
  engageRoutineKillSwitch,
  transitionRoutineRun,
  verifyRoutineAuthorization,
  type RoutineAuthorityRow,
  type RoutineAuthorizationMaterial,
  type RoutineRunRecord,
  type WorkflowEngineDb,
  type WorkflowRevisionAuthorityRow,
} from "./workflow-engine.js";

const NOW = new Date("2026-07-22T10:00:00.000Z");
const SCOPE = {
  actionKinds: ["complete", "wait"],
  channelScopes: [{ channel: "whatsapp", providerConnectionId: null }],
  contactIds: ["contact-1"],
  segmentIds: [],
  maxActions: 2,
  maxRecipients: 1,
};

function revision(overrides: Partial<WorkflowRevisionAuthorityRow> = {}): WorkflowRevisionAuthorityRow {
  return {
    id: "revision-1",
    ownerId: "owner-1",
    workflowDefinitionId: "definition-1",
    revision: 1,
    contentHash: "content-1",
    dependencyHash: "dependency-1",
    compiledRuleJson: {
      trigger: { type: "manual" },
      steps: [{ key: "wait" }, { key: "reply" }],
    },
    validationState: "valid",
    ...overrides,
  };
}

function material(
  overrides: Partial<RoutineAuthorizationMaterial> = {},
): RoutineAuthorizationMaterial {
  return {
    ownerId: "owner-1",
    routineKey: "routine-key-1",
    workflowDefinitionId: "definition-1",
    workflowRevisionId: "revision-1",
    workflowRevision: 1,
    workflowContentHash: "content-1",
    dependencyHash: "dependency-1",
    scopeJson: SCOPE,
    maxCreditsPerRun: 0,
    maxCreditsPerMonth: 0,
    expiresAt: new Date("2026-08-01T00:00:00.000Z"),
    summaryPolicyJson: { destination: "run_history" },
    authorizationRevision: 1,
    ...overrides,
  };
}

function routine(
  rev = revision(),
  overrides: Partial<RoutineAuthorityRow> = {},
): RoutineAuthorityRow {
  const base: RoutineAuthorityRow = {
    id: "routine-1",
    ownerId: rev.ownerId,
    routineKey: "routine-key-1",
    workflowDefinitionId: rev.workflowDefinitionId,
    workflowRevisionId: rev.id,
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
    ...overrides,
  };
  if (overrides.scopeJson !== undefined && overrides.scopeHash === undefined) {
    base.scopeHash = computeRoutineScopeHash(base.scopeJson);
  }
  base.authorizationHash = computeRoutineAuthorizationHash({
    ownerId: base.ownerId,
    routineKey: base.routineKey,
    workflowDefinitionId: base.workflowDefinitionId,
    workflowRevisionId: base.workflowRevisionId,
    workflowRevision: rev.revision,
    workflowContentHash: rev.contentHash,
    dependencyHash: rev.dependencyHash,
    scopeJson: base.scopeJson,
    maxCreditsPerRun: base.maxCreditsPerRun,
    maxCreditsPerMonth: base.maxCreditsPerMonth,
    expiresAt: base.expiresAt,
    summaryPolicyJson: base.summaryPolicyJson,
    authorizationRevision: base.authorizationRevision,
  });
  if (overrides.authorizationHash !== undefined) base.authorizationHash = overrides.authorizationHash;
  return base;
}

class EngineFixture {
  routines: RoutineAuthorityRow[] = [];
  revisions: WorkflowRevisionAuthorityRow[] = [];
  runs: RoutineRunRecord[] = [];
  ownerFilters: string[] = [];

  tx: any = { $queryRaw: async (..._args: unknown[]) => [] };

  constructor() {
    this.tx.routine = {
      findFirst: async ({ where }: any) => {
        this.ownerFilters.push(where.ownerId);
        return this.routines.find((row) => row.id === where.id && row.ownerId === where.ownerId) ?? null;
      },
      updateMany: async ({ where, data }: any) => {
        this.ownerFilters.push(where.ownerId);
        const row = this.routines.find(
          (item) =>
            item.id === where.id &&
            item.ownerId === where.ownerId &&
            (where.rowRevision === undefined || item.rowRevision === where.rowRevision) &&
            (where.status === undefined || where.status.in.includes(item.status)) &&
            (where.killSwitchEngaged === undefined || item.killSwitchEngaged === where.killSwitchEngaged),
        );
        if (!row) return { count: 0 };
        Object.assign(row, data, { rowRevision: row.rowRevision + (data.rowRevision?.increment ?? 0) });
        return { count: 1 };
      },
    };
    this.tx.workflowRevision = {
      findFirst: async ({ where }: any) => {
        this.ownerFilters.push(where.ownerId);
        return this.revisions.find(
          (row) =>
            row.id === where.id &&
            row.ownerId === where.ownerId &&
            row.workflowDefinitionId === where.workflowDefinitionId,
        ) ?? null;
      },
    };
    this.tx.routineRun = {
      findFirst: async ({ where }: any) => {
        this.ownerFilters.push(where.ownerId);
        return this.runs.find(
          (row) =>
            row.ownerId === where.ownerId &&
            (where.id === undefined || row.id === where.id) &&
            (where.runIdempotencyKey === undefined || row.runIdempotencyKey === where.runIdempotencyKey),
        ) ?? null;
      },
      createMany: async ({ data }: any) => {
        const item = data[0];
        if (this.runs.some((row) => row.ownerId === item.ownerId && row.runIdempotencyKey === item.runIdempotencyKey)) {
          return { count: 0 };
        }
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
        this.ownerFilters.push(where.ownerId);
        const row = this.runs.find(
          (item) =>
            item.id === where.id &&
            item.ownerId === where.ownerId &&
            item.rowRevision === where.rowRevision &&
            item.status === where.status,
        );
        if (!row) return { count: 0 };
        const increment = data.rowRevision?.increment ?? 0;
        Object.assign(row, data, { rowRevision: row.rowRevision + increment });
        return { count: 1 };
      },
    };
  }

  db(): WorkflowEngineDb {
    return {
      $transaction: async (callback: any) => callback(this.tx),
    } as unknown as WorkflowEngineDb;
  }
}

function runInput(routineId = "routine-1", payload: unknown = { operation: "op-1" }) {
  return {
    id: "run-1",
    ownerId: "owner-1",
    routineId,
    trigger: { kind: "manual" as const, operationId: "op-1" },
    trustedTriggerPayload: payload,
    now: NOW,
  };
}

describe("C7 routine authorization", () => {
  it("canonicalizes the closed scope and denies unknown fields", () => {
    expect(canonicalizeRoutineScope({ ...SCOPE, actionKinds: ["wait", "complete"] })).toEqual(SCOPE);
    expect(canonicalizeRoutineScope({
      ...SCOPE,
      channelScopes: [
        { channel: "whatsapp", providerConnectionId: "a" },
        { channel: "whatsapp", providerConnectionId: "Z" },
      ],
    })?.channelScopes.map((entry) => entry.providerConnectionId)).toEqual(["Z", "a"]);
    expect(canonicalizeRoutineScope({ ...SCOPE, unlimited: true })).toBeNull();
  });

  it("changes the hash for every immutable envelope field while ignoring JSON object key order", () => {
    const base = material();
    const baseHash = computeRoutineAuthorizationHash(base);
    expect(computeRoutineAuthorizationHash({ ...base, scopeJson: { ...SCOPE, maxActions: 2 } })).toBe(baseHash);
    const changes: RoutineAuthorizationMaterial[] = [
      { ...base, ownerId: "owner-2" },
      { ...base, routineKey: "routine-key-2" },
      { ...base, workflowDefinitionId: "definition-2" },
      { ...base, workflowRevisionId: "revision-2" },
      { ...base, workflowRevision: 2 },
      { ...base, workflowContentHash: "content-2" },
      { ...base, dependencyHash: "dependency-2" },
      { ...base, scopeJson: { ...SCOPE, maxActions: 3 } },
      { ...base, maxCreditsPerRun: 1 },
      { ...base, maxCreditsPerMonth: 1 },
      { ...base, expiresAt: new Date("2026-08-02T00:00:00.000Z") },
      { ...base, summaryPolicyJson: { destination: "owner_email" } },
      { ...base, authorizationRevision: 2 },
    ];
    expect(new Set(changes.map(computeRoutineAuthorizationHash)).size).toBe(changes.length);
    expect(changes.every((value) => computeRoutineAuthorizationHash(value) !== baseHash)).toBe(true);
    expect(createRoutineAuthorizationSnapshot(base).expiresAt).toBe("2026-08-01T00:00:00.000Z");
    expect(() => createRoutineAuthorizationSnapshot({
      ...base,
      summaryPolicyJson: { policy: "x".repeat(32 * 1024) },
    })).toThrowError(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
  });

  it("returns only the five canonical fail reasons", () => {
    const rev = revision();
    expect(verifyRoutineAuthorization(routine(rev, { killSwitchEngaged: true }), rev, NOW)).toEqual({ ok: false, reason: "kill" });
    expect(verifyRoutineAuthorization(routine(rev, { status: "paused" }), rev, NOW)).toEqual({ ok: false, reason: "status" });
    expect(verifyRoutineAuthorization(routine(rev, { expiresAt: new Date("2026-07-22T09:00:00Z") }), rev, NOW)).toEqual({ ok: false, reason: "expired" });
    expect(verifyRoutineAuthorization(routine(rev, { authorizationHash: null }), rev, NOW)).toEqual({ ok: false, reason: "hash_drift" });
    expect(verifyRoutineAuthorization(routine(rev, { maxCreditsPerRun: 1 }), rev, NOW)).toEqual({ ok: false, reason: "budget_unavailable" });
  });
});

describe("C7 RoutineRun exactly-once and CAS", () => {
  it("creates no run for every fail-closed authority state", async () => {
    const cases: Array<{
      name: string;
      expectedReason: string;
      make: (rev: WorkflowRevisionAuthorityRow) => RoutineAuthorityRow;
    }> = [
      { name: "draft", expectedReason: "status", make: (rev) => routine(rev, { status: "draft" }) },
      { name: "paused", expectedReason: "status", make: (rev) => routine(rev, { status: "paused" }) },
      { name: "revoked", expectedReason: "status", make: (rev) => routine(rev, { status: "revoked" }) },
      {
        name: "expired",
        expectedReason: "expired",
        make: (rev) => routine(rev, { expiresAt: new Date("2026-07-22T09:00:00.000Z") }),
      },
      { name: "killed", expectedReason: "kill", make: (rev) => routine(rev, { killSwitchEngaged: true }) },
      { name: "missing hash", expectedReason: "hash_drift", make: (rev) => routine(rev, { authorizationHash: null }) },
      {
        name: "missing scope",
        expectedReason: "hash_drift",
        make: (rev) => {
          const row = routine(rev);
          row.scopeJson = null;
          return row;
        },
      },
      {
        name: "nonzero budget",
        expectedReason: "budget_unavailable",
        make: (rev) => routine(rev, { maxCreditsPerRun: 1 }),
      },
    ];

    for (const authorityCase of cases) {
      const fixture = new EngineFixture();
      const rev = revision();
      fixture.revisions.push(rev);
      fixture.routines.push(authorityCase.make(rev));
      await expect(createRoutineRun(fixture.db(), runInput())).resolves.toEqual({
        kind: "blocked",
        reason: authorityCase.expectedReason,
      });
      expect(fixture.runs, authorityCase.name).toHaveLength(0);
    }

    const missingRevision = new EngineFixture();
    missingRevision.routines.push(routine(revision()));
    await expect(createRoutineRun(missingRevision.db(), runInput())).resolves.toEqual({
      kind: "blocked",
      reason: "hash_drift",
    });
    expect(missingRevision.runs).toHaveLength(0);
  });

  it("derives all four occurrence formulas and a run key that excludes authorization and payload", () => {
    expect(deriveTriggerOccurrence({ kind: "manual", operationId: "m-1" }).triggerOccurrenceRef).toBe("manual:m-1");
    expect(deriveTriggerOccurrence({ kind: "schedule", scheduledFor: "2026-07-22T18:00:00+08:00" }).triggerOccurrenceRef).toBe("schedule:2026-07-22T10:00:00.000Z");
    expect(deriveTriggerOccurrence({ kind: "customer_message", sourceEventKey: "src-1", triggerEventRef: "msg-1" }).triggerOccurrenceRef).toBe("message:src-1");
    expect(deriveTriggerOccurrence({ kind: "journey_due", contactJourneyStateId: "journey-1", waitGeneration: 2, nextEligibleAt: NOW }).triggerOccurrenceRef).toBe("journey:journey-1:2:2026-07-22T10:00:00.000Z");
    const key = deriveRunIdempotencyKey({ ownerId: "owner-1", workflowDefinitionId: "definition-1", routineKey: "routine-key-1", triggerKind: "manual", triggerOccurrenceRef: "manual:m-1" });
    expect(key).toBe(deriveRunIdempotencyKey({ ownerId: "owner-1", workflowDefinitionId: "definition-1", routineKey: "routine-key-1", triggerKind: "manual", triggerOccurrenceRef: "manual:m-1" }));
  });

  it("rejects a run trigger that does not match the immutable compiled revision", async () => {
    const fixture = new EngineFixture();
    const rev = revision({ compiledRuleJson: { trigger: { type: "schedule" }, steps: [] } });
    fixture.revisions.push(rev);
    fixture.routines.push(routine(rev));
    await expect(createRoutineRun(fixture.db(), runInput())).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    expect(fixture.runs).toHaveLength(0);
  });

  it("creates the row before dispatch, absorbs a double tick, and conflicts on comparison drift", async () => {
    const fixture = new EngineFixture();
    const rev = revision();
    fixture.revisions.push(rev);
    fixture.routines.push(routine(rev));
    const first = await createRoutineRun(fixture.db(), runInput());
    expect(first).toMatchObject({ kind: "created", shouldDispatch: true });
    expect(fixture.runs).toHaveLength(1);
    const replay = await createRoutineRun(fixture.db(), { ...runInput(), id: "run-retry" });
    expect(replay).toMatchObject({ kind: "replayed", shouldDispatch: true, run: { id: "run-1" } });
    await expect(createRoutineRun(fixture.db(), runInput("routine-1", { operation: "changed" }))).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(fixture.runs).toHaveLength(1);
    expect(fixture.ownerFilters.every((ownerId) => ownerId === "owner-1")).toBe(true);
  });

  it("keeps a killed occurrence as one no-dispatch row but conflicts after reauthorization", async () => {
    const fixture = new EngineFixture();
    const rev = revision();
    const firstRoutine = routine(rev);
    fixture.revisions.push(rev);
    fixture.routines.push(firstRoutine);
    await createRoutineRun(fixture.db(), runInput());
    await engageRoutineKillSwitch(fixture.db(), {
      ownerId: "owner-1",
      routineId: "routine-1",
      expectedRowRevision: 0,
      killedByMembershipId: "membership-1",
      killReasonCode: "merchant_kill",
      now: NOW,
    });
    await expect(createRoutineRun(fixture.db(), { ...runInput(), id: "after-kill" })).resolves.toMatchObject({
      kind: "replayed",
      shouldDispatch: false,
      blockedReason: "kill",
    });

    const reauthorized = routine(rev, {
      id: "routine-2",
      status: "active",
      killSwitchEngaged: false,
      rowRevision: 0,
      authorizationRevision: 2,
      scopeJson: { ...SCOPE, maxActions: 3 },
    });
    fixture.routines.push(reauthorized);
    await expect(createRoutineRun(fixture.db(), { ...runInput("routine-2"), id: "reauth-run" })).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    expect(fixture.runs).toHaveLength(1);
  });

  it("atomically blocks a queued run instead of claiming it after kill", async () => {
    const fixture = new EngineFixture();
    const rev = revision();
    fixture.revisions.push(rev);
    fixture.routines.push(routine(rev));
    await createRoutineRun(fixture.db(), runInput());
    await engageRoutineKillSwitch(fixture.db(), {
      ownerId: "owner-1", routineId: "routine-1", expectedRowRevision: 0,
      killedByMembershipId: "membership-1", killReasonCode: "merchant_kill", now: NOW,
    });
    await expect(transitionRoutineRun(fixture.db(), {
      ownerId: "owner-1", routineRunId: "run-1", expectedRowRevision: 0, toStatus: "running", now: NOW,
    })).resolves.toMatchObject({
      status: "blocked",
      blockReason: "routine_authority_kill",
      startedAt: null,
      finishedAt: NOW,
    });
  });

  it("forces a killed running run to blocked even when completion is requested", async () => {
    const fixture = new EngineFixture();
    const rev = revision();
    fixture.revisions.push(rev);
    fixture.routines.push(routine(rev));
    await createRoutineRun(fixture.db(), runInput());
    await transitionRoutineRun(fixture.db(), {
      ownerId: "owner-1", routineRunId: "run-1", expectedRowRevision: 0, toStatus: "running", now: NOW,
    });
    await engageRoutineKillSwitch(fixture.db(), {
      ownerId: "owner-1", routineId: "routine-1", expectedRowRevision: 0,
      killedByMembershipId: "membership-1", killReasonCode: "merchant_kill", now: NOW,
    });
    await expect(transitionRoutineRun(fixture.db(), {
      ownerId: "owner-1", routineRunId: "run-1", expectedRowRevision: 1, toStatus: "completed",
      summaryJson: { actions: 1 }, now: NOW,
    })).resolves.toMatchObject({ status: "blocked", blockReason: "routine_authority_kill" });
  });

  it("CAS-claims once and never reopens a terminal run", async () => {
    const fixture = new EngineFixture();
    const rev = revision();
    fixture.revisions.push(rev);
    fixture.routines.push(routine(rev));
    await createRoutineRun(fixture.db(), runInput());
    await expect(transitionRoutineRun(fixture.db(), {
      ownerId: "owner-1", routineRunId: "run-1", expectedRowRevision: 0, toStatus: "running", now: NOW,
    })).resolves.toMatchObject({ status: "running", rowRevision: 1 });
    await expect(transitionRoutineRun(fixture.db(), {
      ownerId: "owner-1", routineRunId: "run-1", expectedRowRevision: 0, toStatus: "running", now: NOW,
    })).rejects.toMatchObject({ code: "CAS_CONFLICT" });
    await transitionRoutineRun(fixture.db(), {
      ownerId: "owner-1", routineRunId: "run-1", expectedRowRevision: 1, toStatus: "completed", summaryUnavailableReason: "simulation_only", now: NOW,
    });
    await expect(transitionRoutineRun(fixture.db(), {
      ownerId: "owner-1", routineRunId: "run-1", expectedRowRevision: 2, toStatus: "running", now: NOW,
    })).rejects.toMatchObject({ code: "RUN_TERMINAL" });
  });

  it("rejects null and oversized terminal summaries", async () => {
    const fixture = new EngineFixture();
    const rev = revision();
    fixture.revisions.push(rev);
    fixture.routines.push(routine(rev));
    await createRoutineRun(fixture.db(), runInput());
    await transitionRoutineRun(fixture.db(), {
      ownerId: "owner-1", routineRunId: "run-1", expectedRowRevision: 0, toStatus: "running", now: NOW,
    });
    await expect(transitionRoutineRun(fixture.db(), {
      ownerId: "owner-1", routineRunId: "run-1", expectedRowRevision: 1, toStatus: "completed", summaryJson: null, now: NOW,
    })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(transitionRoutineRun(fixture.db(), {
      ownerId: "owner-1", routineRunId: "run-1", expectedRowRevision: 1, toStatus: "completed",
      summaryJson: { value: "x".repeat(32 * 1024) }, now: NOW,
    })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it("does not rewrite revoked or expired routines when kill CAS is attempted", async () => {
    for (const status of ["revoked", "expired"] as const) {
      const fixture = new EngineFixture();
      const rev = revision();
      fixture.revisions.push(rev);
      const row = routine(rev, { status });
      fixture.routines.push(row);
      await expect(engageRoutineKillSwitch(fixture.db(), {
        ownerId: "owner-1", routineId: row.id, expectedRowRevision: 0,
        killedByMembershipId: "membership-1", killReasonCode: "merchant_kill", now: NOW,
      })).rejects.toMatchObject({ code: "CAS_CONFLICT" });
      expect(row).toMatchObject({ status, killSwitchEngaged: false, rowRevision: 0 });
    }
  });
});

it("exports a stable typed error", () => {
  expect(new WorkflowEngineError("CAS_CONFLICT")).toMatchObject({ name: "WorkflowEngineError", code: "CAS_CONFLICT" });
});
