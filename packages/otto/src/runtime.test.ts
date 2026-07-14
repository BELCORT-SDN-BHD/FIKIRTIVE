/**
 * runtime.test.ts — WO-OTTO-PHASE1 composition seam (engine spec §6.2 / §17 Phase 1).
 *
 * The profile contract matrix at the SHARED RUNNER level plus the manifest
 * single-source proofs:
 *  - PH1-A1: every withLlmBudget parameter (model / paid / maxSteps / prices /
 *    usage mapper) derives from ONE atomic OttoModelRuntime manifest.
 *  - PH1-A2: fresh / stream / approval-resume / worker-verdict all run through the
 *    SAME runOttoTurn + finalizeOttoTurn; a profile only limits tools/steps.
 *  - PH1-A4: worker-verdict = ZERO tools, single step.
 *  - PH1-A5: production composition binds the existing Anthropic model; the runtime
 *    is chosen at composition time, is frozen, and no env/client channel can flip it
 *    to fixture-no-charge.
 *  - §17 Phase 1 Done: a fake provider (fixture manifest, $0) can execute a safe
 *    skill through the shared runner, including the park→approve→resume round-trip.
 */
process.env.OPENAI_AGENTS_DISABLE_TRACING = "1";

import { beforeEach, describe, it, expect, vi } from "vitest";

const meterMocks = vi.hoisted(() => {
  const transaction = vi.fn();
  const reserveCredits = vi.fn();
  const settleCredits = vi.fn();
  const refundReservation = vi.fn();
  return {
    transaction,
    reserveCredits,
    settleCredits,
    refundReservation,
    prisma: { $transaction: transaction },
  };
});

vi.mock("@fikirtive/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fikirtive/db")>()),
  prisma: meterMocks.prisma,
  reserveCredits: meterMocks.reserveCredits,
  settleCredits: meterMocks.settleCredits,
  refundReservation: meterMocks.refundReservation,
}));

import { z } from "zod";
import { RunState, Usage, MaxTurnsExceededError, run as sdkRun } from "@openai/agents";
import type { Model, ModelRequest, ModelResponse, StreamEvent } from "@openai/agents";
import { OTTO_MAX_STEPS, llmPricesFor } from "@fikirtive/core";
import {
  createOttoRuntime,
  runOttoTurn,
  finalizeOttoTurn,
  ottoBudgetArgsFor,
  noopTraceSink,
  type OttoModelRuntime,
  type OttoRuntimeDeps,
} from "./runtime.js";
import { ottoModel, ottoModelRuntime, OTTO_PRIMARY_MODEL, OTTO_FALLBACK_MODEL, OTTO_DEFAULT_MODEL } from "./model.js";
import { otto, ottoVerdict, ottoInteractiveRuntime, ottoApprovalResumeRuntime, ottoWorkerVerdictRuntime } from "./otto.js";
import { mapOttoUsage } from "./meter.js";
import { defineOttoSkill } from "./skill.js";
import { allSkills } from "./registry.js";
import type { OttoContext } from "./context.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const baseCtx: OttoContext = {
  orgId: "org_t",
  userId: "org_t",
  projectId: "proj_t",
  threadId: "thread_t",
  disabledModels: [],
  sourceGenerationId: null,
};

const fakeUsage = () => new Usage({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });

beforeEach(() => {
  vi.clearAllMocks();
  meterMocks.transaction.mockImplementation(async (fn: (tx: Record<string, never>) => Promise<unknown>) => fn({}));
  meterMocks.reserveCredits.mockResolvedValue(undefined);
  meterMocks.settleCredits.mockResolvedValue(undefined);
  meterMocks.refundReservation.mockResolvedValue(undefined);
});

/** Fixture manifest: declares itself non-billable — the runner derives paid:false from it. */
function fixtureModelRuntime(binding: Model): OttoModelRuntime {
  return Object.freeze({
    binding,
    billableModelId: "fixture-no-charge",
    resolvedModelPolicy: Object.freeze({ primaryModelId: "fixture", fallbackModelId: null, failover: "none" as const }),
    mapUsage: mapOttoUsage,
    cacheCapabilities: Object.freeze({ promptCache: false }),
    pricing: llmPricesFor,
  });
}

/** Paid fixture: exercises the real reserve/refund/settle wrapper without a network provider. */
function paidFixtureModelRuntime(binding: Model): OttoModelRuntime {
  return Object.freeze({
    ...fixtureModelRuntime(binding),
    billableModelId: "claude-sonnet-4-6",
  });
}

/** Fake model: one tool call on the first step, a final text message on the next. */
function fakeToolCallingModel(toolName: string, args: Record<string, unknown>, finalText: string): Model {
  let calls = 0;
  return {
    async getResponse(_request: ModelRequest): Promise<ModelResponse> {
      calls += 1;
      if (calls === 1) {
        return {
          usage: fakeUsage(),
          output: [
            {
              type: "function_call" as const,
              callId: "call_1",
              name: toolName,
              arguments: JSON.stringify(args),
              status: "completed" as const,
            },
          ],
        };
      }
      return {
        usage: fakeUsage(),
        output: [
          {
            type: "message" as const,
            role: "assistant" as const,
            status: "completed" as const,
            content: [{ type: "output_text" as const, text: finalText }],
          },
        ],
      };
    },
    async *getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
      const resp = await this.getResponse(request);
      yield {
        type: "response_done",
        response: {
          id: "fake-resp",
          usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
          output: resp.output,
        },
      } as StreamEvent;
    },
  };
}

/** Fake model that only ever speaks text (worker-verdict / stream legs). */
function fakeTextModel(text: string): Model & { calls: () => number } {
  let calls = 0;
  const message = {
    type: "message" as const,
    role: "assistant" as const,
    status: "completed" as const,
    content: [{ type: "output_text" as const, text }],
  };
  return {
    calls: () => calls,
    async getResponse(_request: ModelRequest): Promise<ModelResponse> {
      calls += 1;
      return { usage: fakeUsage(), output: [message] };
    },
    async *getStreamedResponse(_request: ModelRequest): AsyncIterable<StreamEvent> {
      calls += 1;
      yield { type: "output_text_delta", delta: text } satisfies StreamEvent;
      yield {
        type: "response_done",
        response: {
          id: "fake-resp",
          usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
          output: [message],
        },
      } satisfies StreamEvent;
    },
  };
}

/** Test-only SAFE skill: free/read, executes against the run context only. */
function makeSafeSkill(log: string[]) {
  return defineOttoSkill({
    name: "echoBrand",
    cost: "free",
    effect: "read",
    reach: "internal",
    description: "Test-only safe read skill.",
    parameters: z.object({ q: z.string() }),
    execute: async (input, runContext) => {
      log.push(`${runContext.context.orgId}:${input.q}`);
      return { ok: true, echoed: input.q };
    },
  });
}

/** Test-only APPROVAL-GATED skill (write+external ⇒ needsApproval). Named after a real
 *  registry approval tool so collectApprovalInterruptions (registry closed set) sees it. */
function makeGatedSkill(log: string[]) {
  return defineOttoSkill({
    name: "approveScheduledPost",
    cost: "free",
    effect: "write",
    reach: "external",
    description: "Test-only gated skill.",
    parameters: z.object({ scheduledPostId: z.string() }),
    execute: async (input, runContext) => {
      log.push(`${runContext.context.orgId}:${input.scheduledPostId}`);
      return { ok: true };
    },
  });
}

// ── Profile matrix: tools/steps only ─────────────────────────────────────────

describe("createOttoRuntime — profile matrix (profiles only limit tools/steps)", () => {
  const deps: OttoRuntimeDeps = {
    modelRuntime: fixtureModelRuntime(fakeTextModel("hi")),
    skills: [makeSafeSkill([])],
    traceSink: noopTraceSink,
  };

  it("interactive: full toolset, OTTO_MAX_STEPS", () => {
    const rt = createOttoRuntime(deps, "interactive");
    expect(rt.profile).toBe("interactive");
    expect(rt.agent.name).toBe("Otto");
    expect(rt.agent.tools.length).toBe(1);
    expect(rt.maxTurns).toBe(OTTO_MAX_STEPS);
  });

  it("approval-resume: full toolset, OTTO_MAX_STEPS (B9 recovery turns load the full set)", () => {
    const rt = createOttoRuntime(deps, "approval-resume");
    expect(rt.agent.tools.length).toBe(1);
    expect(rt.maxTurns).toBe(OTTO_MAX_STEPS);
  });

  it("eval: same tools and budget as the production interactive profile (§13.3)", () => {
    const rt = createOttoRuntime(deps, "eval");
    expect(rt.agent.tools.length).toBe(1);
    expect(rt.maxTurns).toBe(OTTO_MAX_STEPS);
  });

  it("worker-verdict: ZERO tools, single step (PH1-A4)", () => {
    const rt = createOttoRuntime(deps, "worker-verdict");
    expect(rt.agent.tools).toEqual([]);
    expect(rt.maxTurns).toBe(1);
    expect(ottoBudgetArgsFor(rt, { orgId: "o", refId: "r", input: "x" }).maxSteps).toBe(1);
  });

  it("runtimes are frozen — composition-time injection, immutable for the process lifetime", () => {
    const rt = createOttoRuntime(deps, "interactive");
    expect(Object.isFrozen(rt)).toBe(true);
    expect(() => {
      (rt as unknown as { maxTurns: number }).maxTurns = 99;
    }).toThrow(TypeError);
  });
});

// ── PH1-A1: budget args single-source ────────────────────────────────────────

describe("ottoBudgetArgsFor — every withLlmBudget parameter derives from the manifest (PH1-A1)", () => {
  it("production interactive: model/paid/maxSteps/prices/usage-mapper all from ottoModelRuntime", () => {
    const args = ottoBudgetArgsFor(ottoInteractiveRuntime, { orgId: "org_1", refId: "otto-turn:m1", input: "x" });
    expect(args.orgId).toBe("org_1");
    expect(args.refId).toBe("otto-turn:m1");
    expect(args.model).toBe("claude-sonnet-4-6");
    expect(args.paid).toBe(true);
    expect(args.maxSteps).toBe(OTTO_MAX_STEPS);
    expect(args.prices).toBe(llmPricesFor("claude-sonnet-4-6"));
    // Truncation metering: MaxTurnsExceededError carrying state.usage → ACTUAL usage settle.
    const truncated = new MaxTurnsExceededError("max turns");
    (truncated as unknown as { state: unknown }).state = { usage: { inputTokens: 7, outputTokens: 3 } };
    expect(args.usageOnError?.(truncated)).toMatchObject({ inputTokens: 7, outputTokens: 3 });
    expect(args.usageOnError?.(new MaxTurnsExceededError("no state"))).toBeNull();
    expect(args.usageOnError?.(new Error("boom"))).toBeNull();
  });

  it("production worker-verdict: single-step reserve (maxSteps 1)", () => {
    const args = ottoBudgetArgsFor(ottoWorkerVerdictRuntime, { orgId: "o", refId: "otto-verdict:j1", input: "x" });
    expect(args.maxSteps).toBe(1);
    expect(args.model).toBe("claude-sonnet-4-6");
    expect(args.paid).toBe(true);
  });

  it("fixture-no-charge manifest → paid:false (the ONLY way to a no-charge run is the manifest itself)", () => {
    const rt = createOttoRuntime(
      { modelRuntime: fixtureModelRuntime(fakeTextModel("x")), skills: [], traceSink: noopTraceSink },
      "eval",
    );
    expect(ottoBudgetArgsFor(rt, { orgId: "o", refId: "r", input: "x" }).paid).toBe(false);
  });
});

// ── PH1-A5: production composition root ──────────────────────────────────────

describe("production composition root (PH1-A5)", () => {
  it("manifest single source: binding/billable/policy/usage-mapper/cache/pricing", () => {
    expect(ottoModelRuntime.binding).toBe(ottoModel);
    expect(ottoModelRuntime.billableModelId).toBe(OTTO_DEFAULT_MODEL);
    expect(ottoModelRuntime.billableModelId).toBe("claude-sonnet-4-6");
    expect(ottoModelRuntime.billableModelId).not.toBe("fixture-no-charge");
    expect(ottoModelRuntime.resolvedModelPolicy.primaryModelId).toBe(OTTO_PRIMARY_MODEL);
    expect(ottoModelRuntime.resolvedModelPolicy.fallbackModelId).toBe(OTTO_FALLBACK_MODEL);
    expect(ottoModelRuntime.resolvedModelPolicy.failover).toBe("same-tier-529-only");
    expect(ottoModelRuntime.mapUsage).toBe(mapOttoUsage);
    expect(ottoModelRuntime.pricing).toBe(llmPricesFor);
    expect(ottoModelRuntime.cacheCapabilities.promptCache).toBe(true);
  });

  it("manifest is frozen: runtime mutation cannot flip the billable model", () => {
    expect(Object.isFrozen(ottoModelRuntime)).toBe(true);
    expect(Object.isFrozen(ottoModelRuntime.resolvedModelPolicy)).toBe(true);
    expect(Object.isFrozen(ottoModelRuntime.cacheCapabilities)).toBe(true);
    expect(() => {
      (ottoModelRuntime as unknown as { billableModelId: string }).billableModelId = "fixture-no-charge";
    }).toThrow(TypeError);
  });

  it("legacy singletons ARE the factory's production instances; production profiles share ONE manifest", () => {
    expect(otto).toBe(ottoInteractiveRuntime.agent);
    expect(ottoVerdict).toBe(ottoWorkerVerdictRuntime.agent);
    expect(ottoInteractiveRuntime.modelRuntime).toBe(ottoModelRuntime);
    expect(ottoApprovalResumeRuntime.modelRuntime).toBe(ottoModelRuntime);
    expect(ottoWorkerVerdictRuntime.modelRuntime).toBe(ottoModelRuntime);
    expect(ottoInteractiveRuntime.agent.tools.length).toBe(allSkills.length);
    expect(ottoApprovalResumeRuntime.agent.tools.length).toBe(allSkills.length);
    expect(ottoWorkerVerdictRuntime.agent.tools).toEqual([]);
    expect(ottoInteractiveRuntime.maxTurns).toBe(OTTO_MAX_STEPS);
    expect(ottoApprovalResumeRuntime.maxTurns).toBe(OTTO_MAX_STEPS);
    expect(ottoWorkerVerdictRuntime.maxTurns).toBe(1);
  });

  it("three ambient selector-like env names are not inputs to the explicit composition API", () => {
    const keys = ["OTTO_MODEL_RUNTIME", "OTTO_BILLABLE_MODEL", "OTTO_MODEL"] as const;
    const saved = keys.map((k) => [k, process.env[k]] as const);
    try {
      process.env.OTTO_MODEL_RUNTIME = "fixture-no-charge";
      process.env.OTTO_BILLABLE_MODEL = "fixture-no-charge";
      process.env.OTTO_MODEL = "cli";
      const rt = createOttoRuntime(
        { modelRuntime: ottoModelRuntime, skills: [], traceSink: noopTraceSink },
        "interactive",
      );
      expect(rt.modelRuntime).toBe(ottoModelRuntime);
      expect(rt.modelRuntime.billableModelId).toBe("claude-sonnet-4-6");
      expect(rt.modelRuntime.binding).toBe(ottoModel);
      expect(ottoBudgetArgsFor(rt, { orgId: "o", refId: "r", input: "x" }).paid).toBe(true);
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

// ── PH1F-A2: stream failure money path + settlement ordering ────────────────

describe("runOttoTurn — real meter stream failure and completion ordering (PH1F-A2)", () => {
  it("an onStream throw refunds the full paid reservation and never success-settles", async () => {
    const runtime = createOttoRuntime(
      { modelRuntime: paidFixtureModelRuntime(fakeTextModel("partial")), skills: [], traceSink: noopTraceSink },
      "interactive",
    );

    await expect(runOttoTurn(
      {
        orgId: "org_t",
        refId: "paid:stream-error",
        input: "hello",
        stream: true,
        onStream: async (stream) => {
          for await (const _event of stream) throw new Error("client stream failed");
        },
      },
      baseCtx,
      runtime,
    )).rejects.toThrow("client stream failed");

    expect(meterMocks.reserveCredits).toHaveBeenCalledOnce();
    expect(meterMocks.refundReservation).toHaveBeenCalledOnce();
    expect(meterMocks.settleCredits).not.toHaveBeenCalled();
    expect(meterMocks.reserveCredits.mock.invocationCallOrder[0]).toBeLessThan(
      meterMocks.refundReservation.mock.invocationCallOrder[0]!,
    );
  });

  it("drains onStream before awaiting completed and reads usage only afterward", async () => {
    const order: string[] = [];
    const modelRuntime = Object.freeze({
      ...fixtureModelRuntime(fakeTextModel("unused")),
      mapUsage: (usage: Parameters<typeof mapOttoUsage>[0]) => {
        order.push("usage");
        return mapOttoUsage(usage);
      },
    });
    const runtime = createOttoRuntime({ modelRuntime, skills: [], traceSink: noopTraceSink }, "interactive");
    const streamResult = {
      async *[Symbol.asyncIterator]() {
        order.push("drain");
        yield { type: "raw_model_stream_event" };
      },
      completed: {
        then(resolve: (value: undefined) => void) {
          order.push("completed");
          resolve(undefined);
        },
      },
      state: {
        toString: () => "ordered-state",
        get usage() {
          return { inputTokens: 3, outputTokens: 2, totalTokens: 5 };
        },
      },
      interruptions: [],
      finalOutput: "done",
    };
    const execution = {
      runAgent: vi.fn(async () => streamResult),
      meter: vi.fn(async (_args: unknown, fn: () => Promise<{ result: unknown }>) => (await fn()).result),
      maxTurnsExceededError: MaxTurnsExceededError,
    };

    await runOttoTurn(
      {
        orgId: "org_t",
        refId: "fixture:stream-order",
        input: "hello",
        stream: true,
        onStream: async (stream) => {
          for await (const _event of stream) { /* drain */ }
        },
      },
      baseCtx,
      runtime,
      execution as never,
    );

    expect(order).toEqual(["drain", "completed", "usage"]);
  });
});

// ── §17 Phase 1 Done: fake provider through the SHARED runner ────────────────

describe("runOttoTurn — fake provider through the shared runner ($0 fixture)", () => {
  it("fresh interactive: executes a SAFE skill end-to-end and finalizes", async () => {
    const log: string[] = [];
    const deps: OttoRuntimeDeps = {
      modelRuntime: fixtureModelRuntime(fakeToolCallingModel("echoBrand", { q: "brand colors" }, "Echoed!")),
      skills: [makeSafeSkill(log)],
      traceSink: noopTraceSink,
    };
    const rt = createOttoRuntime(deps, "interactive");

    const result = await runOttoTurn(
      { orgId: "org_t", refId: "fixture:fresh", input: "echo the brand colors" },
      baseCtx,
      rt,
    );
    const fin = finalizeOttoTurn(result, rt);

    expect(log).toEqual(["org_t:brand colors"]); // the skill ran, with ctx identity
    expect(fin.interrupted).toBe(false);
    expect(fin.approvals).toEqual([]);
    expect(fin.text).toBe("Echoed!");
    expect(typeof fin.newOttoState).toBe("string");
    expect(fin.newOttoState.length).toBeGreaterThan(0);
  });

  it("stream leg: drains events through onStream, then finalizes from the completed stream", async () => {
    const events: string[] = [];
    const deps: OttoRuntimeDeps = {
      modelRuntime: fixtureModelRuntime(fakeTextModel("hi there")),
      skills: [],
      traceSink: noopTraceSink,
    };
    const rt = createOttoRuntime(deps, "interactive");

    const result = await runOttoTurn(
      {
        orgId: "org_t",
        refId: "fixture:stream",
        input: "hello",
        stream: true,
        onStream: async (r) => {
          for await (const event of r) events.push(event.type);
        },
      },
      baseCtx,
      rt,
    );
    const fin = finalizeOttoTurn(result, rt);

    expect(events).toContain("raw_model_stream_event");
    expect(fin.interrupted).toBe(false);
    expect(fin.text).toBe("hi there");
    expect(fin.newOttoState.length).toBeGreaterThan(0);
  });

  it("approval-resume: parks the gated call, then the serialize→restore→approve→resume round-trip executes EXACTLY the approved tool", async () => {
    const log: string[] = [];
    const deps: OttoRuntimeDeps = {
      modelRuntime: fixtureModelRuntime(
        fakeToolCallingModel("approveScheduledPost", { scheduledPostId: "sp_1" }, "Approved and scheduled!"),
      ),
      skills: [makeGatedSkill(log)],
      traceSink: noopTraceSink,
    };
    const interactive = createOttoRuntime(deps, "interactive");
    const resume = createOttoRuntime(deps, "approval-resume");

    // Turn 1 (fresh): the gated tool parks — NO execution.
    const r1 = await runOttoTurn({ orgId: "org_t", refId: "fixture:park", input: "approve it" }, baseCtx, interactive);
    const fin1 = finalizeOttoTurn(r1, interactive);
    expect(fin1.interrupted).toBe(true);
    expect(fin1.approvals).toEqual([
      { toolName: "approveScheduledPost", ref: "sp_1", args: { scheduledPostId: "sp_1" } },
    ]);
    expect(log).toEqual([]); // parked, not executed

    // The production DB round-trip: serialize, restore against the approval-resume agent.
    const restored = await RunState.fromString(resume.agent, fin1.newOttoState);
    const parked = restored.getInterruptions();
    expect(parked.length).toBe(1);
    restored.approve(parked[0]!);

    // Turn 2 (approval-resume): the approved tool executes, then the model closes the turn.
    const r2 = await runOttoTurn({ orgId: "org_t", refId: "fixture:resume", input: restored }, baseCtx, resume);
    const fin2 = finalizeOttoTurn(r2, resume);
    expect(log).toEqual(["org_t:sp_1"]); // executed exactly once
    expect(fin2.interrupted).toBe(false);
    expect(fin2.text).toBe("Approved and scheduled!");
  });

  it("restores an old-construction SDK state against the new production approval agent and resumes", async () => {
    // The persisted state is produced by a separately constructed, minimal legacy-shaped
    // Agent. The restore target is the independently composed production runtime Agent.
    const legacyRuntime = createOttoRuntime(
      {
        modelRuntime: fixtureModelRuntime(
          fakeToolCallingModel("approveScheduledPost", { scheduledPostId: "sp_legacy" }, "legacy-unused"),
        ),
        skills: [makeGatedSkill([])],
        traceSink: noopTraceSink,
      },
      "interactive",
    );
    const parkedResult = await runOttoTurn(
      { orgId: "org_t", refId: "fixture:legacy-park", input: "approve the legacy post" },
      baseCtx,
      legacyRuntime,
    );
    const serialized = finalizeOttoTurn(parkedResult, legacyRuntime).newOttoState;

    const restored = await RunState.fromString(ottoApprovalResumeRuntime.agent, serialized);
    expect(restored.currentAgent).toBe(ottoApprovalResumeRuntime.agent);
    expect(restored.currentAgent).not.toBe(legacyRuntime.agent);
    const [interruption] = restored.getInterruptions();
    expect(interruption).toBeDefined();
    restored.approve(interruption!);

    // Never touch the network: only the provider edge is stubbed. SDK resume, pending-tool
    // handling, production Agent/tool lookup, shared runner, and finalizer all remain real.
    const provider = ottoApprovalResumeRuntime.modelRuntime.binding;
    const providerSpy = vi.spyOn(provider, "getResponse").mockResolvedValue({
      usage: fakeUsage(),
      output: [{
        type: "message" as const,
        role: "assistant" as const,
        status: "completed" as const,
        content: [{ type: "output_text" as const, text: "Production agent resumed." }],
      }],
    });
    try {
      const resumedResult = await runOttoTurn(
        { orgId: "org_t", refId: "fixture:legacy-resume", input: restored },
        baseCtx,
        ottoApprovalResumeRuntime,
        {
          runAgent: sdkRun,
          meter: async (_args, fn) => (await fn()).result,
          maxTurnsExceededError: MaxTurnsExceededError,
        },
      );
      const finalized = finalizeOttoTurn(resumedResult, ottoApprovalResumeRuntime);
      expect(finalized.interrupted).toBe(false);
      expect(finalized.text).toBe("Production agent resumed.");
      expect(providerSpy).toHaveBeenCalledOnce();
    } finally {
      providerSpy.mockRestore();
    }
  });

  it("worker-verdict: single model step, zero tools, text extracted by the shared finalizer", async () => {
    const model = fakeTextModel("Does this look right?");
    const deps: OttoRuntimeDeps = {
      modelRuntime: fixtureModelRuntime(model),
      skills: [makeSafeSkill([])], // present in deps — the PROFILE strips them
      traceSink: noopTraceSink,
    };
    const rt = createOttoRuntime(deps, "worker-verdict");
    expect(rt.agent.tools).toEqual([]);

    const result = await runOttoTurn({ orgId: "org_t", refId: "fixture:verdict", input: "verdict?" }, baseCtx, rt);
    const fin = finalizeOttoTurn(result, rt);

    expect(model.calls()).toBe(1); // exactly one step
    expect(fin.interrupted).toBe(false);
    expect(fin.text).toBe("Does this look right?");
  });
});
