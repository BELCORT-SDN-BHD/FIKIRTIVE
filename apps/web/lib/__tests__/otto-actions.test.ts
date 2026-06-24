/**
 * otto-actions.test.ts — Unit tests for ottoTurn + mapOttoUsage (Task 1.8a)
 *                         and ottoApprove (Task 1.8b)
 *
 * Mocks: @fikirtive/otto `run`/`RunState`/`MaxTurnsExceededError`, @fikirtive/db prisma,
 * requireOwner, withLlmBudget, resolveDisabledModels, revalidatePath.
 * No real DB needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mock primitives (available before vi.mock factories run) ─────────

const {
  mockRequireOwner,
  mockResolveDisabledModels,
  mockStartGen,
  mockProjectFindFirst,
  mockGenerationFindFirst,
  mockChatThreadFindFirst,
  mockChatThreadCreate,
  mockChatThreadUpdate,
  mockChatThreadUpdateMany,
  mockChatMessageFindFirst,
  mockChatMessageCreate,
  mockGenJobFindFirst,
  mockTransaction,
  mockRun,
  mockRunStateFromString,
  mockRunStateToString,
  mockWithLlmBudget,
  MockRunState,
  MockMaxTurnsExceededError,
  mockApprove,
  mockGetInterruptions,
} = vi.hoisted(() => {
  const mockRunStateToString = vi.fn(() => '{"mocked":"state"}');
  const mockRunStateFromString = vi.fn();
  const mockApprove = vi.fn();
  const mockGetInterruptions = vi.fn(() => [] as unknown[]);

  class MockRunState {
    history: unknown[];
    usage: {
      inputTokens: number;
      outputTokens: number;
      requestUsageEntries?: Array<{ inputTokens: number; outputTokens: number; inputTokensDetails: Record<string, number> }>;
    };
    constructor(history: unknown[] = [], usage = { inputTokens: 10, outputTokens: 5, requestUsageEntries: [] as Array<{ inputTokens: number; outputTokens: number; inputTokensDetails: Record<string, number> }> }) {
      this.history = history;
      this.usage = usage;
    }
    toString() { return mockRunStateToString(); }
    static fromString = mockRunStateFromString;
    getInterruptions() { return mockGetInterruptions(); }
    approve(item: unknown, opts?: unknown) { return mockApprove(item, opts); }
  }

  class MockMaxTurnsExceededError extends Error {
    constructor(msg = "Max turns exceeded") {
      super(msg);
      this.name = "MaxTurnsExceededError";
    }
  }

  const mockWithLlmBudget = vi.fn(async (_args: unknown, fn: () => Promise<{ result: unknown; usage?: unknown }>) => {
    const out = await fn();
    return (out as { result: unknown }).result;
  });

  return {
    mockRequireOwner: vi.fn(),
    mockResolveDisabledModels: vi.fn(),
    mockStartGen: vi.fn(),
    mockProjectFindFirst: vi.fn(),
    mockGenerationFindFirst: vi.fn(),
    mockChatThreadFindFirst: vi.fn(),
    mockChatThreadCreate: vi.fn(),
    mockChatThreadUpdate: vi.fn(),
    mockChatThreadUpdateMany: vi.fn(),
    mockChatMessageFindFirst: vi.fn(),
    mockChatMessageCreate: vi.fn(),
    mockGenJobFindFirst: vi.fn(),
    mockTransaction: vi.fn(),
    mockRun: vi.fn(),
    mockRunStateFromString,
    mockRunStateToString,
    mockWithLlmBudget,
    MockRunState,
    MockMaxTurnsExceededError,
    mockApprove,
    mockGetInterruptions,
  };
});

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/model-registry", () => ({ resolveDisabledModels: mockResolveDisabledModels }));
vi.mock("@/lib/gen-actions", () => ({ startGen: mockStartGen }));

vi.mock("@fikirtive/db", () => ({
  prisma: {
    project: { findFirst: mockProjectFindFirst },
    generation: { findFirst: mockGenerationFindFirst },
    chatThread: {
      findFirst: mockChatThreadFindFirst,
      create: mockChatThreadCreate,
      update: mockChatThreadUpdate,
      updateMany: mockChatThreadUpdateMany,
    },
    chatMessage: {
      findFirst: mockChatMessageFindFirst,
      create: mockChatMessageCreate,
    },
    genJob: {
      findFirst: mockGenJobFindFirst,
    },
    $transaction: mockTransaction,
  },
}));

// Spread the REAL module so pure helpers (mapOttoUsage, OTTO_DEFAULT_MODEL, prices)
// stay real — only the heavy / non-deterministic exports are mocked. MaxTurnsExceededError
// stays mocked so a thrown MockMaxTurnsExceededError matches `instanceof` in the SUT.
vi.mock("@fikirtive/otto", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    otto: { name: "Otto" },
    withLlmBudget: mockWithLlmBudget,
    run: mockRun,
    RunState: MockRunState,
    MaxTurnsExceededError: MockMaxTurnsExceededError,
  };
});

// ── Import SUT after mocks ───────────────────────────────────────────────────

const { ottoTurn, mapOttoUsage, buildOttoContext, ottoApprove } = await import("@/lib/otto-actions");

// ── Shared fixtures ──────────────────────────────────────────────────────────

const OWNER_ID = "owner_abc";
const PROJECT_ID = "proj_abc";
const THREAD_ID = "thread_abc";

const GATE = { ownerId: OWNER_ID, email: "user@test.com" };

const BASE_INPUT = { projectId: PROJECT_ID, text: "Make something cool" };

function makeMockResult({
  interruptions = [] as unknown[],
  finalOutput = "Hello from Otto",
  history = [] as unknown[],
  usage = { inputTokens: 10, outputTokens: 5, requestUsageEntries: [] as Array<{ inputTokens: number; outputTokens: number; inputTokensDetails: Record<string, number> }> },
  stateStr = '{"mocked":"state"}',
  newItems = [] as unknown[],
} = {}) {
  const state = new MockRunState(history, usage);
  state.toString = () => stateStr;
  return {
    interruptions,
    finalOutput,
    history,
    newItems,
    state,
  };
}

function setupHappyPath() {
  mockRequireOwner.mockResolvedValue(GATE);
  mockResolveDisabledModels.mockResolvedValue(new Set());
  mockProjectFindFirst.mockResolvedValue({ id: PROJECT_ID });
  mockGenerationFindFirst.mockResolvedValue(null);
  mockChatThreadCreate.mockResolvedValue({});
  mockChatMessageCreate.mockResolvedValue({});
  mockChatMessageFindFirst.mockResolvedValue(null); // seq=0
  mockRun.mockResolvedValue(makeMockResult());
  mockTransaction.mockImplementation(async (ops: unknown[]) => {
    for (const op of ops) {
      if (op !== null && typeof op === "object" && "then" in op && typeof (op as { then?: unknown }).then === "function") {
        await (op as Promise<unknown>);
      }
    }
  });
  // Re-establish withLlmBudget to call through (cleared by vi.clearAllMocks in beforeEach)
  mockWithLlmBudget.mockImplementation(async (_args: unknown, fn: () => Promise<{ result: unknown; usage?: unknown }>) => {
    const out = await fn();
    return (out as { result: unknown }).result;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockChatThreadUpdateMany.mockResolvedValue({ count: 1 });
});

// ── Test 1: new thread ────────────────────────────────────────────────────────

describe("ottoTurn — new thread", () => {
  it("creates ChatThread, persists USER msg, runs Otto, persists reply + ottoState", async () => {
    setupHappyPath();

    const res = await ottoTurn(BASE_INPUT);

    expect(res).toEqual({ threadId: expect.any(String), status: "done", reply: "Hello from Otto" });

    // ChatThread was created (new thread)
    expect(mockChatThreadCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ projectId: PROJECT_ID, ownerId: OWNER_ID }),
      }),
    );

    // USER message persisted
    expect(mockChatMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: "USER", kind: "TEXT", text: BASE_INPUT.text }),
      }),
    );

    // run() was called
    expect(mockRun).toHaveBeenCalled();

    // ottoState persisted + AGENT reply (via $transaction for completed run).
    // Assert the ACTUAL ottoState write was constructed (not just that $transaction ran) —
    // prisma.chatThread.update(...) is invoked to build the tx array, so its mock records it
    // even though the $transaction mock doesn't execute the ops. This catches a regression
    // that drops the state persistence (conversation continuity would silently break).
    expect(mockTransaction).toHaveBeenCalled();
    expect(mockChatThreadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ottoState: expect.any(String) }) }),
    );
    // The AGENT reply message was constructed in the completed path.
    expect(mockChatMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: "AGENT", kind: "TEXT", text: "Hello from Otto" }),
      }),
    );
  });
});

// ── Test 2: continuing thread ────────────────────────────────────────────────

describe("ottoTurn — continuing thread", () => {
  it("loads prior ottoState and feeds it to run() as history + new message", async () => {
    setupHappyPath();
    const priorState = '{"prior":"state"}';
    const priorHistory = [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }];

    mockChatThreadFindFirst.mockResolvedValue({ projectId: PROJECT_ID, ottoState: priorState });
    mockChatMessageFindFirst.mockResolvedValue({ seq: 2 });

    const mockPriorState = new MockRunState(priorHistory);
    mockRunStateFromString.mockResolvedValue(mockPriorState);

    const res = await ottoTurn({ ...BASE_INPUT, threadId: THREAD_ID });

    expect(res).toMatchObject({ status: "done" });

    // RunState.fromString called with the stored state string
    expect(mockRunStateFromString).toHaveBeenCalledWith(
      expect.anything(),
      priorState,
    );

    // run() called with the prior history + new user message
    const runArgs = mockRun.mock.calls[0];
    expect(runArgs[1]).toEqual([
      ...priorHistory,
      expect.objectContaining({ role: "user", content: BASE_INPUT.text }),
    ]);
  });
});

// ── Test 3: ownerId reaches context ──────────────────────────────────────────

describe("buildOttoContext", () => {
  it("puts requireOwner's ownerId into ctx.orgId and injects startGen", async () => {
    mockResolveDisabledModels.mockResolvedValue(new Set(["bad-model"]));

    const ctx = await buildOttoContext({
      ownerId: "owner_xyz",
      projectId: "proj_xyz",
      threadId: "thread_xyz",
      sourceGenerationId: "gen_xyz",
    });

    expect(ctx.orgId).toBe("owner_xyz");
    expect(ctx.userId).toBe("owner_xyz");
    expect(ctx.projectId).toBe("proj_xyz");
    expect(ctx.threadId).toBe("thread_xyz");
    expect(ctx.sourceGenerationId).toBe("gen_xyz");
    expect(ctx.disabledModels).toEqual(["bad-model"]);
    // startGen is the injected port from gen-actions
    expect(ctx.startGen).toBe(mockStartGen);
  });
});

// ── Test 4: metered — run() happens inside withLlmBudget ─────────────────────

describe("ottoTurn — metered", () => {
  it("calls run() inside withLlmBudget", async () => {
    setupHappyPath();

    let runCalledInsideBudget = false;
    mockWithLlmBudget.mockImplementation(async (_args: unknown, fn: () => Promise<{ result: unknown; usage?: unknown }>) => {
      const out = await fn();
      runCalledInsideBudget = mockRun.mock.calls.length > 0;
      return (out as { result: unknown }).result;
    });

    await ottoTurn(BASE_INPUT);

    expect(mockWithLlmBudget).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: OWNER_ID, model: "claude-sonnet-4-6", paid: true }),
      expect.any(Function),
    );
    expect(runCalledInsideBudget).toBe(true);
  });
});

// ── Test 5: interruption ─────────────────────────────────────────────────────

describe("ottoTurn — interruption (needs_approval)", () => {
  it("returns needs_approval with pendingCardIds, persists paused ottoState, does NOT spend", async () => {
    setupHappyPath();

    const cardId = "card_abc123";
    const mockInterruption = {
      rawItem: { name: "generate" },
      arguments: JSON.stringify({ cardId }),
      type: "tool_approval_item",
    };

    const interruptedResult = makeMockResult({ finalOutput: undefined as unknown as string, newItems: [] });
    // Override interruptions directly
    (interruptedResult as unknown as Record<string, unknown>).interruptions = [mockInterruption];
    (interruptedResult as unknown as Record<string, unknown>).finalOutput = undefined;

    mockRun.mockResolvedValue(interruptedResult);

    const res = await ottoTurn(BASE_INPUT);

    expect(res).toEqual({
      threadId: expect.any(String),
      status: "needs_approval",
      pendingCardIds: [cardId],
    });

    // ottoState was persisted on the thread (update called)
    expect(mockChatThreadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ottoState: expect.any(String) }) }),
    );

    // startGen (the spend gate) was NOT called
    expect(mockStartGen).not.toHaveBeenCalled();
  });
});

// ── Test 6: maxTurns ─────────────────────────────────────────────────────────

describe("ottoTurn — MaxTurnsExceededError", () => {
  it("returns status:degraded with friendly reply, does NOT throw to client", async () => {
    setupHappyPath();

    mockWithLlmBudget.mockImplementation(async (_args: unknown, fn: () => Promise<{ result: unknown; usage?: unknown }>) => {
      // fn() will call mockRun which throws MockMaxTurnsExceededError
      return (await fn() as { result: unknown }).result;
    });
    mockRun.mockRejectedValue(new MockMaxTurnsExceededError());

    const res = await ottoTurn(BASE_INPUT);

    expect(res).toEqual({ threadId: expect.any(String), status: "degraded" });

    // Friendly message persisted
    expect(mockChatMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "AGENT",
          kind: "TEXT",
          text: expect.stringContaining("tangled up"),
        }),
      }),
    );
  });
});

// ── Test 7: mapOttoUsage pure unit ────────────────────────────────────────────

describe("mapOttoUsage", () => {
  it("maps state.usage to correct TokenUsage with cached tokens summed across requests", () => {
    const stateUsage = {
      inputTokens: 1000,
      outputTokens: 200,
      requestUsageEntries: [
        { inputTokens: 600, outputTokens: 100, inputTokensDetails: { cached_tokens: 400 } },
        { inputTokens: 400, outputTokens: 100, inputTokensDetails: { cached_tokens: 100 } },
      ],
    };

    const result = mapOttoUsage(stateUsage);

    expect(result).toEqual({
      inputTokens: 1000,
      outputTokens: 200,
      cachedInputTokens: 500, // 400 + 100
    });
  });

  it("returns undefined cachedInputTokens when no cached_tokens present", () => {
    const stateUsage = {
      inputTokens: 500,
      outputTokens: 100,
      requestUsageEntries: [
        { inputTokens: 500, outputTokens: 100, inputTokensDetails: {} },
      ],
    };

    const result = mapOttoUsage(stateUsage);

    expect(result.cachedInputTokens).toBeUndefined();
  });

  it("handles missing requestUsageEntries gracefully", () => {
    const stateUsage = { inputTokens: 300, outputTokens: 150 };
    const result = mapOttoUsage(stateUsage);
    expect(result).toEqual({ inputTokens: 300, outputTokens: 150, cachedInputTokens: undefined });
  });
});

// ── ottoApprove tests (Task 1.8b) ─────────────────────────────────────────────

const CARD_ID = "card_xyz123";
const APPROVE_THREAD_ID = "thread_approve_abc";

/** Build a mock RunToolApprovalItem-like object for `generate` with the given cardId */
function makeApprovalItem(cardId: string, toolName = "generate") {
  return {
    type: "tool_approval_item" as const,
    name: toolName,
    arguments: JSON.stringify({ cardId }),
    rawItem: { name: toolName, arguments: JSON.stringify({ cardId }) },
  };
}

function setupApproveHappyPath(approvalItem = makeApprovalItem(CARD_ID)) {
  mockRequireOwner.mockResolvedValue(GATE);
  mockResolveDisabledModels.mockResolvedValue(new Set());

  // Thread with paused ottoState
  mockChatThreadFindFirst.mockResolvedValue({
    id: APPROVE_THREAD_ID,
    projectId: PROJECT_ID,
    ottoState: '{"paused":"state"}',
  });

  // Rehydrated state has the pending interruption
  const mockState = new MockRunState();
  mockGetInterruptions.mockReturnValue([approvalItem]);
  mockRunStateFromString.mockResolvedValue(mockState);

  // No existing genJob (first approve)
  mockGenJobFindFirst.mockResolvedValue(null);

  // Resume run returns completed result
  const completedResult = makeMockResult({ finalOutput: "Generation started!" });
  mockRun.mockResolvedValue(completedResult);

  // withLlmBudget calls through
  mockWithLlmBudget.mockImplementation(async (_args: unknown, fn: () => Promise<{ result: unknown; usage?: unknown }>) => {
    const out = await fn();
    return (out as { result: unknown }).result;
  });

  mockChatMessageFindFirst.mockResolvedValue({ seq: 5 });
  mockChatMessageCreate.mockResolvedValue({});
  mockChatThreadUpdate.mockResolvedValue({});
  mockTransaction.mockImplementation(async (ops: unknown[]) => {
    for (const op of ops) {
      if (op !== null && typeof op === "object" && "then" in op && typeof (op as { then?: unknown }).then === "function") {
        await (op as Promise<unknown>);
      }
    }
  });
}

// Test 1.8b-1: happy approve → resumes via ctx.startGen, inside withLlmBudget
describe("ottoApprove — happy path (approve → resume → spend via startGen)", () => {
  it("calls state.approve then run() inside withLlmBudget; persists result", async () => {
    setupApproveHappyPath();

    let runCalledInsideBudget = false;
    mockWithLlmBudget.mockImplementation(async (_args: unknown, fn: () => Promise<{ result: unknown; usage?: unknown }>) => {
      const out = await fn();
      runCalledInsideBudget = mockRun.mock.calls.length > 0;
      return (out as { result: unknown }).result;
    });

    const res = await ottoApprove({ threadId: APPROVE_THREAD_ID, cardId: CARD_ID });

    expect(res).toMatchObject({ ok: true, status: "done" });

    // state.approve was called with the matching interruption
    expect(mockApprove).toHaveBeenCalledWith(expect.objectContaining({ name: "generate" }), undefined);

    // run() was called (resume)
    expect(mockRun).toHaveBeenCalled();

    // resume happened inside withLlmBudget
    expect(mockWithLlmBudget).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: OWNER_ID, paid: true }),
      expect.any(Function),
    );
    expect(runCalledInsideBudget).toBe(true);

    // ottoState persisted via CAS updateMany
    expect(mockChatThreadUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ottoState: expect.any(String) }) }),
    );
  });
});

// Test 1.8b-2: cardId mismatch → reject, no approve, no spend
describe("ottoApprove — cardId mismatch → reject", () => {
  it("returns {error} when pending generate has a different cardId, approve NOT called", async () => {
    setupApproveHappyPath(makeApprovalItem("card_DIFFERENT"));
    // We're approving CARD_ID but the pending interruption is for card_DIFFERENT

    const res = await ottoApprove({ threadId: APPROVE_THREAD_ID, cardId: CARD_ID });

    expect(res).toMatchObject({ error: expect.any(String) });
    expect(mockApprove).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
  });
});

// Test 1.8b-3: double-approve / already-generated → returns existing job benignly
describe("ottoApprove — double-approve (already generated)", () => {
  it("returns existing job benignly when no pending interruption but genJob exists", async () => {
    mockRequireOwner.mockResolvedValue(GATE);
    mockChatThreadFindFirst.mockResolvedValue({
      id: APPROVE_THREAD_ID,
      projectId: PROJECT_ID,
      ottoState: '{"paused":"state"}',
    });

    const mockState = new MockRunState();
    // No pending interruptions (already approved/resolved)
    mockGetInterruptions.mockReturnValue([]);
    mockRunStateFromString.mockResolvedValue(mockState);

    // Existing genJob found
    mockGenJobFindFirst.mockResolvedValue({ id: "job_existing_123", status: "QUEUED" });

    const res = await ottoApprove({ threadId: APPROVE_THREAD_ID, cardId: CARD_ID });

    expect(res).toMatchObject({ ok: true, genJobId: "job_existing_123", status: "QUEUED" });
    // No second spend — approve and run must NOT be called
    expect(mockApprove).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
  });
});

// Test 1.8b-4: owner scope — thread not owned → {error}
describe("ottoApprove — owner scope", () => {
  it("returns {error} when thread is not found for this owner", async () => {
    mockRequireOwner.mockResolvedValue(GATE);
    mockChatThreadFindFirst.mockResolvedValue(null); // not found / not owned

    const res = await ottoApprove({ threadId: "thread_not_mine", cardId: CARD_ID });

    expect(res).toMatchObject({ error: expect.any(String) });
    expect(mockRunStateFromString).not.toHaveBeenCalled();
    expect(mockApprove).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
  });
});

// Test 1.8b-5: no ottoState → {error: "Nothing to approve."}
describe("ottoApprove — no ottoState", () => {
  it("returns {error: 'Nothing to approve.'} when thread has null ottoState", async () => {
    mockRequireOwner.mockResolvedValue(GATE);
    mockChatThreadFindFirst.mockResolvedValue({
      id: APPROVE_THREAD_ID,
      projectId: PROJECT_ID,
      ottoState: null,
    });

    const res = await ottoApprove({ threadId: APPROVE_THREAD_ID, cardId: CARD_ID });

    expect(res).toEqual({ error: "Nothing to approve." });
    expect(mockRunStateFromString).not.toHaveBeenCalled();
  });
});

// Test 1.8b-6: resume metered — run happens inside withLlmBudget
describe("ottoApprove — resume metered", () => {
  it("wraps resume run() in withLlmBudget with correct args", async () => {
    setupApproveHappyPath();

    const budgetCallArgs: unknown[] = [];
    let runCalledInsideBudget = false;
    mockWithLlmBudget.mockImplementation(async (args: unknown, fn: () => Promise<{ result: unknown; usage?: unknown }>) => {
      budgetCallArgs.push(args);
      const out = await fn();
      runCalledInsideBudget = mockRun.mock.calls.length > 0;
      return (out as { result: unknown }).result;
    });

    await ottoApprove({ threadId: APPROVE_THREAD_ID, cardId: CARD_ID });

    // withLlmBudget called once (the resume turn metering)
    expect(mockWithLlmBudget).toHaveBeenCalledOnce();
    expect(budgetCallArgs[0]).toMatchObject({
      orgId: OWNER_ID,
      paid: true,
      refId: expect.stringContaining("otto-approve"),
    });
    // run() was called inside the budget callback
    expect(runCalledInsideBudget).toBe(true);
  });
});

// ── Test CAS: stale ottoState ─────────────────────────────────────────────────

describe("ottoTurn — CAS miss → stale", () => {
  it("returns 'stale' when ottoState moved on (CAS miss), no AGENT message written", async () => {
    mockRequireOwner.mockResolvedValue({ ownerId: "o1" });
    mockResolveDisabledModels.mockResolvedValue(new Set());
    mockProjectFindFirst.mockResolvedValue({ id: "p1", ownerId: "o1" });
    mockChatThreadFindFirst.mockResolvedValue({ projectId: "p1", ottoState: '{"prior":"x"}' });
    mockChatMessageFindFirst.mockResolvedValue({ seq: 2 });
    mockRunStateFromString.mockResolvedValue(new MockRunState([{ role: "user", content: "hi" }]));
    mockRun.mockResolvedValue({ state: new MockRunState(), newItems: [], finalOutput: "ok", interruptions: [] });
    mockChatThreadUpdateMany.mockResolvedValue({ count: 0 }); // someone else wrote first
    mockWithLlmBudget.mockImplementation(async (_args: unknown, fn: () => Promise<{ result: unknown; usage?: unknown }>) => {
      const out = await fn();
      return (out as { result: unknown }).result;
    });
    mockChatMessageCreate.mockResolvedValue({});
    const res = await ottoTurn({ threadId: "t1", projectId: "p1", text: "hi", entityIds: [], variantSel: {} });
    expect(res).toEqual({ threadId: "t1", status: "stale" });
    expect(mockChatMessageCreate).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: "AGENT", kind: "TEXT" }) }));
  });
});

// ── Test CAS: interruption path CAS miss writes no orphan message ─────────────

describe("ottoTurn — interruption CAS miss → stale, no orphan AGENT message", () => {
  it("returns stale and does NOT write an AGENT chatMessage when CAS misses on interruption path", async () => {
    mockRequireOwner.mockResolvedValue({ ownerId: "o1" });
    mockResolveDisabledModels.mockResolvedValue(new Set());
    mockProjectFindFirst.mockResolvedValue({ id: "p1", ownerId: "o1" });
    mockChatThreadFindFirst.mockResolvedValue({ projectId: "p1", ottoState: '{"prior":"x"}' });
    mockChatMessageFindFirst.mockResolvedValue({ seq: 2 });
    mockRunStateFromString.mockResolvedValue(new MockRunState([{ role: "user", content: "hi" }]));

    // run() returns a generate interruption (not completed)
    const interruptionItem = {
      rawItem: { name: "generate" },
      arguments: JSON.stringify({ cardId: "card_orphan_test" }),
      type: "tool_approval_item",
    };
    mockRun.mockResolvedValue({
      state: new MockRunState(),
      newItems: [],
      finalOutput: "some text before park",
      interruptions: [interruptionItem],
    });

    // CAS misses — another turn already moved the state
    mockChatThreadUpdateMany.mockResolvedValue({ count: 0 });

    mockWithLlmBudget.mockImplementation(async (_args: unknown, fn: () => Promise<{ result: unknown; usage?: unknown }>) => {
      const out = await fn();
      return (out as { result: unknown }).result;
    });
    mockChatMessageCreate.mockResolvedValue({});

    const res = await ottoTurn({ threadId: "t1", projectId: "p1", text: "hi", entityIds: [], variantSel: {} });

    // Must return stale, not needs_approval
    expect(res).toEqual({ threadId: "t1", status: "stale" });

    // No AGENT message must have been written (the orphan guard)
    expect(mockChatMessageCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "AGENT" }) }),
    );
  });
});

describe("ottoApprove — interruption CAS miss → stale, no orphan AGENT message", () => {
  it("returns stale and does NOT write an AGENT chatMessage when CAS misses on chained interruption path", async () => {
    mockRequireOwner.mockResolvedValue(GATE);
    mockResolveDisabledModels.mockResolvedValue(new Set());

    mockChatThreadFindFirst.mockResolvedValue({
      id: APPROVE_THREAD_ID,
      projectId: PROJECT_ID,
      ottoState: '{"paused":"state"}',
    });

    const approvalItem = makeApprovalItem(CARD_ID);
    const mockState = new MockRunState();
    mockGetInterruptions.mockReturnValue([approvalItem]);
    mockRunStateFromString.mockResolvedValue(mockState);

    mockGenJobFindFirst.mockResolvedValue(null);

    // Resume produces another interruption (chained approval)
    const chainedInterruption = {
      rawItem: { name: "generate" },
      arguments: JSON.stringify({ cardId: "card_chained" }),
      type: "tool_approval_item",
    };
    mockRun.mockResolvedValue({
      state: new MockRunState(),
      newItems: [],
      finalOutput: "intermediate text",
      interruptions: [chainedInterruption],
    });

    // CAS misses
    mockChatThreadUpdateMany.mockResolvedValue({ count: 0 });

    mockWithLlmBudget.mockImplementation(async (_args: unknown, fn: () => Promise<{ result: unknown; usage?: unknown }>) => {
      const out = await fn();
      return (out as { result: unknown }).result;
    });
    mockChatMessageCreate.mockResolvedValue({});
    mockChatMessageFindFirst.mockResolvedValue({ seq: 5 });

    const res = await ottoApprove({ threadId: APPROVE_THREAD_ID, cardId: CARD_ID });

    // Must return stale, not needs_approval
    expect(res).toEqual({ ok: true, status: "stale" });

    // No AGENT message must have been written (the orphan guard)
    expect(mockChatMessageCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "AGENT" }) }),
    );
  });
});
