/**
 * otto-actions.test.ts — Unit tests for ottoTurn + mapOttoUsage (Task 1.8a)
 *                         and ottoApprove (Task 1.8b)
 *
 * Mocks: @fikirtive/otto `run`/`RunState`/`MaxTurnsExceededError`, @fikirtive/db prisma,
 * requireOwner, withLlmBudget, resolveDisabledModels, revalidatePath.
 * No real DB needed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  mockChatThreadDeleteMany,
  mockChatMessageFindFirst,
  mockChatMessageCreate,
  mockChatMessageDeleteMany,
  mockChatMessageUpdateMany,
  mockScheduledPostFindFirst,
  mockActionEventCreate,
  mockGenJobFindFirst,
  mockGenJobUpdateMany,
  mockResearchJobFindFirst,
  mockResearchJobDeleteMany,
  mockCanvasNodeUpdateMany,
  mockGenerationUpdateMany,
  mockEntityFindMany,
  mockMemoryFindMany,
  mockGetBrandContextText,
  mockExecuteRaw,
  mockTransaction,
  mockRun,
  mockRunStateFromString,
  mockWithLlmBudget,
  MockRunState,
  MockMaxTurnsExceededError,
  mockApprove,
  mockReject,
  mockGetInterruptions,
  mockTavilySearch,
  mockBraveSearch,
  mockSearchWithFallback,
  mockRunVariantBatch,
  mockRunBulkGrid,
} = vi.hoisted(() => {
  const mockRunStateToString = vi.fn(() => '{"mocked":"state"}');
  const mockRunStateFromString = vi.fn();
  const mockApprove = vi.fn();
  const mockReject = vi.fn();
  const mockGetInterruptions = vi.fn(() => [] as unknown[]);
  const mockTavilySearch = vi.fn();
  const mockBraveSearch = vi.fn();
  const mockSearchWithFallback = vi.fn();

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
    reject(item: unknown, opts?: unknown) { return mockReject(item, opts); }
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
    mockChatThreadDeleteMany: vi.fn(),
    mockChatMessageFindFirst: vi.fn(),
    mockChatMessageCreate: vi.fn(),
    mockChatMessageDeleteMany: vi.fn(),
    mockChatMessageUpdateMany: vi.fn(),
    mockScheduledPostFindFirst: vi.fn(),
    mockActionEventCreate: vi.fn(),
    mockGenJobFindFirst: vi.fn(),
    mockGenJobUpdateMany: vi.fn(),
    mockResearchJobFindFirst: vi.fn(),
    mockResearchJobDeleteMany: vi.fn(),
    mockCanvasNodeUpdateMany: vi.fn(),
    mockGenerationUpdateMany: vi.fn(),
    mockEntityFindMany: vi.fn(),
    mockMemoryFindMany: vi.fn(),
    mockGetBrandContextText: vi.fn(),
    mockExecuteRaw: vi.fn(),
    mockTransaction: vi.fn(),
    mockRun: vi.fn(),
    mockRunStateFromString,
    mockWithLlmBudget,
    MockRunState,
    MockMaxTurnsExceededError,
    mockApprove,
    mockReject,
    mockGetInterruptions,
    mockTavilySearch,
    mockBraveSearch,
    mockSearchWithFallback,
    mockRunVariantBatch: vi.fn(),
    mockRunBulkGrid: vi.fn(),
  };
});

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: () => Promise.resolve(false), auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/model-registry", () => ({ resolveDisabledModels: mockResolveDisabledModels }));
vi.mock("@/lib/gen-actions", () => ({ startCoworkGen: mockStartGen }));
vi.mock("@/lib/factory-actions", () => ({ runVariantBatch: mockRunVariantBatch, runBulkGrid: mockRunBulkGrid }));
vi.mock("@/lib/memory-actions", () => ({ getBrandContextText: mockGetBrandContextText }));

vi.mock("@fikirtive/db", () => ({
  prisma: {
    project: { findFirst: mockProjectFindFirst },
    chatThread: {
      findFirst: mockChatThreadFindFirst,
      create: mockChatThreadCreate,
      update: mockChatThreadUpdate,
      updateMany: mockChatThreadUpdateMany,
      deleteMany: mockChatThreadDeleteMany,
    },
    chatMessage: {
      findFirst: mockChatMessageFindFirst,
      create: mockChatMessageCreate,
      deleteMany: mockChatMessageDeleteMany,
      updateMany: mockChatMessageUpdateMany,
    },
    genJob: {
      findFirst: mockGenJobFindFirst,
      updateMany: mockGenJobUpdateMany,
    },
    scheduledPost: { findFirst: mockScheduledPostFindFirst },
    actionEvent: { create: mockActionEventCreate },
    researchJob: { findFirst: mockResearchJobFindFirst, deleteMany: mockResearchJobDeleteMany },
    canvasNode: { updateMany: mockCanvasNodeUpdateMany },
    generation: {
      findFirst: mockGenerationFindFirst,
      updateMany: mockGenerationUpdateMany,
    },
    entity: {
      findMany: mockEntityFindMany,
    },
    memory: {
      findMany: mockMemoryFindMany,
    },
    $executeRaw: mockExecuteRaw,
    $transaction: mockTransaction,
  },
}));

// Spread the REAL module so pure helpers (newId, coworkTurnRequest, OTTO_MAX_STEPS,
// GOAL_PRESETS, isGoalKey, ...) stay real — only the web-search adapters are mocked so
// buildOttoContext's env-key wiring can be tested with ZERO real network calls.
vi.mock("@fikirtive/core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    tavilySearch: mockTavilySearch,
    braveSearch: mockBraveSearch,
    searchWithFallback: mockSearchWithFallback,
  };
});

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
    // tryRestoreRunState (F24) wraps @openai/agents' RunState.fromString directly, so the real
    // helper bypasses the MockRunState override above. Delegate it to MockRunState.fromString so
    // these tests keep controlling restore behavior through mockRunStateFromString.
    tryRestoreRunState: async (_agent: unknown, str: string) => {
      try {
        return await MockRunState.fromString(_agent, str);
      } catch {
        return null;
      }
    },
    MaxTurnsExceededError: MockMaxTurnsExceededError,
  };
});

// ── Import SUT after mocks ───────────────────────────────────────────────────

const { ottoTurn, mapOttoUsage, buildOttoContext, ottoApprove, ottoReject, createEmptyCoworkThread, deleteCoworkThread, setCoworkThreadPinned, finalizeOttoRun } = await import("@/lib/otto-actions");
const { computeApprovalContentHash, factoryBatchApprovalHashFromArgs } = await import("@/lib/approval-content-hash");

// ── Shared fixtures ──────────────────────────────────────────────────────────

const OWNER_ID = "owner_abc";
const PROJECT_ID = "proj_abc";
const THREAD_ID = "thread_abc";

const GATE = { ownerId: OWNER_ID, email: "user@test.com" };

const BASE_INPUT = { projectId: PROJECT_ID, text: "Make something cool" };

const transactionTx = {
  $executeRaw: mockExecuteRaw,
  chatThread: {
    findFirst: mockChatThreadFindFirst,
    create: mockChatThreadCreate,
    update: mockChatThreadUpdate,
    updateMany: mockChatThreadUpdateMany,
    deleteMany: mockChatThreadDeleteMany,
  },
  chatMessage: {
    findFirst: mockChatMessageFindFirst,
    create: mockChatMessageCreate,
    deleteMany: mockChatMessageDeleteMany,
  },
  genJob: {
    findFirst: mockGenJobFindFirst,
    updateMany: mockGenJobUpdateMany,
  },
  researchJob: {
    findFirst: mockResearchJobFindFirst,
    deleteMany: mockResearchJobDeleteMany,
  },
  canvasNode: { updateMany: mockCanvasNodeUpdateMany },
  generation: {
    findFirst: mockGenerationFindFirst,
    updateMany: mockGenerationUpdateMany,
  },
};

async function runTransaction(arg: unknown) {
  if (typeof arg === "function") {
    return (arg as (tx: typeof transactionTx) => Promise<unknown>)(transactionTx);
  }
  if (Array.isArray(arg)) {
    for (const op of arg) {
      if (op !== null && typeof op === "object" && "then" in op && typeof (op as { then?: unknown }).then === "function") {
        await (op as Promise<unknown>);
      }
    }
  }
}

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
  mockTransaction.mockImplementation(runTransaction);
  // Re-establish withLlmBudget to call through (cleared by vi.clearAllMocks in beforeEach)
  mockWithLlmBudget.mockImplementation(async (_args: unknown, fn: () => Promise<{ result: unknown; usage?: unknown }>) => {
    const out = await fn();
    return (out as { result: unknown }).result;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockChatThreadUpdateMany.mockResolvedValue({ count: 1 });
  mockChatThreadDeleteMany.mockResolvedValue({ count: 1 });
  mockChatMessageDeleteMany.mockResolvedValue({ count: 1 });
  mockResearchJobFindFirst.mockResolvedValue(null);
  mockResearchJobDeleteMany.mockResolvedValue({ count: 0 });
  mockCanvasNodeUpdateMany.mockResolvedValue({ count: 0 });
  mockGenerationUpdateMany.mockResolvedValue({ count: 0 });
  mockGenJobUpdateMany.mockResolvedValue({ count: 0 });
  mockExecuteRaw.mockResolvedValue(undefined);
  mockTransaction.mockImplementation(runTransaction);
  // Default: no brand context, no entities, no active job (best-effort baselines)
  mockGetBrandContextText.mockResolvedValue("");
  mockEntityFindMany.mockResolvedValue([]);
  mockGenJobFindFirst.mockResolvedValue(null);
  mockScheduledPostFindFirst.mockResolvedValue(null);
  mockChatMessageUpdateMany.mockResolvedValue({ count: 1 });
  mockActionEventCreate.mockResolvedValue({});
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
    // The injected port binds the persisted GEN_CARD quote before entering startGen.
    expect(ctx.startGen).toBe(mockStartGen);
  });

  it("keeps image refs visible as arrays but hides the image scalar from spend cards when a video ref exists", async () => {
    mockResolveDisabledModels.mockResolvedValue(new Set());

    const ctx = await buildOttoContext({
      ownerId: "owner_xyz",
      projectId: "proj_xyz",
      threadId: "thread_xyz",
      sourceGenerationIds: ["gen_img_1", "gen_img_2"],
      referenceVideoGenerationIds: ["gen_vid_1", "gen_vid_2"],
    });

    expect(ctx.sourceGenerationIds).toEqual(["gen_img_1", "gen_img_2"]);
    expect(ctx.referenceVideoGenerationId).toBe("gen_vid_1");
    expect(ctx.referenceVideoGenerationIds).toEqual(["gen_vid_1", "gen_vid_2"]);
    expect(ctx.sourceGenerationId).toBeNull();
  });
});

// ── Test 3b: research.search env-key wiring (S1) ─────────────────────────────
//
// buildOttoContext wires ctx.research.search off TAVILY_API_KEY / BRAVE_SEARCH_API_KEY:
// no keys -> undefined (not configured); one key -> that provider as primary, no
// fallback; both keys -> Tavily primary + Brave fallback via searchWithFallback.
// The adapter's bare WebSearchResult[] is wrapped as { results: [...] } at this seam.

describe("buildOttoContext — research.search env-key wiring", () => {
  const savedEnv: { TAVILY_API_KEY?: string; BRAVE_SEARCH_API_KEY?: string } = {};

  beforeEach(() => {
    savedEnv.TAVILY_API_KEY = process.env.TAVILY_API_KEY;
    savedEnv.BRAVE_SEARCH_API_KEY = process.env.BRAVE_SEARCH_API_KEY;
    delete process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;
    mockResolveDisabledModels.mockResolvedValue(new Set());
  });

  afterEach(() => {
    if (savedEnv.TAVILY_API_KEY === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = savedEnv.TAVILY_API_KEY;
    if (savedEnv.BRAVE_SEARCH_API_KEY === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
    else process.env.BRAVE_SEARCH_API_KEY = savedEnv.BRAVE_SEARCH_API_KEY;
  });

  it("no keys: search is undefined; readPage and fetchUrl are still wired", async () => {
    const ctx = await buildOttoContext({
      ownerId: "owner_nokeys",
      projectId: "proj_nokeys",
      threadId: "thread_nokeys",
    });

    expect(ctx.research!.search).toBeUndefined();
    expect(typeof ctx.research!.readPage).toBe("function");
    expect(typeof ctx.research!.fetchUrl).toBe("function");
    expect(mockTavilySearch).not.toHaveBeenCalled();
    expect(mockBraveSearch).not.toHaveBeenCalled();
  });

  it("Tavily key only: search is wired via tavilySearch, returns {results}-wrapped, brave unused", async () => {
    process.env.TAVILY_API_KEY = "tvly-test-key";

    const bareResults = [{ title: "t", url: "https://example.com", snippet: "s" }];
    const mockPrimaryFn = vi.fn();
    mockTavilySearch.mockReturnValue(mockPrimaryFn);
    // searchWithFallback(primary, fb) -> a WebSearchFn; stub it to return the bare array
    // so we can assert buildOttoContext wraps it as { results: [...] }.
    mockSearchWithFallback.mockReturnValue(async () => bareResults);

    const ctx = await buildOttoContext({
      ownerId: "owner_tavily",
      projectId: "proj_tavily",
      threadId: "thread_tavily",
    });

    expect(mockTavilySearch).toHaveBeenCalledWith("tvly-test-key");
    expect(mockBraveSearch).not.toHaveBeenCalled();
    expect(typeof ctx.research!.search).toBe("function");

    const result = await ctx.research!.search!("some query");
    expect(result).toEqual({ results: bareResults });
  });

  it("both keys: search wired {results}-wrapped; searchWithFallback fed a Tavily primary + Brave fallback", async () => {
    process.env.TAVILY_API_KEY = "tvly-test-key";
    process.env.BRAVE_SEARCH_API_KEY = "brave-test-key";

    const mockPrimaryFn = vi.fn();
    const mockFallbackFn = vi.fn();
    mockTavilySearch.mockReturnValue(mockPrimaryFn);
    mockBraveSearch.mockReturnValue(mockFallbackFn);
    const bareResults = [{ title: "t2", url: "https://example.com/2", snippet: "s2" }];
    mockSearchWithFallback.mockReturnValue(async () => bareResults);

    const ctx = await buildOttoContext({
      ownerId: "owner_both",
      projectId: "proj_both",
      threadId: "thread_both",
    });

    expect(mockTavilySearch).toHaveBeenCalledWith("tvly-test-key");
    expect(mockBraveSearch).toHaveBeenCalledWith("brave-test-key");
    expect(typeof ctx.research!.search).toBe("function");

    // searchWithFallback composition is wired lazily inside the search closure — invoke it
    // to observe primary=Tavily's fn, fallback=Brave's fn both feeding the fallback compose.
    const result = await ctx.research!.search!("q");
    expect(mockSearchWithFallback).toHaveBeenCalledWith(mockPrimaryFn, mockFallbackFn);
    expect(result).toEqual({ results: bareResults });
  });

  it("Brave key only: search wired via braveSearch as primary, tavily unused", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "brave-test-key";

    const mockPrimaryFn = vi.fn();
    mockBraveSearch.mockReturnValue(mockPrimaryFn);
    const bareResults = [{ title: "t3", url: "https://example.com/3", snippet: "s3" }];
    mockSearchWithFallback.mockReturnValue(async () => bareResults);

    const ctx = await buildOttoContext({
      ownerId: "owner_brave",
      projectId: "proj_brave",
      threadId: "thread_brave",
    });

    expect(mockBraveSearch).toHaveBeenCalledWith("brave-test-key");
    expect(mockTavilySearch).not.toHaveBeenCalled();
    expect(typeof ctx.research!.search).toBe("function");

    const result = await ctx.research!.search!("q");
    // No fallback available when only Brave is present.
    expect(mockSearchWithFallback).toHaveBeenCalledWith(mockPrimaryFn, undefined);
    expect(result).toEqual({ results: bareResults });
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

  it("keys the reservation refId off the UNIQUE user-message id, not threadId:seq (F27)", async () => {
    setupHappyPath();
    await ottoTurn(BASE_INPUT);

    // the USER ChatMessage.create carries a unique newId()
    const userCreate = mockChatMessageCreate.mock.calls.find(
      (c) => (c[0] as { data: { role: string } }).data.role === "USER",
    );
    expect(userCreate).toBeDefined();
    const userMessageId = (userCreate![0] as { data: { id: string } }).data.id;

    const refId = (mockWithLlmBudget.mock.calls[0]![0] as { refId: string }).refId;
    expect(refId).toBe(`otto-turn:${userMessageId}`);
    // NOT the old collidable `otto-turn:<threadId>:<seq>` shape (two concurrent turns could
    // land the same seq → same refId → the second reserveCredits no-ops → an unpaid turn).
    expect(refId).not.toMatch(/^otto-turn:[^:]+:\d+$/);
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

describe("finalizeOttoRun — assistant TEXT seq accounts for tool-persisted cards", () => {
  // proposePack (and propose / propose-meta-action / propose-ad-build) persist card
  // messages MID-run at max(seq)+1. seqAfterUser is a PRE-run snapshot; writing the
  // reply at seqAfterUser+1 collides with the first card, and a reload (ordered by
  // seq) then interleaves the TEXT into the pack, splitting the PackCard grouping.
  it("writes the reply after the thread's REAL max seq, not the pre-run snapshot", async () => {
    mockChatMessageFindFirst.mockResolvedValue({ seq: 6 }); // 3 cards landed at 4/5/6 mid-run
    mockChatThreadUpdateMany.mockResolvedValue({ count: 1 });
    mockChatMessageCreate.mockResolvedValue({});
    const result = { state: new MockRunState(), interruptions: [], finalOutput: "Here is the pack.", newItems: [] };
    const out = await finalizeOttoRun({
      ownerId: OWNER_ID, threadId: THREAD_ID, isNew: false, priorOttoState: "s0",
      result, seqAfterUser: 3,
    });
    expect(out).toEqual({ status: "done", reply: "Here is the pack." });
    expect(mockChatMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: "TEXT", seq: 7 }) }),
    );
  });

  it("still uses seqAfterUser when no tool wrote anything mid-run", async () => {
    mockChatMessageFindFirst.mockResolvedValue({ seq: 3 }); // user msg is still the max
    mockChatThreadUpdateMany.mockResolvedValue({ count: 1 });
    mockChatMessageCreate.mockResolvedValue({});
    const result = { state: new MockRunState(), interruptions: [], finalOutput: "Plain reply.", newItems: [] };
    await finalizeOttoRun({
      ownerId: OWNER_ID, threadId: THREAD_ID, isNew: false, priorOttoState: "s0",
      result, seqAfterUser: 3,
    });
    expect(mockChatMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: "TEXT", seq: 4 }) }),
    );
  });
});

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

// ── Task 4: dynamic context seam — brand memory + entities injected ───────────

describe("ottoTurn — injects brand context + refs as a system message", () => {
  it("includes brand memory text and entity name in the leading system message passed to run()", async () => {
    mockRequireOwner.mockResolvedValue({ ownerId: "o1" });
    mockResolveDisabledModels.mockResolvedValue(new Set());
    mockProjectFindFirst.mockResolvedValue({ id: "p1", ownerId: "o1" });
    mockGenerationFindFirst.mockResolvedValue(null);
    mockChatThreadCreate.mockResolvedValue({});
    mockChatMessageCreate.mockResolvedValue({});
    mockChatMessageFindFirst.mockResolvedValue(null);
    mockChatThreadUpdateMany.mockResolvedValue({ count: 1 });

    // Brand context returns a memory entry
    mockGetBrandContextText.mockResolvedValue("voice: warm, family tone");
    // Entity loader returns one entity
    mockEntityFindMany.mockResolvedValue([{ id: "e1", name: "CocoCandy", type: "PRODUCT" }]);

    mockRun.mockResolvedValue(makeMockResult());
    mockWithLlmBudget.mockImplementation(async (_args: unknown, fn: () => Promise<{ result: unknown; usage?: unknown }>) => {
      const out = await fn();
      return (out as { result: unknown }).result;
    });
    mockTransaction.mockImplementation(async (ops: unknown[]) => {
      for (const op of ops) {
        if (op !== null && typeof op === "object" && "then" in op && typeof (op as { then?: unknown }).then === "function") {
          await (op as Promise<unknown>);
        }
      }
    });

    await ottoTurn({ projectId: "p1", text: "make an ad", entityIds: [], variantSel: {} });

    // run() was called — inspect the input (2nd arg)
    expect(mockRun).toHaveBeenCalled();
    const runInput = mockRun.mock.calls[0][1] as unknown[];
    const sys = (runInput as Array<{ role: string; content: string }>).find((m) => m.role === "system");
    expect(sys).toBeDefined();
    expect(sys!.content).toContain("warm, family tone");
    expect(sys!.content).toContain("CocoCandy");
  });
});

// ── Task 5: goal-intent seeding ───────────────────────────────────────────────

describe("ottoTurn — goalKey seeds opening on new thread", () => {
  it("includes the goal preset opening in the system message for a new thread with goalKey", async () => {
    mockRequireOwner.mockResolvedValue({ ownerId: "o1" });
    mockResolveDisabledModels.mockResolvedValue(new Set());
    mockProjectFindFirst.mockResolvedValue({ id: "p1", ownerId: "o1" });
    mockGenerationFindFirst.mockResolvedValue(null);
    mockChatThreadCreate.mockResolvedValue({});
    mockChatMessageCreate.mockResolvedValue({});
    mockChatMessageFindFirst.mockResolvedValue(null);
    mockChatThreadUpdateMany.mockResolvedValue({ count: 1 });
    mockGetBrandContextText.mockResolvedValue("");
    mockEntityFindMany.mockResolvedValue([]);
    mockRun.mockResolvedValue(makeMockResult());
    mockWithLlmBudget.mockImplementation(async (_args: unknown, fn: () => Promise<{ result: unknown; usage?: unknown }>) => {
      const out = await fn();
      return (out as { result: unknown }).result;
    });
    mockTransaction.mockImplementation(async (ops: unknown[]) => {
      for (const op of ops) {
        if (op !== null && typeof op === "object" && "then" in op && typeof (op as { then?: unknown }).then === "function") {
          await (op as Promise<unknown>);
        }
      }
    });

    // New thread with goalKey = "sell-product"
    await ottoTurn({ projectId: "p1", text: "help me sell", entityIds: [], variantSel: {}, goalKey: "sell-product" });

    expect(mockRun).toHaveBeenCalled();
    const runInput = mockRun.mock.calls[0][1] as Array<{ role: string; content: string }>;
    const sys = runInput.find((m) => m.role === "system");
    expect(sys).toBeDefined();
    // The sell-product opening mentions "product"
    expect(sys!.content).toContain("product");
    // It contains the goal framing prefix
    expect(sys!.content).toContain("Goal for this conversation");
  });
});

// ── Task 6: simple-mode plain-language voice ──────────────────────────────────

describe("ottoTurn — simple-mode injects the plain-language block only when simple:true", () => {
  const baseSetup = () => {
    mockRequireOwner.mockResolvedValue({ ownerId: "o1" });
    mockResolveDisabledModels.mockResolvedValue(new Set());
    mockProjectFindFirst.mockResolvedValue({ id: "p1", ownerId: "o1" });
    mockGenerationFindFirst.mockResolvedValue(null);
    mockChatThreadCreate.mockResolvedValue({});
    mockChatMessageCreate.mockResolvedValue({});
    mockChatMessageFindFirst.mockResolvedValue(null);
    mockChatThreadUpdateMany.mockResolvedValue({ count: 1 });
    mockGetBrandContextText.mockResolvedValue("");
    mockEntityFindMany.mockResolvedValue([]);
    mockRun.mockResolvedValue(makeMockResult());
    mockWithLlmBudget.mockImplementation(async (_a: unknown, fn: () => Promise<{ result: unknown; usage?: unknown }>) => (await fn()).result);
    mockTransaction.mockImplementation(async (ops: unknown[]) => {
      for (const op of ops) {
        if (op !== null && typeof op === "object" && "then" in op && typeof (op as { then?: unknown }).then === "function") await (op as Promise<unknown>);
      }
    });
  };

  it("includes the simple-mode block when simple:true", async () => {
    baseSetup();
    await ottoTurn({ projectId: "p1", text: "make an ad", entityIds: [], variantSel: {}, simple: true });
    const runInput = mockRun.mock.calls[0][1] as Array<{ role: string; content: string }>;
    const sys = runInput.find((m) => m.role === "system");
    expect(sys).toBeDefined();
    expect(sys!.content).toContain("Talking to a beginner");
  });

  it("omits the simple-mode block when simple is not set", async () => {
    baseSetup();
    await ottoTurn({ projectId: "p1", text: "make an ad", entityIds: [], variantSel: {} });
    const runInput = mockRun.mock.calls[0][1] as Array<{ role: string; content: string }>;
    const sys = runInput.find((m) => m.role === "system");
    expect(sys === undefined || !sys.content.includes("Talking to a beginner")).toBe(true);
  });
});

// ── Task 6: createEmptyCoworkThread ──────────────────────────────────────────

// ── Task: activeJob status injection ─────────────────────────────────────────

import { buildContextSystemMessage } from "@/lib/otto-actions";

describe("buildContextSystemMessage — activeJob status injection", () => {
  it("includes 'Current generation status' when activeJob is present", () => {
    const result = buildContextSystemMessage({
      orgId: "o1",
      userId: "o1",
      projectId: "p1",
      threadId: "t1",
      disabledModels: [],
      activeJob: { status: "FAILED", kind: "IMAGE", error: "provider error" },
    });
    expect(result).not.toBeNull();
    expect((result as { content: string }).content).toContain("Current generation status");
    expect((result as { content: string }).content).toContain("NOT charged");
  });

  it("includes 'being made right now' for GENERATING status", () => {
    const result = buildContextSystemMessage({
      orgId: "o1",
      userId: "o1",
      projectId: "p1",
      threadId: "t1",
      disabledModels: [],
      activeJob: { status: "GENERATING", kind: "VIDEO" },
    });
    expect((result as { content: string }).content).toContain("being made right now");
  });

  it("includes 'queued and about to start' for QUEUED status", () => {
    const result = buildContextSystemMessage({
      orgId: "o1",
      userId: "o1",
      projectId: "p1",
      threadId: "t1",
      disabledModels: [],
      activeJob: { status: "QUEUED", kind: "IMAGE" },
    });
    expect((result as { content: string }).content).toContain("queued and about to start");
  });

  it("includes 'finished' for DONE status", () => {
    const result = buildContextSystemMessage({
      orgId: "o1",
      userId: "o1",
      projectId: "p1",
      threadId: "t1",
      disabledModels: [],
      activeJob: { status: "DONE", kind: "IMAGE" },
    });
    expect((result as { content: string }).content).toContain("finished");
  });

  it("returns null when no context fields are set and activeJob is null", () => {
    const result = buildContextSystemMessage({
      orgId: "o1",
      userId: "o1",
      projectId: "p1",
      threadId: "t1",
      disabledModels: [],
      activeJob: null,
    });
    expect(result).toBeNull();
  });
});

describe("createEmptyCoworkThread — validation", () => {
  it("returns {error:'Invalid request.'} and makes no prisma calls when projectId is missing", async () => {
    const res = await createEmptyCoworkThread({ title: "My campaign" });
    expect(res).toEqual({ error: "Invalid request." });
    expect(mockProjectFindFirst).not.toHaveBeenCalled();
    expect(mockChatThreadCreate).not.toHaveBeenCalled();
  });

  it("returns {error:'Invalid request.'} and makes no prisma calls when title is missing", async () => {
    const res = await createEmptyCoworkThread({ projectId: "proj_abc" });
    expect(res).toEqual({ error: "Invalid request." });
    expect(mockProjectFindFirst).not.toHaveBeenCalled();
    expect(mockChatThreadCreate).not.toHaveBeenCalled();
  });

  it("returns {error:'Invalid request.'} when raw is null", async () => {
    const res = await createEmptyCoworkThread(null);
    expect(res).toEqual({ error: "Invalid request." });
    expect(mockProjectFindFirst).not.toHaveBeenCalled();
    expect(mockChatThreadCreate).not.toHaveBeenCalled();
  });

  it("returns {error:'Invalid request.'} when projectId is not a string", async () => {
    const res = await createEmptyCoworkThread({ projectId: 123, title: "My campaign" });
    expect(res).toEqual({ error: "Invalid request." });
    expect(mockProjectFindFirst).not.toHaveBeenCalled();
    expect(mockChatThreadCreate).not.toHaveBeenCalled();
  });
});

describe("createEmptyCoworkThread — owner-scoping / cross-tenant", () => {
  it("returns {error:'Project not found.'} and does NOT create a thread when project is not owned by session owner", async () => {
    mockRequireOwner.mockResolvedValue(GATE); // GATE.ownerId = OWNER_ID = "owner_abc"
    mockProjectFindFirst.mockResolvedValue(null); // project not found for this owner

    const res = await createEmptyCoworkThread({ projectId: PROJECT_ID, title: "My campaign" });

    expect(res).toEqual({ error: "Project not found." });
    expect(mockChatThreadCreate).not.toHaveBeenCalled();
  });

  it("uses the session ownerId (from requireOwner) — never the ownerId supplied in raw", async () => {
    // Attacker passes a forged ownerId in raw (the action should ignore it)
    mockRequireOwner.mockResolvedValue(GATE); // session owner = OWNER_ID
    mockProjectFindFirst.mockResolvedValue(null); // will be null regardless

    await createEmptyCoworkThread({
      projectId: PROJECT_ID,
      title: "Evil title",
      ownerId: "attacker_owner_xyz", // forged — must be ignored
    });

    // prisma.project.findFirst must have been called with the SESSION ownerId, not the forged one
    expect(mockProjectFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerId: OWNER_ID }),
      }),
    );
    // The forged ownerId must NOT appear in any prisma call
    expect(mockProjectFindFirst).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerId: "attacker_owner_xyz" }),
      }),
    );
  });
});

describe("createEmptyCoworkThread — success", () => {
  it("creates a chatThread with the gate ownerId + given projectId + title, returns {id}", async () => {
    mockRequireOwner.mockResolvedValue(GATE);
    mockProjectFindFirst.mockResolvedValue({ id: PROJECT_ID }); // project found
    mockChatThreadCreate.mockResolvedValue({});

    const res = await createEmptyCoworkThread({ projectId: PROJECT_ID, title: "Summer sale" });

    // Returns an id
    expect(res).toEqual({ id: expect.any(String) });

    // chatThread.create called with the gate ownerId (not a forged one), given projectId, and title
    expect(mockChatThreadCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: OWNER_ID,
          projectId: PROJECT_ID,
          title: "Summer sale",
        }),
      }),
    );
  });

  it("truncates title to 80 chars", async () => {
    mockRequireOwner.mockResolvedValue(GATE);
    mockProjectFindFirst.mockResolvedValue({ id: PROJECT_ID });
    mockChatThreadCreate.mockResolvedValue({});

    const longTitle = "A".repeat(120);
    await createEmptyCoworkThread({ projectId: PROJECT_ID, title: longTitle });

    expect(mockChatThreadCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "A".repeat(80),
        }),
      }),
    );
  });
});

describe("deleteCoworkThread — hard delete", () => {
  it("returns not found without mutating when the thread is not owned/live", async () => {
    mockRequireOwner.mockResolvedValue(GATE);
    mockChatThreadFindFirst.mockResolvedValue(null);

    const res = await deleteCoworkThread(THREAD_ID);

    expect(res).toEqual({ error: "Conversation not found." });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockChatThreadDeleteMany).not.toHaveBeenCalled();
  });

  it("deletes messages and the thread instead of soft-deleting deletedAt", async () => {
    mockRequireOwner.mockResolvedValue(GATE);
    mockChatThreadFindFirst.mockResolvedValue({ id: THREAD_ID });

    const res = await deleteCoworkThread(THREAD_ID);

    expect(res).toEqual({ ok: true });
    expect(mockChatThreadFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: THREAD_ID, ownerId: OWNER_ID, deletedAt: null },
      select: { id: true },
    }));
    expect(mockResearchJobDeleteMany).toHaveBeenCalledWith({ where: { ownerId: OWNER_ID, threadId: THREAD_ID } });
    expect(mockCanvasNodeUpdateMany).toHaveBeenCalledWith({ where: { ownerId: OWNER_ID, threadId: THREAD_ID }, data: { threadId: null } });
    expect(mockGenerationUpdateMany).toHaveBeenCalledWith({ where: { ownerId: OWNER_ID, threadId: THREAD_ID }, data: { threadId: null } });
    expect(mockGenJobUpdateMany).toHaveBeenCalledWith({ where: { ownerId: OWNER_ID, threadId: THREAD_ID }, data: { threadId: null } });
    expect(mockChatMessageDeleteMany).toHaveBeenCalledWith({ where: { ownerId: OWNER_ID, threadId: THREAD_ID } });
    expect(mockChatThreadDeleteMany).toHaveBeenCalledWith({ where: { id: THREAD_ID, ownerId: OWNER_ID } });
    expect(mockChatThreadUpdateMany).not.toHaveBeenCalled();
  });

  it("blocks hard delete while research is still running", async () => {
    mockRequireOwner.mockResolvedValue(GATE);
    mockChatThreadFindFirst.mockResolvedValue({ id: THREAD_ID });
    mockResearchJobFindFirst.mockResolvedValue({ id: "research-live" });

    const res = await deleteCoworkThread(THREAD_ID);

    expect(res).toEqual({ error: "Research is still running in this conversation. Delete it after research finishes." });
    expect(mockResearchJobDeleteMany).not.toHaveBeenCalled();
    expect(mockChatMessageDeleteMany).not.toHaveBeenCalled();
    expect(mockChatThreadDeleteMany).not.toHaveBeenCalled();
  });
});

describe("setCoworkThreadPinned", () => {
  it("updates pinnedAt through an owner-scoped write", async () => {
    mockRequireOwner.mockResolvedValue(GATE);
    mockChatThreadFindFirst.mockResolvedValue({ id: THREAD_ID });
    mockChatThreadUpdateMany.mockResolvedValue({ count: 1 });

    const res = await setCoworkThreadPinned(THREAD_ID, true);

    expect(res).toEqual({ ok: true, pinnedAt: expect.any(String) });
    expect(mockChatThreadUpdateMany).toHaveBeenCalledWith({
      where: { id: THREAD_ID, ownerId: OWNER_ID },
      data: { pinnedAt: expect.any(Date) },
    });
  });
});

// ── reference video: per-turn system-message signal ──────────────────────────
describe("buildContextSystemMessage — reference video signal", () => {
  const base = { orgId: "o1", userId: "o1", projectId: "p1", threadId: "t1", disabledModels: [] as string[] };
  it("injects the REFERENCE VIDEO signal when referenceVideoGenerationId is set", () => {
    const result = buildContextSystemMessage({ ...base, referenceVideoGenerationId: "gen_vid" });
    expect(result).not.toBeNull();
    const content = (result as { content: string }).content;
    expect(content).toContain("REFERENCE VIDEO");
    expect(content).toContain('kind:"video"');
  });
  it("mentions multiple reference videos when more than one is attached", () => {
    const result = buildContextSystemMessage({ ...base, referenceVideoGenerationIds: ["gen_vid_1", "gen_vid_2"] });
    expect(result).not.toBeNull();
    const content = (result as { content: string }).content;
    expect(content).toContain("2 REFERENCE VIDEOS");
    expect(content).toContain('kind:"video"');
  });
  it("omits the signal when no reference video is attached", () => {
    const result = buildContextSystemMessage({ ...base });
    // no parts at all → null; and certainly no REFERENCE VIDEO mention
    expect(result === null || !(result as { content: string }).content.includes("REFERENCE VIDEO")).toBe(true);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Universal approval card chain (B4 debt-70, spec §五 5.1·附 + AR1 处方1/2) — the
// five-test clause: ① card persistence (rendered content asserted in
// approval-card-view.test.ts), ② approve→resume→execute chain (hash-verified,
// CAS-consumed + TOCTOU-welded), ③ STATIC decline (zero LLM resume, zero EXTERNAL writes), ④ double-approve /
// double-click idempotency + TTL, ⑤ generate regression (1.8b suite + pins below).
// ─────────────────────────────────────────────────────────────────────────────

const APPROVAL_CARD_MSG_ID = "apcard_msg_1";
const SCHEDULED_POST_ID = "post_sched_1";
const APPROVE_THREAD_ID_2 = "thread_approve_sched";

/** The owner's post as readApprovalConsent reads it (material fields + media order). */
const SCHED_POST_UPDATED_AT = new Date("2026-07-12T10:00:00.000Z");

function schedPostFixture(overrides: Record<string, unknown> = {}) {
  return {
    channel: "instagram",
    caption: "Golden hour drop",
    scheduledAt: new Date("2026-07-15T01:00:00.000Z"),
    scheduledTz: "Asia/Kuala_Lumpur",
    firstComment: null,
    metaTargetId: "tgt_1",
    media: [{ generationId: "g1" }],
    approvedAt: null,
    updatedAt: SCHED_POST_UPDATED_AT,
    ...overrides,
  };
}

const SCHED_POST_HASH = computeApprovalContentHash({
  channel: "instagram",
  scheduledAt: "2026-07-15T01:00:00.000Z",
  caption: "Golden hour drop",
  firstComment: null,
  metaTargetId: "tgt_1",
  mediaGenerationIds: ["g1"],
});

function makeSchedApprovalItem(scheduledPostId: string) {
  return {
    type: "tool_approval_item" as const,
    name: "approveScheduledPost",
    arguments: JSON.stringify({ scheduledPostId }),
    rawItem: { name: "approveScheduledPost", arguments: JSON.stringify({ scheduledPostId }) },
  };
}

function pendingCardPayload(status = "pending", payloadOverrides: Record<string, unknown> = {}) {
  return {
    toolName: "approveScheduledPost",
    ref: SCHEDULED_POST_ID,
    status,
    summary: {
      channel: "instagram",
      caption: "Golden hour drop",
      scheduledAt: "2026-07-15T01:00:00.000Z",
      scheduledTz: "Asia/Kuala_Lumpur",
      mediaCount: 1,
    },
    contentHash: SCHED_POST_HASH,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    ...payloadOverrides,
  };
}

/** Harness for the universal branch: a paused thread whose state parks approveScheduledPost,
 *  an APPROVAL_CARD binding (toolName, ref, contentHash, expiresAt), and the matching post. */
function setupUniversalApprove(
  cardStatus = "pending",
  interruptionItems?: unknown[],
  payloadOverrides: Record<string, unknown> = {},
) {
  mockRequireOwner.mockResolvedValue(GATE);
  mockResolveDisabledModels.mockResolvedValue(new Set());
  mockChatThreadFindFirst.mockResolvedValue({
    id: APPROVE_THREAD_ID_2,
    projectId: PROJECT_ID,
    ottoState: '{"paused":"state"}',
  });
  const mockState = new MockRunState();
  mockGetInterruptions.mockReturnValue(interruptionItems ?? [makeSchedApprovalItem(SCHEDULED_POST_ID)]);
  mockRunStateFromString.mockResolvedValue(mockState);
  mockGenJobFindFirst.mockResolvedValue(null);
  mockScheduledPostFindFirst.mockResolvedValue(schedPostFixture());
  mockChatMessageFindFirst.mockImplementation((args: { where?: { kind?: string } } | undefined) => {
    if (args?.where?.kind === "APPROVAL_CARD") {
      return Promise.resolve({ id: APPROVAL_CARD_MSG_ID, payload: pendingCardPayload(cardStatus, payloadOverrides) });
    }
    return Promise.resolve({ seq: 5 });
  });
  mockChatMessageCreate.mockResolvedValue({});
  mockChatThreadUpdate.mockResolvedValue({});
  mockRun.mockResolvedValue(makeMockResult({ finalOutput: "Done — approved and queued." }));
  mockWithLlmBudget.mockImplementation(async (_args: unknown, fn: () => Promise<{ result: unknown; usage?: unknown }>) => {
    const out = await fn();
    return (out as { result: unknown }).result;
  });
  mockTransaction.mockImplementation(runTransaction);
}

describe("ottoApprove — universal branch (test ②: hash-verified approve → CAS consume → resume → same server action)", () => {
  it("verifies the content hash, consumes the card pending→approved BEFORE the resume, approves the parked item, resumes metered", async () => {
    setupUniversalApprove();

    const res = await ottoApprove({ threadId: APPROVE_THREAD_ID_2, cardId: APPROVAL_CARD_MSG_ID });

    expect(res).toMatchObject({ ok: true, status: "done" });
    // ATOMIC consumption: CAS pins payload.status="pending" in the WHERE (AR1 处方2).
    expect(mockChatMessageUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: APPROVAL_CARD_MSG_ID,
          ownerId: OWNER_ID,
          kind: "APPROVAL_CARD",
          AND: [{ payload: { path: ["status"], equals: "pending" } }],
        }),
        data: expect.objectContaining({ payload: expect.objectContaining({ status: "approved" }) }),
      }),
    );
    // The PARKED approveScheduledPost item was approved (not a generate item).
    expect(mockApprove).toHaveBeenCalledWith(expect.objectContaining({ name: "approveScheduledPost" }), undefined);
    // Resume ran inside withLlmBudget with the approve refId (恢复链 withLlmBudget 计量).
    expect(mockWithLlmBudget).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: OWNER_ID, paid: true, refId: expect.stringContaining("otto-approve") }),
      expect.any(Function),
    );
    expect(mockRun).toHaveBeenCalled();
    // Metering idempotency (AR2 处方2b explicit assertion): exactly ONE reservation per approve.
    expect(mockWithLlmBudget).toHaveBeenCalledTimes(1);
    // Consumption strictly precedes the resume (consume-then-act).
    const consumeOrder = mockChatMessageUpdateMany.mock.invocationCallOrder[0]!;
    const runOrder = mockRun.mock.invocationCallOrder[0]!;
    expect(consumeOrder).toBeLessThan(runOrder);
    // AR2 处方1: the hash-time updatedAt snapshot rides the resume context (ctx.approvalConsent),
    // so the approve skill threads it to the server action's CAS.
    const resumeCtx = (mockRun.mock.calls[0]![2] as { context: { approvalConsent?: unknown } }).context;
    expect(resumeCtx.approvalConsent).toEqual({
      scheduledPostId: SCHEDULED_POST_ID,
      expectedUpdatedAt: SCHED_POST_UPDATED_AT.toISOString(),
    });
  });

  it("AR1 处方2 hash binding: content drift since mint → HARD refuse, no consume, no approve, no run", async () => {
    setupUniversalApprove();
    // The post's caption changed after the card was minted.
    mockScheduledPostFindFirst.mockResolvedValue(schedPostFixture({ caption: "Edited copy" }));

    const res = await ottoApprove({ threadId: APPROVE_THREAD_ID_2, cardId: APPROVAL_CARD_MSG_ID });

    expect(res).toMatchObject({ error: expect.stringMatching(/changed/i) });
    expect(mockChatMessageUpdateMany).not.toHaveBeenCalled(); // NOT consumed — re-approvable after review
    expect(mockApprove).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("a hashless card (post unreadable at mint) is fail-closed unapprovable", async () => {
    setupUniversalApprove("pending", undefined, { contentHash: null, summary: null });

    const res = await ottoApprove({ threadId: APPROVE_THREAD_ID_2, cardId: APPROVAL_CARD_MSG_ID });

    expect(res).toMatchObject({ error: expect.any(String) });
    expect(mockApprove).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("AR1 处方2 TTL: an expired ask is consumed to \"expired\" and refused benignly", async () => {
    setupUniversalApprove("pending", undefined, { expiresAt: new Date(Date.now() - 1000).toISOString() });

    const res = await ottoApprove({ threadId: APPROVE_THREAD_ID_2, cardId: APPROVAL_CARD_MSG_ID });

    expect(res).toEqual({ ok: true, alreadyResolved: true, resolution: "expired" });
    expect(mockChatMessageUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ payload: expect.objectContaining({ status: "expired" }) }) }),
    );
    expect(mockApprove).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("AR1 处方2 CAS double-click: the losing resolver (count 0) refuses benignly — at most one resume per card, ZERO LLM reservation for the loser (AR2 处方2b)", async () => {
    setupUniversalApprove();
    mockChatMessageUpdateMany.mockResolvedValue({ count: 0 }); // a concurrent resolver won

    const res = await ottoApprove({ threadId: APPROVE_THREAD_ID_2, cardId: APPROVAL_CARD_MSG_ID });

    expect(res).toMatchObject({ ok: true, alreadyResolved: true });
    expect(mockApprove).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
    // The loser never reaches withLlmBudget — same-card double-click cannot double-reserve LLM.
    expect(mockWithLlmBudget).not.toHaveBeenCalled();
  });

  it("ref mismatch: hash ok but no parked item for this ref (post not approved) → error, no consume of the pending card", async () => {
    setupUniversalApprove("pending", [makeSchedApprovalItem("post_OTHER")]);

    const res = await ottoApprove({ threadId: APPROVE_THREAD_ID_2, cardId: APPROVAL_CARD_MSG_ID });

    expect(res).toMatchObject({ error: expect.any(String) });
    expect(mockApprove).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("test ④ double-approve: a consumed (approved) card refuses benignly — no re-approve, no run, no write", async () => {
    setupUniversalApprove("approved");

    const res = await ottoApprove({ threadId: APPROVE_THREAD_ID_2, cardId: APPROVAL_CARD_MSG_ID });

    expect(res).toEqual({ ok: true, alreadyResolved: true, resolution: "approved" });
    expect(mockApprove).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
    expect(mockChatMessageUpdateMany).not.toHaveBeenCalled();
  });

  it("truth-first: pending card whose parked ask is gone but the post IS approved → consume + benign", async () => {
    setupUniversalApprove("pending", []); // no parked interruptions
    mockScheduledPostFindFirst.mockResolvedValue(schedPostFixture({ approvedAt: new Date() }));

    const res = await ottoApprove({ threadId: APPROVE_THREAD_ID_2, cardId: APPROVAL_CARD_MSG_ID });

    expect(res).toEqual({ ok: true, alreadyResolved: true, resolution: "approved" });
    expect(mockApprove).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
    expect(mockChatMessageUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ payload: expect.objectContaining({ status: "approved" }) }) }),
    );
  });

  // NODE-279① regression pair: the targetItem-missing + approvedAt=true short-circuit must verify the
  // content hash BEFORE consuming (pre-reorder order). approvedAt=true must never launder a card whose
  // material fields drifted since mint.
  it("NODE-279① regression: targetItem gone + post approvedAt=true + material DRIFT → hard refuse, ZERO consume, the card stays pending", async () => {
    setupUniversalApprove("pending", []); // parked ask gone
    // Post got approved elsewhere AND its caption was edited after the card was minted.
    mockScheduledPostFindFirst.mockResolvedValue(schedPostFixture({ approvedAt: new Date(), caption: "Edited copy" }));

    const res = await ottoApprove({ threadId: APPROVE_THREAD_ID_2, cardId: APPROVAL_CARD_MSG_ID });

    expect(res).toMatchObject({ error: expect.stringMatching(/changed/i) });
    expect(mockChatMessageUpdateMany).not.toHaveBeenCalled(); // NOT consumed — the card stays pending
    expect(mockApprove).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("NODE-279① control: targetItem gone + approvedAt=true + hash MATCHES → benign alreadyResolved consume (short-circuit intact)", async () => {
    setupUniversalApprove("pending", []); // parked ask gone, material untouched since mint
    mockScheduledPostFindFirst.mockResolvedValue(schedPostFixture({ approvedAt: new Date() }));

    const res = await ottoApprove({ threadId: APPROVE_THREAD_ID_2, cardId: APPROVAL_CARD_MSG_ID });

    expect(res).toEqual({ ok: true, alreadyResolved: true, resolution: "approved" });
    expect(mockChatMessageUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ payload: expect.objectContaining({ status: "approved" }) }) }),
    );
    expect(mockApprove).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
  });
});

describe("ottoReject — STATIC decline (AR1 处方1: zero LLM resume, zero EXTERNAL writes; internal writes = card state/message/audit)", () => {
  it("consumes the card pending→rejected (CAS), best-effort rejects the parked item, inserts the deterministic message + ActionEvent — NO run, NO withLlmBudget", async () => {
    setupUniversalApprove();

    const res = await ottoReject({ threadId: APPROVE_THREAD_ID_2, cardId: APPROVAL_CARD_MSG_ID });

    expect(res).toMatchObject({ ok: true, status: "done", reply: expect.stringMatching(/declined/i) });
    // STRUCTURAL zero-LLM guarantee: no resume, no metering, no context build.
    expect(mockRun).not.toHaveBeenCalled();
    expect(mockWithLlmBudget).not.toHaveBeenCalled();
    // The card was atomically consumed pending→rejected.
    expect(mockChatMessageUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: APPROVAL_CARD_MSG_ID, kind: "APPROVAL_CARD" }),
        data: expect.objectContaining({ payload: expect.objectContaining({ status: "rejected" }) }),
      }),
    );
    // Best-effort state hygiene: the parked item was SDK-rejected (deterministic, no run).
    expect(mockReject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "approveScheduledPost" }),
      expect.objectContaining({ message: expect.any(String) }),
    );
    expect(mockApprove).not.toHaveBeenCalled();
    // Deterministic confirmation message persisted.
    expect(mockChatMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: "TEXT", role: "AGENT", text: expect.stringMatching(/declined/i) }) }),
    );
    // Audit trail.
    expect(mockActionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "approval.declined" }) }),
    );
  });

  it("test ④ (reject side): a consumed card refuses benignly — no reject, no message", async () => {
    setupUniversalApprove("rejected");

    const res = await ottoReject({ threadId: APPROVE_THREAD_ID_2, cardId: APPROVAL_CARD_MSG_ID });

    expect(res).toEqual({ ok: true, alreadyResolved: true, resolution: "rejected" });
    expect(mockReject).not.toHaveBeenCalled();
    expect(mockChatMessageCreate).not.toHaveBeenCalled();
  });

  it("truth-first: declining a card whose post got approved elsewhere records \"approved\", not a false rejection", async () => {
    setupUniversalApprove();
    mockScheduledPostFindFirst.mockResolvedValue(schedPostFixture({ approvedAt: new Date() }));

    const res = await ottoReject({ threadId: APPROVE_THREAD_ID_2, cardId: APPROVAL_CARD_MSG_ID });

    expect(res).toEqual({ ok: true, alreadyResolved: true, resolution: "approved" });
    expect(mockReject).not.toHaveBeenCalled();
  });

  it("an expired ask declines to \"expired\" (honest terminal state), no message inserted", async () => {
    setupUniversalApprove("pending", undefined, { expiresAt: new Date(Date.now() - 1000).toISOString() });

    const res = await ottoReject({ threadId: APPROVE_THREAD_ID_2, cardId: APPROVAL_CARD_MSG_ID });

    expect(res).toEqual({ ok: true, alreadyResolved: true, resolution: "expired" });
    expect(mockChatMessageCreate).not.toHaveBeenCalled();
  });

  it("declining a stale ask (interruption gone) still consumes + confirms — nothing can execute either way", async () => {
    setupUniversalApprove("pending", []); // no parked interruptions

    const res = await ottoReject({ threadId: APPROVE_THREAD_ID_2, cardId: APPROVAL_CARD_MSG_ID });

    expect(res).toMatchObject({ ok: true, status: "done" });
    expect(mockReject).not.toHaveBeenCalled(); // nothing to reject on the state
    expect(mockRun).not.toHaveBeenCalled();
    expect(mockChatMessageUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ payload: expect.objectContaining({ status: "rejected" }) }) }),
    );
  });

  it("CAS double-click on decline: the loser refuses benignly, no second message", async () => {
    setupUniversalApprove();
    mockChatMessageUpdateMany.mockResolvedValue({ count: 0 });

    const res = await ottoReject({ threadId: APPROVE_THREAD_ID_2, cardId: APPROVAL_CARD_MSG_ID });

    expect(res).toMatchObject({ ok: true, alreadyResolved: true });
    expect(mockChatMessageCreate).not.toHaveBeenCalled();
  });
});

describe("finalizeOttoRun — universal card persistence (test ①) + generate regression (test ⑤)", () => {
  function schedInterruptionResult(items: unknown[]) {
    return makeMockResult({ interruptions: items, finalOutput: "Want me to approve it?" });
  }

  function setupFinalize({ dedupeHit = false } = {}) {
    mockChatThreadUpdateMany.mockResolvedValue({ count: 1 });
    mockChatMessageCreate.mockResolvedValue({});
    mockChatMessageFindFirst.mockImplementation((args: { where?: { kind?: string } } | undefined) => {
      if (args?.where?.kind === "APPROVAL_CARD") {
        return Promise.resolve(dedupeHit ? { id: "existing_card_1" } : null);
      }
      return Promise.resolve({ seq: 3 });
    });
    // R1 enrichment source: the owner-scoped post read (material fields incl. hash inputs).
    mockScheduledPostFindFirst.mockResolvedValue({
      channel: "instagram",
      caption: "Golden hour drop",
      scheduledAt: new Date("2026-07-15T01:00:00.000Z"),
      scheduledTz: "Asia/Kuala_Lumpur",
      firstComment: null,
      metaTargetId: "tgt_1",
      media: [{ generationId: "g1" }, { generationId: "g2" }],
      updatedAt: new Date("2026-07-12T10:00:00.000Z"),
    });
  }

  it("persists an APPROVAL_CARD with the R1 summary (channel/time/caption/mediaCount) and returns its id", async () => {
    setupFinalize();
    const res = await finalizeOttoRun({
      ownerId: OWNER_ID,
      threadId: THREAD_ID,
      isNew: false,
      priorOttoState: '{"p":1}',
      result: schedInterruptionResult([makeSchedApprovalItem(SCHEDULED_POST_ID)]),
      seqAfterUser: 3,
    });
    expect(res.status).toBe("needs_approval");
    expect((res as { pendingCardIds: string[] }).pendingCardIds).toHaveLength(1);
    expect(mockChatMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "APPROVAL_CARD",
          role: "AGENT",
          payload: expect.objectContaining({
            toolName: "approveScheduledPost",
            ref: SCHEDULED_POST_ID,
            status: "pending",
            contentHash: expect.any(String),
            expiresAt: expect.any(String),
            summary: expect.objectContaining({
              channel: "instagram",
              caption: "Golden hour drop",
              scheduledAt: "2026-07-15T01:00:00.000Z",
              scheduledTz: "Asia/Kuala_Lumpur",
              mediaCount: 2,
            }),
          }),
        }),
      }),
    );
  });

  it("dedupes: a still-pending card for the same (toolName, ref) is reused, not re-minted", async () => {
    setupFinalize({ dedupeHit: true });
    const res = await finalizeOttoRun({
      ownerId: OWNER_ID,
      threadId: THREAD_ID,
      isNew: false,
      priorOttoState: '{"p":1}',
      result: schedInterruptionResult([makeSchedApprovalItem(SCHEDULED_POST_ID)]),
      seqAfterUser: 3,
    });
    expect((res as { pendingCardIds: string[] }).pendingCardIds).toEqual(["existing_card_1"]);
    expect(mockChatMessageCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: "APPROVAL_CARD" }) }),
    );
  });

  it("test ⑤ generate regression: a generate-only park keeps the EXACT old contract — cardId in pendingCardIds, zero APPROVAL_CARD writes, zero schedule reads", async () => {
    setupFinalize();
    const generateItem = {
      rawItem: { name: "generate" },
      arguments: JSON.stringify({ cardId: "gcard_1" }),
      type: "tool_approval_item",
    };
    const res = await finalizeOttoRun({
      ownerId: OWNER_ID,
      threadId: THREAD_ID,
      isNew: false,
      priorOttoState: '{"p":1}',
      result: schedInterruptionResult([generateItem]),
      seqAfterUser: 3,
    });
    expect(res).toMatchObject({ status: "needs_approval", pendingCardIds: ["gcard_1"] });
    expect(mockChatMessageCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: "APPROVAL_CARD" }) }),
    );
    expect(mockScheduledPostFindFirst).not.toHaveBeenCalled();
  });

  it("mixed park (generate + schedule): generate id rides pendingCardIds, ONE card minted for the schedule ask only", async () => {
    setupFinalize();
    const generateItem = {
      rawItem: { name: "generate" },
      arguments: JSON.stringify({ cardId: "gcard_1" }),
      type: "tool_approval_item",
    };
    const res = await finalizeOttoRun({
      ownerId: OWNER_ID,
      threadId: THREAD_ID,
      isNew: false,
      priorOttoState: '{"p":1}',
      result: schedInterruptionResult([generateItem, makeSchedApprovalItem(SCHEDULED_POST_ID)]),
      seqAfterUser: 3,
    });
    const ids = (res as { pendingCardIds: string[] }).pendingCardIds;
    expect(ids[0]).toBe("gcard_1");
    expect(ids).toHaveLength(2);
    const approvalCreates = mockChatMessageCreate.mock.calls.filter(
      (c) => (c[0] as { data?: { kind?: string } })?.data?.kind === "APPROVAL_CARD",
    );
    expect(approvalCreates).toHaveLength(1);
    expect((approvalCreates[0]![0] as { data: { payload: { toolName: string } } }).data.payload.toolName).toBe("approveScheduledPost");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WO-OTTO-PHASE1 · 四入口 contract matrix（现状锁定）— web entries.
// Locks the CURRENT metering/run contract of the fresh non-stream entry and the
// approval-resume entry (generate branch + the #280 runFactoryBatch branch) so the
// Phase-1 behavior-preserving composition seam cannot drift billing, step caps, or
// approval semantics. The stream entry shares this file's finalizeOttoRun coverage;
// its runner-level stream contract is locked in packages/otto/src/runtime.test.ts.
// The worker-verdict entry contract is locked in apps/worker/src/otto-resume.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

describe("contract matrix — fresh non-stream entry (ottoTurn)", () => {
  it("meters the production manifest contract: model=claude-sonnet-4-6, paid, maxSteps=10, refId otto-turn:<userMessageId>, run maxTurns=10, truncation usage mapper attached", async () => {
    setupHappyPath();

    await ottoTurn(BASE_INPUT);

    expect(mockWithLlmBudget).toHaveBeenCalledTimes(1);
    const args = mockWithLlmBudget.mock.calls[0]![0] as {
      orgId: string; refId: string; model: string; paid: boolean; maxSteps: number;
      usageOnError?: (e: unknown) => unknown;
    };
    expect(args.orgId).toBe(OWNER_ID);
    expect(args.model).toBe("claude-sonnet-4-6");
    expect(args.paid).toBe(true);
    expect(args.maxSteps).toBe(10); // OTTO_MAX_STEPS
    expect(args.refId).toMatch(/^otto-turn:/);
    // Truncation metering: a MaxTurnsExceededError carrying state.usage settles ACTUAL usage;
    // any other error yields null (whole-reservation refund inside withLlmBudget).
    expect(typeof args.usageOnError).toBe("function");
    const truncated = new MockMaxTurnsExceededError();
    (truncated as unknown as { state: unknown }).state = {
      usage: { inputTokens: 7, outputTokens: 3, requestUsageEntries: [] },
    };
    expect(args.usageOnError!(truncated)).toMatchObject({ inputTokens: 7, outputTokens: 3 });
    expect(args.usageOnError!(new Error("other"))).toBeNull();
    // run() is capped at the SAME 10 steps the reserve was priced for.
    const runOpts = mockRun.mock.calls[0]![2] as { maxTurns: number };
    expect(runOpts.maxTurns).toBe(10);
  });
});

describe("contract matrix — approval-resume entry (ottoApprove, generate branch)", () => {
  it("meters the resume with the SAME manifest contract: model, paid, maxSteps=10, refId otto-approve:<threadId>:<cardId>, run maxTurns=10", async () => {
    setupApproveHappyPath();

    await ottoApprove({ threadId: APPROVE_THREAD_ID, cardId: CARD_ID });

    expect(mockWithLlmBudget).toHaveBeenCalledTimes(1);
    const args = mockWithLlmBudget.mock.calls[0]![0] as {
      orgId: string; refId: string; model: string; paid: boolean; maxSteps: number;
    };
    expect(args.orgId).toBe(OWNER_ID);
    expect(args.model).toBe("claude-sonnet-4-6");
    expect(args.paid).toBe(true);
    expect(args.maxSteps).toBe(10); // OTTO_MAX_STEPS
    expect(args.refId).toBe(`otto-approve:${APPROVE_THREAD_ID}:${CARD_ID}`);
    const runOpts = mockRun.mock.calls[0]![2] as { maxTurns: number };
    expect(runOpts.maxTurns).toBe(10);
  });
});

// ── contract matrix — approval-resume entry, runFactoryBatch branch (#280) ───
// The third approval branch (generate / generateReferences / runFactoryBatch): the
// consent object is the EXACT parked tool-call args (hash-bound), the card is the
// CAS-consumable, and ONLY the consumed card id may become the server-only factory
// attempt token (the model can never supply one).

const FACTORY_CARD_MSG_ID = "apcard_factory_1";
const FACTORY_BATCH_ID = "batch_fp_1";
const FACTORY_THREAD_ID = "thread_approve_factory";
const FACTORY_ARGS = {
  mode: "variant",
  batchId: FACTORY_BATCH_ID,
  name: "Raya ad variants",
  base: { prompt: "hero shot of satay skewers", aspect: "1:1" },
  variants: [{ prompt: "hook A" }, { prompt: "hook B" }],
} as const;
const FACTORY_HASH = factoryBatchApprovalHashFromArgs(FACTORY_ARGS as unknown as Record<string, unknown>)!;

function makeFactoryApprovalItem(args: Record<string, unknown> = FACTORY_ARGS as unknown as Record<string, unknown>) {
  return {
    type: "tool_approval_item" as const,
    name: "runFactoryBatch",
    arguments: JSON.stringify(args),
    rawItem: { name: "runFactoryBatch", arguments: JSON.stringify(args) },
  };
}

function factoryCardPayload(overrides: Record<string, unknown> = {}) {
  return {
    toolName: "runFactoryBatch",
    ref: FACTORY_BATCH_ID,
    status: "pending",
    summary: null,
    contentHash: FACTORY_HASH,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function setupFactoryApprove(
  payloadOverrides: Record<string, unknown> = {},
  interruptionItems?: unknown[],
) {
  mockRequireOwner.mockResolvedValue(GATE);
  mockResolveDisabledModels.mockResolvedValue(new Set());
  mockChatThreadFindFirst.mockResolvedValue({
    id: FACTORY_THREAD_ID,
    projectId: PROJECT_ID,
    ottoState: '{"paused":"state"}',
  });
  const mockState = new MockRunState();
  mockGetInterruptions.mockReturnValue(interruptionItems ?? [makeFactoryApprovalItem()]);
  mockRunStateFromString.mockResolvedValue(mockState);
  mockGenJobFindFirst.mockResolvedValue(null);
  mockChatMessageFindFirst.mockImplementation((args: { where?: { kind?: string } } | undefined) => {
    if (args?.where?.kind === "APPROVAL_CARD") {
      return Promise.resolve({ id: FACTORY_CARD_MSG_ID, payload: factoryCardPayload(payloadOverrides) });
    }
    return Promise.resolve({ seq: 5 });
  });
  mockChatMessageCreate.mockResolvedValue({});
  mockChatThreadUpdate.mockResolvedValue({});
  mockRun.mockResolvedValue(makeMockResult({ finalOutput: "Batch started." }));
  mockWithLlmBudget.mockImplementation(async (_args: unknown, fn: () => Promise<{ result: unknown; usage?: unknown }>) => {
    const out = await fn();
    return (out as { result: unknown }).result;
  });
  mockTransaction.mockImplementation(runTransaction);
}

describe("contract matrix — approval-resume entry (ottoApprove, runFactoryBatch branch, #280)", () => {
  it("hash-verifies the parked call, consumes the card pending→approved BEFORE the resume, approves it, and injects the CONSUMED card id as the server-only factory attempt token", async () => {
    setupFactoryApprove();

    const res = await ottoApprove({ threadId: FACTORY_THREAD_ID, cardId: FACTORY_CARD_MSG_ID });

    expect(res).toMatchObject({ ok: true, status: "done" });
    // ATOMIC consumption: CAS pins payload.status="pending" in the WHERE.
    expect(mockChatMessageUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: FACTORY_CARD_MSG_ID,
          ownerId: OWNER_ID,
          kind: "APPROVAL_CARD",
          AND: [{ payload: { path: ["status"], equals: "pending" } }],
        }),
        data: expect.objectContaining({ payload: expect.objectContaining({ status: "approved" }) }),
      }),
    );
    // The PARKED runFactoryBatch item was approved.
    expect(mockApprove).toHaveBeenCalledWith(expect.objectContaining({ name: "runFactoryBatch" }), undefined);
    // Consumption strictly precedes the resume (consume-then-act).
    expect(mockChatMessageUpdateMany.mock.invocationCallOrder[0]!).toBeLessThan(mockRun.mock.invocationCallOrder[0]!);
    // Metered exactly once with the approve refId + the manifest contract.
    expect(mockWithLlmBudget).toHaveBeenCalledTimes(1);
    const args = mockWithLlmBudget.mock.calls[0]![0] as {
      orgId: string; refId: string; model: string; paid: boolean; maxSteps: number;
    };
    expect(args.orgId).toBe(OWNER_ID);
    expect(args.model).toBe("claude-sonnet-4-6");
    expect(args.paid).toBe(true);
    expect(args.maxSteps).toBe(10);
    expect(args.refId).toBe(`otto-approve:${FACTORY_THREAD_ID}:${FACTORY_CARD_MSG_ID}`);
    // The resume context's factory port is bound to the CONSUMED card id: the port forwards
    // attemptId = APPROVAL_CARD.id to the SAME owner-scoped server action the human uses.
    const resumeCtx = (mockRun.mock.calls[0]![2] as {
      context: { runFactoryBatch: { variant: (i: Record<string, unknown>) => Promise<unknown> } };
    }).context;
    mockRunVariantBatch.mockResolvedValue({ ok: true });
    await resumeCtx.runFactoryBatch.variant({
      batchId: FACTORY_BATCH_ID,
      projectId: PROJECT_ID,
      base: FACTORY_ARGS.base,
      variants: FACTORY_ARGS.variants,
    });
    expect(mockRunVariantBatch).toHaveBeenCalledWith(
      expect.objectContaining({ attemptId: FACTORY_CARD_MSG_ID, batchId: FACTORY_BATCH_ID }),
    );
  });

  it("P2 ref-collision discipline: a parked call whose args hash differs from the card's hash NEVER matches — refuse WITHOUT consuming, no approve, no resume", async () => {
    // Same batchId (same ref), flipped content → different hash → the card must not launder it.
    setupFactoryApprove({}, [
      makeFactoryApprovalItem({
        ...(FACTORY_ARGS as unknown as Record<string, unknown>),
        variants: [{ prompt: "hook A" }, { prompt: "FLIPPED hook" }],
      }),
    ]);

    const res = await ottoApprove({ threadId: FACTORY_THREAD_ID, cardId: FACTORY_CARD_MSG_ID });

    expect(res).toMatchObject({ error: expect.any(String) });
    expect(mockChatMessageUpdateMany).not.toHaveBeenCalled(); // NOT consumed
    expect(mockApprove).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
    expect(mockRunVariantBatch).not.toHaveBeenCalled();
  });

  it("ottoTurn context (no approval) binds NO attempt token: the factory port fails closed instead of calling the server action", async () => {
    setupHappyPath();

    await ottoTurn(BASE_INPUT);

    const turnCtx = (mockRun.mock.calls[0]![2] as {
      context: { runFactoryBatch: { variant: (i: Record<string, unknown>) => Promise<unknown> } };
    }).context;
    const out = await turnCtx.runFactoryBatch.variant({ batchId: FACTORY_BATCH_ID, projectId: PROJECT_ID });
    expect(out).toMatchObject({ error: expect.stringMatching(/approval attempt is missing/i) });
    expect(mockRunVariantBatch).not.toHaveBeenCalled();
  });
});
