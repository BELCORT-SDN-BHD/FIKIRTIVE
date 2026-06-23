/**
 * otto-resume.test.ts — TDD tests for resumeOttoAfterGen (Task 1.9).
 *
 * Tests:
 *  1. non-cowork gen (threadId null) → returns immediately, no claim, no run
 *  2. no ottoState → returns, no run
 *  3. at-most-once: genJob.updateMany returns count 0 → no run, no persist
 *  4. happy verdict: claim wins → rehydrates, runs otto inside withLlmBudget, persists verdict + ottoState
 *  5. best-effort: run throws → resumeOttoAfterGen does NOT throw (swallowed), no verdict persisted
 *  6. interrupted verdict: Otto parked a generate → persists paused state, no spend (startGen not injected)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted — create mocks before vi.mock hoisting runs
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => {
  // prisma mock
  const chatThreadFindFirst = vi.fn();
  const genJobUpdateMany = vi.fn();
  const chatMessageFindFirst = vi.fn();
  const chatMessageCreate = vi.fn();
  const chatThreadUpdate = vi.fn();
  const $transaction = vi.fn();

  const prisma = {
    chatThread: {
      findFirst: chatThreadFindFirst,
      update: chatThreadUpdate,
    },
    genJob: {
      updateMany: genJobUpdateMany,
    },
    chatMessage: {
      findFirst: chatMessageFindFirst,
      create: chatMessageCreate,
    },
    $transaction: $transaction,
  };

  // RunState mock
  const runStateMock = {
    history: [{ role: "user", content: "make me a poster" }],
    toString: vi.fn(() => "serialized-state"),
    getInterruptions: vi.fn(() => []),
  };
  const RunState = {
    fromString: vi.fn(async () => runStateMock),
  };

  // run mock
  const run = vi.fn();

  // withLlmBudget mock — by default just calls fn and returns its result.result
  const withLlmBudget = vi.fn(async (_args: unknown, fn: () => Promise<{ result: unknown; usage?: unknown }>) => {
    const out = await fn();
    return out.result;
  });

  // MaxTurnsExceededError mock
  class MaxTurnsExceededError extends Error {
    constructor(msg = "max turns") { super(msg); this.name = "MaxTurnsExceededError"; }
  }

  // mapOttoUsage mock — returns a trivial TokenUsage
  const mapOttoUsage = vi.fn(() => ({ inputTokens: 10, outputTokens: 5 }));

  // otto mock (just a sentinel value)
  const otto = { name: "Otto" };

  // newId mock
  const newId = vi.fn(() => `msg-${Math.random().toString(36).slice(2)}`);

  return {
    prisma,
    RunState,
    runStateMock,
    run,
    withLlmBudget,
    MaxTurnsExceededError,
    mapOttoUsage,
    otto,
    newId,
    chatThreadFindFirst,
    genJobUpdateMany,
    chatMessageFindFirst,
    chatMessageCreate,
    chatThreadUpdate,
    $transaction,
  };
});

vi.mock("@artlio/db", () => ({
  prisma: mocks.prisma,
  newId: mocks.newId,
}));

vi.mock("@artlio/core", () => ({
  newId: mocks.newId,
  OTTO_MAX_STEPS: 10,
}));

vi.mock("@artlio/otto", () => ({
  otto: mocks.otto,
  withLlmBudget: mocks.withLlmBudget,
  OTTO_DEFAULT_MODEL: "claude-sonnet-4-6",
  run: mocks.run,
  RunState: mocks.RunState,
  MaxTurnsExceededError: mocks.MaxTurnsExceededError,
  mapOttoUsage: mocks.mapOttoUsage,
}));

// Import AFTER mocks are registered
import { resumeOttoAfterGen } from "./otto-resume.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
const JOB = {
  id: "job-1",
  threadId: "thread-1",
  ownerId: "owner-1",
  projectId: "project-1",
};

function makeRunResult(opts: { interruptions?: unknown[]; text?: string } = {}) {
  const text = opts.text ?? "Looks good! Does this meet your expectation?";
  const state = {
    toString: () => "new-serialized-state",
    usage: { inputTokens: 100, outputTokens: 50 },
  };
  return {
    finalOutput: text,
    newItems: [],
    interruptions: opts.interruptions ?? [],
    state,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  // Default: claim wins (count=1)
  mocks.genJobUpdateMany.mockResolvedValue({ count: 1 });

  // Default: thread with ottoState
  mocks.chatThreadFindFirst.mockResolvedValue({ ottoState: "prior-state" });

  // Default: RunState.fromString returns the mock state
  mocks.RunState.fromString.mockResolvedValue(mocks.runStateMock);
  mocks.runStateMock.toString.mockReturnValue("new-serialized-state");
  mocks.runStateMock.history = [{ role: "user", content: "make me a poster" }];

  // Default: run returns a completed result
  const defaultResult = makeRunResult();
  mocks.run.mockResolvedValue(defaultResult);

  // Default: withLlmBudget calls fn and returns result
  mocks.withLlmBudget.mockImplementation(async (_args: unknown, fn: () => Promise<{ result: unknown; usage?: unknown }>) => {
    const out = await fn();
    return out.result;
  });

  // Default: last message seq=3
  mocks.chatMessageFindFirst.mockResolvedValue({ seq: 3 });

  // Default: chatMessage.create resolves
  mocks.chatMessageCreate.mockResolvedValue({});

  // Default: chatThread.update resolves
  mocks.chatThreadUpdate.mockResolvedValue({});

  // Default: $transaction runs all ops (accept array of promises)
  mocks.$transaction.mockImplementation(async (ops: unknown) => {
    if (Array.isArray(ops)) return Promise.all(ops);
    if (typeof ops === "function") return ops({});
    return ops;
  });
});

// ---------------------------------------------------------------------------
// Test #1: non-cowork gen (threadId null) → returns immediately
// ---------------------------------------------------------------------------
describe("Test #1 — non-cowork gen (threadId null)", () => {
  it("returns immediately without querying DB or running Otto", async () => {
    await resumeOttoAfterGen({ ...JOB, threadId: null });

    expect(mocks.chatThreadFindFirst).not.toHaveBeenCalled();
    expect(mocks.genJobUpdateMany).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.withLlmBudget).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test #2: no ottoState → returns, no run
// ---------------------------------------------------------------------------
describe("Test #2 — no ottoState", () => {
  it("skips when thread has no ottoState (null)", async () => {
    mocks.chatThreadFindFirst.mockResolvedValue({ ottoState: null });

    await resumeOttoAfterGen(JOB);

    expect(mocks.genJobUpdateMany).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.withLlmBudget).not.toHaveBeenCalled();
  });

  it("skips when thread not found", async () => {
    mocks.chatThreadFindFirst.mockResolvedValue(null);

    await resumeOttoAfterGen(JOB);

    expect(mocks.genJobUpdateMany).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test #3: at-most-once — updateMany returns count=0 → no run, no persist
// ---------------------------------------------------------------------------
describe("Test #3 — at-most-once claim (count=0 = already claimed / redelivery)", () => {
  it("returns immediately when claim count=0; run and persist not called", async () => {
    mocks.genJobUpdateMany.mockResolvedValue({ count: 0 });

    await resumeOttoAfterGen(JOB);

    expect(mocks.genJobUpdateMany).toHaveBeenCalledOnce();
    // Verify the claim targets ottoVerdictAt: null
    const [updateArgs] = mocks.genJobUpdateMany.mock.calls[0] as [{ where: { id: string; ottoVerdictAt: null }; data: { ottoVerdictAt: Date } }];
    expect(updateArgs.where).toMatchObject({ id: JOB.id, ottoVerdictAt: null });
    expect(updateArgs.data.ottoVerdictAt).toBeInstanceOf(Date);

    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.withLlmBudget).not.toHaveBeenCalled();
    expect(mocks.chatMessageCreate).not.toHaveBeenCalled();
    expect(mocks.chatThreadUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test #4: happy verdict — claim wins, rehydrates, runs otto inside withLlmBudget, persists
// ---------------------------------------------------------------------------
describe("Test #4 — happy verdict path", () => {
  it("rehydrates state, calls run inside withLlmBudget, persists verdict message + new ottoState", async () => {
    const verdictText = "Does this meet your expectation? Any changes?";
    const runResult = makeRunResult({ text: verdictText });
    mocks.run.mockResolvedValue(runResult);

    await resumeOttoAfterGen(JOB);

    // Claim must have been made
    expect(mocks.genJobUpdateMany).toHaveBeenCalledOnce();

    // RunState.fromString called with the agent + prior state string
    expect(mocks.RunState.fromString).toHaveBeenCalledWith(mocks.otto, "prior-state");

    // withLlmBudget was called (run is INSIDE it)
    expect(mocks.withLlmBudget).toHaveBeenCalledOnce();
    const [budgetArgs] = mocks.withLlmBudget.mock.calls[0] as [{ orgId: string; refId: string; model: string; paid: boolean; maxSteps: number }, unknown];
    expect(budgetArgs.orgId).toBe(JOB.ownerId);
    expect(budgetArgs.refId).toBe(`otto-verdict:${JOB.id}`);
    expect(budgetArgs.paid).toBe(true);
    expect(budgetArgs.maxSteps).toBe(10);

    // run was called (inside withLlmBudget)
    expect(mocks.run).toHaveBeenCalledOnce();

    // $transaction called for persist (verdict + ottoState)
    expect(mocks.$transaction).toHaveBeenCalledOnce();

    // Verify chatMessage.create was called (verdict message)
    expect(mocks.chatMessageCreate).toHaveBeenCalledOnce();
    const [createArgs] = mocks.chatMessageCreate.mock.calls[0] as [{ data: { role: string; kind: string; text: string; seq: number } }];
    expect(createArgs.data.role).toBe("AGENT");
    expect(createArgs.data.kind).toBe("TEXT");
    expect(createArgs.data.text).toBe(verdictText);

    // Verify chatThread.update was called with new state
    expect(mocks.chatThreadUpdate).toHaveBeenCalledOnce();
    const [updateArgs] = mocks.chatThreadUpdate.mock.calls[0] as [{ where: { id: string }; data: { ottoState: string } }];
    expect(updateArgs.data.ottoState).toBe("new-serialized-state");
  });

  it("the run input includes the injection message appended to history", async () => {
    const runResult = makeRunResult();
    mocks.run.mockResolvedValue(runResult);

    await resumeOttoAfterGen(JOB);

    const [_agent, input] = mocks.run.mock.calls[0] as [unknown, Array<{ role: string; content: string }>];
    // Last item in input must be the injection message
    const lastItem = input[input.length - 1]!;
    expect(lastItem.role).toBe("user");
    expect(lastItem.content).toContain("generation you queued has finished");
    // Prior history items come before it
    expect(input.length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Test #5: best-effort — run throws → does NOT throw, no verdict persisted
// ---------------------------------------------------------------------------
describe("Test #5 — best-effort (run throws)", () => {
  it("does NOT throw when withLlmBudget throws; no verdict message persisted", async () => {
    mocks.withLlmBudget.mockRejectedValue(new Error("LLM exploded"));

    // Must not throw
    await expect(resumeOttoAfterGen(JOB)).resolves.toBeUndefined();

    // No verdict persisted
    expect(mocks.chatMessageCreate).not.toHaveBeenCalled();
    expect(mocks.chatThreadUpdate).not.toHaveBeenCalled();
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it("does NOT throw when run throws MaxTurnsExceededError", async () => {
    mocks.withLlmBudget.mockImplementation(async (_args: unknown, fn: () => Promise<{ result: unknown; usage?: unknown }>) => {
      // Simulate MaxTurnsExceededError propagating out of fn
      throw new mocks.MaxTurnsExceededError("max turns exceeded");
    });

    await expect(resumeOttoAfterGen(JOB)).resolves.toBeUndefined();

    expect(mocks.chatMessageCreate).not.toHaveBeenCalled();
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test #6: interrupted verdict — Otto parked a generate → persists paused state, no spend
// ---------------------------------------------------------------------------
describe("Test #6 — interrupted verdict (Otto parked a generate)", () => {
  it("persists paused ottoState + any assistant text; startGen is NOT in context (no spend)", async () => {
    const assistantText = "Got it! Before I generate, I just wanted to check — does that match what you had in mind?";
    const interruption = { name: "generate", arguments: JSON.stringify({ cardId: "card-abc" }) };
    const runResult = {
      finalOutput: assistantText,
      newItems: [],
      interruptions: [interruption],
      state: {
        toString: () => "paused-state",
        usage: { inputTokens: 50, outputTokens: 20 },
      },
    };
    mocks.run.mockResolvedValue(runResult);

    await resumeOttoAfterGen(JOB);

    // Paused state persisted via chatThread.update
    expect(mocks.chatThreadUpdate).toHaveBeenCalledOnce();
    const [updateArgs] = mocks.chatThreadUpdate.mock.calls[0] as [{ where: { id: string }; data: { ottoState: string } }];
    expect(updateArgs.data.ottoState).toBe("paused-state");

    // Assistant text before interruption was persisted
    expect(mocks.chatMessageCreate).toHaveBeenCalledOnce();
    const [createArgs] = mocks.chatMessageCreate.mock.calls[0] as [{ data: { text: string; role: string } }];
    expect(createArgs.data.text).toBe(assistantText);
    expect(createArgs.data.role).toBe("AGENT");

    // $transaction NOT used (interruption path uses separate update + create, not $transaction)
    // (or if implementation batches it in $transaction, check it was called — either is fine
    // as long as paused state is persisted and no generation spend occurs)

    // Verify startGen is NOT in the context passed to run
    const [_agent, _input, runOptions] = mocks.run.mock.calls[0] as [unknown, unknown, { context: { startGen?: unknown } }];
    expect(runOptions.context.startGen).toBeUndefined();
  });
});
