/**
 * Worker entry coverage for resumeOttoAfterGen.
 *
 * This file deliberately keeps the production Otto composition intact. It mocks
 * only the documented OttoRuntimeExecution primitives (`run` and
 * `withLlmBudget`) plus DB IO; `runOttoTurn`, `ottoBudgetArgsFor`,
 * `finalizeOttoTurn`, the production runtimes, RunState restoration, history
 * sanitization, and output projection are the real package implementations.
 */
process.env.OPENAI_AGENTS_DISABLE_TRACING = "1";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const chatThreadFindFirst = vi.fn();
  const chatThreadUpdateMany = vi.fn();
  const genJobUpdateMany = vi.fn();
  const chatMessageFindFirst = vi.fn();
  const chatMessageCreate = vi.fn();
  const run = vi.fn();
  const meter = vi.fn();

  return {
    prisma: {
      chatThread: { findFirst: chatThreadFindFirst, updateMany: chatThreadUpdateMany },
      genJob: { updateMany: genJobUpdateMany },
      chatMessage: { findFirst: chatMessageFindFirst, create: chatMessageCreate },
    },
    chatThreadFindFirst,
    chatThreadUpdateMany,
    genJobUpdateMany,
    chatMessageFindFirst,
    chatMessageCreate,
    run,
    meter,
  };
});

vi.mock("@fikirtive/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fikirtive/db")>()),
  prisma: mocks.prisma,
}));

vi.mock("@fikirtive/otto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fikirtive/otto")>()),
  // The only Otto substitutions are the legal OttoRuntimeExecution seam.
  run: mocks.run,
  withLlmBudget: mocks.meter,
}));

import { llmPricesFor } from "@fikirtive/core";
import {
  MaxTurnsExceededError,
  RunState,
  finalizeOttoTurn,
  otto,
  ottoWorkerVerdictRuntime,
  runOttoTurn,
} from "@fikirtive/otto";
import { resumeOttoAfterGen } from "./otto-resume.js";

const JOB = {
  id: "job-1",
  threadId: "thread-1",
  ownerId: "owner-1",
  projectId: "project-1",
};

const emptyUsage = {
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  inputTokensDetails: [],
  outputTokensDetails: [],
};

/** A real SDK RunState serialization, sufficient for the worker's history-only restore. */
function priorState(content = "make me a poster") {
  const runContext = {
    usage: emptyUsage,
    toJSON: () => ({ context: { orgId: JOB.ownerId }, usage: emptyUsage, approvals: {} }),
  };
  return new RunState(
    runContext as never,
    [{ role: "user", content }] as never,
    otto,
    10,
  ).toString();
}

function makeRunResult(opts: { interruptions?: unknown[]; text?: string; state?: string } = {}) {
  return {
    finalOutput: opts.text ?? "Looks good! Does this meet your expectation?",
    newItems: [],
    interruptions: opts.interruptions ?? [],
    state: {
      toString: () => opts.state ?? "new-serialized-state",
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    },
  };
}

let serializedPriorState: string;

beforeEach(() => {
  vi.clearAllMocks();
  serializedPriorState = priorState();
  mocks.genJobUpdateMany.mockResolvedValue({ count: 1 });
  mocks.chatThreadFindFirst.mockResolvedValue({ ottoState: serializedPriorState });
  mocks.run.mockResolvedValue(makeRunResult());
  mocks.meter.mockImplementation(async (_args: unknown, fn: () => Promise<{ result: unknown }>) => (await fn()).result);
  mocks.chatMessageFindFirst.mockResolvedValue({ seq: 3 });
  mocks.chatMessageCreate.mockResolvedValue({});
  mocks.chatThreadUpdateMany.mockResolvedValue({ count: 1 });
});

describe("worker guards and at-most-once claim", () => {
  it("returns immediately for a non-cowork job", async () => {
    await resumeOttoAfterGen({ ...JOB, threadId: null });
    expect(mocks.chatThreadFindFirst).not.toHaveBeenCalled();
    expect(mocks.genJobUpdateMany).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.meter).not.toHaveBeenCalled();
  });

  it("skips a thread with no state", async () => {
    mocks.chatThreadFindFirst.mockResolvedValue({ ottoState: null });
    await resumeOttoAfterGen(JOB);
    expect(mocks.genJobUpdateMany).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("skips a missing thread", async () => {
    mocks.chatThreadFindFirst.mockResolvedValue(null);
    await resumeOttoAfterGen(JOB);
    expect(mocks.genJobUpdateMany).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("does not run or persist when another delivery already claimed the job", async () => {
    mocks.genJobUpdateMany.mockResolvedValue({ count: 0 });
    await resumeOttoAfterGen(JOB);

    expect(mocks.genJobUpdateMany).toHaveBeenCalledOnce();
    const [claim] = mocks.genJobUpdateMany.mock.calls[0] as [{
      where: { id: string; ownerId: string; ottoVerdictAt: null };
      data: { ottoVerdictAt: Date };
    }];
    expect(claim.where).toMatchObject({ id: JOB.id, ownerId: JOB.ownerId, ottoVerdictAt: null });
    expect(claim.data.ottoVerdictAt).toBeInstanceOf(Date);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.meter).not.toHaveBeenCalled();
    expect(mocks.chatMessageCreate).not.toHaveBeenCalled();
  });
});

describe("real worker composition seam (PH1F-A1)", () => {
  it("uses the real shared runner/finalizer and derives the complete one-step budget contract", async () => {
    const verdictText = "Does this meet your expectation? Any changes?";
    mocks.run.mockResolvedValue(makeRunResult({ text: verdictText }));

    await resumeOttoAfterGen(JOB);

    // Regression guard against the former fake coverage: neither object under test is a mock.
    expect(vi.isMockFunction(runOttoTurn)).toBe(false);
    expect(vi.isMockFunction(finalizeOttoTurn)).toBe(false);

    expect(mocks.meter).toHaveBeenCalledOnce();
    const [budget] = mocks.meter.mock.calls[0] as [{
      orgId: string;
      refId: string;
      model: string;
      paid: boolean;
      maxSteps: number;
      prices: unknown;
      usageOnError: (error: unknown) => unknown;
    }, unknown];
    expect(budget).toMatchObject({
      orgId: JOB.ownerId,
      refId: `otto-verdict:${JOB.id}`,
      model: "claude-sonnet-4-6",
      paid: true,
      maxSteps: 1,
    });
    expect(budget.prices).toBe(llmPricesFor("claude-sonnet-4-6"));
    const truncated = new MaxTurnsExceededError("max turns");
    (truncated as unknown as { state: unknown }).state = {
      usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 },
    };
    expect(budget.usageOnError(truncated)).toMatchObject({ inputTokens: 7, outputTokens: 3 });
    expect(budget.usageOnError(new Error("boom"))).toBeNull();

    expect(mocks.run).toHaveBeenCalledOnce();
    const [agent, input, options] = mocks.run.mock.calls[0] as [
      unknown,
      Array<{ role: string; content: string }>,
      { context: Record<string, unknown>; maxTurns: number },
    ];
    expect(agent).toBe(ottoWorkerVerdictRuntime.agent);
    expect(ottoWorkerVerdictRuntime.agent.tools).toEqual([]);
    expect(options.maxTurns).toBe(1);
    expect(options.context.startGen).toBeUndefined();
    expect(input[0]).toMatchObject({ role: "user", content: "make me a poster" });
    expect(input.at(-1)?.content).toContain("generation you queued has finished");

    expect(mocks.chatThreadUpdateMany).toHaveBeenCalledOnce();
    const [cas] = mocks.chatThreadUpdateMany.mock.calls[0] as [{
      where: { id: string; ownerId: string; ottoState: string };
      data: { ottoState: string };
    }];
    expect(cas.where).toMatchObject({ id: JOB.threadId, ownerId: JOB.ownerId, ottoState: serializedPriorState });
    expect(cas.data.ottoState).toBe("new-serialized-state");
    expect(mocks.chatMessageCreate).toHaveBeenCalledOnce();
    const [create] = mocks.chatMessageCreate.mock.calls[0] as [{
      data: { role: string; kind: string; text: string; seq: number };
    }];
    expect(create.data).toMatchObject({ role: "AGENT", kind: "TEXT", text: verdictText, seq: 4 });
  });

  it("restores and sanitizes real serialized history before appending the verdict instruction", async () => {
    serializedPriorState = priorState("remember this history");
    mocks.chatThreadFindFirst.mockResolvedValue({ ottoState: serializedPriorState });

    await resumeOttoAfterGen(JOB);

    const [, input] = mocks.run.mock.calls[0] as [unknown, Array<{ role: string; content: string }>];
    expect(input).toHaveLength(2);
    expect(input[0]).toEqual({ role: "user", content: "remember this history" });
    expect(input[1]?.content).toContain("generation you queued has finished");
  });
});

describe("best-effort and persistence behavior", () => {
  it("swallows a metering failure and writes no verdict", async () => {
    mocks.meter.mockRejectedValue(new Error("LLM exploded"));
    await expect(resumeOttoAfterGen(JOB)).resolves.toBeUndefined();
    expect(mocks.chatMessageCreate).not.toHaveBeenCalled();
    expect(mocks.chatThreadUpdateMany).not.toHaveBeenCalled();
  });

  it("swallows a real MaxTurnsExceededError from the injected SDK runner", async () => {
    mocks.run.mockRejectedValue(new MaxTurnsExceededError("max turns exceeded"));
    await expect(resumeOttoAfterGen(JOB)).resolves.toBeUndefined();
    expect(mocks.chatMessageCreate).not.toHaveBeenCalled();
    expect(mocks.chatThreadUpdateMany).not.toHaveBeenCalled();
  });

  it("persists paused state and assistant text for a defensive interruption", async () => {
    const text = "Does that match what you had in mind?";
    mocks.run.mockResolvedValue(makeRunResult({
      text,
      state: "paused-state",
      interruptions: [{ rawItem: { name: "generate", arguments: JSON.stringify({ cardId: "card-abc" }) } }],
    }));

    await resumeOttoAfterGen(JOB);

    const [cas] = mocks.chatThreadUpdateMany.mock.calls[0] as [{ data: { ottoState: string } }];
    expect(cas.data.ottoState).toBe("paused-state");
    const [create] = mocks.chatMessageCreate.mock.calls[0] as [{ data: { role: string; text: string } }];
    expect(create.data).toMatchObject({ role: "AGENT", text });
    const [, , options] = mocks.run.mock.calls[0] as [unknown, unknown, { context: { startGen?: unknown } }];
    expect(options.context.startGen).toBeUndefined();
  });

  it("does not write a verdict when the state CAS loses", async () => {
    mocks.chatThreadUpdateMany.mockResolvedValue({ count: 0 });
    await resumeOttoAfterGen(JOB);
    expect(mocks.chatThreadUpdateMany).toHaveBeenCalledOnce();
    expect(mocks.chatMessageCreate).not.toHaveBeenCalled();
  });

  it("writes a verdict when the state CAS wins", async () => {
    mocks.chatThreadUpdateMany.mockResolvedValue({ count: 1 });
    await resumeOttoAfterGen(JOB);
    expect(mocks.chatMessageCreate).toHaveBeenCalledOnce();
  });

  it("uses the exact prior state as the CAS precondition", async () => {
    serializedPriorState = priorState("specific prior state");
    mocks.chatThreadFindFirst.mockResolvedValue({ ottoState: serializedPriorState });
    await resumeOttoAfterGen(JOB);
    const [cas] = mocks.chatThreadUpdateMany.mock.calls[0] as [{ where: { ottoState: string } }];
    expect(cas.where.ottoState).toBe(serializedPriorState);
  });
});

describe("worker capability boundary", () => {
  it("injects no generation, Meta-write, or Meta-build port", async () => {
    await resumeOttoAfterGen(JOB);
    const [, , options] = mocks.run.mock.calls[0] as [unknown, unknown, { context: Record<string, unknown> }];
    expect(options.context).not.toHaveProperty("startGen");
    expect(options.context).not.toHaveProperty("metaWrite");
    expect(options.context).not.toHaveProperty("approveMetaActionPlan");
    expect(options.context).not.toHaveProperty("runApprovedPlan");
    expect(options.context).not.toHaveProperty("maybeAutoRun");
    expect(options.context).not.toHaveProperty("runAdBuild");
    expect(options.context).not.toHaveProperty("approveAdBuild");
    expect(options.context).not.toHaveProperty("maybeAutoBuild");
    expect(options.context).not.toHaveProperty("metaBuild");
  });

  it("imports no Meta writer or builder", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const source = readFileSync(fileURLToPath(new URL("./otto-resume.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/meta-write|runApprovedPlan|approveMetaActionPlan/);
    expect(source).not.toMatch(/meta-build|runAdBuild|approveAdBuild/);
  });
});
