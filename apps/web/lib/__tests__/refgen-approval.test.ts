/**
 * refgen-approval.test.ts — the generateReferences (debt-68) approval wiring (PR #279 P1 fix).
 *
 * Before this fix generateReferences was in APPROVAL_TOOL_NAMES (needsApproval=true) but approvalRefOf
 * had no branch for it → collectApprovalInterruptions dropped the parked call → no card was ever minted
 * → the spend approval was DOA in chat (ottoApprove had nothing to bind). These tests pin the completed
 * end-to-end wiring:
 *   collect (real approval-tools) → finalizeOttoRun mints a hash-bound APPROVAL_CARD → ottoApprove
 *   verifies the content hash, CAS-consumes the card BEFORE the resume, approves the parked item, and
 *   resumes metered.
 * Plus the anti-flip negative: a same-entity args swap (the prompt changed after the card was minted)
 * ⇒ content-hash mismatch ⇒ hard refuse (no consume, no approve, no run). The port-reach with ZERO real
 * spend (executeGenerateReferences → ctx.refgen.generate, MockProvider-style) is proven independently in
 * packages/otto/src/skills/generate-references.test.ts.
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
  realOtto,
  mockOrganizationFindUnique,
  MockInsufficientCredits,
  MockSpendCapBlocked,
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
  // #524: the two typed money refusals `ottoFailureMessage` narrows on. They are only shapes
  // here — nothing in this file throws one — but a `@fikirtive/db` mock that omits them makes
  // every `instanceof` in the error-copy chain explode instead of returning false.
  class MockInsufficientCredits extends Error {
    readonly requiredInternal: number | null;
    readonly balanceInternal: number | null;
    constructor(message = "Not enough credits.", detail?: { requiredInternal?: number | null; balanceInternal?: number | null }) {
      super(message);
      this.name = "InsufficientCredits";
      this.requiredInternal = detail?.requiredInternal ?? null;
      this.balanceInternal = detail?.balanceInternal ?? null;
    }
  }
  class MockSpendCapBlocked extends Error {
    readonly requiredInternal: number;
    readonly capInternal: number | null;
    constructor(detail: { requiredInternal: number; capInternal: number | null }) {
      super("Spend cap reached.");
      this.name = "SpendCapBlocked";
      this.requiredInternal = detail.requiredInternal;
      this.capInternal = detail.capInternal;
    }
  }
  // #524 r3/r5: the approval card is claimed inside withLlmBudget's post-reserve window. A double
  // that ignored `afterReserve` would model a product where consent is never consumed — and one
  // that ignored a FALSE return would run the model for a resolver that LOST the CAS (judge r4 P2).
  //
  // #524 r6(判官 r5 P2):它抛的必须是**生产那一个类**。上一版抛的是这里的本地同名副本,
  // 于是 ottoApprove 里 `e instanceof ReservationNotClaimed` 一律不命中 —— 模型确实没跑
  // (行为看着对),但「输掉 CAS」那条真实错误路由从来没被这两份替身走过。
  //
  // `vi.hoisted` 在任何 import 之前跑,拿不到真类;所以留一个盒子,由下面
  // `vi.mock("@fikirtive/otto")` 的工厂(它有 importOriginal)在注册时填进去。
  const realOtto = { ReservationNotClaimed: null as unknown as new () => Error };
  const mockWithLlmBudget = vi.fn(async (args: unknown, fn: () => Promise<{ result: unknown }>) => {
    const claim = (args as { afterReserve?: () => Promise<boolean> }).afterReserve;
    if (claim && !(await claim())) throw new realOtto.ReservationNotClaimed();
    return (await fn()).result;
  });

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
    realOtto,
    mockOrganizationFindUnique: vi.fn(),
    MockInsufficientCredits,
    MockSpendCapBlocked,
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

/**
 * #524 r6 — the two READ-ONLY ledger questions ottoApprove asks (judge r5 P1-A'①/②).
 *
 *  - finalizedReservations: which per-attempt refIds the ledger has already finished with, so a
 *    retry reserves under one it will still accept. Default: none — a fresh card.
 *  - otherHoldsSince: whether anything besides this turn's own hold was taken for this org since
 *    it was taken. Default "none" — these fixtures hold nothing else, so a failed approval really
 *    did charge nothing, and the card may say so.
 */
const { mockFinalizedReservations, mockOtherHoldsSince } = vi.hoisted(() => ({
  mockFinalizedReservations: vi.fn(async (_orgId: string, _refIds: readonly string[]) => new Set<string>()),
  mockOtherHoldsSince: vi.fn(async (_orgId: string, _refId: string): Promise<"none" | "some" | "unknown"> => "none"),
}));

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
    genJob: { findFirst: mockGenJobFindFirst },
    // #791-1: buildOttoContext reads Project.coworkBrief for the per-turn brief injection.
    // No brief in these fixtures — the point here is the approval path, not the brief.
    project: { findFirst: async () => null },
    entity: { findMany: mockEntityFindMany },
    generation: { findFirst: mockGenerationFindFirst, findMany: mockGenerationFindMany },
    scheduledPost: { findFirst: mockScheduledPostFindFirst },
    actionEvent: { create: mockActionEventCreate },
    $transaction: mockTransaction,
    $executeRaw: mockExecuteRaw,
    // #524: ottoApprove reads the merchant's spend cap before it holds anything.
    organization: { findUnique: mockOrganizationFindUnique },
  },
  InsufficientCredits: MockInsufficientCredits,
  SpendCapBlocked: MockSpendCapBlocked,
  // #524 r6: ottoApprove asks the LEDGER which attempt is still free, and whether a failed
  // approval may claim "nothing was charged". Read-only; defaults say "fresh" and "unknown".
  finalizedReservations: mockFinalizedReservations,
  otherHoldsSince: mockOtherHoldsSince,
}));

// Real @fikirtive/core (newId, presets, etc.) — no search env keys in the test runner, so
// buildOttoContext leaves ctx.research.search unwired (no adapter call). Only the heavy/non-deterministic
// otto exports are mocked; approval-tools (approvalRefOf / collectApprovalInterruptions) stay REAL.
vi.mock("@fikirtive/otto", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  // #524 r6(判官 r5 P2):把生产的 ReservationNotClaimed 交给上面的替身,让它抛真类。
  realOtto.ReservationNotClaimed = actual.ReservationNotClaimed as new () => Error;
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
const { computeRefgenApprovalContentHash } = await import("@/lib/approval-content-hash");

// ── Fixtures ──────────────────────────────────────────────────────────────────
const OWNER_ID = "owner_refgen";
const PROJECT_ID = "proj_refgen";
const THREAD_ID = "thread_refgen_finalize";
const REFGEN_THREAD_ID = "thread_refgen_approve";
const REFGEN_CARD_ID = "card_refgen_1";
const ENTITY_ID = "ent_refgen_abc";
const GATE = { ownerId: OWNER_ID, email: "user@test.com" };

const REFGEN_ARGS = { entityId: ENTITY_ID, prompt: "a red cap on a wooden table", count: 3, mode: "REFSHEET" };
const REFGEN_HASH = computeRefgenApprovalContentHash({
  entityId: ENTITY_ID,
  prompt: REFGEN_ARGS.prompt,
  count: 3,
  mode: "REFSHEET",
  variantName: null,
});

function makeRefgenApprovalItem(args: Record<string, unknown>) {
  return {
    type: "tool_approval_item" as const,
    name: "generateReferences",
    arguments: JSON.stringify(args),
    rawItem: { name: "generateReferences", arguments: JSON.stringify(args) },
  };
}

function makeMockResult({ interruptions = [] as unknown[], finalOutput = "" } = {}) {
  return { interruptions, finalOutput, history: [] as unknown[], newItems: [] as unknown[], state: new MockRunState() };
}

async function runTransaction(arg: unknown) {
  if (typeof arg === "function") return (arg as (tx: unknown) => Promise<unknown>)({});
}

function refgenCardPayload(overrides: Record<string, unknown> = {}) {
  return {
    toolName: "generateReferences",
    ref: ENTITY_ID,
    status: "pending",
    summary: null,
    contentHash: REFGEN_HASH,
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
  mockScheduledPostFindFirst.mockResolvedValue(null);
  mockChatThreadUpdate.mockResolvedValue({});
  mockChatThreadUpdateMany.mockResolvedValue({ count: 1 });
  mockChatMessageCreate.mockResolvedValue({});
  // #498 round-5: the tie-language fallback probes recent USER messages.
  mockChatMessageFindMany.mockResolvedValue([]);
  mockChatMessageUpdateMany.mockResolvedValue({ count: 1 });
  // #524: no spend cap set for these fixtures — the ceiling is not what they are about.
  mockOrganizationFindUnique.mockResolvedValue({ settings: null });
  mockActionEventCreate.mockResolvedValue({});
  mockExecuteRaw.mockResolvedValue(undefined);
  mockTransaction.mockImplementation(runTransaction);
  mockWithLlmBudget.mockImplementation(async (args: unknown, fn: () => Promise<{ result: unknown }>) => {
    // #524 r3/r5: honour the post-reserve claim window — that is where the card is consumed — AND
    // its false return, which means a concurrent resolver won and the model must NOT run.
    const claim = (args as { afterReserve?: () => Promise<boolean> }).afterReserve;
    if (claim && !(await claim())) throw new realOtto.ReservationNotClaimed();
    return (await fn()).result;
  });
});

// ── Mint (finalizeOttoRun) ──────────────────────────────────────────────────────
describe("generateReferences approval — collect + mint the hash-bound APPROVAL_CARD (was DOA before #279)", () => {
  beforeEach(() => {
    mockChatMessageFindFirst.mockImplementation((a: { where?: { kind?: string } } | undefined) =>
      Promise.resolve(a?.where?.kind === "APPROVAL_CARD" ? null : { seq: 3 }),
    );
  });

  it("the parked generateReferences interruption is collected and minted as a pending card bound to (entityId + content hash)", async () => {
    const res = await finalizeOttoRun({
      ownerId: OWNER_ID,
      threadId: THREAD_ID,
      isNew: false,
      priorOttoState: '{"p":1}',
      result: makeMockResult({ interruptions: [makeRefgenApprovalItem(REFGEN_ARGS)], finalOutput: "Want me to generate them?" }),
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
            toolName: "generateReferences",
            ref: ENTITY_ID,
            status: "pending",
            contentHash: REFGEN_HASH, // the EXACT parked args are hash-bound (anti-flip anchor)
            summary: null, // refgen renders via the generic approval-card view (named action)
            expiresAt: expect.any(String),
          }),
        }),
      }),
    );
  });
});

// ── Approve + anti-flip (ottoApprove) ───────────────────────────────────────────
describe("generateReferences approval — ottoApprove verifies the hash, consumes, approves the parked item, resumes", () => {
  function setupRefgenApprove(interruptionItems?: unknown[], payloadOverrides: Record<string, unknown> = {}) {
    mockChatThreadFindFirst.mockResolvedValue({ id: REFGEN_THREAD_ID, projectId: PROJECT_ID, ottoState: '{"paused":"state"}' });
    mockRunStateFromString.mockResolvedValue(new MockRunState());
    mockGetInterruptions.mockReturnValue(interruptionItems ?? [makeRefgenApprovalItem(REFGEN_ARGS)]);
    mockChatMessageFindFirst.mockImplementation((a: { where?: { kind?: string } } | undefined) =>
      Promise.resolve(
        a?.where?.kind === "APPROVAL_CARD"
          ? { id: REFGEN_CARD_ID, payload: refgenCardPayload(payloadOverrides) }
          : { seq: 5 },
      ),
    );
    mockRun.mockResolvedValue(makeMockResult({ finalOutput: "Queued your references." }));
  }

  it("happy path: hash verifies → CAS-consume pending→approved BEFORE the resume → approve the parked generateReferences item → resume metered", async () => {
    setupRefgenApprove();

    const res = await ottoApprove({ threadId: REFGEN_THREAD_ID, cardId: REFGEN_CARD_ID });

    expect(res).toMatchObject({ ok: true, status: "done" });
    // ATOMIC consumption pins payload.status="pending" in the WHERE (AR1 处方2).
    expect(mockChatMessageUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: REFGEN_CARD_ID,
          ownerId: OWNER_ID,
          kind: "APPROVAL_CARD",
          AND: [{ payload: { path: ["status"], equals: "pending" } }],
        }),
        data: expect.objectContaining({ payload: expect.objectContaining({ status: "approved" }) }),
      }),
    );
    // The PARKED generateReferences item was approved (not a generate item).
    expect(mockApprove).toHaveBeenCalledWith(expect.objectContaining({ name: "generateReferences" }), undefined);
    // Resume ran inside withLlmBudget (metered) exactly once.
    expect(mockWithLlmBudget).toHaveBeenCalledTimes(1);
    expect(mockRun).toHaveBeenCalled();
    // Consume strictly precedes the resume (consume-then-act — a losing double-click never spends).
    expect(mockChatMessageUpdateMany.mock.invocationCallOrder[0]!).toBeLessThan(mockRun.mock.invocationCallOrder[0]!);
    // No scheduled-post TOCTOU snapshot for a refgen approval (its consent is the immutable parked args).
    const resumeCtx = (mockRun.mock.calls[0]![2] as { context: { approvalConsent?: unknown } }).context;
    expect(resumeCtx.approvalConsent).toBeUndefined();
  });

  it("anti-flip: the prompt was swapped (same entity) after mint → the card no longer matches any parked call → hard refuse, no consume, no approve, no run", async () => {
    // ref still matches (entityId unchanged), so ONLY the content hash can catch the swap. With the
    // hash-pinned matcher (P2 ref collision fix) the swapped interruption is simply NOT this card's
    // parked ask — refusal, zero consume, zero approve, zero run.
    setupRefgenApprove([makeRefgenApprovalItem({ ...REFGEN_ARGS, prompt: "a BLUE cap — swapped after consent" })]);

    const res = await ottoApprove({ threadId: REFGEN_THREAD_ID, cardId: REFGEN_CARD_ID });

    expect(res).toMatchObject({ error: expect.stringMatching(/isn't awaiting approval/i) });
    expect(mockChatMessageUpdateMany).not.toHaveBeenCalled(); // NOT consumed — the ask stays re-requestable
    expect(mockApprove).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("a hashless card (no bindable consent at mint) is fail-closed unapprovable", async () => {
    setupRefgenApprove(undefined, { contentHash: null });

    const res = await ottoApprove({ threadId: REFGEN_THREAD_ID, cardId: REFGEN_CARD_ID });

    expect(res).toMatchObject({ error: expect.any(String) });
    expect(mockApprove).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
  });
});

// ── P2 ref collision (控制面独立发现): ref=entityId is NOT unique across two same-entity parks ──────
describe("generateReferences approval — same-entity multi-park (P2 ref collision): each card binds ITS OWN parked call", () => {
  const ARGS_A = { entityId: ENTITY_ID, prompt: "prompt A — a red cap", count: 2, mode: "REFSHEET" };
  const ARGS_B = { entityId: ENTITY_ID, prompt: "prompt B — a blue scarf", count: 1, mode: "BASE" };
  const HASH_A = computeRefgenApprovalContentHash({ entityId: ENTITY_ID, prompt: ARGS_A.prompt, count: 2, mode: "REFSHEET", variantName: null });
  const HASH_B = computeRefgenApprovalContentHash({ entityId: ENTITY_ID, prompt: ARGS_B.prompt, count: 1, mode: "BASE", variantName: null });

  it("mint: two same-entity parks with different prompts mint TWO cards (dedup discriminates by contentHash, not just ref)", async () => {
    mockChatMessageFindFirst.mockImplementation((a: { where?: { kind?: string } } | undefined) =>
      Promise.resolve(a?.where?.kind === "APPROVAL_CARD" ? null : { seq: 3 }),
    );

    const res = await finalizeOttoRun({
      ownerId: OWNER_ID,
      threadId: THREAD_ID,
      isNew: false,
      priorOttoState: '{"p":1}',
      result: makeMockResult({ interruptions: [makeRefgenApprovalItem(ARGS_A), makeRefgenApprovalItem(ARGS_B)] }),
      seqAfterUser: 3,
    });

    expect((res as { pendingCardIds: string[] }).pendingCardIds).toHaveLength(2);
    const cardCreates = mockChatMessageCreate.mock.calls
      .map((c) => (c[0] as { data: { kind: string; payload?: { contentHash?: string } } }).data)
      .filter((d) => d.kind === "APPROVAL_CARD");
    expect(cardCreates.map((d) => d.payload?.contentHash)).toEqual([HASH_A, HASH_B]);
    // The dedup lookup itself pins the hash (a same-args re-park still reuses its card; a different
    // ask for the same entity does NOT steal it).
    const dedupWhere = (mockChatMessageFindFirst.mock.calls.find(
      (c) => (c[0] as { where?: { kind?: string } })?.where?.kind === "APPROVAL_CARD",
    )![0] as { where: { AND: unknown[] } }).where;
    expect(dedupWhere.AND).toContainEqual({ payload: { path: ["contentHash"], equals: HASH_A } });
  });

  function setupTwoParks(cardHash: string) {
    mockChatThreadFindFirst.mockResolvedValue({ id: REFGEN_THREAD_ID, projectId: PROJECT_ID, ottoState: '{"paused":"state"}' });
    mockRunStateFromString.mockResolvedValue(new MockRunState());
    mockGetInterruptions.mockReturnValue([makeRefgenApprovalItem(ARGS_A), makeRefgenApprovalItem(ARGS_B)]);
    mockChatMessageFindFirst.mockImplementation((a: { where?: { kind?: string } } | undefined) =>
      Promise.resolve(
        a?.where?.kind === "APPROVAL_CARD"
          ? { id: REFGEN_CARD_ID, payload: refgenCardPayload({ contentHash: cardHash }) }
          : { seq: 5 },
      ),
    );
    mockRun.mockResolvedValue(makeMockResult({ finalOutput: "Queued." }));
  }

  it("approving card A (hash A) approves the parked call with prompt A — never the same-entity sibling", async () => {
    setupTwoParks(HASH_A);

    const res = await ottoApprove({ threadId: REFGEN_THREAD_ID, cardId: REFGEN_CARD_ID });

    expect(res).toMatchObject({ ok: true, status: "done" });
    expect(mockApprove).toHaveBeenCalledTimes(1);
    const approvedItem = mockApprove.mock.calls[0]![0] as { arguments: string };
    expect(approvedItem.arguments).toContain("prompt A");
    expect(approvedItem.arguments).not.toContain("prompt B");
  });

  it("approving card B (hash B) approves the parked call with prompt B — order in the parked list doesn't matter", async () => {
    setupTwoParks(HASH_B);

    const res = await ottoApprove({ threadId: REFGEN_THREAD_ID, cardId: REFGEN_CARD_ID });

    expect(res).toMatchObject({ ok: true, status: "done" });
    expect(mockApprove).toHaveBeenCalledTimes(1);
    const approvedItem = mockApprove.mock.calls[0]![0] as { arguments: string };
    expect(approvedItem.arguments).toContain("prompt B");
    expect(approvedItem.arguments).not.toContain("prompt A");
  });
});

// ── #524 r6(判官 r5 P2):输掉 CAS 的那条**真实错误路由** ────────────────────────────
//
// 上一版的替身抛的是本地同名副本,生产里的 `e instanceof ReservationNotClaimed` 一律不命中,
// 于是这条分支从来没被这份测试走过 —— 模型确实没跑(行为看着对),但「输家怎么被回答」这件事
// 一个断言都没有。现在替身抛的是真类,下面两条钉的正是那条路由的出口。
describe("generateReferences approval — a LOST claim routes through the production branch (#524 r6)", () => {
  function setupLostClaim(afterLoss: "approved" | "pending") {
    mockChatThreadFindFirst.mockResolvedValue({ id: REFGEN_THREAD_ID, projectId: PROJECT_ID, ottoState: '{"paused":"state"}' });
    mockRunStateFromString.mockResolvedValue(new MockRunState());
    mockGetInterruptions.mockReturnValue([makeRefgenApprovalItem(REFGEN_ARGS)]);
    mockRun.mockResolvedValue(makeMockResult({ finalOutput: "should never run" }));
    // Every resolver starts on a card that still reads pending — that is why it reserves at all.
    let approvalReads = 0;
    mockChatMessageFindFirst.mockImplementation((a: { where?: { kind?: string } } | undefined) => {
      if (a?.where?.kind !== "APPROVAL_CARD") return Promise.resolve({ seq: 5 });
      approvalReads += 1;
      return Promise.resolve({
        id: REFGEN_CARD_ID,
        payload: refgenCardPayload(approvalReads === 1 ? {} : { status: afterLoss }),
      });
    });
    // The CAS goes against this resolver: someone else already consumed the consent.
    mockChatMessageUpdateMany.mockResolvedValue({ count: 0 });
  }

  it("the winner's resolution is REPORTED (never invented), and the model never ran", async () => {
    setupLostClaim("approved");

    const res = await ottoApprove({ threadId: REFGEN_THREAD_ID, cardId: REFGEN_CARD_ID });

    // Only the `instanceof ReservationNotClaimed` branch produces this shape; a look-alike class
    // would have fallen through to the generic "Couldn't approve" catch instead.
    expect(res).toEqual({ ok: true, alreadyResolved: true, resolution: "approved" });
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("a loss it cannot PROVE is an honest error, never a cheerful approved", async () => {
    setupLostClaim("pending");

    const res = await ottoApprove({ threadId: REFGEN_THREAD_ID, cardId: REFGEN_CARD_ID });

    expect(res).toMatchObject({ error: expect.stringContaining("Couldn't confirm this approval") });
    expect(res).not.toHaveProperty("resolution");
    expect(mockRun).not.toHaveBeenCalled();
  });
});
