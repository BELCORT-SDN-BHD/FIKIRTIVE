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
  const reserveCreditsUpTo = vi.fn();
  const settleCredits = vi.fn();
  const refundReservation = vi.fn();
  return {
    transaction,
    reserveCredits,
    reserveCreditsUpTo,
    settleCredits,
    refundReservation,
    prisma: { $transaction: transaction },
  };
});

vi.mock("@fikirtive/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fikirtive/db")>()),
  prisma: meterMocks.prisma,
  reserveCredits: meterMocks.reserveCredits,
  reserveCreditsUpTo: meterMocks.reserveCreditsUpTo,
  settleCredits: meterMocks.settleCredits,
  refundReservation: meterMocks.refundReservation,
}));

import { z } from "zod";
import { Agent, RunState, Usage, MaxTurnsExceededError, run as sdkRun } from "@openai/agents";
import type { Model, ModelRequest, ModelResponse, StreamEvent } from "@openai/agents";
import {
  OTTO_MAX_STEPS,
  OTTO_OUTPUT_CAP_TOKENS,
  OTTO_CONVERSATION_TURN_RESERVE_INTERNAL,
  OTTO_CHAT_MIN_START_INTERNAL,
  llmPricesFor,
  ottoLlmMargin,
  turnBudgetInternal,
} from "@fikirtive/core";
import {
  createOttoRuntime,
  runOttoTurn,
  finalizeOttoTurn,
  ottoBudgetArgsFor,
  type OttoModelRuntime,
  type OttoRuntimeDeps,
} from "./runtime.js";
import { ottoModel, ottoModelRuntime, OTTO_PRIMARY_MODEL, OTTO_FALLBACK_MODEL, OTTO_DEFAULT_MODEL } from "./model.js";
import { otto, ottoInteractiveRuntime, ottoApprovalResumeRuntime } from "./otto.js";
import { actualCostInternal, mapOttoUsage, withLlmBudget } from "./meter.js";
import { defineOttoSkill } from "./skill.js";
import { tryRestoreRunStateWithContext } from "./run-input.js";
import { allSkills } from "./registry.js";
import { ottoInstructions } from "./instructions.js";
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
  // #898: the conversation turn reserves through reserveCreditsUpTo; resolve the hold it took.
  meterMocks.reserveCreditsUpTo.mockResolvedValue(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL);
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

  // #791-4: the tool-less `worker-verdict` profile is gone with the automatic
  // post-generation Review round it existed for. Every remaining profile carries the
  // full toolset at OTTO_MAX_STEPS — which is what the three cases above now pin.

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

  it("#543: the conversation turn carries the 40-internal hold cap (was a 120-internal hold)", () => {
    const args = ottoBudgetArgsFor(ottoInteractiveRuntime, { orgId: "org_1", refId: "otto-turn:m1", input: "x" });
    expect(args.reserveCapInternal).toBe(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL);
    expect(args.reserveCapInternal).toBe(40);
    // The worst case it caps, at the live prices/margin/steps.
    expect(turnBudgetInternal(llmPricesFor("claude-sonnet-4-6"), ottoLlmMargin(), OTTO_MAX_STEPS)).toBe(120);
  });

  it("#543: the approval-resume turn carries the same cap (same conversation, same hold)", () => {
    const args = ottoBudgetArgsFor(ottoApprovalResumeRuntime, { orgId: "o", refId: "otto-turn:m2", input: "x" });
    expect(args.reserveCapInternal).toBe(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL);
  });

  it("#898: the conversation turn also carries the 1-credit entry minimum, so the hold can fit a small balance", () => {
    const args = ottoBudgetArgsFor(ottoInteractiveRuntime, { orgId: "org_1", refId: "otto-turn:m1", input: "x" });
    expect(args.reserveMinInternal).toBe(OTTO_CHAT_MIN_START_INTERNAL);
    expect(args.reserveMinInternal).toBe(10);
    // The pair is what makes 3.9 credits sendable: gate at 10, hold at min(40, 39).
    expect(args.reserveMinInternal).toBeLessThan(args.reserveCapInternal!);
  });

  it("#898: the approval-resume turn carries the same minimum (same conversation, same door)", () => {
    const args = ottoBudgetArgsFor(ottoApprovalResumeRuntime, { orgId: "o", refId: "otto-turn:m2", input: "x" });
    expect(args.reserveMinInternal).toBe(OTTO_CHAT_MIN_START_INTERNAL);
  });

  it("fixture-no-charge manifest → paid:false (the ONLY way to a no-charge run is the manifest itself)", () => {
    const rt = createOttoRuntime(
      { modelRuntime: fixtureModelRuntime(fakeTextModel("x")), skills: [] },
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
    expect(ottoInteractiveRuntime.modelRuntime).toBe(ottoModelRuntime);
    expect(ottoApprovalResumeRuntime.modelRuntime).toBe(ottoModelRuntime);
    expect(ottoInteractiveRuntime.agent.tools.length).toBe(allSkills.length);
    expect(ottoApprovalResumeRuntime.agent.tools.length).toBe(allSkills.length);
    expect(ottoInteractiveRuntime.maxTurns).toBe(OTTO_MAX_STEPS);
    expect(ottoApprovalResumeRuntime.maxTurns).toBe(OTTO_MAX_STEPS);
  });

  it("three ambient selector-like env names are not inputs to the explicit composition API", () => {
    const keys = ["OTTO_MODEL_RUNTIME", "OTTO_BILLABLE_MODEL", "OTTO_MODEL"] as const;
    const saved = keys.map((k) => [k, process.env[k]] as const);
    try {
      process.env.OTTO_MODEL_RUNTIME = "fixture-no-charge";
      process.env.OTTO_BILLABLE_MODEL = "fixture-no-charge";
      process.env.OTTO_MODEL = "cli";
      const rt = createOttoRuntime(
        { modelRuntime: ottoModelRuntime, skills: [] },
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
      { modelRuntime: paidFixtureModelRuntime(fakeTextModel("partial")), skills: [] },
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

    // #898: the conversation turn reserves through reserveCreditsUpTo (hold = min(cap, balance)).
    // The claim is unchanged — exactly one reservation, then a full refund.
    expect(meterMocks.reserveCreditsUpTo).toHaveBeenCalledOnce();
    expect(meterMocks.reserveCredits).not.toHaveBeenCalled();
    expect(meterMocks.refundReservation).toHaveBeenCalledOnce();
    expect(meterMocks.refundReservation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: "org_t", refId: "paid:stream-error" }),
    );
    expect(meterMocks.settleCredits).not.toHaveBeenCalled();
    expect(meterMocks.reserveCreditsUpTo.mock.invocationCallOrder[0]).toBeLessThan(
      meterMocks.refundReservation.mock.invocationCallOrder[0]!,
    );
  });

  it("drains onStream before awaiting completed and reads usage only afterward", async () => {
    const order: string[] = [];
    let markDrainStarted!: () => void;
    let releaseDrain!: () => void;
    const drainStarted = new Promise<void>((resolve) => { markDrainStarted = resolve; });
    const drainGate = new Promise<void>((resolve) => { releaseDrain = resolve; });
    const modelRuntime = Object.freeze({
      ...paidFixtureModelRuntime(fakeTextModel("unused")),
      mapUsage: (usage: Parameters<typeof mapOttoUsage>[0]) => {
        order.push("usage");
        return mapOttoUsage(usage);
      },
    });
    const runtime = createOttoRuntime({ modelRuntime, skills: [] }, "interactive");
    const streamResult = {
      async *[Symbol.asyncIterator]() {
        order.push("drain-start");
        markDrainStarted();
        yield { type: "raw_model_stream_event" };
        await drainGate;
        order.push("drain-complete");
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
      meter: withLlmBudget,
      maxTurnsExceededError: MaxTurnsExceededError,
    };

    const turn = runOttoTurn(
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

    await drainStarted;
    await new Promise<void>((resolve) => setImmediate(resolve));
    const orderBeforeDrainRelease = [...order];
    releaseDrain();
    await turn;

    expect(orderBeforeDrainRelease).toEqual(["drain-start"]);
    expect(order).toEqual(["drain-start", "drain-complete", "completed", "usage"]);
    const actualInternal = actualCostInternal(
      { inputTokens: 3, outputTokens: 2 },
      llmPricesFor("claude-sonnet-4-6"),
      ottoLlmMargin(),
    );
    expect(meterMocks.settleCredits).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: "org_t",
        refId: "fixture:stream-order",
        actualInternal,
      }),
    );
  });
});

// ── §17 Phase 1 Done: fake provider through the SHARED runner ────────────────

describe("runOttoTurn — fake provider through the shared runner ($0 fixture)", () => {
  it("fresh interactive: executes a SAFE skill end-to-end and finalizes", async () => {
    const log: string[] = [];
    const deps: OttoRuntimeDeps = {
      modelRuntime: fixtureModelRuntime(fakeToolCallingModel("echoBrand", { q: "brand colors" }, "Echoed!")),
      skills: [makeSafeSkill(log)],
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

    // The production DB round-trip: serialize, restore against the approval-resume agent, carrying
    // the live context (#566 — a fromString restore would resume with the ports stripped).
    const restored = (await tryRestoreRunStateWithContext(resume.agent, fin1.newOttoState, baseCtx))!;
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
    // Exact pre-seam construction shape: standalone Agent, same name/instructions/settings,
    // and the full production tool registry. It is intentionally not built by the new factory.
    const legacyModelRuntime = fixtureModelRuntime(
      fakeToolCallingModel("approveScheduledPost", { scheduledPostId: "sp_legacy" }, "legacy-unused"),
    );
    const legacyAgent = new Agent<OttoContext>({
      name: "Otto",
      instructions: ottoInstructions,
      model: legacyModelRuntime.binding,
      modelSettings: { maxTokens: OTTO_OUTPUT_CAP_TOKENS },
      tools: allSkills.map((skill) => skill.tool),
    });
    const legacyRuntime = Object.freeze({
      profile: "interactive" as const,
      modelRuntime: legacyModelRuntime,
      agent: legacyAgent,
      maxTurns: OTTO_MAX_STEPS,
    });
    const parkedResult = await runOttoTurn(
      { orgId: "org_t", refId: "fixture:legacy-park", input: "approve the legacy post" },
      baseCtx,
      legacyRuntime,
    );
    const serialized = finalizeOttoTurn(parkedResult, legacyRuntime).newOttoState;

    const restored = (await tryRestoreRunStateWithContext(ottoApprovalResumeRuntime.agent, serialized, baseCtx))!;
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

  // #791-4: the single-step, tool-less verdict leg is gone with the automatic Review
  // round. A text-only run through the shared finalizer is still covered by the
  // eval-profile legs above.
});

// ── #566: a resumed run must carry the LIVE context (injected ports survive) ──
//
// Production bug (5 weeks, 3 clicks, 0 generations, 0 log lines): the approve path restored the
// parked RunState with RunState.fromString and only THEN built the context. The serialized state is
// JSON, so the restored context had lost every function field, and run() ignores options.context for
// a resumed state — so the rebuilt one was never consulted. `generate` hit its fail-closed
// `if (!ctx.startGen) throw` guard, the SDK folded that throw into the tool's return value, and the
// merchant was told to press the button they had just pressed.
//
// These tests run the REAL SDK serialize→restore→approve→resume cycle (a fake model at the provider
// edge only). No RunState double: a mock is exactly what let CI stay green through this bug.
describe("#566 — resume carries the live context", () => {
  /** Test-only gated skill shaped like the real spend gate: its work is reachable ONLY through an
   *  injected function port, and it runs the same fail-closed guard as
   *  packages/otto/src/skills/generate.ts ("startGen port required"). */
  function makePortGatedSkill(log: string[]) {
    return defineOttoSkill({
      name: "approveScheduledPost", // a registry approval name, so the park is a real gated park
      cost: "free",
      effect: "write",
      reach: "external",
      description: "Test-only gated skill that can only work through an injected port.",
      parameters: z.object({ scheduledPostId: z.string() }),
      execute: async (input, runContext) => {
        const ctx = runContext.context as OttoContext;
        if (!ctx.startGen) throw new Error("startGen port required");
        const port = await ctx.startGen({ id: input.scheduledPostId } as never);
        log.push(`${input.scheduledPostId}:${JSON.stringify(port)}:${ctx.approvalConsent?.expectedUpdatedAt ?? "-"}`);
        return { ok: true };
      },
    });
  }

  /** A live context: the scalars survive JSON, the port does not. */
  function liveCtx(): OttoContext {
    return {
      ...baseCtx,
      startGen: async () => ({ id: "job_1", disposition: "fresh" as const }),
    };
  }

  /** Park the gated call and return the serialized state + the two runtimes, exactly as production
   *  persists it on ChatThread.ottoState. */
  async function parkGatedCall(log: string[]) {
    const deps: OttoRuntimeDeps = {
      modelRuntime: fixtureModelRuntime(
        fakeToolCallingModel("approveScheduledPost", { scheduledPostId: "sp_1" }, "Done!"),
      ),
      skills: [makePortGatedSkill(log)],
    };
    const interactive = createOttoRuntime(deps, "interactive");
    const resume = createOttoRuntime(deps, "approval-resume");
    const parked = await runOttoTurn(
      { orgId: "org_t", refId: "fixture:566-park", input: "do it" },
      liveCtx(),
      interactive,
    );
    const fin = finalizeOttoTurn(parked, interactive);
    expect(fin.interrupted).toBe(true);
    expect(log).toEqual([]);
    return { serialized: fin.newOttoState, resume };
  }

  it("SDK truth: fromString drops the ports and run() IGNORES options.context on a resumed state", async () => {
    const log: string[] = [];
    const { serialized, resume } = await parkGatedCall(log);

    // The exact pre-fix production sequence: restore without a context, then hand the freshly built
    // live context to run() as an option.
    const restored = await RunState.fromString(resume.agent, serialized);
    expect((restored as unknown as { _context: { context: OttoContext } })._context.context.startGen)
      .toBeUndefined(); // JSON kept the scalars, dropped the port
    restored.approve(restored.getInterruptions()[0]!);

    const ctx = liveCtx();
    const resumed = await sdkRun(resume.agent, restored, { context: ctx, maxTurns: OTTO_MAX_STEPS });

    expect(log).toEqual([]); // the port was NEVER reached — this is #566
    // …and the failure is invisible: the throw came back as the tool's own result text.
    expect(resumed.state.toString()).toContain("startGen port required");
  });

  it("tryRestoreRunStateWithContext re-attaches the live ports, so the approved tool reaches them", async () => {
    const log: string[] = [];
    const { serialized, resume } = await parkGatedCall(log);
    const ctx = liveCtx();

    const restored = await tryRestoreRunStateWithContext(resume.agent, serialized, ctx);
    expect(restored).not.toBeNull();
    restored!.approve(restored!.getInterruptions()[0]!);

    const resumed = await runOttoTurn(
      { orgId: "org_t", refId: "fixture:566-resume", input: restored! },
      ctx,
      resume,
    );
    const fin = finalizeOttoTurn(resumed, resume);

    expect(log).toEqual([`sp_1:{"id":"job_1","disposition":"fresh"}:-`]); // port called exactly once
    expect(fin.interrupted).toBe(false);
    expect(fin.text).toBe("Done!");
  });

  it("fields assigned to the context AFTER the restore still reach the tool (late-bound consent)", async () => {
    // ottoApprove can only compute the hash-time consent snapshot and the factory attemptId once it
    // has inspected the restored interruptions, so it assigns them onto the already-restored
    // context. That works only because the state holds the context BY REFERENCE — assert it does.
    const log: string[] = [];
    const { serialized, resume } = await parkGatedCall(log);
    const ctx = liveCtx();

    const restored = (await tryRestoreRunStateWithContext(resume.agent, serialized, ctx))!;
    restored.approve(restored.getInterruptions()[0]!);
    ctx.approvalConsent = { scheduledPostId: "sp_1", expectedUpdatedAt: "2026-07-31T00:00:00.000Z" };

    await runOttoTurn({ orgId: "org_t", refId: "fixture:566-late", input: restored }, ctx, resume);

    expect(log).toEqual([`sp_1:{"id":"job_1","disposition":"fresh"}:2026-07-31T00:00:00.000Z`]);
  });

  /** A BILLABLE resume runtime. The $0 fixture manifest short-circuits withLlmBudget entirely
   *  (`paid:false` ⇒ no reserve, no settle), which would make "reserveCredits was not called" true
   *  no matter what the guard did. Billing must be genuinely reachable for that assertion to mean
   *  anything, so the guard tests below run on a paid manifest and prove reachability first. */
  function paidResumeRuntime(log: string[]) {
    const deps: OttoRuntimeDeps = {
      modelRuntime: paidFixtureModelRuntime(
        fakeToolCallingModel("approveScheduledPost", { scheduledPostId: "sp_1" }, "Done!"),
      ),
      skills: [makePortGatedSkill(log)],
    };
    return createOttoRuntime(deps, "approval-resume");
  }

  it("the shared runner REFUSES a resumed state whose context is not the live one (fail-closed, no reservation)", async () => {
    const log: string[] = [];
    const { serialized } = await parkGatedCall(log);
    const paidResume = paidResumeRuntime(log);
    const restored = await RunState.fromString(paidResume.agent, serialized);
    restored.approve(restored.getInterruptions()[0]!);

    // Control: on this very runtime a fresh run DOES reserve — so the assertion below is real.
    // #898: a conversation turn reserves through reserveCreditsUpTo, so that is the live seam.
    meterMocks.reserveCredits.mockClear();
    meterMocks.reserveCreditsUpTo.mockClear();
    await runOttoTurn({ orgId: "org_t", refId: "fixture:566-control", input: "hi" }, liveCtx(), paidResume);
    expect(meterMocks.reserveCreditsUpTo).toHaveBeenCalled();

    meterMocks.reserveCredits.mockClear();
    meterMocks.reserveCreditsUpTo.mockClear();
    await expect(
      runOttoTurn({ orgId: "org_t", refId: "fixture:566-guard", input: restored }, liveCtx(), paidResume),
    ).rejects.toThrow(/tryRestoreRunStateWithContext/);

    expect(log).toEqual([]);
    // Refused before any spend or model call — neither reserve seam fired.
    expect(meterMocks.reserveCreditsUpTo).not.toHaveBeenCalled();
    expect(meterMocks.reserveCredits).not.toHaveBeenCalled();
  });

  // #566 R2 review: the first version of the guard only compared identity when `_context.context`
  // happened to be readable, so a missing field — an SDK internal reshape, a second incompatible
  // SDK copy, or a test double — waved the run straight through into metering. The classification
  // is now positive: string/array = fresh, anything else = resume and must prove its context.
  it("refuses a resume-shaped input that exposes NO comparable context, instead of waving it into billing", async () => {
    const paidResume = paidResumeRuntime([]);
    meterMocks.reserveCredits.mockClear();
    meterMocks.reserveCreditsUpTo.mockClear();

    const outcomes: string[] = [];
    for (const shapeless of [{}, { _context: null }, { _context: {} }, { _context: { context: undefined } }]) {
      await runOttoTurn(
        { orgId: "org_t", refId: "fixture:566-shapeless", input: shapeless as never },
        liveCtx(),
        paidResume,
      ).then(
        () => outcomes.push("RESOLVED — the runner accepted an unverifiable state"),
        (e: unknown) => outcomes.push(e instanceof Error ? e.message : String(e)),
      );
    }

    // The load-bearing consequence of failing OPEN is that billing is entered at all — assert that
    // first, so a regression reads as a money finding rather than a message mismatch.
    // #898: both reserve seams, so a future route change can't quietly move past this guard.
    expect(meterMocks.reserveCreditsUpTo).not.toHaveBeenCalled();
    expect(meterMocks.reserveCredits).not.toHaveBeenCalled();
    for (const outcome of outcomes) expect(outcome).toMatch(/exposes no comparable RunState context/);
  });

  it("still lets the two fresh-input shapes through untouched (string and item array)", async () => {
    const { resume } = await parkGatedCall([]);
    // A fresh run legitimately has no RunState context — the SDK honours options.context there.
    await expect(
      runOttoTurn({ orgId: "org_t", refId: "fixture:566-fresh-string", input: "hello" }, liveCtx(), resume),
    ).resolves.toBeDefined();
    await expect(
      runOttoTurn(
        { orgId: "org_t", refId: "fixture:566-fresh-array", input: [{ role: "user", content: "hello" }] as never },
        liveCtx(),
        resume,
      ),
    ).resolves.toBeDefined();
  });
});
