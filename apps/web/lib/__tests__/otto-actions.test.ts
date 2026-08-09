/**
 * otto-actions.test.ts — Unit tests for ottoTurn + mapOttoUsage (Task 1.8a)
 *                         and ottoApprove (Task 1.8b)
 *
 * Mocks: @fikirtive/otto `run`/`RunState`/`MaxTurnsExceededError`, @fikirtive/db prisma,
 * requireOwner, withLlmBudget, resolveDisabledModels, revalidatePath.
 * No real DB needed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getPrincipal, type Principal } from "@fikirtive/db/principal";
// #692 r4: one closed contract, reused by the mapper tests and the end-to-end test below.
import { expectClosedAccountPayload, expectClosedAdPayload } from "./otto-money-contract";

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
  mockChatMessageFindMany,
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
  MockInsufficientCredits,
  mockRun,
  mockRunStateFromString,
  mockRestoreWithContext,
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
  mockListCrmSegments,
  mockGetCrmSegment,
  mockPreviewCrmSegment,
  mockBuildCrmSegment,
  mockListCampaigns,
  mockGetCampaign,
  mockProposeCampaign,
  mockProposeCampaignEntry,
  mockUpdateCampaignEntry,
  mockRemoveCampaignEntry,
  mockApproveCampaignEntry,
  mockSetCampaignGrouping,
  mockListTrendSnapshots,
  mockSaveTrendSnapshot,
  mockListContacts,
  mockGetContact,
  mockSearchContacts,
  mockCreateContact,
  mockUpdateContact,
  mockImportContacts,
  mockSetContactConsent,
  mockSetContactDndFromOtto,
} = vi.hoisted(() => {
  const mockRunStateToString = vi.fn(() => '{"mocked":"state"}');
  const mockRunStateFromString = vi.fn();
  /** Records (agent, serialized, context) for the resume-side restore (#566). */
  const mockRestoreWithContext = vi.fn();
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

  // #810 P2-2: the real InsufficientCredits carries the two numbers a merchant is told (what they
  // hold, what a turn needs). The double must carry them too, or a test could pass while the
  // action printed "undefined credits". `instanceof` in the SUT keys on THIS class, because the
  // @fikirtive/db mock below exports it.
  class MockInsufficientCredits extends Error {
    readonly requiredInternal: number | null;
    readonly balanceInternal: number | null;
    constructor(
      message = "Not enough credits.",
      detail?: { requiredInternal?: number | null; balanceInternal?: number | null },
    ) {
      super(message);
      this.name = "InsufficientCredits";
      this.requiredInternal = detail?.requiredInternal ?? null;
      this.balanceInternal = detail?.balanceInternal ?? null;
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
    mockChatMessageFindMany: vi.fn(),
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
    mockRestoreWithContext,
    mockWithLlmBudget,
    MockRunState,
    MockMaxTurnsExceededError,
    MockInsufficientCredits,
    mockApprove,
    mockReject,
    mockGetInterruptions,
    mockTavilySearch,
    mockBraveSearch,
    mockSearchWithFallback,
    mockRunVariantBatch: vi.fn(),
    mockRunBulkGrid: vi.fn(),
    mockListCrmSegments: vi.fn(),
    mockGetCrmSegment: vi.fn(),
    mockPreviewCrmSegment: vi.fn(),
    mockBuildCrmSegment: vi.fn(),
    mockListCampaigns: vi.fn(),
    mockGetCampaign: vi.fn(),
    mockProposeCampaign: vi.fn(),
    mockProposeCampaignEntry: vi.fn(),
    mockUpdateCampaignEntry: vi.fn(),
    mockRemoveCampaignEntry: vi.fn(),
    mockApproveCampaignEntry: vi.fn(),
    mockSetCampaignGrouping: vi.fn(),
    mockListTrendSnapshots: vi.fn(),
    mockSaveTrendSnapshot: vi.fn(),
    mockListContacts: vi.fn(),
    mockGetContact: vi.fn(),
    mockSearchContacts: vi.fn(),
    mockCreateContact: vi.fn(),
    mockUpdateContact: vi.fn(),
    mockImportContacts: vi.fn(),
    mockSetContactConsent: vi.fn(),
    mockSetContactDndFromOtto: vi.fn(),
  };
});

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/auth-guard", async () => ({ requireOwner: mockRequireOwner, resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: () => Promise.resolve(false), auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/model-registry", () => ({ resolveDisabledModels: mockResolveDisabledModels }));
vi.mock("@/lib/gen-actions", () => ({ startCoworkGen: mockStartGen }));
vi.mock("@/lib/factory-actions", () => ({ runVariantBatch: mockRunVariantBatch, runBulkGrid: mockRunBulkGrid }));
vi.mock("@/lib/memory-actions", () => ({ getBrandContextText: mockGetBrandContextText }));
vi.mock("@/lib/segment-actions", () => ({
  listSegments: mockListCrmSegments,
  getSegment: mockGetCrmSegment,
  previewSegment: mockPreviewCrmSegment,
  buildSegment: mockBuildCrmSegment,
}));
vi.mock("@/lib/campaign-view-data", () => ({
  listCampaigns: mockListCampaigns,
  getCampaign: mockGetCampaign,
}));
vi.mock("@/lib/campaign-actions", () => ({
  proposeCampaign: mockProposeCampaign,
  proposeCampaignEntry: mockProposeCampaignEntry,
  updateCampaignEntry: mockUpdateCampaignEntry,
  removeCampaignEntry: mockRemoveCampaignEntry,
  approveCampaignEntry: mockApproveCampaignEntry,
  setCampaignGrouping: mockSetCampaignGrouping,
}));
vi.mock("@/lib/trend-actions", () => ({
  listTrendSnapshots: mockListTrendSnapshots,
  saveTrendSnapshot: mockSaveTrendSnapshot,
}));
vi.mock("@/lib/crm-view-data", () => ({
  listContacts: mockListContacts,
  getContact: mockGetContact,
  searchContacts: mockSearchContacts,
}));
vi.mock("@/lib/crm-actions", () => ({
  createContact: mockCreateContact,
  updateContact: mockUpdateContact,
  importContacts: mockImportContacts,
  setContactConsent: mockSetContactConsent,
  setContactDndFromOtto: mockSetContactDndFromOtto,
}));

// #692 r4: the RAW Meta reads. Mocking these and NOT the money boundary is the point — the
// end-to-end money test below runs through the real port wiring in otto-actions and the real
// lib/otto-money-view, so what it validates is what production hands the model.
const { mockFetchOwnerInsights, mockFetchOwnerAdPerformance } = vi.hoisted(() => ({
  mockFetchOwnerInsights: vi.fn(),
  mockFetchOwnerAdPerformance: vi.fn(),
}));
vi.mock("@/lib/meta-insights", () => ({
  fetchOwnerInsights: mockFetchOwnerInsights,
  fetchOwnerInsightsSeries: vi.fn(),
}));
vi.mock("@/lib/meta-performance", () => ({
  fetchOwnerAdPerformance: mockFetchOwnerAdPerformance,
  MAX_ADS: 25,
}));

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
      findMany: mockChatMessageFindMany,
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
  InsufficientCredits: MockInsufficientCredits,
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
    // #566: the resume-side restore takes the LIVE context. Record it so tests can assert the
    // ports were already built when the state was rehydrated (that ordering IS the bug fix).
    // The real SDK INSTALLS that context on the returned state (RunState._context.context), and
    // runOttoTurn's fail-closed guard checks exactly that field before entering metering — so the
    // double has to install it too, or it models a state the production code would refuse.
    tryRestoreRunStateWithContext: async (_agent: unknown, str: string, context: unknown) => {
      mockRestoreWithContext(_agent, str, context);
      try {
        const state = await MockRunState.fromString(_agent, str);
        if (state) (state as { _context?: unknown })._context = { context };
        return state;
      } catch {
        return null;
      }
    },
    MaxTurnsExceededError: MockMaxTurnsExceededError,
  };
});

// ── Import SUT after mocks ───────────────────────────────────────────────────

const { ottoTurn, mapOttoUsage, buildOttoContext, ottoApprove, ottoReject, createEmptyCoworkThread, deleteCoworkThread, setCoworkThreadPinned, finalizeOttoRun, approvalPointerText, interruptedFallbackText, fallbackLangOf, decideFallbackLang } = await import("@/lib/otto-actions");
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
    findMany: mockChatMessageFindMany,
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
  mockResolveDisabledModels.mockResolvedValue({ disabled: new Set() });
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
  // #498 round-5: the tie-language fallback probes recent USER messages; default
  // to an empty thread history (→ "en") unless a test scripts one.
  mockChatMessageFindMany.mockResolvedValue([]);
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
  mockListCrmSegments.mockResolvedValue({
    ok: true,
    evaluatedAt: "2026-07-18T00:00:00.000Z",
    nextSegmentId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    nextSegmentProof: "owner-bound-proof",
    segments: [],
    unavailableFacts: { lastOrderAt: true, tags: true },
  });
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
    mockResolveDisabledModels.mockResolvedValue({ disabled: new Set(["bad-model"]) });

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
    mockResolveDisabledModels.mockResolvedValue({ disabled: new Set() });

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

  it("injects CRM Segment reads and create/update through the shared authenticated actions", async () => {
    const rules = {
      match: "all" as const,
      rules: [{ kind: "contactability" as const, value: "contactable" as const }],
    };
    const segment = {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      name: "Reachable audience",
      phrase: "All of: Contact is not a known opt-out",
      rules,
      status: "ready" as const,
      matchedCount: 4,
      contactableCount: 3,
      knownOptOutCount: 1,
      createdAt: "2026-07-18T00:00:00.000Z",
    };
    mockListCrmSegments.mockResolvedValue({
      ok: true,
      evaluatedAt: "2026-07-18T00:00:00.000Z",
      nextSegmentId: segment.id,
      nextSegmentProof: "owner-bound-proof",
      segments: [segment],
      unavailableFacts: { lastOrderAt: true, tags: true },
    });
    mockGetCrmSegment.mockResolvedValue({
      ok: true,
      evaluatedAt: "2026-07-18T00:00:00.000Z",
      segment,
      unavailableFacts: { lastOrderAt: true, tags: true },
    });
    mockPreviewCrmSegment.mockResolvedValue({
      ok: true,
      evaluatedAt: "2026-07-18T00:00:00.000Z",
      phrase: segment.phrase,
      matchedCount: 4,
      contactableCount: 3,
      knownOptOutCount: 1,
      contacts: [{ id: "c1" }, { id: "c2" }, { id: "c3" }],
      // #819 — the action states the cut; the port's job is to carry it, not to re-derive it.
      returned: 3,
      hasMore: true,
      unavailableFacts: { lastOrderAt: true, tags: true },
    });
    mockBuildCrmSegment.mockResolvedValue({
      ok: true,
      operation: "create",
      idempotent: false,
      segment,
      nextSegmentId: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
      nextSegmentProof: "next-proof",
    });

    const ctx = await buildOttoContext({
      ownerId: "owner_xyz",
      projectId: "proj_xyz",
      threadId: "thread_xyz",
    });
    const segments = (ctx as unknown as {
      segments: {
        list(): Promise<unknown>;
        get(id: string): Promise<unknown>;
        preview(value: typeof rules): Promise<unknown>;
        build(value: {
          operation: "create" | "update";
          segmentId?: string;
          name: string;
          rules: typeof rules;
        }): Promise<unknown>;
      };
    }).segments;

    await expect(segments.list()).resolves.toEqual({
      ok: true,
      evaluatedAt: "2026-07-18T00:00:00.000Z",
      segments: [segment],
    });
    await expect(segments.get(segment.id)).resolves.toMatchObject({ ok: true, segment });
    expect(mockGetCrmSegment).toHaveBeenCalledWith(segment.id);
    await expect(segments.preview(rules)).resolves.toMatchObject({
      ok: true,
      matchedCount: 4,
      contactableCount: 3,
      knownOptOutCount: 1,
      // #819 — a sample of 3 out of a match of 4 arrives saying it is a sample.
      returned: 3,
      hasMore: true,
    });
    expect(mockPreviewCrmSegment).toHaveBeenCalledWith(rules);

    await segments.build({ operation: "create", name: segment.name, rules });
    expect(mockBuildCrmSegment).toHaveBeenLastCalledWith({
      operation: "create",
      segmentId: segment.id,
      segmentProof: "owner-bound-proof",
      name: segment.name,
      rules,
    });

    mockListCrmSegments.mockClear();
    mockBuildCrmSegment.mockResolvedValue({
      ok: true,
      operation: "update",
      idempotent: false,
      segment,
    });
    await segments.build({ operation: "update", segmentId: segment.id, name: segment.name, rules });
    expect(mockListCrmSegments).not.toHaveBeenCalled();
    expect(mockBuildCrmSegment).toHaveBeenLastCalledWith({
      operation: "update",
      segmentId: segment.id,
      name: segment.name,
      rules,
    });
    expect(JSON.stringify(mockBuildCrmSegment.mock.calls)).not.toContain("owner_xyz");
  });

  it("injects CRM Contact reads and engine-routed writes without threading owner identity", async () => {
    const contact = {
      id: "contact-1",
      name: "Aisha",
      lifecycleStage: "Active",
      source: "manual",
      firstTouchCampaignId: null,
      firstTouchAt: new Date("2026-07-17T00:00:00.000Z"),
      lastSeenAt: new Date("2026-07-18T00:00:00.000Z"),
      consentState: {
        state: "unknown" as const,
        stateSourceKind: "crm_manual",
        evidenceStatus: "asserted",
        lastReceivedAt: new Date("2026-07-18T01:00:00.000Z"),
      },
      doNotDisturb: false,
      totalOrdersMyr: null,
      createdAt: new Date("2026-07-17T00:00:00.000Z"),
      identities: [],
    };
    const detail = {
      ...contact,
      consentEvents: [{
        id: "event-1",
        channel: "whatsapp",
        purpose: "marketing",
        action: "grant",
        actorKind: "merchant",
        entryMode: "backfill",
        sourceKind: "crm_manual",
        evidenceStatus: "asserted",
        occurredAt: null,
        receivedAt: new Date("2026-07-18T01:00:00.000Z"),
      }],
    };
    mockListContacts.mockResolvedValue({ ok: true, contacts: [contact], totalCount: 1, nextCursor: null, hasMore: false });
    mockGetContact.mockResolvedValue({ ok: true, contact: detail });
    mockSearchContacts.mockResolvedValue({ ok: true, contacts: [contact], totalCount: 1, nextCursor: null, hasMore: false });
    mockCreateContact.mockResolvedValue({ ok: true, contactId: contact.id, created: true, possibleDuplicates: [] });
    mockUpdateContact.mockResolvedValue({ ok: true });
    mockImportContacts.mockResolvedValue({ ok: true, importedCount: 1, failedCount: 0, rows: [] });
    mockSetContactConsent.mockResolvedValue({ ok: true });
    mockSetContactDndFromOtto.mockResolvedValue({ ok: true });

    const ctx = await buildOttoContext({
      ownerId: "owner_xyz",
      projectId: "proj_xyz",
      threadId: "thread_xyz",
    });
    const contacts = ctx.contacts!;

    await expect(contacts.list({ lifecycleStage: "Active" })).resolves.toMatchObject({
      ok: true,
      contacts: [{
        id: contact.id,
        firstTouchAt: "2026-07-17T00:00:00.000Z",
        consentState: { state: "unknown", lastReceivedAt: "2026-07-18T01:00:00.000Z" },
      }],
    });
    await expect(contacts.get(contact.id)).resolves.toMatchObject({
      ok: true,
      contact: { consentEvents: [{ receivedAt: "2026-07-18T01:00:00.000Z" }] },
    });
    await contacts.search({ query: "Aisha" });
    await contacts.create({ name: "Aisha", lifecycleStage: "Active" });
    await contacts.update({ contactId: contact.id, patch: { lifecycleStage: "Dormant" } });
    await contacts.importCsv({ csv: "name\nBo", importId: "import-1" });
    await contacts.recordConsent({ contactId: contact.id, action: "grant", requestId: "consent-1" });
    await contacts.setDnd({ contactId: contact.id, enabled: true, requestId: "dnd-1" });

    expect(mockCreateContact).toHaveBeenCalledWith({ name: "Aisha", lifecycleStage: "Active", source: "otto" });
    expect(mockSetContactConsent).toHaveBeenCalledWith({ contactId: contact.id, action: "grant", requestId: "consent-1" });
    expect(mockSetContactDndFromOtto).toHaveBeenCalledWith({ contactId: contact.id, enabled: true, requestId: "dnd-1" });
    expect(JSON.stringify([
      mockCreateContact.mock.calls,
      mockUpdateContact.mock.calls,
      mockImportContacts.mock.calls,
      mockSetContactConsent.mock.calls,
      mockSetContactDndFromOtto.mock.calls,
    ])).not.toContain("owner_xyz");
  });

  // #742 — the Contacts page has admitted its cut since #715 ("Showing 50 of 65 contacts"),
  // but Otto was handed the 50 rows and nothing else. Asked "how many customers do I have",
  // it answered off a list that had already been cut, with nothing in the payload saying so.
  // The counts must cross into the port WITH the rows: one read, one truth, two surfaces.
  it("hands Otto the same truncation the Contacts page admits, never the page alone", async () => {
    mockResolveDisabledModels.mockResolvedValue({ disabled: new Set() });
    const row = (index: number) => ({
      id: `contact-${index}`,
      name: `Bulk Contact ${index}`,
      lifecycleStage: "Active",
      source: "manual",
      firstTouchCampaignId: null,
      firstTouchAt: new Date("2026-07-17T00:00:00.000Z"),
      lastSeenAt: new Date("2026-07-18T00:00:00.000Z"),
      consentState: {
        state: "unknown" as const,
        stateSourceKind: null,
        evidenceStatus: null,
        lastReceivedAt: null,
        unresolvedLegacyOptOut: false,
      },
      doNotDisturb: false,
      totalOrdersMyr: null,
      createdAt: new Date("2026-07-17T00:00:00.000Z"),
      identities: [],
    });
    const page = Array.from({ length: 50 }, (_, index) => row(index));
    mockListContacts.mockResolvedValue({
      ok: true, contacts: page, totalCount: 65, nextCursor: "cursor-50", hasMore: true,
    });
    mockSearchContacts.mockResolvedValue({
      ok: true, contacts: page.slice(0, 10), totalCount: 42, nextCursor: "cursor-10", hasMore: true,
    });

    const ctx = await buildOttoContext({
      ownerId: "owner_xyz",
      projectId: "proj_xyz",
      threadId: "thread_xyz",
    });
    const contacts = ctx.contacts!;

    // 50 rows in hand, 65 in the merchant's records — both numbers, or the answer is a guess.
    await expect(contacts.list({})).resolves.toMatchObject({
      ok: true, returned: 50, totalCount: 65, hasMore: true,
    });
    // Search truncates the same way and must own it the same way.
    await expect(contacts.search({ query: "Bulk" })).resolves.toMatchObject({
      ok: true, returned: 10, totalCount: 42, hasMore: true,
    });

    // An untruncated read says so rather than going quiet: hasMore false, and the two counts agree.
    mockListContacts.mockResolvedValue({
      ok: true, contacts: page.slice(0, 3), totalCount: 3, nextCursor: null, hasMore: false,
    });
    await expect(contacts.list({})).resolves.toMatchObject({
      ok: true, returned: 3, totalCount: 3, hasMore: false,
    });
  });

  it("injects Campaign reads and zero-cost proposal writes through the shared authenticated actions", async () => {
    const campaignId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const entryId = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
    const targetId = "01ARZ3NDEKTSV4RRFFQ69G5FAX";
    const campaign = {
      id: campaignId,
      name: "Merdeka launch",
      status: "DRAFT",
      goal: "Drive pre-orders",
      startAt: "2026-08-23T16:00:00.000Z",
      endAt: "2026-08-31T15:59:59.999Z",
      plan: { theme: "Local pride", rationale: null, entries: [], ideas: [] },
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
    };
    const detail = {
      ...campaign,
      grouped: { projects: [], scheduledPosts: [], generations: [], broadcasts: [] },
      available: { projects: [], scheduledPosts: [], generations: [] },
      trendSnapshots: [],
    };
    const entry = {
      date: "2026-08-24",
      platform: "instagram",
      format: "image",
      hook: "Merdeka box",
      brief: "Show the gift box opening in warm morning light.",
      estCredits: 12,
    };
    mockListCampaigns.mockResolvedValue({
      ok: true,
      campaigns: [campaign],
      nextCampaignId: campaignId,
      nextCampaignProof: "campaign-proof",
    });
    mockGetCampaign.mockResolvedValue({
      ok: true,
      campaign: detail,
      nextEntryId: entryId,
      nextEntryProof: "entry-proof",
    });
    mockListTrendSnapshots.mockResolvedValue({
      ok: true,
      snapshots: [],
      nextSnapshotId: targetId,
      nextSnapshotProof: "trend-proof",
    });
    mockProposeCampaign.mockResolvedValue({ ok: true, campaignId, payload: campaign.plan });
    mockProposeCampaignEntry.mockResolvedValue({ ok: true, payload: campaign.plan });
    mockApproveCampaignEntry.mockResolvedValue({ ok: true, payload: campaign.plan });
    mockSetCampaignGrouping.mockResolvedValue({ ok: true });
    mockSaveTrendSnapshot.mockResolvedValue({ ok: true });

    const ctx = await buildOttoContext({
      ownerId: "owner_xyz",
      projectId: "proj_xyz",
      threadId: "thread_xyz",
    });
    const campaigns = ctx.campaigns!;

    await expect(campaigns.list()).resolves.toEqual({ ok: true, campaigns: [campaign] });
    await expect(campaigns.get(campaignId)).resolves.toMatchObject({ ok: true, campaign: detail });
    await campaigns.create({
      name: campaign.name,
      goal: campaign.goal,
      status: "DRAFT",
      period: { start: "2026-08-24", end: "2026-08-31", tz: "Asia/Kuala_Lumpur" },
    });
    expect(mockProposeCampaign).toHaveBeenCalledWith({
      campaignId,
      campaignProof: "campaign-proof",
      title: campaign.name,
      goal: campaign.goal,
      status: "DRAFT",
      period: { start: "2026-08-24", end: "2026-08-31", tz: "Asia/Kuala_Lumpur" },
      theme: campaign.name,
      items: [],
      ideas: [],
    });

    await campaigns.proposeEntry({ campaignId, entry });
    expect(mockProposeCampaignEntry).toHaveBeenCalledWith({
      campaignId,
      entryId,
      entryProof: "entry-proof",
      entry,
    });
    await campaigns.approveEntry({ campaignId, entryId });
    expect(mockApproveCampaignEntry).toHaveBeenCalledWith({ campaignId, entryId });
    await campaigns.group({ campaignId, targetType: "project", targetId });
    expect(mockSetCampaignGrouping).toHaveBeenCalledWith({ campaignId, targetType: "project", targetId });
    await campaigns.saveTrend({
      campaignId,
      evidence: {
        summary: "Gift bundles are rising.",
        sources: [{ title: "Brief", domain: "example.com" }],
      },
    });
    expect(mockSaveTrendSnapshot).toHaveBeenCalledWith({
      snapshotId: targetId,
      snapshotProof: "trend-proof",
      campaignId,
      evidence: {
        summary: "Gift bundles are rising.",
        sources: [{ title: "Brief", domain: "example.com" }],
      },
    });
    expect(JSON.stringify([
      mockProposeCampaign.mock.calls,
      mockProposeCampaignEntry.mock.calls,
      mockApproveCampaignEntry.mock.calls,
    ])).not.toContain("owner_xyz");
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
    mockResolveDisabledModels.mockResolvedValue({ disabled: new Set() });
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

// ── #498: a paused run is NEVER silent ───────────────────────────────────────
// Repro (2026-07-29 lane-a walkthrough): storyboard → Otto mints plan cards and
// invites "全部生成" → the merchant sends it → the model calls the gated `generate`
// tool(s) with ZERO narration text → the run parks (needs_approval) and nothing
// visible ever happens: no reply, no error, no card change, no charge. These tests
// lock the fix: an interrupted run with no model text persists an honest reply and
// returns it as fallbackReply; the spend gate (startGen) stays untouched.

describe("finalizeOttoRun — #498 verbal approval must never be silent", () => {
  function generateInterruption(cardId: string) {
    return {
      rawItem: { name: "generate" },
      arguments: JSON.stringify({ cardId }),
      type: "tool_approval_item",
    };
  }

  beforeEach(() => {
    mockChatMessageFindFirst.mockResolvedValue({ seq: 4 });
    mockChatThreadUpdateMany.mockResolvedValue({ count: 1 });
    mockChatMessageCreate.mockResolvedValue({});
  });

  it("repro: parked generate with no narration → persists the approval-pointer reply and returns it", async () => {
    const result = {
      state: new MockRunState(),
      interruptions: [generateInterruption("card_verbal")],
      finalOutput: undefined,
      newItems: [],
    };
    const out = await finalizeOttoRun({
      ownerId: OWNER_ID, threadId: THREAD_ID, isNew: false, priorOttoState: "s0",
      result, seqAfterUser: 4,
    });
    expect(out).toEqual({
      status: "needs_approval",
      pendingCardIds: ["card_verbal"],
      fallbackReply: approvalPointerText({ cardCount: 1, allGenerate: true, lang: "en" }),
    });
    expect(mockChatMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: "AGENT", kind: "TEXT", seq: 5, text: approvalPointerText({ cardCount: 1, allGenerate: true, lang: "en" }) }),
      }),
    );
    // Money safety: the fallback is chat copy only — the spend gate is never touched.
    expect(mockStartGen).not.toHaveBeenCalled();
  });

  it('repro: "全部生成" parks THREE generate calls → one plural pointer reply, all card ids pending', async () => {
    const result = {
      state: new MockRunState(),
      interruptions: [generateInterruption("card_1"), generateInterruption("card_2"), generateInterruption("card_3")],
      finalOutput: undefined,
      newItems: [],
    };
    const out = await finalizeOttoRun({
      ownerId: OWNER_ID, threadId: THREAD_ID, isNew: false, priorOttoState: "s0",
      result, seqAfterUser: 4,
    });
    expect(out).toEqual({
      status: "needs_approval",
      pendingCardIds: ["card_1", "card_2", "card_3"],
      fallbackReply: approvalPointerText({ cardCount: 3, allGenerate: true, lang: "en" }),
    });
    expect(mockChatMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: "TEXT", text: approvalPointerText({ cardCount: 3, allGenerate: true, lang: "en" }) }),
      }),
    );
    expect(mockStartGen).not.toHaveBeenCalled();
  });

  it("model narrated before parking → its own text persists, NO synthesized fallback", async () => {
    const result = {
      state: new MockRunState(),
      interruptions: [generateInterruption("card_verbal")],
      finalOutput: "Your cards are ready — confirm to start.",
      newItems: [],
    };
    const out = await finalizeOttoRun({
      ownerId: OWNER_ID, threadId: THREAD_ID, isNew: false, priorOttoState: "s0",
      result, seqAfterUser: 4,
    });
    expect(out).toEqual({
      status: "needs_approval",
      pendingCardIds: ["card_verbal"],
      fallbackReply: null,
    });
    expect(mockChatMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: "TEXT", text: "Your cards are ready — confirm to start." }),
      }),
    );
    expect(mockChatMessageCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ text: approvalPointerText({ cardCount: 1, allGenerate: true, lang: "en" }) }) }),
    );
  });

  // #498 round-5 P2a: whitespace-only narration IS no narration. Locked through
  // the REAL finalizer — finalizeOttoTurn/extractText run un-mocked over this
  // scripted RunResult, so the trim happens at the single extraction source.
  it("whitespace-only narration (finalOutput of blank deltas) → the receipt still fires — through the real finalizer", async () => {
    const result = {
      state: new MockRunState(),
      interruptions: [generateInterruption("card_verbal")],
      finalOutput: " \n\t  ",
      newItems: [],
    };
    const out = await finalizeOttoRun({
      ownerId: OWNER_ID, threadId: THREAD_ID, isNew: false, priorOttoState: "s0",
      result, seqAfterUser: 4,
    });
    expect(out).toEqual({
      status: "needs_approval",
      pendingCardIds: ["card_verbal"],
      fallbackReply: approvalPointerText({ cardCount: 1, allGenerate: true, lang: "en" }),
    });
    // Exactly ONE visible reply: the receipt — never a whitespace-only TEXT row.
    expect(mockChatMessageCreate).toHaveBeenCalledTimes(1);
    expect(mockChatMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: "TEXT", text: approvalPointerText({ cardCount: 1, allGenerate: true, lang: "en" }) }),
      }),
    );
  });

  it("whitespace-only message_output_item chunks (no finalOutput) → same receipt — through the real finalizer", async () => {
    const result = {
      state: new MockRunState(),
      interruptions: [generateInterruption("card_verbal")],
      finalOutput: undefined,
      newItems: [
        { type: "message_output_item", rawItem: { content: [{ type: "output_text", text: "  " }] } },
        { type: "message_output_item", rawItem: { content: [{ type: "output_text", text: "\n" }] } },
      ],
    };
    const out = await finalizeOttoRun({
      ownerId: OWNER_ID, threadId: THREAD_ID, isNew: false, priorOttoState: "s0",
      result, seqAfterUser: 4,
    });
    expect(out).toMatchObject({
      status: "needs_approval",
      fallbackReply: approvalPointerText({ cardCount: 1, allGenerate: true, lang: "en" }),
    });
  });

  it("paused with NOTHING approvable and no narration → honest dead-end reply instead of silence", async () => {
    const result = {
      state: new MockRunState(),
      interruptions: [{ rawItem: { name: "not-a-gated-tool" }, arguments: "{}", type: "tool_approval_item" }],
      finalOutput: undefined,
      newItems: [],
    };
    const out = await finalizeOttoRun({
      ownerId: OWNER_ID, threadId: THREAD_ID, isNew: false, priorOttoState: "s0",
      result, seqAfterUser: 4,
    });
    expect(out).toEqual({
      status: "needs_approval",
      pendingCardIds: [],
      fallbackReply: interruptedFallbackText("en"),
    });
    expect(mockChatMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: "AGENT", kind: "TEXT", text: interruptedFallbackText("en") }),
      }),
    );
  });

  it("CAS miss on the interruption path stays stale and writes NO fallback message", async () => {
    mockChatThreadUpdateMany.mockResolvedValue({ count: 0 });
    const result = {
      state: new MockRunState(),
      interruptions: [generateInterruption("card_verbal")],
      finalOutput: undefined,
      newItems: [],
    };
    const out = await finalizeOttoRun({
      ownerId: OWNER_ID, threadId: THREAD_ID, isNew: false, priorOttoState: "s0",
      result, seqAfterUser: 4,
    });
    expect(out).toEqual({ status: "stale" });
    expect(mockChatMessageCreate).not.toHaveBeenCalled();
  });

  // ── #498 P2: the receipt follows the merchant's language ──────────────────
  it('language follow: a CJK-majority turn ("全部生成") gets the Chinese receipt', async () => {
    const result = {
      state: new MockRunState(),
      interruptions: [generateInterruption("card_verbal")],
      finalOutput: undefined,
      newItems: [],
    };
    const out = await finalizeOttoRun({
      ownerId: OWNER_ID, threadId: THREAD_ID, isNew: false, priorOttoState: "s0",
      result, seqAfterUser: 4, userText: "全部生成",
    });
    const zh = approvalPointerText({ cardCount: 1, allGenerate: true, lang: "zh" });
    expect(out).toEqual({ status: "needs_approval", pendingCardIds: ["card_verbal"], fallbackReply: zh });
    expect(mockChatMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "AGENT", kind: "TEXT", text: zh }) }),
    );
  });

  it("language follow: an English turn keeps the English receipt; dead-end follows too", async () => {
    const genResult = {
      state: new MockRunState(),
      interruptions: [generateInterruption("card_verbal")],
      finalOutput: undefined,
      newItems: [],
    };
    const outEn = await finalizeOttoRun({
      ownerId: OWNER_ID, threadId: THREAD_ID, isNew: false, priorOttoState: "s0",
      result: genResult, seqAfterUser: 4, userText: "please make all of them",
    });
    expect(outEn).toMatchObject({ fallbackReply: approvalPointerText({ cardCount: 1, allGenerate: true, lang: "en" }) });

    const deadEndResult = {
      state: new MockRunState(),
      interruptions: [{ rawItem: { name: "not-a-gated-tool" }, arguments: "{}", type: "tool_approval_item" }],
      finalOutput: undefined,
      newItems: [],
    };
    const outZh = await finalizeOttoRun({
      ownerId: OWNER_ID, threadId: THREAD_ID, isNew: false, priorOttoState: "s0",
      result: deadEndResult, seqAfterUser: 4, userText: "帮我继续做下去",
    });
    expect(outZh).toMatchObject({ fallbackReply: interruptedFallbackText("zh") });
  });

  // #498 round-4: Malay is the third receipt language.
  it('language follow: a Malay turn ("tolong buat semua") gets the Malay receipt', async () => {
    const result = {
      state: new MockRunState(),
      interruptions: [generateInterruption("card_verbal")],
      finalOutput: undefined,
      newItems: [],
    };
    const out = await finalizeOttoRun({
      ownerId: OWNER_ID, threadId: THREAD_ID, isNew: false, priorOttoState: "s0",
      result, seqAfterUser: 4, userText: "tolong buat semua",
    });
    const ms = approvalPointerText({ cardCount: 1, allGenerate: true, lang: "ms" });
    expect(out).toEqual({ status: "needs_approval", pendingCardIds: ["card_verbal"], fallbackReply: ms });
    expect(mockChatMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "AGENT", kind: "TEXT", text: ms }) }),
    );
  });

  // ── #498 round-5 P2b: a mixed-language TIE follows the thread history ───────
  it('language tie ("ok teruskan") → falls back to the most recent DECISIVE merchant message in the thread', async () => {
    // The thread's recent USER messages, newest first: the tie itself (already
    // persisted), then a decisive Malay ask.
    mockChatMessageFindMany.mockResolvedValue([
      { text: "ok teruskan" },
      { text: "tolong buat semua gambar" },
    ]);
    const result = {
      state: new MockRunState(),
      interruptions: [generateInterruption("card_verbal")],
      finalOutput: undefined,
      newItems: [],
    };
    const out = await finalizeOttoRun({
      ownerId: OWNER_ID, threadId: THREAD_ID, isNew: false, priorOttoState: "s0",
      result, seqAfterUser: 4, userText: "ok teruskan",
    });
    expect(out).toMatchObject({
      fallbackReply: approvalPointerText({ cardCount: 1, allGenerate: true, lang: "ms" }),
    });
    // The probe is owner+thread scoped and reads USER TEXT only, newest first.
    expect(mockChatMessageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ threadId: THREAD_ID, ownerId: OWNER_ID, role: "USER", kind: "TEXT" }),
        orderBy: { seq: "desc" },
      }),
    );
  });

  it("language tie with NO decisive history → English; an indecisive history row is walked past", async () => {
    mockChatMessageFindMany.mockResolvedValue([{ text: "ok teruskan" }, { text: "hmm" }]);
    const result = {
      state: new MockRunState(),
      interruptions: [generateInterruption("card_verbal")],
      finalOutput: undefined,
      newItems: [],
    };
    const out = await finalizeOttoRun({
      ownerId: OWNER_ID, threadId: THREAD_ID, isNew: false, priorOttoState: "s0",
      result, seqAfterUser: 4, userText: "ok teruskan",
    });
    expect(out).toMatchObject({
      fallbackReply: approvalPointerText({ cardCount: 1, allGenerate: true, lang: "en" }),
    });
  });

  it("a DECISIVE message this turn never touches the history probe", async () => {
    const result = {
      state: new MockRunState(),
      interruptions: [generateInterruption("card_verbal")],
      finalOutput: undefined,
      newItems: [],
    };
    await finalizeOttoRun({
      ownerId: OWNER_ID, threadId: THREAD_ID, isNew: false, priorOttoState: "s0",
      result, seqAfterUser: 4, userText: "tolong buat semua",
    });
    expect(mockChatMessageFindMany).not.toHaveBeenCalled();
  });
});

// ── #498 P2: fallback copy stays honest per language and approval type ────────
describe("#498 fallback copy — language pick and type-honest wording", () => {
  it("fallbackLangOf: CJK-majority → zh, latin-majority or empty → en", () => {
    expect(fallbackLangOf("全部生成")).toBe("zh");
    expect(fallbackLangOf("ok 全部生成吧")).toBe("zh"); // 4 Han > 2 latin
    expect(fallbackLangOf("please make all of them")).toBe("en");
    expect(fallbackLangOf("make 三张")).toBe("en"); // 4 latin > 2 Han
    expect(fallbackLangOf("")).toBe("en");
    expect(fallbackLangOf(null)).toBe("en");
  });

  // #498 round-4: Malay joins the receipt languages. Detection is a token vote —
  // Malay-indicative words/word forms vs English-indicative words; ties → en
  // (fallbackLangOf is the pure no-history projection).
  it("fallbackLangOf: Malay-token-majority → ms; mixed English-majority stays en", () => {
    expect(fallbackLangOf("tolong buat semua")).toBe("ms");
    expect(fallbackLangOf("sahkan dan teruskan semuanya")).toBe("ms"); // list + -kan/-nya word forms
    expect(fallbackLangOf("jana semua gambar sekarang")).toBe("ms");
    expect(fallbackLangOf("please make semua")).toBe("en"); // 2 en votes > 1 ms vote
    expect(fallbackLangOf("boleh")).toBe("ms"); // 1 ms vote > 0 en votes
    // Han-majority wins BEFORE the token vote (documented order).
    expect(fallbackLangOf("全部生成吧 ok")).toBe("zh");
  });

  // #498 round-5 P2b: decideFallbackLang admits indecision (null) instead of
  // silently defaulting — that null is what triggers the thread-history fallback.
  it("decideFallbackLang: short words decide when they can; mixed ties and unknowns return null", () => {
    expect(decideFallbackLang("ok")).toBe("en"); // decisive: 1 en vote
    expect(decideFallbackLang("teruskan")).toBe("ms"); // decisive: 1 ms vote
    expect(decideFallbackLang("okey")).toBe("ms"); // Malay spelling votes ms
    expect(decideFallbackLang("ok teruskan")).toBeNull(); // 1-1 mixed tie
    expect(decideFallbackLang("sila proceed")).toBeNull(); // 1-1 mixed tie
    expect(decideFallbackLang("hmm")).toBeNull(); // no recognized tokens
    expect(decideFallbackLang("")).toBeNull();
    expect(decideFallbackLang(null)).toBeNull();
    // The pure projection still lands those on en (no history in reach).
    expect(fallbackLangOf("ok teruskan")).toBe("en");
  });

  // #498 round-4 (judge): locked THROUGH the real finalizer, not the template
  // function alone — a run parked on non-generate approvals (approveScheduledPost)
  // must persist + return the pointer WITHOUT the generate-only "start right away"
  // promise, in the merchant's language. The mocks below only stub prisma; the
  // wording choice (allGenerate=false) is made by finalizeOttoRun itself.
  it('non-generate approvals never promise "I\'ll start right away" — through the real finalizer (en/zh/ms)', async () => {
    async function finalizeNonGenerate(userText: string) {
      mockChatMessageFindFirst.mockReset();
      mockChatMessageFindFirst.mockResolvedValueOnce({ seq: 4 }); // max-seq read
      mockChatMessageFindFirst.mockResolvedValue(null); // APPROVAL_CARD dedup: none exist
      mockChatThreadUpdateMany.mockResolvedValue({ count: 1 });
      mockChatMessageCreate.mockReset();
      mockChatMessageCreate.mockResolvedValue({});
      mockScheduledPostFindFirst.mockResolvedValue(schedPostFixture());
      const result = {
        state: new MockRunState(),
        interruptions: [makeSchedApprovalItem("post_a"), makeSchedApprovalItem("post_b")],
        finalOutput: undefined,
        newItems: [],
      };
      return await finalizeOttoRun({
        ownerId: OWNER_ID, threadId: THREAD_ID, isNew: false, priorOttoState: "s0",
        result, seqAfterUser: 4, userText,
      });
    }

    const cases = [
      { userText: "please approve both posts", lang: "en" as const, promise: /start right away/i },
      { userText: "帮我确认这两个排程", lang: "zh" as const, promise: /马上开始|开始生成/ },
      { userText: "tolong sahkan semua", lang: "ms" as const, promise: /mula serta-merta/ },
    ];
    for (const { userText, lang, promise } of cases) {
      const out = await finalizeNonGenerate(userText);
      const receipt = approvalPointerText({ cardCount: 2, allGenerate: false, lang });
      expect(receipt).not.toMatch(promise);
      // The real finalizer picked the non-generate wording and returned it…
      expect(out).toMatchObject({ status: "needs_approval", fallbackReply: receipt });
      // …and persisted exactly that text as the visible reply.
      expect(mockChatMessageCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ role: "AGENT", kind: "TEXT", text: receipt }),
        }),
      );
      // Money safety unchanged: chat copy only.
      expect(mockStartGen).not.toHaveBeenCalled();
    }
  });

  it("generate approvals keep the start-right-away promise in the matching language", () => {
    expect(approvalPointerText({ cardCount: 3, allGenerate: true, lang: "en" })).toMatch(/start right away/);
    expect(approvalPointerText({ cardCount: 3, allGenerate: true, lang: "zh" })).toContain("马上开始");
    expect(approvalPointerText({ cardCount: 3, allGenerate: true, lang: "ms" })).toContain("mula serta-merta");
  });

  it("dead-end fallback has all three language variants", () => {
    expect(interruptedFallbackText("en")).toContain("try again");
    expect(interruptedFallbackText("zh")).toContain("再试一次");
    expect(interruptedFallbackText("ms")).toContain("cuba lagi");
    const variants = [interruptedFallbackText("en"), interruptedFallbackText("zh"), interruptedFallbackText("ms")];
    expect(new Set(variants).size).toBe(3);
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
  mockResolveDisabledModels.mockResolvedValue({ disabled: new Set() });

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

// #566 (挡上线): "talk to Otto first, then press confirm" never produced anything. The approve path
// rehydrated the parked RunState BEFORE building the context, so the state resumed with a
// JSON-rebuilt context that had lost ctx.startGen — and the SDK ignores options.context on a
// resumed state, so the context built afterwards was never consulted. Production: 3 clicks, 0 jobs.
// The contract these assertions pin: the live context exists BEFORE the restore, rides INTO it, and
// is the very same object the resume runs on.
describe("ottoApprove — #566 the resumed state carries the live context (startGen survives)", () => {
  it("restores WITH the context, and that context is the port-carrying object run() resumes on", async () => {
    setupApproveHappyPath();

    const res = await ottoApprove({ threadId: APPROVE_THREAD_ID, cardId: CARD_ID });
    expect(res).toMatchObject({ ok: true, status: "done" });

    // The restore took a context (the context-less helper must not be what resumes a run).
    expect(mockRestoreWithContext).toHaveBeenCalledTimes(1);
    const [, serialized, restoreCtx] = mockRestoreWithContext.mock.calls[0] as [unknown, string, { startGen?: unknown }];
    expect(serialized).toBe('{"paused":"state"}');

    // The spend port was ALREADY injected at restore time — this is what was missing in production.
    expect(restoreCtx.startGen).toBe(mockStartGen);

    // …and it is the SAME object the resume runs on (identity, not a look-alike copy): the state
    // holds it by reference, which is also how the late-bound consent fields reach the skills.
    const runCtx = (mockRun.mock.calls[0]![2] as { context: unknown }).context;
    expect(runCtx).toBe(restoreCtx);
  });

  it("builds the context BEFORE the restore (ordering is the fix, not an accident)", async () => {
    setupApproveHappyPath();

    await ottoApprove({ threadId: APPROVE_THREAD_ID, cardId: CARD_ID });

    // resolveDisabledModels is buildOttoContext's first await; it must have run before the restore.
    expect(mockResolveDisabledModels.mock.invocationCallOrder[0]!).toBeLessThan(
      mockRestoreWithContext.mock.invocationCallOrder[0]!,
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
    mockResolveDisabledModels.mockResolvedValue({ disabled: new Set() });
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
    mockResolveDisabledModels.mockResolvedValue({ disabled: new Set() });
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
    mockResolveDisabledModels.mockResolvedValue({ disabled: new Set() });

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

// ── #498 P1a: the CHAINED approval pause must never be silent either ──────────
// ottoApprove resumes the run; the resume can park AGAIN on the next gated call.
// Before this fix only the main turn path synthesized a receipt — the chained
// branch dropped the turn silently when the model narrated nothing. These lock
// parity with finalizeOttoRun: honest receipt persisted + returned, language
// following the merchant's latest message (an approve is a click, not a message).
describe("ottoApprove — chained interruption with zero narration synthesizes the receipt", () => {
  const chainedInterruption = {
    rawItem: { name: "generate" },
    arguments: JSON.stringify({ cardId: "card_chained" }),
    type: "tool_approval_item",
  };

  function setupChained({ finalOutput, userHistory }: { finalOutput: string | undefined; userHistory: string[] }) {
    setupApproveHappyPath();
    // Resume parks again (chained approval), CAS wins.
    mockRun.mockResolvedValue({
      state: new MockRunState(),
      newItems: [],
      finalOutput,
      interruptions: [chainedInterruption],
    });
    mockChatThreadUpdateMany.mockResolvedValue({ count: 1 });
    // findFirst serves the max-seq lookup; findMany serves the #498 round-5
    // language probe (recent USER messages, newest first).
    mockChatMessageFindFirst.mockResolvedValue({ seq: 5 });
    mockChatMessageFindMany.mockResolvedValue(userHistory.map((text) => ({ text })));
  }

  it('zero narration + CJK merchant ("全部生成") → persists and returns the Chinese pointer receipt', async () => {
    setupChained({ finalOutput: undefined, userHistory: ["全部生成"] });

    const res = await ottoApprove({ threadId: APPROVE_THREAD_ID, cardId: CARD_ID });

    const zh = approvalPointerText({ cardCount: 1, allGenerate: true, lang: "zh" });
    expect(res).toEqual({ ok: true, status: "needs_approval", pendingCardIds: ["card_chained"], fallbackReply: zh, narrationMessageId: null });
    expect(mockChatMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "AGENT", kind: "TEXT", seq: 6, text: zh }) }),
    );
    // Money safety: chat copy only — the spend gate is untouched by the synthesis.
    expect(mockStartGen).not.toHaveBeenCalled();
  });

  it("zero narration + English merchant → the English pointer receipt", async () => {
    setupChained({ finalOutput: undefined, userHistory: ["make all of them please"] });

    const res = await ottoApprove({ threadId: APPROVE_THREAD_ID, cardId: CARD_ID });

    expect(res).toMatchObject({
      ok: true,
      status: "needs_approval",
      fallbackReply: approvalPointerText({ cardCount: 1, allGenerate: true, lang: "en" }),
    });
  });

  // #498 round-5 P2b: a mixed-language TIE in the latest message follows the
  // thread's most recent DECISIVE merchant message instead of defaulting to en.
  it('language tie in the latest message ("ok teruskan") → falls back to the previous decisive Malay message', async () => {
    setupChained({ finalOutput: undefined, userHistory: ["ok teruskan", "tolong buat semua gambar"] });

    const res = await ottoApprove({ threadId: APPROVE_THREAD_ID, cardId: CARD_ID });

    expect(res).toMatchObject({
      fallbackReply: approvalPointerText({ cardCount: 1, allGenerate: true, lang: "ms" }),
    });
  });

  it("language tie with NO decisive history → the English receipt", async () => {
    setupChained({ finalOutput: undefined, userHistory: ["ok teruskan"] });

    const res = await ottoApprove({ threadId: APPROVE_THREAD_ID, cardId: CARD_ID });

    expect(res).toMatchObject({
      fallbackReply: approvalPointerText({ cardCount: 1, allGenerate: true, lang: "en" }),
    });
  });

  // #498 round-5 P2a: whitespace-only narration is NO narration — the receipt
  // must fire. Locked through the REAL finalizer (finalizeOttoTurn/extractText
  // run un-mocked on this scripted RunResult).
  it("whitespace-only narration (blank deltas) still synthesizes the receipt — through the real finalizer", async () => {
    setupChained({ finalOutput: "  \n\t ", userHistory: ["全部生成"] });

    const res = await ottoApprove({ threadId: APPROVE_THREAD_ID, cardId: CARD_ID });

    const zh = approvalPointerText({ cardCount: 1, allGenerate: true, lang: "zh" });
    expect(res).toEqual({ ok: true, status: "needs_approval", pendingCardIds: ["card_chained"], fallbackReply: zh, narrationMessageId: null });
    expect(mockChatMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "AGENT", kind: "TEXT", text: zh }) }),
    );
  });

  it("model narrated before the chained park → its own text persists AND its durable id returns for live injection (round-5 P2c)", async () => {
    setupChained({ finalOutput: "One down — confirm the next card to continue.", userHistory: ["全部生成"] });

    const res = await ottoApprove({ threadId: APPROVE_THREAD_ID, cardId: CARD_ID });

    // The persisted narration TEXT's id is returned so the client can inject it
    // without a reload — the exact id that was written, not a re-derivation.
    const narrationCreate = mockChatMessageCreate.mock.calls
      .map((c) => (c[0] as { data: { id: string; role?: string; kind?: string; text?: string } }).data)
      .find((d) => d.role === "AGENT" && d.kind === "TEXT" && d.text === "One down — confirm the next card to continue.");
    expect(narrationCreate).toBeDefined();
    expect(res).toEqual({
      ok: true,
      status: "needs_approval",
      pendingCardIds: ["card_chained"],
      fallbackReply: null,
      narrationMessageId: narrationCreate!.id,
    });
    expect(mockChatMessageCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ text: approvalPointerText({ cardCount: 1, allGenerate: true, lang: "zh" }) }),
      }),
    );
  });
});

// ── Task 4: dynamic context seam — brand memory + entities injected ───────────

describe("ottoTurn — injects brand context + refs as a system message", () => {
  it("includes brand memory text and entity name in the leading system message passed to run()", async () => {
    mockRequireOwner.mockResolvedValue({ ownerId: "o1" });
    mockResolveDisabledModels.mockResolvedValue({ disabled: new Set() });
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
    mockResolveDisabledModels.mockResolvedValue({ disabled: new Set() });
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
    mockResolveDisabledModels.mockResolvedValue({ disabled: new Set() });
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

  // #677 (#546 收口余项) — the empty-title fallback had no pin: only a normal title and the
  // 80-char truncation were covered, so a thread row could start carrying "" (a blank entry
  // in the merchant's conversation list) without a single test going red.
  it("an empty title falls back to Untitled — never a blank row in the list", async () => {
    mockRequireOwner.mockResolvedValue(GATE);
    mockProjectFindFirst.mockResolvedValue({ id: PROJECT_ID });
    mockChatThreadCreate.mockResolvedValue({});

    const res = await createEmptyCoworkThread({ projectId: PROJECT_ID, title: "" });

    expect(res).toEqual({ id: expect.any(String) });
    expect(mockChatThreadCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ownerId: OWNER_ID, projectId: PROJECT_ID, title: "Untitled" }),
      }),
    );
  });

  // "Untitled", never "New campaign" (#546): a conversation is not a campaign, and the
  // project-level placeholder must not leak onto a thread.
  it("the fallback is exactly Untitled, not a project placeholder name", async () => {
    mockRequireOwner.mockResolvedValue(GATE);
    mockProjectFindFirst.mockResolvedValue({ id: PROJECT_ID });
    mockChatThreadCreate.mockResolvedValue({});

    await createEmptyCoworkThread({ projectId: PROJECT_ID, title: "" });

    const { title } = mockChatThreadCreate.mock.calls.at(-1)![0].data as { title: string };
    expect(title).toBe("Untitled");
    expect(title).not.toBe("New campaign");
    expect(title).not.toBe("New project");
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

  /**
   * #464 B1 acceptance for this site — see `principal-frame-b1.test.ts` for the other seamed
   * sites and the shared rationale. It lives here rather than there because reaching the real
   * `otto-actions` module needs this file's sixteen mocks.
   *
   * The owner-scoped `where` clause above proves the SCOPE; it says nothing about the ambient
   * identity, which is what #464 adds and what B4 will later enforce on.
   */
  it("runs the owner-scoped read AND write inside the ambient user frame (#464 B1)", async () => {
    mockRequireOwner.mockResolvedValue(GATE);
    const seen: Record<string, Principal | undefined> = {};
    mockChatThreadFindFirst.mockImplementation(async () => {
      seen.read = getPrincipal();
      return { id: THREAD_ID };
    });
    mockChatThreadUpdateMany.mockImplementation(async () => {
      seen.write = getPrincipal();
      return { count: 1 };
    });

    await setCoworkThreadPinned(THREAD_ID, true);

    expect(Object.keys(seen).sort()).toEqual(["read", "write"]);
    for (const [where, principal] of Object.entries(seen)) {
      expect(principal, `ambient principal missing at the ${where}`).toBeDefined();
      // Explicit kind check: a `runAsTenant` stand-in also carries `ownerId`, and it is exactly
      // the frame that has lost the actor.
      expect(principal!.kind, `frame at the ${where} is not a user frame`).toBe("user");
      expect(principal).toMatchObject({ kind: "user", ownerId: OWNER_ID, subjectEmail: GATE.email });
    }
    expect(getPrincipal()).toBeUndefined();
  });

  it("opens no frame when the gate denies (#464 B1)", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Sign in required." });
    mockChatThreadFindFirst.mockImplementation(async () => {
      throw new Error("must not be reached");
    });

    const res = await setCoworkThreadPinned(THREAD_ID, true);

    expect(res).toEqual({ error: "Sign in required." });
    expect(mockChatThreadFindFirst).not.toHaveBeenCalled();
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
  mockResolveDisabledModels.mockResolvedValue({ disabled: new Set() });
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
  mockResolveDisabledModels.mockResolvedValue({ disabled: new Set() });
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

// ─────────────────────────────────────────────────────────────────────────────
// #692 r4 — money end-to-end, through the REAL wiring.
//
// The unit tests for lib/otto-money-view feed it hand-built rows. That proves the mapper, not
// the pipe: a later edit could bypass the boundary in buildOttoContext and every mapper test
// would stay green. Here the only thing faked is Meta itself — raw account/ad rows with plain
// numeric spend, exactly as fetchOwnerInsights/fetchOwnerAdPerformance return them — and the
// payload is read back off the ports buildOttoContext actually assembles, then put through the
// same closed contract the mapper tests use.
// ─────────────────────────────────────────────────────────────────────────────
describe("buildOttoContext — the money boundary, end to end (#692 r4)", () => {
  const RAW_METRICS = {
    spend: "48.75", impressions: "18342", reach: "12840", frequency: "1.43",
    clicks: "412", ctr: "2.25", cpc: "0.12", cpm: "2.66", purchaseRoas: "3.1",
  };

  /** MYR + SGD + two accounts Meta reported no currency for — every bucket kind at once. */
  const MIXED_ACCOUNTS = [
    { accountId: "act_1", name: "Kaia Cafe", currency: "MYR", metrics: { ...RAW_METRICS, spend: "48.75" } },
    { accountId: "act_2", name: "Night Market", currency: "SGD", metrics: { ...RAW_METRICS, spend: "33.10" } },
    { accountId: "act_3", name: "Third Stall", currency: null, metrics: { ...RAW_METRICS, spend: "1240" } },
    { accountId: "act_4", name: "Fourth Stall", currency: null, metrics: { ...RAW_METRICS, spend: "990" } },
  ];

  // #692 r5: real Meta identifiers are long runs of digits — the fixture uses that shape so the
  // contract is exercised against real data, not against ids invented to be easy on it.
  const MIXED_ADS = MIXED_ACCOUNTS.map((a, i) => ({
    adId: `2385123456789012${i}`, adName: `Ad ${i}`, accountId: a.accountId, accountName: a.name,
    currency: a.currency, metrics: a.metrics,
    creative: { imageUrl: null, body: null, title: `2026080${i}`, videoId: `12345678901234${i}` },
  }));

  const ctxFor = async () => {
    mockResolveDisabledModels.mockResolvedValue({ disabled: new Set() });
    return buildOttoContext({ ownerId: OWNER_ID, projectId: PROJECT_ID, threadId: THREAD_ID });
  };

  it("the account payload the port hands over passes the closed contract, mixed buckets and all", async () => {
    mockFetchOwnerInsights.mockResolvedValue({ accounts: MIXED_ACCOUNTS });
    const ctx = await ctxFor();
    const res = await ctx.metaInsights!.get("last_30d");
    if (!("accounts" in res)) throw new Error("expected accounts");

    expectClosedAccountPayload(res.accounts);
    expect(res.accounts.map((a) => a.money.spend)).toEqual([
      "MYR 48.75",
      "SGD 33.10",
      "1240 (currency not reported — Third Stall)",
      "990 (currency not reported — Fourth Stall)",
    ]);
    // four accounts, four distinct buckets — nothing pools
    expect(new Set(res.accounts.map((a) => a.moneyBucket)).size).toBe(4);
    // none of the sums a model might reach for
    const json = JSON.stringify(res);
    for (const total of ["81.85", "2230", "2311.85"]) expect(json).not.toContain(total);
  });

  it("the per-ad payload goes through the SAME contract on the SAME wiring", async () => {
    mockFetchOwnerAdPerformance.mockResolvedValue({
      ads: MIXED_ADS, truncated: false, organic: { posts: [] },
      datePreset: "last_30d", fetchedAt: "2026-07-03T00:00:00.000Z",
    });
    const ctx = await ctxFor();
    const res = await ctx.metaPerformance!.getAds("last_30d");
    if (!("ads" in res)) throw new Error("expected ads");

    expectClosedAdPayload(res.ads);
    expect(res.ads.map((a) => a.money.spend)).toEqual([
      "MYR 48.75",
      "SGD 33.10",
      "1240 (currency not reported — Third Stall)",
      "990 (currency not reported — Fourth Stall)",
    ]);
    expect(res.ads.every((a) => typeof a.hasSpend === "boolean")).toBe(true);
  });

  it("connection states cross the boundary untouched — no shape invented out of a failure", async () => {
    for (const state of [{ notConnected: true }, { needsReconnect: true }, { transientError: true }]) {
      mockFetchOwnerInsights.mockResolvedValue(state);
      mockFetchOwnerAdPerformance.mockResolvedValue(state);
      const ctx = await ctxFor();
      expect(await ctx.metaInsights!.get("last_30d")).toEqual(state);
      expect(await ctx.metaPerformance!.getAds("last_30d")).toEqual(state);
    }
  });
});

// ── #791 第 1 项:项目 brief 进 Otto 每轮上下文 ─────────────────────────────
//
// 「说的≠做的」的原型:QuickBrief 的注释与 setCoworkBrief 的注释都写着这段文字会
// 「injected into the planner system prompt」,而 buildOttoContext 从来没读过
// Project.coworkBrief —— 商家写完 brief,Otto 每一轮都不知道。

describe("#791-1 项目 brief 进 Otto 每轮上下文", () => {
  it("buildOttoContext 按 owner + project 读 coworkBrief,并去掉首尾空白放进 ctx.projectBrief", async () => {
    mockResolveDisabledModels.mockResolvedValue({ disabled: new Set() });
    mockProjectFindFirst.mockResolvedValue({ coworkBrief: "  Always 9:16, warm tone  " });

    const ctx = await buildOttoContext({
      ownerId: "owner_brief",
      projectId: "proj_brief",
      threadId: "thread_brief",
    });

    expect(ctx.projectBrief).toBe("Always 9:16, warm tone");
    const call = mockProjectFindFirst.mock.calls.at(-1)![0] as { where: Record<string, unknown> };
    // 租户约束:读必须同时带 ownerId,永远不能只按 projectId 读。
    expect(call.where).toMatchObject({ id: "proj_brief", ownerId: "owner_brief", deletedAt: null });
  });

  it("读不到项目(或 brief 为空)时不带这一段,而不是编一段空 brief", async () => {
    mockResolveDisabledModels.mockResolvedValue({ disabled: new Set() });
    mockProjectFindFirst.mockResolvedValue({ coworkBrief: "   " });

    const ctx = await buildOttoContext({
      ownerId: "owner_brief",
      projectId: "proj_brief",
      threadId: "thread_brief",
    });

    expect(ctx.projectBrief).toBeUndefined();
  });

  it("brief 排在品牌记忆之后,并说明它是商家自己写的这一个项目的方向", () => {
    const result = buildContextSystemMessage({
      orgId: "o1",
      userId: "o1",
      projectId: "p1",
      threadId: "t1",
      disabledModels: [],
      brandContext: "BRAND_MEMORY_MARKER",
      projectBrief: "PROJECT_BRIEF_MARKER",
    });
    const content = (result as { content: string }).content;
    expect(content).toContain("PROJECT_BRIEF_MARKER");
    expect(content.indexOf("BRAND_MEMORY_MARKER")).toBeLessThan(content.indexOf("PROJECT_BRIEF_MARKER"));
    expect(content).toMatch(/brief for this project/i);
  });

  it("没有 brief 就完全不注入这一段", () => {
    const result = buildContextSystemMessage({
      orgId: "o1",
      userId: "o1",
      projectId: "p1",
      threadId: "t1",
      disabledModels: [],
      brandContext: "BRAND_MEMORY_MARKER",
    });
    expect((result as { content: string }).content).not.toMatch(/brief for this project/i);
  });
});

// ── #810 P2-2:「余额不足」这句人话必须每个 Otto 入口都说 ────────────────────
//
// #791-7 教会了主流式路由不再撒「You're out of credits.」这个谎(一轮先冻结固定
// 额度,余额 3.9、一分钱没花的商家被告知一分钱没有),但只教了那一条路。非流式的
// ottoTurn 与 ottoApprove 仍然把同一个 typed 拒绝吞成 "Couldn't reach Otto" /
// "Couldn't approve" —— 比旧文案更糟:把一件不是故障的事说成产品坏了,还不给
// 那两个能解释清楚的数字。Brand Memory 走的正是这条非流式入口,所以这是活的。
//
// 钱路一个字没动(reserve 本来就拒了,零花费);变的只是这件事被叫作什么,
// 以及每个入口都叫同一个名字。
describe("#810 P2-2 余额不足:三个入口同一句人话", () => {
  const insufficient = () =>
    new MockInsufficientCredits("Not enough credits.", { requiredInternal: 40, balanceInternal: 39 });

  it("ottoTurn:说出真实余额与门槛,而不是「Couldn't reach Otto」", async () => {
    mockRequireOwner.mockResolvedValue(GATE);
    mockResolveDisabledModels.mockResolvedValue({ disabled: new Set() });
    mockProjectFindFirst.mockResolvedValue({ id: PROJECT_ID, ownerId: OWNER_ID });
    mockChatThreadFindFirst.mockResolvedValue({ projectId: PROJECT_ID, ottoState: null });
    mockChatMessageFindFirst.mockResolvedValue({ seq: 1 });
    mockChatMessageCreate.mockResolvedValue({});
    mockWithLlmBudget.mockRejectedValue(insufficient());

    const res = (await ottoTurn({ threadId: "t1", projectId: PROJECT_ID, text: "hi", entityIds: [], variantSel: {} })) as {
      error?: string;
    };

    expect(res.error).toBe("You have 3.9 credits — starting a message with Otto holds 4 credits first. Top up in Billing.");
    expect(res.error).not.toMatch(/Couldn't reach Otto/);
  });

  it("ottoApprove:同一句话,不是「Couldn't approve」", async () => {
    mockRequireOwner.mockResolvedValue(GATE);
    mockResolveDisabledModels.mockResolvedValue({ disabled: new Set() });
    mockChatThreadFindFirst.mockResolvedValue({
      id: APPROVE_THREAD_ID,
      projectId: PROJECT_ID,
      ottoState: '{"paused":"state"}',
    });
    const approvalItem = makeApprovalItem(CARD_ID);
    mockGetInterruptions.mockReturnValue([approvalItem]);
    mockRunStateFromString.mockResolvedValue(new MockRunState());
    mockGenJobFindFirst.mockResolvedValue(null);
    mockChatMessageFindFirst.mockResolvedValue({ seq: 5 });
    mockChatMessageCreate.mockResolvedValue({});
    mockWithLlmBudget.mockRejectedValue(insufficient());

    const res = (await ottoApprove({ threadId: APPROVE_THREAD_ID, cardId: CARD_ID })) as { error?: string };

    expect(res.error).toBe("You have 3.9 credits — starting a message with Otto holds 4 credits first. Top up in Billing.");
    expect(res.error).not.toMatch(/Couldn't approve/);
  });

  it("别的故障仍然照实说是哪个动作失败了(这不是把所有错误都改成钱不够)", async () => {
    mockRequireOwner.mockResolvedValue(GATE);
    mockResolveDisabledModels.mockResolvedValue({ disabled: new Set() });
    mockProjectFindFirst.mockResolvedValue({ id: PROJECT_ID, ownerId: OWNER_ID });
    mockChatThreadFindFirst.mockResolvedValue({ projectId: PROJECT_ID, ottoState: null });
    mockChatMessageFindFirst.mockResolvedValue({ seq: 1 });
    mockChatMessageCreate.mockResolvedValue({});
    mockWithLlmBudget.mockRejectedValue(new Error("upstream exploded"));

    const res = (await ottoTurn({ threadId: "t1", projectId: PROJECT_ID, text: "hi", entityIds: [], variantSel: {} })) as {
      error?: string;
    };

    expect(res.error).toBe("Couldn't reach Otto — please try again.");
    // 内部细节不外露。
    expect(res.error).not.toContain("upstream exploded");
  });
});
