/**
 * factory-approval.test.ts — the runFactoryBatch (W-B3-F-P) approval wiring (PR #280 收尾轮,
 * closing the item-⑤ stop-report after the #279 seam landed on main).
 *
 * Before this wiring runFactoryBatch was in APPROVAL_TOOL_NAMES (needsApproval=true) but
 * approvalRefOf had no branch for it → collectApprovalInterruptions dropped the parked call → no
 * card was ever minted → the batch spend approval was DOA in chat (same defect class as
 * generateReferences before #279). These tests pin the completed end-to-end wiring:
 *   collect (real approval-tools) → finalizeOttoRun mints a hash-bound APPROVAL_CARD (ref=batchId,
 *   contentHash over the EXACT parked mode/batchId/name/base/variants/cells) → ottoApprove verifies
 *   the hash, CAS-consumes the card BEFORE the resume, approves the parked item, resumes metered —
 *   and the resume (`run` mock simulating the SDK's resume semantics) invokes the REAL parked
 *   runFactoryBatch tool (zod parse + the skill's execute) against the resume context, reaching the
 *   REAL owner-scoped factory action in ONE CONTINUOUS chain: approve → resume → skill execute →
 *   ctx.runFactoryBatch port → runVariantBatch → orchestrateBatch → per-cell mocked startGen
 *   (ZERO real spend).
 * Plus the anti-flip negative (cells/variants swapped after mint ⇒ hash mismatch ⇒ hard refuse, no
 * consume, no approve, no run) and the same-batchId re-park dedup semantics (same args ⇒ same hash
 * ⇒ same card; different content ⇒ two cards, each approving exactly ITS OWN parked call).
 * The skill-execute→port hop itself (executeRunFactoryBatch routes mode→variant/bulk) is proven in
 * packages/otto/src/skills/run-factory-batch.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockRequireOwner,
  mockResolveDisabledModels,
  mockGetBrandContextText,
  mockStartGen,
  mockChatThreadFindFirst,
  mockChatThreadUpdate,
  mockChatThreadUpdateMany,
  mockChatMessageFindFirst,
  mockChatMessageFindMany,
  mockChatMessageCreate,
  mockChatMessageUpdateMany,
  mockGenJobFindFirst,
  mockGenJobFindMany,
  mockGenJobUpdateMany,
  mockProjectFindFirst,
  mockGenerationBatchFindFirst,
  mockGenerationBatchCreate,
  mockEntityFindMany,
  mockGenerationFindFirst,
  mockGenerationFindMany,
  mockScheduledPostFindFirst,
  mockActionEventCreate,
  mockTransaction,
  mockExecuteRaw,
  mockRun,
  mockRunStateFromString,
  mockRestoreWithContext,
  mockWithLlmBudget,
  MockRunState,
  MockMaxTurnsExceededError,
  mockApprove,
  mockGetInterruptions,
} = vi.hoisted(() => {
  const mockApprove = vi.fn();
  const mockGetInterruptions = vi.fn(() => [] as unknown[]);
  const mockRunStateFromString = vi.fn();
  /** Records (agent, serialized, context) for the resume-side restore (#566). */
  const mockRestoreWithContext = vi.fn();

  class MockRunState {
    usage = { inputTokens: 10, outputTokens: 5, requestUsageEntries: [] as unknown[] };
    toString() { return '{"mocked":"state"}'; }
    static fromString = mockRunStateFromString;
    getInterruptions() { return mockGetInterruptions(); }
    approve(item: unknown, opts?: unknown) { return mockApprove(item, opts); }
    reject() { /* not exercised here */ }
  }
  class MockMaxTurnsExceededError extends Error {
    constructor(msg = "Max turns exceeded") { super(msg); this.name = "MaxTurnsExceededError"; }
  }
  const mockWithLlmBudget = vi.fn(async (_args: unknown, fn: () => Promise<{ result: unknown }>) => (await fn()).result);

  return {
    mockRequireOwner: vi.fn(),
    mockResolveDisabledModels: vi.fn(),
    mockGetBrandContextText: vi.fn(),
    mockStartGen: vi.fn(),
    mockChatThreadFindFirst: vi.fn(),
    mockChatThreadUpdate: vi.fn(),
    mockChatThreadUpdateMany: vi.fn(),
    mockChatMessageFindFirst: vi.fn(),
    mockChatMessageFindMany: vi.fn(),
    mockChatMessageCreate: vi.fn(),
    mockChatMessageUpdateMany: vi.fn(),
    mockGenJobFindFirst: vi.fn(),
    mockGenJobFindMany: vi.fn(),
    mockGenJobUpdateMany: vi.fn(),
    mockProjectFindFirst: vi.fn(),
    mockGenerationBatchFindFirst: vi.fn(),
    mockGenerationBatchCreate: vi.fn(),
    mockEntityFindMany: vi.fn(),
    mockGenerationFindFirst: vi.fn(),
    mockGenerationFindMany: vi.fn(),
    mockScheduledPostFindFirst: vi.fn(),
    mockActionEventCreate: vi.fn(),
    mockTransaction: vi.fn(),
    mockExecuteRaw: vi.fn(),
    mockRun: vi.fn(),
    mockRunStateFromString,
    mockRestoreWithContext,
    mockWithLlmBudget,
    MockRunState,
    MockMaxTurnsExceededError,
    mockApprove,
    mockGetInterruptions,
  };
});

vi.mock("@/lib/auth-guard", async () => ({ requireOwner: mockRequireOwner, resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: () => Promise.resolve(false), auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/model-registry", () => ({ resolveDisabledModels: mockResolveDisabledModels }));
vi.mock("@/lib/gen-actions", () => ({ startGen: mockStartGen, startCoworkGen: mockStartGen }));
vi.mock("@/lib/memory-actions", () => ({ getBrandContextText: mockGetBrandContextText }));

vi.mock("@fikirtive/db", () => ({
  prisma: {
    chatThread: {
      findFirst: mockChatThreadFindFirst,
      update: mockChatThreadUpdate,
      updateMany: mockChatThreadUpdateMany,
    },
    chatMessage: {
      findFirst: mockChatMessageFindFirst,
      findMany: mockChatMessageFindMany,
      create: mockChatMessageCreate,
      updateMany: mockChatMessageUpdateMany,
    },
    genJob: { findFirst: mockGenJobFindFirst, findMany: mockGenJobFindMany, updateMany: mockGenJobUpdateMany },
    project: { findFirst: mockProjectFindFirst },
    generationBatch: { findFirst: mockGenerationBatchFindFirst, create: mockGenerationBatchCreate },
    entity: { findMany: mockEntityFindMany },
    generation: { findFirst: mockGenerationFindFirst, findMany: mockGenerationFindMany },
    scheduledPost: { findFirst: mockScheduledPostFindFirst },
    actionEvent: { create: mockActionEventCreate },
    $transaction: mockTransaction,
    $executeRaw: mockExecuteRaw,
  },
}));

// Real @fikirtive/core; only the heavy/non-deterministic otto exports are mocked —
// approval-tools (approvalRefOf / collectApprovalInterruptions) stay REAL, so the ref=batchId
// branch and APPROVAL_TOOL_NAMES membership are exercised for real.
vi.mock("@fikirtive/otto", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    otto: { name: "Otto" },
    withLlmBudget: mockWithLlmBudget,
    run: mockRun,
    RunState: MockRunState,
    tryRestoreRunState: async (_agent: unknown, str: string) => {
      try { return await MockRunState.fromString(_agent, str); } catch { return null; }
    },
    // #566: the resume-side restore takes the LIVE context (built before the rehydrate) and — like
    // the real SDK — installs it on the state, which runOttoTurn's fail-closed guard verifies.
    tryRestoreRunStateWithContext: async (_agent: unknown, str: string, context: unknown) => {
      mockRestoreWithContext(_agent, str, context);
      try {
        const state = await MockRunState.fromString(_agent, str);
        if (state) (state as { _context?: unknown })._context = { context };
        return state;
      } catch { return null; }
    },
    MaxTurnsExceededError: MockMaxTurnsExceededError,
  };
});

const { ottoApprove, finalizeOttoRun } = await import("@/lib/otto-actions");
const { runBulkGrid } = await import("@/lib/factory-actions");
const { computeFactoryBatchApprovalContentHash, factoryBatchApprovalHashFromArgs } = await import("@/lib/approval-content-hash");
const { approvalRefOf, APPROVAL_TOOL_NAMES, allSkills } = await import("@fikirtive/otto");
const { INTERNAL_PER_DISPLAY } = await import("@fikirtive/core");
const { factoryAttemptKey } = await import("@/lib/batch-idempotency");

// The REAL registered skill — its `.tool` is the @openai/agents FunctionTool whose invoke(runContext,
// argsJsonString) does the SDK's own zod parse then runs the skill's execute. Invoking it from the
// `run` mock reproduces exactly what the SDK runner does when resuming an approved parked call.
const factorySkillTool = (allSkills as { name: string; tool: { invoke(rc: unknown, input: string): Promise<unknown> } }[])
  .find((s) => s.name === "runFactoryBatch")!.tool;

// ── Fixtures ──────────────────────────────────────────────────────────────────
const OWNER_ID = "owner_factory";
const PROJECT_ID = "proj_factory";
const THREAD_ID = "thread_factory_finalize";
const APPROVE_THREAD_ID = "thread_factory_approve";
const FACTORY_CARD_ID = "card_factory_1";
const BATCH_ID = "6f9619ff-8b86-d011-b42d-00cf4fc964ff"; // UUID convention (skill guidance)
const GATE = { ownerId: OWNER_ID, email: "user@test.com" };

const FACTORY_ARGS = {
  mode: "variant",
  batchId: BATCH_ID,
  name: "Summer ads",
  base: { prompt: "product on white" },
  variants: [{}, { prompt: "hook B — lifestyle shot" }],
};
const FACTORY_HASH = computeFactoryBatchApprovalContentHash({
  mode: "variant",
  batchId: BATCH_ID,
  name: "Summer ads",
  base: FACTORY_ARGS.base,
  variants: FACTORY_ARGS.variants,
  cells: null,
});

function makeFactoryApprovalItem(args: Record<string, unknown>) {
  return {
    type: "tool_approval_item" as const,
    name: "runFactoryBatch",
    arguments: JSON.stringify(args),
    rawItem: { name: "runFactoryBatch", arguments: JSON.stringify(args) },
  };
}

function makeMockResult({ interruptions = [] as unknown[], finalOutput = "" } = {}) {
  return { interruptions, finalOutput, history: [] as unknown[], newItems: [] as unknown[], state: new MockRunState() };
}

async function runTransaction(arg: unknown) {
  if (typeof arg === "function") return (arg as (tx: unknown) => Promise<unknown>)({});
}

function factoryCardPayload(overrides: Record<string, unknown> = {}) {
  return {
    toolName: "runFactoryBatch",
    ref: BATCH_ID,
    status: "pending",
    summary: null,
    contentHash: FACTORY_HASH,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOwner.mockResolvedValue(GATE);
  mockResolveDisabledModels.mockResolvedValue({ disabled: new Set() });
  mockGetBrandContextText.mockResolvedValue("");
  mockEntityFindMany.mockResolvedValue([]);
  mockGenerationFindFirst.mockResolvedValue(null);
  mockGenerationFindMany.mockResolvedValue([]);
  mockGenJobFindFirst.mockResolvedValue(null);
  mockGenJobFindMany.mockResolvedValue([]);
  mockGenJobUpdateMany.mockResolvedValue({ count: 1 });
  mockProjectFindFirst.mockResolvedValue({ id: PROJECT_ID });
  mockGenerationBatchFindFirst.mockResolvedValue(null);
  mockGenerationBatchCreate.mockImplementation(async ({ data }: { data: { id: string } }) => ({ id: data.id }));
  mockScheduledPostFindFirst.mockResolvedValue(null);
  mockChatThreadUpdate.mockResolvedValue({});
  mockChatThreadUpdateMany.mockResolvedValue({ count: 1 });
  mockChatMessageCreate.mockResolvedValue({});
  mockChatMessageUpdateMany.mockResolvedValue({ count: 1 });
  // #498 round-5: the tie-language fallback probes recent USER messages.
  mockChatMessageFindMany.mockResolvedValue([]);
  mockActionEventCreate.mockResolvedValue({});
  mockExecuteRaw.mockResolvedValue(undefined);
  mockTransaction.mockImplementation(runTransaction);
  mockWithLlmBudget.mockImplementation(async (_args: unknown, fn: () => Promise<{ result: unknown }>) => (await fn()).result);
});

// ── Seam unit truths (real approval-tools + real hash normalizer) ───────────────
describe("runFactoryBatch approval seam — ref + hash primitives", () => {
  it("runFactoryBatch is in APPROVAL_TOOL_NAMES and approvalRefOf anchors on batchId", () => {
    expect(APPROVAL_TOOL_NAMES.has("runFactoryBatch")).toBe(true);
    expect(approvalRefOf("runFactoryBatch", FACTORY_ARGS)).toBe(BATCH_ID);
    expect(approvalRefOf("runFactoryBatch", { mode: "grid" })).toBeNull(); // no batchId ⇒ no ref
  });

  it("factoryBatchApprovalHashFromArgs is the single normalization (matches the material hash) and is key-order invariant", () => {
    expect(factoryBatchApprovalHashFromArgs(FACTORY_ARGS)).toBe(FACTORY_HASH);
    // same args, different key insertion order ⇒ SAME hash (canonical key-sorted serialization)
    const reordered = {
      variants: FACTORY_ARGS.variants,
      base: { prompt: "product on white" },
      name: "Summer ads",
      batchId: BATCH_ID,
      mode: "variant",
    };
    expect(factoryBatchApprovalHashFromArgs(reordered)).toBe(FACTORY_HASH);
    // ANY spend-shaping flip ⇒ different hash (anti-flip): a variant added / prompt swapped / mode switched
    expect(factoryBatchApprovalHashFromArgs({ ...FACTORY_ARGS, variants: [...FACTORY_ARGS.variants, {}] })).not.toBe(FACTORY_HASH);
    expect(factoryBatchApprovalHashFromArgs({ ...FACTORY_ARGS, base: { prompt: "SWAPPED" } })).not.toBe(FACTORY_HASH);
    // no bindable consent ⇒ null (fail-closed): missing batchId / unknown mode / no content for the mode
    expect(factoryBatchApprovalHashFromArgs({ ...FACTORY_ARGS, batchId: "" })).toBeNull();
    expect(factoryBatchApprovalHashFromArgs({ ...FACTORY_ARGS, mode: "bogus" })).toBeNull();
    expect(factoryBatchApprovalHashFromArgs({ mode: "variant", batchId: BATCH_ID })).toBeNull();
    expect(factoryBatchApprovalHashFromArgs({ mode: "grid", batchId: BATCH_ID })).toBeNull();
  });

  it("the direct owner-scoped action requires attemptId in a strict envelope", async () => {
    const authCalls = mockRequireOwner.mock.calls.length;
    const missing = await runBulkGrid({
      batchId: BATCH_ID,
      projectId: PROJECT_ID,
      cells: [{ type: "gen", prompt: "a" }],
    });
    const unknownAlias = await runBulkGrid({
      batchId: BATCH_ID,
      projectId: PROJECT_ID,
      attemptId: FACTORY_CARD_ID,
      retryToken: "model-alias",
      cells: [{ type: "gen", prompt: "a" }],
    });

    expect(missing).toHaveProperty("error");
    expect(unknownAlias).toHaveProperty("error");
    expect(mockRequireOwner).toHaveBeenCalledTimes(authCalls); // schema refusal happens before auth/spend
  });
});

// ── Mint (finalizeOttoRun) ──────────────────────────────────────────────────────
describe("runFactoryBatch approval — collect + mint the hash-bound APPROVAL_CARD (was DOA before this wiring)", () => {
  beforeEach(() => {
    mockChatMessageFindFirst.mockImplementation((a: { where?: { kind?: string } } | undefined) =>
      Promise.resolve(a?.where?.kind === "APPROVAL_CARD" ? null : { seq: 3 }),
    );
  });

  it("the parked runFactoryBatch interruption is collected and minted as a pending card bound to (batchId + content hash)", async () => {
    const res = await finalizeOttoRun({
      ownerId: OWNER_ID,
      threadId: THREAD_ID,
      isNew: false,
      priorOttoState: '{"p":1}',
      result: makeMockResult({ interruptions: [makeFactoryApprovalItem(FACTORY_ARGS)], finalOutput: "Run this batch?" }),
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
            toolName: "runFactoryBatch",
            ref: BATCH_ID,
            status: "pending",
            contentHash: FACTORY_HASH, // the EXACT parked args are hash-bound (anti-flip anchor)
            summary: null, // renders via the generic approval-card view (named action)
            expiresAt: expect.any(String),
          }),
        }),
      }),
    );
  });
});

// ── Approve + anti-flip (ottoApprove) ───────────────────────────────────────────
describe("runFactoryBatch approval — ottoApprove verifies the hash, consumes, approves, resumes to the factory port", () => {
  /** What the resume run actually returned per approved parked call (captured by the run mock). */
  let resumedBatchResults: unknown[] = [];
  let capturedResumeCtx: { projectId: string; approvalConsent?: unknown } | null = null;

  function setupFactoryApprove(
    interruptionItems?: unknown[],
    payloadOverrides: Record<string, unknown> = {},
    cardId = FACTORY_CARD_ID,
  ) {
    resumedBatchResults = [];
    capturedResumeCtx = null;
    mockApprove.mockClear();
    mockRun.mockClear();
    mockStartGen.mockClear();
    mockChatThreadFindFirst.mockResolvedValue({ id: APPROVE_THREAD_ID, projectId: PROJECT_ID, ottoState: '{"paused":"state"}' });
    mockRunStateFromString.mockResolvedValue(new MockRunState());
    mockGetInterruptions.mockReturnValue(interruptionItems ?? [makeFactoryApprovalItem(FACTORY_ARGS)]);
    mockChatMessageFindFirst.mockImplementation((a: { where?: { kind?: string } } | undefined) =>
      Promise.resolve(
        a?.where?.kind === "APPROVAL_CARD"
          ? { id: cardId, payload: factoryCardPayload(payloadOverrides) }
          : { seq: 5 },
      ),
    );
    mockStartGen.mockImplementation(async (req: unknown) => ({
      id: `job-${(req as { idempotencyKey: string }).idempotencyKey}`,
      disposition: "fresh",
    }));
    // SDK-resume semantics (NODE-280-R2 ⑥ continuous chain): after ottoApprove calls
    // state.approve(item), the real runner would execute the approved parked tool call — its
    // ORIGINAL arguments string — against the run context. Reproduce that by invoking the REAL
    // runFactoryBatch FunctionTool (zod parse + skill execute → ctx.runFactoryBatch port → real
    // runVariantBatch → orchestrateBatch → mocked startGen), so approve→resume→execute→spend port
    // is ONE unbroken chain instead of a stitched-together assertion.
    mockRun.mockImplementation(async (_agent: unknown, _state: unknown, opts: { context: { projectId: string; approvalConsent?: unknown } }) => {
      capturedResumeCtx = opts.context;
      for (const call of mockApprove.mock.calls) {
        const item = call[0] as { name?: string; arguments?: string };
        if (item?.name === "runFactoryBatch" && item.arguments) {
          resumedBatchResults.push(await factorySkillTool.invoke({ context: opts.context }, item.arguments));
        }
      }
      return makeMockResult({ finalOutput: "Queued your batch." });
    });
  }

  it("happy path — ONE CONTINUOUS chain: hash verifies → CAS-consume BEFORE the resume → approve the parked item → resume executes the REAL parked skill → ctx port → REAL runVariantBatch → orchestrateBatch → per-cell mocked startGen (zero real spend)", async () => {
    setupFactoryApprove();

    const res = await ottoApprove({ threadId: APPROVE_THREAD_ID, cardId: FACTORY_CARD_ID });

    expect(res).toMatchObject({ ok: true, status: "done" });
    // ATOMIC consumption pins payload.status="pending" in the WHERE (AR1 处方2).
    expect(mockChatMessageUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: FACTORY_CARD_ID,
          ownerId: OWNER_ID,
          kind: "APPROVAL_CARD",
          AND: [{ payload: { path: ["status"], equals: "pending" } }],
        }),
        data: expect.objectContaining({ payload: expect.objectContaining({ status: "approved" }) }),
      }),
    );
    // The PARKED runFactoryBatch item was approved (not a generate item).
    expect(mockApprove).toHaveBeenCalledWith(expect.objectContaining({ name: "runFactoryBatch" }), undefined);
    const approvedArgs = JSON.parse((mockApprove.mock.calls[0]![0] as { arguments: string }).arguments) as Record<string, unknown>;
    expect(approvedArgs).not.toHaveProperty("attemptId"); // the model-visible parked call never carries it
    // Resume ran inside withLlmBudget (metered) exactly once.
    expect(mockWithLlmBudget).toHaveBeenCalledTimes(1);
    expect(mockRun).toHaveBeenCalledTimes(1);

    // THE CONTINUOUS CHAIN LANDED: the resume itself (inside ottoApprove) executed the REAL parked
    // skill via FunctionTool.invoke → executeRunFactoryBatch → ctx.runFactoryBatch.variant → REAL
    // runVariantBatch → orchestrateBatch → mocked startGen. No post-hoc manual port drive.
    expect(resumedBatchResults).toHaveLength(1);
    expect(resumedBatchResults[0]).toMatchObject({
      batchId: BATCH_ID,
      dispatched: 2,
      reused: 0,
      failed: 0,
      totalCredits: 2 * INTERNAL_PER_DISPLAY, // per-cell quote unchanged: 1 image cell = 1 displayed credit
    });
    const chainCells = (resumedBatchResults[0] as { cells: { status: string; credits: number }[] }).cells;
    expect(chainCells.map((c) => c.status)).toEqual(["queued", "queued"]);
    expect(chainCells.every((c) => c.credits === INTERNAL_PER_DISPLAY)).toBe(true);
    // Per-cell spend went through the ONLY spend authority with the derived batch keys.
    expect(mockStartGen).toHaveBeenCalledTimes(2);
    expect(mockStartGen).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID, idempotencyKey: factoryAttemptKey(BATCH_ID, 0, FACTORY_CARD_ID).key }),
    );
    expect(mockStartGen).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID, idempotencyKey: factoryAttemptKey(BATCH_ID, 1, FACTORY_CARD_ID).key }),
    );
    // Strict order along the chain: CAS consume → resume(run) → startGen (consume-then-act).
    expect(mockChatMessageUpdateMany.mock.invocationCallOrder[0]!).toBeLessThan(mockRun.mock.invocationCallOrder[0]!);
    expect(mockRun.mock.invocationCallOrder[0]!).toBeLessThan(mockStartGen.mock.invocationCallOrder[0]!);
    // No scheduled-post TOCTOU snapshot for a factory-batch approval (consent = immutable parked args).
    expect(capturedResumeCtx!.approvalConsent).toBeUndefined();
  });

  it("a second click on the consumed card returns already-resolved and never executes the batch again", async () => {
    setupFactoryApprove();
    const first = await ottoApprove({ threadId: APPROVE_THREAD_ID, cardId: FACTORY_CARD_ID });
    expect(first).toMatchObject({ ok: true, status: "done" });
    expect(mockStartGen).toHaveBeenCalledTimes(2);

    mockChatMessageFindFirst.mockImplementation((a: { where?: { kind?: string } } | undefined) =>
      Promise.resolve(
        a?.where?.kind === "APPROVAL_CARD"
          ? { id: FACTORY_CARD_ID, payload: factoryCardPayload({ status: "approved" }) }
          : { seq: 5 },
      ),
    );
    const second = await ottoApprove({ threadId: APPROVE_THREAD_ID, cardId: FACTORY_CARD_ID });

    expect(second).toMatchObject({ ok: true, alreadyResolved: true, resolution: "approved" });
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockStartGen).toHaveBeenCalledTimes(2); // no second batch execution / reserve path
  });

  it("a new approved card injects a distinct server attempt while parked model args stay unchanged", async () => {
    setupFactoryApprove(undefined, {}, FACTORY_CARD_ID);
    const first = await ottoApprove({ threadId: APPROVE_THREAD_ID, cardId: FACTORY_CARD_ID });
    expect(first).toMatchObject({ ok: true, status: "done" });
    const firstKeys = mockStartGen.mock.calls.map((call) => (call[0] as { idempotencyKey: string }).idempotencyKey);

    const nextCardId = "card_factory_2";
    setupFactoryApprove(undefined, {}, nextCardId);
    const second = await ottoApprove({ threadId: APPROVE_THREAD_ID, cardId: nextCardId });
    expect(second).toMatchObject({ ok: true, status: "done" });
    const secondKeys = mockStartGen.mock.calls.map((call) => (call[0] as { idempotencyKey: string }).idempotencyKey);

    expect(firstKeys).toEqual([
      factoryAttemptKey(BATCH_ID, 0, FACTORY_CARD_ID).key,
      factoryAttemptKey(BATCH_ID, 1, FACTORY_CARD_ID).key,
    ]);
    expect(secondKeys).toEqual([
      factoryAttemptKey(BATCH_ID, 0, nextCardId).key,
      factoryAttemptKey(BATCH_ID, 1, nextCardId).key,
    ]);
    expect(secondKeys).not.toEqual(firstKeys);
    const parkedArgs = JSON.parse((mockApprove.mock.calls[0]![0] as { arguments: string }).arguments) as Record<string, unknown>;
    expect(parkedArgs).not.toHaveProperty("attemptId");
  });

  it("anti-flip: the variants were swapped (same batchId) after mint → the card no longer matches any parked call → hard refuse, no consume, no approve, no run", async () => {
    // ref still matches (batchId unchanged), so ONLY the content hash can catch the swap. With the
    // hash-pinned matcher the swapped interruption is simply NOT this card's parked ask.
    setupFactoryApprove([
      makeFactoryApprovalItem({ ...FACTORY_ARGS, variants: [{ prompt: "SWAPPED after consent" }, {}, {}] }),
    ]);

    const res = await ottoApprove({ threadId: APPROVE_THREAD_ID, cardId: FACTORY_CARD_ID });

    expect(res).toMatchObject({ error: expect.stringMatching(/isn't awaiting approval/i) });
    expect(mockChatMessageUpdateMany).not.toHaveBeenCalled(); // NOT consumed — the ask stays re-requestable
    expect(mockApprove).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
    expect(mockStartGen).not.toHaveBeenCalled(); // the continuous chain never starts
    expect(resumedBatchResults).toHaveLength(0);
  });

  it("a hashless card (no bindable consent at mint) is fail-closed unapprovable", async () => {
    setupFactoryApprove(undefined, { contentHash: null });

    const res = await ottoApprove({ threadId: APPROVE_THREAD_ID, cardId: FACTORY_CARD_ID });

    expect(res).toMatchObject({ error: expect.any(String) });
    expect(mockApprove).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
  });
});

// ── Same-batchId re-park dedup semantics ─────────────────────────────────────────
describe("runFactoryBatch approval — same-batchId re-park dedup (hash-pinned card identity)", () => {
  const ARGS_A = FACTORY_ARGS;
  const ARGS_B = { ...FACTORY_ARGS, variants: [{ prompt: "a DIFFERENT second ask, same batchId" }] };
  const HASH_A = FACTORY_HASH;
  const HASH_B = factoryBatchApprovalHashFromArgs(ARGS_B)!;

  it("mint: a re-park of the SAME call reuses its pending card (dedup by toolName+ref+hash), no second card", async () => {
    // The dedup lookup finds an existing pending card for (runFactoryBatch, batchId, HASH_A).
    mockChatMessageFindFirst.mockImplementation((a: { where?: { kind?: string } } | undefined) =>
      Promise.resolve(
        a?.where?.kind === "APPROVAL_CARD" ? { id: FACTORY_CARD_ID } : { seq: 3 },
      ),
    );

    const res = await finalizeOttoRun({
      ownerId: OWNER_ID,
      threadId: THREAD_ID,
      isNew: false,
      priorOttoState: '{"p":1}',
      result: makeMockResult({ interruptions: [makeFactoryApprovalItem(ARGS_A)] }),
      seqAfterUser: 3,
    });

    expect((res as { pendingCardIds: string[] }).pendingCardIds).toEqual([FACTORY_CARD_ID]);
    // No new APPROVAL_CARD row minted (only the dedup lookup ran).
    const cardCreates = mockChatMessageCreate.mock.calls
      .map((c) => (c[0] as { data: { kind: string } }).data)
      .filter((d) => d.kind === "APPROVAL_CARD");
    expect(cardCreates).toHaveLength(0);
    // The dedup WHERE pins the content hash (same args ⇒ same hash ⇒ same card).
    const dedupWhere = (mockChatMessageFindFirst.mock.calls.find(
      (c) => (c[0] as { where?: { kind?: string } })?.where?.kind === "APPROVAL_CARD",
    )![0] as { where: { AND: unknown[] } }).where;
    expect(dedupWhere.AND).toContainEqual({ payload: { path: ["contentHash"], equals: HASH_A } });
  });

  it("mint: two parks with the SAME batchId but different content mint TWO cards with distinct hashes", async () => {
    mockChatMessageFindFirst.mockImplementation((a: { where?: { kind?: string } } | undefined) =>
      Promise.resolve(a?.where?.kind === "APPROVAL_CARD" ? null : { seq: 3 }),
    );

    const res = await finalizeOttoRun({
      ownerId: OWNER_ID,
      threadId: THREAD_ID,
      isNew: false,
      priorOttoState: '{"p":1}',
      result: makeMockResult({ interruptions: [makeFactoryApprovalItem(ARGS_A), makeFactoryApprovalItem(ARGS_B)] }),
      seqAfterUser: 3,
    });

    expect((res as { pendingCardIds: string[] }).pendingCardIds).toHaveLength(2);
    const cardCreates = mockChatMessageCreate.mock.calls
      .map((c) => (c[0] as { data: { kind: string; payload?: { contentHash?: string } } }).data)
      .filter((d) => d.kind === "APPROVAL_CARD");
    expect(cardCreates.map((d) => d.payload?.contentHash)).toEqual([HASH_A, HASH_B]);
    expect(HASH_A).not.toBe(HASH_B);
  });

  function setupTwoParks(cardHash: string) {
    mockChatThreadFindFirst.mockResolvedValue({ id: APPROVE_THREAD_ID, projectId: PROJECT_ID, ottoState: '{"paused":"state"}' });
    mockRunStateFromString.mockResolvedValue(new MockRunState());
    mockGetInterruptions.mockReturnValue([makeFactoryApprovalItem(ARGS_A), makeFactoryApprovalItem(ARGS_B)]);
    mockChatMessageFindFirst.mockImplementation((a: { where?: { kind?: string } } | undefined) =>
      Promise.resolve(
        a?.where?.kind === "APPROVAL_CARD"
          ? { id: FACTORY_CARD_ID, payload: factoryCardPayload({ contentHash: cardHash }) }
          : { seq: 5 },
      ),
    );
    mockRun.mockResolvedValue(makeMockResult({ finalOutput: "Queued." }));
  }

  it("approving card A (hash A) approves the parked call with content A — never the same-batchId sibling", async () => {
    setupTwoParks(HASH_A);

    const res = await ottoApprove({ threadId: APPROVE_THREAD_ID, cardId: FACTORY_CARD_ID });

    expect(res).toMatchObject({ ok: true, status: "done" });
    expect(mockApprove).toHaveBeenCalledTimes(1);
    const approvedItem = mockApprove.mock.calls[0]![0] as { arguments: string };
    expect(approvedItem.arguments).toContain("hook B");
    expect(approvedItem.arguments).not.toContain("DIFFERENT second ask");
  });

  it("approving card B (hash B) approves the parked call with content B — order in the parked list doesn't matter", async () => {
    setupTwoParks(HASH_B);

    const res = await ottoApprove({ threadId: APPROVE_THREAD_ID, cardId: FACTORY_CARD_ID });

    expect(res).toMatchObject({ ok: true, status: "done" });
    expect(mockApprove).toHaveBeenCalledTimes(1);
    const approvedItem = mockApprove.mock.calls[0]![0] as { arguments: string };
    expect(approvedItem.arguments).toContain("DIFFERENT second ask");
    expect(approvedItem.arguments).not.toContain("hook B");
  });
});
