import { describe, expect, it, vi, beforeEach } from "vitest";
import { getPrincipal, type Principal } from "@fikirtive/db/principal";
import { OTTO_TURN_RATE_LIMIT_MESSAGE } from "@/lib/rate-limit-gates";
import {
  referenceUnavailableMessage,
  MAX_TURN_REFERENCES,
  TOO_MANY_REFERENCES_SENTENCE,
  TURN_REQUEST_GENERIC_REFUSAL,
} from "@fikirtive/core";

const mocks = vi.hoisted(() => {
  class MockInsufficientCredits extends Error {
    // #791-7: the real InsufficientCredits carries the two numbers the merchant is told
    // (what they hold, what the turn needs). The double must carry them too, or this suite
    // would pass while the route printed "undefined credits".
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

  // #524 — the route now tells the two refusals apart (out of credits vs the merchant's own
  // spend cap), so the double for the cap error has to exist here too.
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

  const parts: unknown[] = [];

  return {
    parts,
    MockInsufficientCredits,
    MockSpendCapBlocked,
    requireOwner: vi.fn(),
    isImpersonating: vi.fn(),
    consumeOttoTurnGate: vi.fn(),
    // ENGINE-A2 (spec §7.2②): the turn-trace writer this route hands its facts to.
    recordOttoTurnTrace: vi.fn(async (_facts: unknown) => {}),
    projectFindFirst: vi.fn(),
    chatThreadCreate: vi.fn(),
    chatThreadFindFirst: vi.fn(),
    chatThreadUpdateMany: vi.fn(),
    chatMessageCreate: vi.fn(),
    chatMessageFindFirst: vi.fn(),
    generationFindFirst: vi.fn(),
    // FRONT-A10: the media half of `resolveOwnedReferenceRefs` (generations + uploads).
    generationFindMany: vi.fn(),
    genJobFindFirst: vi.fn(),
    creditLedgerFindMany: vi.fn(),
    entityFindMany: vi.fn(),
    memoryFindMany: vi.fn(),
    buildOttoContext: vi.fn(),
    buildContextSystemMessage: vi.fn(),
    finalizeOttoRun: vi.fn(),
    validateOttoTurnReferences: vi.fn(),
    validateOwnedGenerationExt: vi.fn(),
    withLlmBudget: vi.fn(),
    run: vi.fn(),
    // ENGINE-A6 (判官落修 A6-P1-2): the route only enters the history-budget path when a prior
    // RunState really restores. The REAL tryRestoreRunState wraps RunState.fromString, which
    // cannot restore against the `{ name: "Otto" }` double below — so it returned null in every
    // case in this file and the whole ENGINE-A6 path was never executed here. Default stays null
    // (the F24 fresh-start behaviour every existing case relies on); the A6 cases install a state.
    tryRestoreRunState: vi.fn(async (_agent: unknown, _serialized: string) => null as unknown),
    // ENGINE-A6: 摘要落盘的那个写入口。这个文件是 DB-free 的,所以这里只核「被叫了没、带的是
    // 哪一条线程与哪个 ownerId」—— where 子句(含 `deletedAt: null`)的断言在 otto-actions.test.ts。
    saveRollingSummary: vi.fn(async (_threadId: string, _ownerId: string, _summary: string) => {}),
  };
});

vi.mock("ai", () => ({
  createUIMessageStream: (stream: unknown) => stream,
  createUIMessageStreamResponse: async ({ stream }: { stream: { execute: (args: { writer: { write: (part: unknown) => void } }) => Promise<void> } }) => {
    mocks.parts.length = 0;
    await stream.execute({ writer: { write: (part) => mocks.parts.push(part) } });
    return Response.json(mocks.parts);
  },
}));

vi.mock("@/lib/auth-guard", async () => ({ requireOwner: mocks.requireOwner, resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: mocks.isImpersonating }));
// Founder 2026-08-18 — the conversation gate is a REAL Postgres counter that fails CLOSED when it
// cannot reach the database (packages/db/src/rate-limit.ts says so on purpose). This suite is
// deliberately DB-free, so an unmocked gate would refuse every turn and turn the file red for a
// reason that has nothing to do with what it tests. Granted by default; the gate's own numbers are
// covered in rate-limit-gates.test.ts, and the WIRING — that this route really consults it, and
// what a refusal costs — is pinned by its own case below.
vi.mock("@/lib/rate-limit-gates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit-gates")>()),
  consumeOttoTurnGate: mocks.consumeOttoTurnGate,
}));
vi.mock("@/lib/otto-actions", async () => {
  // 措辞不打桩:路由回给商家的那一句必须真的来自 `gen-failure.ts` 的那张表,否则下面那条
  // 断言只是在核对一个我们刚编出来的字符串(QA-CRE-FE9-013)。
  const { referenceUnavailableMessage } = await import("@fikirtive/core");
  return {
    buildOttoContext: mocks.buildOttoContext,
    buildContextSystemMessage: mocks.buildContextSystemMessage,
    finalizeOttoRun: mocks.finalizeOttoRun,
    validateOttoTurnReferences: mocks.validateOttoTurnReferences,
    unavailableReferenceMessage: (unavailable: { reason: "notFound" | "fileMissing" }[]) =>
      referenceUnavailableMessage(unavailable[0]?.reason ?? "notFound"),
    // ENGINE-A2 (规格 docs/specs/otto-engine.md §7.2②): 这条路由把每轮调试档案交给
    // otto-actions 里那个唯一的写入口。这个文件是 DB-free 的,所以替身只记「被叫了没、
    // 拿到的是什么」—— 落盘那一刀的断言在 otto-actions.test.ts。
    recordOttoTurnTrace: mocks.recordOttoTurnTrace,
    // ENGINE-A6 (规格 §7.2④): 折叠好的滚动摘要由 otto-actions 里那个唯一的写入口落盘。
    saveRollingSummary: mocks.saveRollingSummary,
  };
});
vi.mock("@/lib/otto-generation-validate", () => ({
  validateOwnedGenerationExt: mocks.validateOwnedGenerationExt,
}));
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
  InsufficientCredits: mocks.MockInsufficientCredits,
  SpendCapBlocked: mocks.MockSpendCapBlocked,
  prisma: {
    project: { findFirst: mocks.projectFindFirst },
    chatThread: {
      create: mocks.chatThreadCreate,
      findFirst: mocks.chatThreadFindFirst,
      updateMany: mocks.chatThreadUpdateMany,
    },
    chatMessage: {
      create: mocks.chatMessageCreate,
      findFirst: mocks.chatMessageFindFirst,
    },
    generation: { findFirst: mocks.generationFindFirst, findMany: mocks.generationFindMany },
    genJob: { findFirst: mocks.genJobFindFirst },
    creditLedger: { findMany: mocks.creditLedgerFindMany },
    entity: { findMany: mocks.entityFindMany },
    memory: { findMany: mocks.memoryFindMany },
  },
  // #524 r6: ottoApprove asks the LEDGER which attempt is still free, and whether a failed
  // approval may claim "nothing was charged". Read-only; defaults say "fresh" and "unknown".
  finalizedReservations: mockFinalizedReservations,
  otherHoldsSince: mockOtherHoldsSince,
}));
vi.mock("@fikirtive/otto", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    otto: { name: "Otto" },
    withLlmBudget: mocks.withLlmBudget,
    run: mocks.run,
    tryRestoreRunState: mocks.tryRestoreRunState,
  };
});

// The route decides "this was a MaxTurns degrade" with `instanceof MaxTurnsExceededError`,
// so the test throws the REAL class the runtime is wired with — a look-alike would take the
// generic-error branch and silently prove nothing.
const { MaxTurnsExceededError, estimateHistoryTokens, OTTO_HISTORY_BUDGET_TOKENS } = await import("@fikirtive/otto");
const { POST } = await import("@/app/api/otto/stream/route");

function req(body: unknown) {
  return { json: async () => body } as never;
}

function tokenEvent(delta: string) {
  return {
    type: "raw_model_stream_event" as const,
    data: { type: "output_text_delta", delta },
  };
}

/** One reasoning item — the shape behind the merchant-visible "Otto's thinking" block. */
function reasoningEvent(text: string) {
  return {
    type: "run_item_stream_event" as const,
    name: "reasoning_item_created",
    item: { rawItem: { content: [{ text }] } },
  };
}

function streamedRunResult(args: {
  events: unknown[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    requestUsageEntries?: Array<{
      inputTokens: number;
      outputTokens: number;
      inputTokensDetails: Record<string, number>;
    }>;
  };
}) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of args.events) yield event;
    },
    completed: Promise.resolve(undefined),
    state: {
      usage: args.usage ?? {
        inputTokens: 0,
        outputTokens: 0,
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.consumeOttoTurnGate.mockResolvedValue(true);
  mocks.parts.length = 0;
  mocks.requireOwner.mockResolvedValue({ ownerId: "org_stream", email: "owner@example.com" });
  mocks.isImpersonating.mockResolvedValue(false);
  mocks.projectFindFirst.mockResolvedValue({ id: "proj_stream" });
  mocks.chatThreadCreate.mockResolvedValue({});
  mocks.chatMessageCreate.mockResolvedValue({});
  mocks.chatMessageFindFirst.mockResolvedValue(null);
  // #555: the turn's SETTLED rows (RESERVE -120 + SETTLE +87 = -33 internal = 3.3 credits).
  // A SETTLE row must be present — a bare RESERVE is a hold, never a cost (round-2 P1③).
  mocks.creditLedgerFindMany.mockResolvedValue([
    { kind: "RESERVE", balanceDelta: -120 },
    { kind: "SETTLE", balanceDelta: 87 },
  ]);
  mocks.buildOttoContext.mockResolvedValue({
    orgId: "org_stream",
    userId: "org_stream",
    projectId: "proj_stream",
    threadId: "thread_stream",
    images: [],
    disabledModels: [],
  });
  mocks.buildContextSystemMessage.mockReturnValue(null);
  mocks.tryRestoreRunState.mockResolvedValue(null);
  mocks.finalizeOttoRun.mockResolvedValue({ status: "completed" });
  mocks.validateOttoTurnReferences.mockImplementation(async (input: {
    sourceGenerationId?: string | null;
    sourceGenerationIds?: string[] | null;
    referenceVideoGenerationId?: string | null;
    referenceVideoGenerationIds?: string[] | null;
  }) => ({
    sourceGenerationIds: [...(input.sourceGenerationIds ?? []), ...(input.sourceGenerationId ? [input.sourceGenerationId] : [])],
    referenceVideoGenerationIds: [
      ...(input.referenceVideoGenerationIds ?? []),
      ...(input.referenceVideoGenerationId ? [input.referenceVideoGenerationId] : []),
    ],
    mediaReferences: [],
    unavailable: [],
  }));
  mocks.withLlmBudget.mockImplementation(
    async (_args: unknown, fn: () => Promise<{ result: unknown; usage?: unknown }>) => {
      const out = await fn();
      return out.result;
    },
  );
});

describe("POST /api/otto/stream", () => {
  it("streams a successful Otto turn inside the LLM budget, returns usage for settlement, and finalizes the run", async () => {
    let runCalledInsideBudget = false;
    let usageForSettlement: unknown = null;
    const streamed = streamedRunResult({
      events: [tokenEvent("Done")],
      usage: {
        inputTokens: 120,
        outputTokens: 30,
        requestUsageEntries: [
          { inputTokens: 120, outputTokens: 30, inputTokensDetails: { cached_tokens: 50 } },
        ],
      },
    });
    mocks.run.mockResolvedValue(streamed);
    mocks.withLlmBudget.mockImplementation(
      async (_args: unknown, fn: () => Promise<{ result: unknown; usage?: unknown }>) => {
        const out = await fn();
        runCalledInsideBudget = mocks.run.mock.calls.length > 0;
        usageForSettlement = out.usage;
        return out.result;
      },
    );

    const res = await POST(req({ projectId: "proj_stream", text: "Make a launch post" }));
    const parts = await res.json();

    expect(res.status).toBe(200);
    expect(mocks.withLlmBudget).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org_stream",
        refId: expect.stringMatching(/^otto-stream:/),
        paid: true,
      }),
      expect.any(Function),
    );
    expect(runCalledInsideBudget).toBe(true);
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Otto" }),
      expect.any(Array),
      expect.objectContaining({
        context: expect.objectContaining({ orgId: "org_stream", projectId: "proj_stream" }),
        stream: true,
      }),
    );
    expect(usageForSettlement).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      cachedInputTokens: 50,
    });
    const finalized = mocks.finalizeOttoRun.mock.calls[0]?.[0] as { threadId?: string } | undefined;
    const threadId = finalized?.threadId;
    expect(threadId).toEqual(expect.any(String));
    expect(mocks.finalizeOttoRun).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "org_stream",
        threadId,
        isNew: true,
        priorOttoState: null,
        result: streamed,
        seqAfterUser: 1,
      }),
    );
    expect(parts).toEqual(
      expect.arrayContaining([
        { type: "text-start", id: "otto-text" },
        { type: "text-delta", id: "otto-text", delta: "Done" },
        { type: "text-end", id: "otto-text" },
        { type: "data-status", data: { kind: "done", threadId } },
      ]),
    );
  });

  // ENGINE-A2(规格 docs/specs/otto-engine.md §7.2②):流式这一门确实把档案交出去了。
  // 这个用例跑的是**真的** runOttoTurn(本文件只替身 withLlmBudget 与 run),所以它验的是
  // 端口接线本身,不是一个替身在自说自话。
  it("ENGINE-A2: 流式一轮跑完,把这一轮的结构事实交给唯一的写入口(surface=stream)", async () => {
    mocks.run.mockResolvedValue(
      streamedRunResult({ events: [tokenEvent("Done")], usage: { inputTokens: 10, outputTokens: 5 } }),
    );

    const res = await POST(req({ projectId: "proj_stream", text: "Make a launch post" }));
    await res.json();

    expect(mocks.recordOttoTurnTrace).toHaveBeenCalledTimes(1);
    const facts = mocks.recordOttoTurnTrace.mock.calls[0]![0] as Record<string, unknown>;
    expect(facts.surface).toBe("stream");
    expect(facts.orgId).toBe("org_stream");
    expect(facts.refId).toEqual(expect.stringMatching(/^otto-stream:/));
    expect(facts.threadId).toEqual(expect.any(String));
    // ⑥段(ENGINE-A7)之后这一栏不再恒为空:装配器报出这一轮装了哪几份知识文件。
    // 常驻薄层永远在,而且每一份都必须是真柜文 —— 名单是 build 期的柜子本身。
    expect(facts.skillFiles).toContain("_core.md");
    for (const f of facts.skillFiles as string[]) {
      expect(f, `${f} 不是柜文`).toMatch(/^(?:_core\.md|craft\/|playbooks\/|product-map\/)/);
    }
    // 商家写的那句话不在档案里 —— 围栏在引擎侧是类型层的,这里再当场看一眼。
    expect(JSON.stringify(facts)).not.toContain("Make a launch post");
  });

  it("validates and threads multiple canvas references into the Otto context", async () => {
    mocks.run.mockResolvedValue(streamedRunResult({ events: [] }));

    const res = await POST(req({
      projectId: "proj_stream",
      text: "Use these refs",
      sourceGenerationIds: ["gen_img_1", "gen_img_2"],
      referenceVideoGenerationIds: ["gen_vid_1", "gen_vid_2"],
    }));

    expect(res.status).toBe(200);
    expect(mocks.validateOttoTurnReferences).toHaveBeenCalledWith({
      ownerId: "org_stream",
      projectId: "proj_stream",
      sourceGenerationId: undefined,
      sourceGenerationIds: ["gen_img_1", "gen_img_2"],
      referenceVideoGenerationId: undefined,
      referenceVideoGenerationIds: ["gen_vid_1", "gen_vid_2"],
    });
    expect(mocks.buildOttoContext).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: "org_stream",
      projectId: "proj_stream",
      sourceGenerationIds: ["gen_img_1", "gen_img_2"],
      referenceVideoGenerationIds: ["gen_vid_1", "gen_vid_2"],
    }));
    expect(mocks.chatMessageCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        payload: expect.objectContaining({
          sourceGenerationIds: ["gen_img_1", "gen_img_2"],
          referenceVideoGenerationIds: ["gen_vid_1", "gen_vid_2"],
        }),
      }),
    }));
  });

  /**
   * CREATE-A2(Codex 只读 E2E QA-CRE-FE9-013)—— 挂上来的引用取不到时,这一轮**整轮不发**。
   *
   * 上一版这里是静默丢弃:解析器把取不到的滤成空数组,路由照常建对话、落 USER 消息、开流,
   * Otto 按「没有产品参考」的前提铸卡,商家为一张不含指定产品的素材付了钱。
   */
  it("CREATE-A2 一件引用取不到:400 + 那一句人话,而且不建对话、不落 USER 消息、不开流", async () => {
    mocks.validateOttoTurnReferences.mockResolvedValue({
      sourceGenerationIds: [],
      referenceVideoGenerationIds: [],
      mediaReferences: [],
      unavailable: [{ id: "gen_cup", reason: "notFound" }],
    });

    const res = await POST(req({
      projectId: "proj_stream",
      text: "Put my cup on a marble counter",
      sourceGenerationIds: ["gen_cup"],
    }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: referenceUnavailableMessage("notFound") });
    expect(mocks.chatThreadCreate).not.toHaveBeenCalled();
    expect(mocks.chatMessageCreate).not.toHaveBeenCalled();
    expect(mocks.buildOttoContext).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  // #498: the verbal-approval repro (storyboard → Otto invites "全部生成" → merchant sends
  // it) parks the gated generate call(s) with zero model narration; before the fix the
  // stream carried ONLY an invisible data-status part — total silence. These lock the fix.
  it("#498 a run that pauses without narration streams the synthesized reply before needs_approval", async () => {
    mocks.run.mockResolvedValue(streamedRunResult({ events: [] }));
    mocks.finalizeOttoRun.mockResolvedValue({
      status: "needs_approval",
      pendingCardIds: ["card_1", "card_2", "card_3"],
      fallbackReply: "To keep your credits safe, nothing is made from words alone — confirm each card above and I'll start right away.",
    });

    const res = await POST(req({ projectId: "proj_stream", text: "全部生成" }));
    const parts = (await res.json()) as Array<{ type: string }>;

    expect(res.status).toBe(200);
    expect(parts).toEqual(
      expect.arrayContaining([
        { type: "text-start", id: "otto-text" },
        {
          type: "text-delta",
          id: "otto-text",
          delta: "To keep your credits safe, nothing is made from words alone — confirm each card above and I'll start right away.",
        },
        { type: "text-end", id: "otto-text" },
        { type: "data-status", data: { kind: "needs_approval", pendingCardIds: ["card_1", "card_2", "card_3"] } },
      ]),
    );
    // The reply renders BEFORE the status part (the status itself has no visible UI).
    const textIdx = parts.findIndex((p) => p.type === "text-delta");
    const statusIdx = parts.findIndex((p) => p.type === "data-status");
    expect(textIdx).toBeGreaterThanOrEqual(0);
    expect(textIdx).toBeLessThan(statusIdx);
  });

  it("#498 no synthesized reply when the model narrated itself (fallbackReply null → no extra text part)", async () => {
    mocks.run.mockResolvedValue(streamedRunResult({ events: [tokenEvent("Confirm on the cards to start.")] }));
    mocks.finalizeOttoRun.mockResolvedValue({
      status: "needs_approval",
      pendingCardIds: ["card_1"],
      fallbackReply: null,
    });

    const res = await POST(req({ projectId: "proj_stream", text: "全部生成" }));
    const parts = (await res.json()) as Array<{ type: string; delta?: string }>;

    expect(res.status).toBe(200);
    expect(parts).toContainEqual({ type: "data-status", data: { kind: "needs_approval", pendingCardIds: ["card_1"] } });
    // Exactly the model's own streamed text — nothing synthesized on top.
    expect(parts.filter((p) => p.type === "text-delta")).toEqual([
      { type: "text-delta", id: "otto-text", delta: "Confirm on the cards to start." },
    ]);
  });

  // #498 round-3: "the fallback only exists when nothing streamed" is now a CHECKED
  // invariant (textWasStreamed), not an assumption about the post-run text extraction.
  it("#498 textWasStreamed guard: a fallbackReply arriving despite streamed model text is never rendered on top", async () => {
    mocks.run.mockResolvedValue(streamedRunResult({ events: [tokenEvent("Streamed but missed by extraction.")] }));
    // Adversarial finalize: extraction saw no text and synthesized a fallback anyway.
    mocks.finalizeOttoRun.mockResolvedValue({
      status: "needs_approval",
      pendingCardIds: ["card_1"],
      fallbackReply: "To keep your credits safe, nothing is made from words alone — confirm on the card above and I'll start right away.",
    });

    const res = await POST(req({ projectId: "proj_stream", text: "全部生成" }));
    const parts = (await res.json()) as Array<{ type: string; delta?: string }>;

    expect(res.status).toBe(200);
    // The pause still surfaces; the fallback text does NOT double the streamed text.
    expect(parts).toContainEqual({ type: "data-status", data: { kind: "needs_approval", pendingCardIds: ["card_1"] } });
    expect(parts.filter((p) => p.type === "text-delta")).toEqual([
      { type: "text-delta", id: "otto-text", delta: "Streamed but missed by extraction." },
    ]);
  });

  // #498 round-4: textWasStreamed only counts NON-whitespace deltas. A model that
  // emits a lone "\n" (or spaces) before parking showed the merchant nothing
  // readable — the whitespace stream must not suppress the synthesized fallback.
  it("#498 round-4: a whitespace-only streamed delta does NOT suppress the synthesized fallback", async () => {
    mocks.run.mockResolvedValue(streamedRunResult({ events: [tokenEvent("\n"), tokenEvent("  ")] }));
    mocks.finalizeOttoRun.mockResolvedValue({
      status: "needs_approval",
      pendingCardIds: ["card_1"],
      fallbackReply: "To keep your credits safe, nothing is made from words alone — confirm on the card above and I'll start right away.",
    });

    const res = await POST(req({ projectId: "proj_stream", text: "全部生成" }));
    const parts = (await res.json()) as Array<{ type: string; delta?: string }>;

    expect(res.status).toBe(200);
    expect(parts).toContainEqual({ type: "data-status", data: { kind: "needs_approval", pendingCardIds: ["card_1"] } });
    // The whitespace deltas streamed as-is AND the fallback still rendered.
    const deltas = parts.filter((p) => p.type === "text-delta").map((p) => p.delta);
    expect(deltas).toContain(
      "To keep your credits safe, nothing is made from words alone — confirm on the card above and I'll start right away.",
    );
  });

  it("#498 P2: the merchant's message text reaches finalizeOttoRun so the receipt can follow its language", async () => {
    mocks.run.mockResolvedValue(streamedRunResult({ events: [] }));
    mocks.finalizeOttoRun.mockResolvedValue({ status: "needs_approval", pendingCardIds: [], fallbackReply: null });

    const res = await POST(req({ projectId: "proj_stream", text: "全部生成" }));
    await res.json();

    expect(mocks.finalizeOttoRun).toHaveBeenCalledWith(expect.objectContaining({ userText: "全部生成" }));
  });

  it("persists and surfaces a first-turn insufficient-credits failure without running Otto", async () => {
    mocks.withLlmBudget.mockRejectedValue(new mocks.MockInsufficientCredits());

    const res = await POST(req({ projectId: "proj_stream", text: "Make a launch post" }));
    const parts = await res.json();

    expect(res.status).toBe(200);
    expect(parts).toContainEqual({
      type: "data-error",
      data: { kind: "insufficient_credits", text: "Not enough credits — this needs 1 credit. Top up in Billing." },
    });
    expect(mocks.withLlmBudget).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org_stream",
        refId: expect.stringMatching(/^otto-stream:/),
        paid: true,
      }),
      expect.any(Function),
    );
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.finalizeOttoRun).not.toHaveBeenCalled();
    expect(mocks.chatMessageCreate).toHaveBeenCalledTimes(2);
    expect(mocks.chatMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: "USER", kind: "TEXT", text: "Make a launch post" }),
      }),
    );
    expect(mocks.chatMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "AGENT",
          kind: "TURN_ERROR",
          text: "Not enough credits — this needs 1 credit. Top up in Billing.",
          payload: expect.objectContaining({
            kind: "stream_run_error",
            error: { kind: "insufficient_credits", text: "Not enough credits — this needs 1 credit. Top up in Billing." },
          }),
        }),
      }),
    );
  });

  it("keeps the existing-thread insufficient-credits response and persists the same durable failure", async () => {
    mocks.chatThreadFindFirst.mockResolvedValue({ projectId: "proj_stream", ottoState: null });
    mocks.withLlmBudget.mockRejectedValue(new mocks.MockInsufficientCredits());

    const res = await POST(req({
      projectId: "proj_stream",
      threadId: "thread_existing",
      text: "Try another post",
    }));
    const parts = await res.json();

    expect(parts).toContainEqual({
      type: "data-error",
      data: { kind: "insufficient_credits", text: "Not enough credits — this needs 1 credit. Top up in Billing." },
    });
    expect(mocks.chatThreadCreate).not.toHaveBeenCalled();
    expect(mocks.chatMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          threadId: "thread_existing",
          role: "AGENT",
          kind: "TURN_ERROR",
          text: "Not enough credits — this needs 1 credit. Top up in Billing.",
          payload: expect.objectContaining({
            kind: "stream_run_error",
            error: { kind: "insufficient_credits", text: "Not enough credits — this needs 1 credit. Top up in Billing." },
          }),
        }),
      }),
    );
  });

  // #791-7: "You're out of credits." was usually false — a turn HELD a fixed amount up front, so
  // a merchant with 3.9 who had spent nothing was told they had none, with their balance on
  // screen contradicting it. The refusal now carries the balance it was judged against.
  // #898 moved the door: the hold fits the balance, so 3.9 sends. Only below 1 credit refuses.
  it("names the merchant's REAL balance and the real minimum when the reserve refuses", async () => {
    mocks.withLlmBudget.mockRejectedValue(
      new mocks.MockInsufficientCredits(undefined, { requiredInternal: 10, balanceInternal: 8 }),
    );

    const parts = (await (await POST(req({ projectId: "proj_stream", text: "hi" }))).json()) as Array<{
      type: string;
      data?: { kind?: string; text?: string };
    }>;

    const error = parts.find((p) => p.type === "data-error");
    expect(error?.data?.text).toBe(
      "You have 0.8 credits — starting a message with Otto needs at least 1 credit. Top up in Billing.",
    );
    expect(error?.data?.text).not.toMatch(/out of credits/i);
  });

  it("keeps generic run failures durable with the same typed stream response", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.withLlmBudget.mockRejectedValue(new Error("provider detail must stay private"));

    const res = await POST(req({ projectId: "proj_stream", text: "Make a launch post" }));
    const parts = await res.json() as Array<{ type?: string; data?: { kind?: string; text?: string } }>;
    const streamedError = parts.find((part) => part.type === "data-error")?.data;

    expect(streamedError).toEqual({
      kind: "error",
      text: expect.stringMatching(/^Otto hit a snag — please try again\. Reference: OTTO-/),
    });
    expect(streamedError?.text).not.toContain("provider detail");
    expect(log).toHaveBeenCalledWith(
      "[otto/stream] run failed:",
      expect.objectContaining({ error: "Error | provider detail must stay private" }),
    );
    expect(mocks.chatMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "AGENT",
          kind: "TURN_ERROR",
          text: streamedError?.text,
          payload: expect.objectContaining({
            kind: "stream_run_error",
            error: streamedError,
          }),
        }),
      }),
    );
    log.mockRestore();
  });

  // 走查修复三(#3310,截图 09、13-15):我们这边的 Anthropic 账户余额不足 → 服务端拿到
  // status=400「Your credit balance is too low…」,商家却读到「please try again」并一直重试。
  // 上一条钉的是**瞬时**那一档(照旧 snag + Reference);这一条钉它的另一半:供应商侧
  // 不可恢复的那一档换诚实句、说清没收钱、把手仍在,而且不点名供应商。
  it("ENGINE-A4: 供应商侧不可恢复的失败说实话,而不是「再试一次」", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const body = JSON.stringify({
      type: "error",
      error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." },
    });
    const providerError = Object.assign(new Error("AI_APICallError: Invalid request"), {
      name: "AI_APICallError",
      statusCode: 400,
      responseBody: body,
    });
    mocks.run.mockRejectedValue(providerError);
    // 真实合约:fn 抛了、usageOnError 交回 null ⇒ 整笔退款 ⇒ 钩子响 ⇒ 原错误照抛。
    mocks.withLlmBudget.mockImplementation(
      async (args: { onRefundedFailure?: () => void }, fn: () => Promise<unknown>) => {
        try {
          return await fn();
        } catch (e) {
          args.onRefundedFailure?.();
          throw e;
        }
      },
    );

    const parts = (await (await POST(req({ projectId: "proj_stream", text: "Make a launch post" }))).json()) as Array<{
      type?: string;
      data?: { kind?: string; text?: string };
    }>;
    const streamedError = parts.find((part) => part.type === "data-error")?.data;

    expect(streamedError?.text).toMatch(
      /^Otto is unavailable right now on our side\. This turn wasn't charged\. Please try again later\. Reference: OTTO-/,
    );
    expect(streamedError?.text).not.toMatch(/hit a snag/i);
    expect(streamedError?.text).not.toMatch(/anthropic|credit balance/i);
    // #1224 判官 P2-2:句子改了,**类型也要改**。顶着 `error` 这个 kind 的话,渲染层照旧在
    // 这句「等一会儿再说」旁边长出一颗「Edit and retry」—— 一个按了必然再失败的死循环入口。
    // 上一条测试钉的是瞬时那一档仍是 `error`,所以「一律改成新 kind」也会当场红。
    expect(streamedError?.kind).toBe("provider_unavailable");
    // 刷新之后还得是同一句、同一个类型 —— 落盘的那条 TURN_ERROR 与流上这一条逐字相同。
    expect(mocks.chatMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "TURN_ERROR",
          text: streamedError?.text,
          payload: expect.objectContaining({ error: streamedError }),
        }),
      }),
    );
    log.mockRestore();
  });
});

/**
 * #464 B1 acceptance for this route — see `principal-frame-b1.test.ts` for the other seamed
 * sites and the shared rationale.
 *
 * This route is the one site whose frame has to survive PAST the handler's own return: the
 * pre-stream validation runs inside `runAsUser`, but the paid turn itself runs inside the SSE
 * `execute` callback, which is still writing after the Response object exists. Both halves are
 * asserted here. The SDK-side reason the second half works — `ai` invoking `execute` during
 * `createUIMessageStream` construction — is pinned separately, against the REAL SDK, in
 * `otto-stream-frame-liveness.test.ts`; this file mocks `ai`, so it can only observe the
 * consequence, never the cause.
 */
describe("POST /api/otto/stream — #464 B1 ambient user frame", () => {
  it("carries the user frame through pre-stream validation AND into the SSE turn", async () => {
    const seen: Record<string, Principal | undefined> = {};
    mocks.projectFindFirst.mockImplementation(async () => {
      seen.preStream = getPrincipal();
      return { id: "proj_stream" };
    });
    mocks.finalizeOttoRun.mockImplementation(async () => {
      // Deepest point of the turn: this runs inside `execute`, after the route already returned
      // its Response, and it is the step that persists the run.
      seen.insideSseTurn = getPrincipal();
      return { status: "completed" };
    });
    mocks.run.mockResolvedValue(streamedRunResult({ events: [tokenEvent("Done")] }));

    const res = await POST(req({ projectId: "proj_stream", text: "Make a launch post" }));
    await res.json();

    for (const [where, principal] of Object.entries(seen)) {
      expect(principal, `ambient principal missing at ${where}`).toBeDefined();
      // Explicit kind check: a `runAsTenant` stand-in also carries `ownerId`, and it is exactly
      // the frame that has lost the actor.
      expect(principal!.kind, `frame at ${where} is not a user frame`).toBe("user");
      expect(principal).toMatchObject({
        kind: "user",
        ownerId: "org_stream",
        subjectEmail: "owner@example.com",
      });
    }
    expect(Object.keys(seen).sort()).toEqual(["insideSseTurn", "preStream"]);
    // The handler's own context is clean once it has returned — `store.run` popped with it.
    expect(getPrincipal()).toBeUndefined();
  });

  it("opens no frame when the gate denies", async () => {
    mocks.requireOwner.mockResolvedValue({ error: "Sign in required." });
    mocks.projectFindFirst.mockImplementation(async () => {
      throw new Error("must not be reached");
    });

    const res = await POST(req({ projectId: "proj_stream", text: "Make a launch post" }));

    expect(res.status).toBe(401);
    expect(mocks.projectFindFirst).not.toHaveBeenCalled();
  });
});

describe("POST /api/otto/stream — #555 per-turn cost is visible", () => {
  it("streams the SETTLED cost of the turn (not the hold) after the run finishes", async () => {
    mocks.run.mockResolvedValue(streamedRunResult({ events: [tokenEvent("Done")] }));

    const res = await POST(req({ projectId: "proj_stream", text: "What should I post?" }));
    const parts = await res.json();

    expect(mocks.creditLedgerFindMany).toHaveBeenCalledWith({
      where: { orgId: "org_stream", refId: expect.stringMatching(/^otto-stream:/) },
      select: { kind: true, balanceDelta: true },
    });
    expect(parts).toEqual(
      expect.arrayContaining([{ type: "data-cost", data: { credits: 3.3 } }]),
    );
  });

  it("says nothing when the turn was not charged (free/mock turn or a refunded failure)", async () => {
    mocks.run.mockResolvedValue(streamedRunResult({ events: [tokenEvent("Done")] }));
    mocks.creditLedgerFindMany.mockResolvedValue([
      { kind: "RESERVE", balanceDelta: -120 },
      { kind: "REFUND", balanceDelta: 120 },
    ]);

    const parts = await (await POST(req({ projectId: "proj_stream", text: "hi" }))).json();

    expect(parts.some((p: { type: string }) => p.type === "data-cost")).toBe(false);
  });

  it("never fabricates a number, and never breaks the turn, when the ledger read fails", async () => {
    mocks.run.mockResolvedValue(streamedRunResult({ events: [tokenEvent("Done")] }));
    mocks.creditLedgerFindMany.mockRejectedValue(new Error("db down"));

    const res = await POST(req({ projectId: "proj_stream", text: "hi" }));
    const parts = await res.json();

    expect(res.status).toBe(200);
    expect(parts.some((p: { type: string }) => p.type === "data-cost")).toBe(false);
    expect(parts.some((p: { type: string; data?: { kind?: string } }) => p.data?.kind === "done")).toBe(true);
  });

  // Round-1 review P2: a tangled run still burns tokens, and withLlmBudget settles them.
  // The merchant paid, so the degrade must carry the same cost line as a normal turn.
  it("shows the cost of a MaxTurns turn — it was charged like any other", async () => {
    mocks.run.mockRejectedValue(new MaxTurnsExceededError("too many turns"));
    mocks.chatMessageFindFirst.mockResolvedValue({ seq: 3 });

    const parts = await (await POST(req({ projectId: "proj_stream", text: "go round in circles" }))).json();

    expect(parts).toEqual(expect.arrayContaining([{ type: "data-cost", data: { credits: 3.3 } }]));
    expect(parts.some((p: { data?: { kind?: string } }) => p.data?.kind === "degraded")).toBe(true);
  });

  // ENGINE-A4(规格 docs/specs/otto-engine.md §7.2⑤ 第③刀)—— 入口诚实文案。
  //
  // 上一条钉的是「交付了就照收」;这一条钉的是它的另一半:整笔退了的那一轮,商家读到的那句话
  // 必须自己说出「没收钱」,而且**不许**再挂一条 data-cost。判定来自 withLlmBudget 的
  // onRefundedFailure 钩子(引擎侧的零交付判词已经在 packages/otto/src/runtime.test.ts 钉过),
  // 这里替身照真实合约触发它。
  it("ENGINE-A4: 截断且整笔退款的一轮,降级句自己说「没收钱」,而且不报花费", async () => {
    mocks.run.mockRejectedValue(new MaxTurnsExceededError("too many turns"));
    mocks.chatMessageFindFirst.mockResolvedValue({ seq: 3 });
    // 真实合约:fn 抛了、usageOnError 交回 null ⇒ 整笔退款 ⇒ 钩子响 ⇒ 原错误照抛。
    mocks.withLlmBudget.mockImplementation(
      async (args: { onRefundedFailure?: () => void }, fn: () => Promise<unknown>) => {
        try {
          return await fn();
        } catch (e) {
          args.onRefundedFailure?.();
          throw e;
        }
      },
    );

    const parts = await (await POST(req({ projectId: "proj_stream", text: "go round in circles" }))).json();

    expect(mocks.chatMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ text: "I got a bit tangled up — try asking again. This turn wasn't charged." }),
      }),
    );
    expect(parts).toEqual(
      expect.arrayContaining([
        { type: "data-status", data: { kind: "degraded", text: "I got a bit tangled up — try asking again. This turn wasn't charged." } },
      ]),
    );
    // 净变 0 的一轮没有花费可报 —— 报一个数就是在说一件没发生的事。
    expect(parts.some((p: { type: string }) => p.type === "data-cost")).toBe(false);
  });

  it("charges nothing and says nothing when the reserve itself failed", async () => {
    mocks.run.mockRejectedValue(new mocks.MockInsufficientCredits());
    mocks.creditLedgerFindMany.mockResolvedValue([]);

    const parts = await (await POST(req({ projectId: "proj_stream", text: "hi" }))).json();

    expect(parts.some((p: { type: string }) => p.type === "data-cost")).toBe(false);
    expect(parts.some((p: { data?: { kind?: string } }) => p.data?.kind === "insufficient_credits")).toBe(true);
  });

  it("reports a real charge on a failed run that still settled usage", async () => {
    mocks.run.mockRejectedValue(new Error("provider exploded"));

    const parts = await (await POST(req({ projectId: "proj_stream", text: "hi" }))).json();

    expect(parts).toEqual(expect.arrayContaining([{ type: "data-cost", data: { credits: 3.3 } }]));
    expect(parts.some((p: { data?: { kind?: string } }) => p.data?.kind === "error")).toBe(true);
  });

  // Round-2 review P1③: a hold is not a cost. If the settle/refund transaction itself fails,
  // the run throws with a bare RESERVE still on the ledger — quoting it would show the
  // merchant the worst-case turn budget as if they had been charged it.
  it("shows NOTHING when only an outstanding hold exists — a reserve is not a charge", async () => {
    mocks.run.mockRejectedValue(new Error("settle transaction failed"));
    mocks.creditLedgerFindMany.mockResolvedValue([{ kind: "RESERVE", balanceDelta: -120 }]);

    const parts = await (await POST(req({ projectId: "proj_stream", text: "hi" }))).json();

    expect(parts.some((p: { type: string }) => p.type === "data-cost")).toBe(false);
    expect(parts.some((p: { data?: { kind?: string } }) => p.data?.kind === "error")).toBe(true);
  });

  it("shows nothing on a completed turn whose hold has not been finalized yet", async () => {
    mocks.run.mockResolvedValue(streamedRunResult({ events: [tokenEvent("Done")] }));
    mocks.creditLedgerFindMany.mockResolvedValue([{ kind: "RESERVE", balanceDelta: -120 }]);

    const parts = await (await POST(req({ projectId: "proj_stream", text: "hi" }))).json();

    expect(parts.some((p: { type: string }) => p.type === "data-cost")).toBe(false);
    expect(parts.some((p: { data?: { kind?: string } }) => p.data?.kind === "done")).toBe(true);
  });
});

// ── #879 step 1: Otto foundation schema pinning — page-context pins ─────────
//
// Client can declare POSITION (surface/subjectRef/outletId); it can never declare IDENTITY
// (actorId/visibility) — there is no field for those, and the shared zod schema is `.strict()`,
// so a client that tries rejects the WHOLE request rather than having the extra keys silently
// dropped.
describe("POST /api/otto/stream — #879 step 1 page-context pins", () => {
  it("writes surface/subjectRef/outletId onto the new USER message when the caller sends them", async () => {
    mocks.run.mockResolvedValue(streamedRunResult({ events: [] }));

    const res = await POST(req({
      projectId: "proj_stream",
      text: "Make a launch post",
      surface: "campaign",
      subjectRef: "campaign_123",
      outletId: "outlet_abc",
    }));

    expect(res.status).toBe(200);
    expect(mocks.chatMessageCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        role: "USER",
        surface: "campaign",
        subjectRef: "campaign_123",
        outletId: "outlet_abc",
      }),
    }));
  });

  it("leaves surface/subjectRef/outletId NULL on the new USER message when the caller omits them", async () => {
    mocks.run.mockResolvedValue(streamedRunResult({ events: [] }));

    const res = await POST(req({ projectId: "proj_stream", text: "Make a launch post" }));

    expect(res.status).toBe(200);
    expect(mocks.chatMessageCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        role: "USER",
        surface: null,
        subjectRef: null,
        outletId: null,
      }),
    }));
  });

  // Security boundary: actorId/visibility are identity columns with no client-facing field.
  // The shared request schema is `.strict()`, so sending them rejects parsing entirely — the
  // request never reaches persistence, and no thread/message is created at all.
  it("rejects the whole request (and persists nothing) if the caller sends actorId", async () => {
    const res = await POST(req({
      projectId: "proj_stream",
      text: "Make a launch post",
      actorId: "user_someone_else",
    }));

    expect(res.status).toBe(400);
    expect(mocks.chatThreadCreate).not.toHaveBeenCalled();
    expect(mocks.chatMessageCreate).not.toHaveBeenCalled();
  });

  it("rejects the whole request (and persists nothing) if the caller sends visibility", async () => {
    const res = await POST(req({
      projectId: "proj_stream",
      text: "Make a launch post",
      visibility: "private",
    }));

    expect(res.status).toBe(400);
    expect(mocks.chatThreadCreate).not.toHaveBeenCalled();
    expect(mocks.chatMessageCreate).not.toHaveBeenCalled();
  });
});

// ── #791-6 白标铁律:流式那一条也拦得住 ────────────────────────────────────
//
// 只洗持久化的那一份是不够的:商家会亲眼看着引擎名一个字一个字流进来,然后刷新
// 一下它消失了 —— 那比不洗更糟。这里把模型的原始 token 流灌进真的路由,断言写出去
// 的每一个 text-delta 都不含供应商名,并且拼起来正是洗过的那句话。
describe("#791-6 供应商名不会流到商家眼前", () => {
  beforeEach(() => {
    mocks.finalizeOttoRun.mockResolvedValue({ status: "ok" });
  });

  it("名字被模型切成多个 token 吐出来,也拼不回原样", async () => {
    // "Seedance 2.0" 被拆成四个 delta —— 逐块洗名会漏掉的那种切法。
    mocks.run.mockResolvedValue(
      streamedRunResult({
        events: [
          tokenEvent("Made with See"),
          tokenEvent("dance 2.0"),
          tokenEvent(" — want a 9:16 crop?"),
        ],
      }),
    );

    const parts = (await (await POST(req({ projectId: "proj_stream", text: "make it" }))).json()) as Array<{
      type: string;
      delta?: string;
    }>;

    const streamedText = parts
      .filter((p) => p.type === "text-delta")
      .map((p) => p.delta ?? "")
      .join("");

    expect(streamedText.toLowerCase()).not.toContain("seedance");
    expect(streamedText).toContain("generation provider");
    // 尾巴要放出来 —— 过滤器不能吃掉最后一段。
    expect(streamedText).toContain("want a 9:16 crop?");
  });

  it("没有秘密的回复逐字节原样流出", async () => {
    mocks.run.mockResolvedValue(
      streamedRunResult({ events: [tokenEvent("Two options — "), tokenEvent("warm daylight, or night market?")] }),
    );

    const parts = (await (await POST(req({ projectId: "proj_stream", text: "ideas" }))).json()) as Array<{
      type: string;
      delta?: string;
    }>;
    const streamedText = parts.filter((p) => p.type === "text-delta").map((p) => p.delta ?? "").join("");

    expect(streamedText).toBe("Two options — warm daylight, or night market?");
  });

  // ── #810 P1-2 ────────────────────────────────────────────────────────────
  // 白标只装在正文那条路上。可是 "Otto's thinking" 是**商家点开就能读**的
  // (components/otto/parts/ReasoningPart.tsx),模型的 reasoning 原文以
  // reasoning-delta 原样写出去 —— 提示词里那条「不许指名」一旦失守,这条路上
  // 一个机器防线都没有。reasoning 和正文是两条独立字节流,必须各持一个独立的
  // 过滤器实例:共用一个会把两段文字搅进同一个尾缓冲。
  const deltasOf = (parts: Array<{ type: string; delta?: string }>, type: string) =>
    parts.filter((p) => p.type === type).map((p) => p.delta ?? "").join("");

  it("商家能读的 Otto's thinking 也过洗名 —— 名字跨块出现照样拦得住", async () => {
    mocks.run.mockResolvedValue(
      streamedRunResult({
        events: [
          reasoningEvent("The shop wants a clip. I'll use See"),
          reasoningEvent("dance 2.0 for this one, then crop it 9:16."),
          tokenEvent("On it — a 9:16 clip coming up."),
        ],
      }),
    );

    const parts = (await (await POST(req({ projectId: "proj_stream", text: "make a clip" }))).json()) as Array<{
      type: string;
      delta?: string;
    }>;

    const reasoning = deltasOf(parts, "reasoning-delta");
    expect(reasoning.toLowerCase()).not.toContain("seedance");
    expect(reasoning).toContain("generation provider");
    // 尾巴必须放出来 —— 过滤器不能吃掉最后一段。
    expect(reasoning).toContain("crop it 9:16.");
    // 正文那条路不受影响。
    expect(deltasOf(parts, "text-delta")).toBe("On it — a 9:16 clip coming up.");
  });

  it("两条流各持一个过滤器:正文的尾缓冲不会串进 thinking 里", async () => {
    mocks.run.mockResolvedValue(
      streamedRunResult({
        events: [
          tokenEvent("Made with See"),
          reasoningEvent("checking the brief"),
          tokenEvent("dream 4.5."),
        ],
      }),
    );

    const parts = (await (await POST(req({ projectId: "proj_stream", text: "go" }))).json()) as Array<{
      type: string;
      delta?: string;
    }>;

    // 正文两块拼起来是 "Made with Seedream 4.5." —— 名字跨块,必须洗掉。
    const text = deltasOf(parts, "text-delta");
    expect(text.toLowerCase()).not.toContain("seedream");
    expect(text).toContain("generation provider");
    // 而 thinking 只包含它自己那句话,没有被正文的缓冲污染。
    expect(deltasOf(parts, "reasoning-delta")).toBe("checking the brief");
  });

  it("没有秘密的 thinking 逐字节原样流出", async () => {
    mocks.run.mockResolvedValue(
      streamedRunResult({
        events: [reasoningEvent("They asked for two options. "), reasoningEvent("Warm daylight and night market.")],
      }),
    );

    const parts = (await (await POST(req({ projectId: "proj_stream", text: "ideas" }))).json()) as Array<{
      type: string;
      delta?: string;
    }>;

    expect(deltasOf(parts, "reasoning-delta")).toBe(
      "They asked for two options. Warm daylight and night market.",
    );
  });
});

// ── 对话闸接在这扇门上,而且拒绝的那一次什么都不做 ──────────────────────────────────────
//
// 额度管得住一轮**能花多少**(冻结那一步管的),管不住一个卡死的客户端能**起多少轮** ——
// 每一轮都是一次真的模型调用。闸本身的数字在 rate-limit-gates.test.ts;这里钉的是**这条路
// 真的问过它**,以及被拒时一行都没写、模型一次都没跑 —— 一次被拒的请求必须是零成本的。
describe("POST /api/otto/stream — the conversation gate (Founder 2026-08-18)", () => {
  it("asks the gate for THIS tenant before anything is written", async () => {
    await POST(req({ projectId: "proj_stream", text: "hello" }));
    expect(mocks.consumeOttoTurnGate).toHaveBeenCalledWith("org_stream");
  });

  it("a refused turn answers 429 with the shared sentence, and runs and persists nothing", async () => {
    mocks.consumeOttoTurnGate.mockResolvedValue(false);

    const res = await POST(req({ projectId: "proj_stream", text: "hello" }));

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: OTTO_TURN_RATE_LIMIT_MESSAGE });
    // Nothing ran, nothing was persisted, and no money path was entered.
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.withLlmBudget).not.toHaveBeenCalled();
    expect(mocks.chatMessageCreate).not.toHaveBeenCalled();
    expect(mocks.chatThreadCreate).not.toHaveBeenCalled();
  });

  it("never mentions credits in the refusal — nothing was reserved and nothing was charged", async () => {
    mocks.consumeOttoTurnGate.mockResolvedValue(false);
    const body = (await (await POST(req({ projectId: "proj_stream", text: "hi" }))).json()) as { error: string };
    expect(body.error).not.toMatch(/credit/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ENGINE-A6 —— 流式路由这一门的接线(判官落修 A6-P1-2)
//
// 上一轮这一门只有代码接线、零测试:删掉 `rollingSummary: rollingSummaryPort,`、或把
// `buildContextSystemMessage(ctx, priorRollingSummary)` 改回单参数,两次独立变异都全绿 ——
// 「历史照裁、摘要不折叠也不回注」的纯失忆状态没有任何东西挡着。这三条把那一段跑起来。
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/otto/stream — ENGINE-A6 长对话预算闸", () => {
  /** 一段稳稳超过 12,000 token 预算的历史(user/assistant 交替,与真线程同形)。 */
  const bigHistory = Array.from({ length: 12 }, (_, i) => ({
    role: i % 2 ? "assistant" : "user",
    content: `t${i} ${"h".repeat(6_000)}`,
  }));

  const mainTurnCall = () => mocks.run.mock.calls.find((c) => (c[0] as { name?: string })?.name === "Otto");
  const foldCall = () => mocks.run.mock.calls.find((c) => (c[0] as { name?: string })?.name === "Otto rolling summary");

  beforeEach(() => {
    mocks.chatThreadFindFirst.mockResolvedValue({
      projectId: "proj_stream",
      ottoState: '{"prior":"state"}',
      rollingSummary: "older notes: merchant sells kopi",
    });
    mocks.tryRestoreRunState.mockResolvedValue({ history: [...bigHistory] });
    mocks.buildContextSystemMessage.mockImplementation((_ctx: unknown, summary?: string | null) =>
      ({ role: "system", content: `brand${summary ? `\n${summary}` : ""}` }));
    // 折叠那一次调用要真的产出文字,否则引擎按「摘要为空」处理、什么都不写。
    mocks.run.mockImplementation(async (agent: { name?: string }) => {
      if (agent?.name === "Otto rolling summary") {
        return { finalOutput: "folded notes", state: { usage: { inputTokens: 5, outputTokens: 5 } } };
      }
      return streamedRunResult({ events: [tokenEvent("Done")] });
    });
  });

  it("ENGINE-A6: 超预算的历史被裁到预算以内才进 run(),裁掉的旧轮交给折叠端口", async () => {
    const res = await POST(req({ projectId: "proj_stream", threadId: "thread_long", text: "Next question" }));
    expect(res.status).toBe(200);

    const input = mainTurnCall()![1] as unknown[];
    expect(input.length).toBeLessThan(bigHistory.length + 2);
    expect(estimateHistoryTokens(input.slice(1, -1) as never[])).toBeLessThanOrEqual(OTTO_HISTORY_BUDGET_TOKENS);
    expect(foldCall()).toBeTruthy();
  });

  it("ENGINE-A6: 折叠好的摘要交给唯一那个写入口,带本对话与已认证的 ownerId", async () => {
    await POST(req({ projectId: "proj_stream", threadId: "thread_long", text: "Next question" }));

    expect(mocks.saveRollingSummary).toHaveBeenCalledWith("thread_long", "org_stream", "folded notes");
  });

  it("ENGINE-A6: 线程已有的摘要逐字回注在这一轮的 system 消息里", async () => {
    await POST(req({ projectId: "proj_stream", threadId: "thread_long", text: "Next question" }));

    expect(mocks.buildContextSystemMessage).toHaveBeenCalledWith(
      expect.anything(),
      "older notes: merchant sells kopi",
    );
    const sys = (mainTurnCall()![1] as { role?: string; content?: string }[])[0]!;
    expect(sys.role).toBe("system");
    expect(sys.content).toContain("older notes: merchant sells kopi");
  });

  // ENGINE-A7 × ENGINE-A6(判官 2026-09-05 P1):裁剪之后装载集不许缩水 —— 被折走的上下文里
  // 点名过的事,标签仍然对得上。变异实证:把 route 里的
  // `if (dropped.length > 0 || priorRollingSummary)` 改回 `if (dropped.length > 0)`,
  // 或把引擎里的 `instructionsForTurn(request.input, request.rollingSummary)` 改回单参数,
  // 这一条当场红。
  it("ENGINE-A7: 被折进摘要的话题,这一轮仍然把对应的柜文装进说明书", async () => {
    mocks.chatThreadFindFirst.mockResolvedValue({
      projectId: "proj_stream",
      ottoState: '{"prior":"state"}',
      rollingSummary: "merchant asked for a facebook advert; targeting agreed",
    });
    // 这一轮什么都没裁掉(短历史),被折走的话题只活在摘要里。
    mocks.tryRestoreRunState.mockResolvedValue({ history: [{ role: "user", content: "ok" }] });

    await POST(req({ projectId: "proj_stream", threadId: "thread_long", text: "carry on then" }));

    const instructions = (mainTurnCall()![0] as { instructions: string }).instructions;
    expect(instructions).toContain("`meta-list-objects`");
  });

  // ENGINE-A7(判官第二轮 P2-1):`tryRestoreRunState` 回 null 的那一轮 —— F24 的坏状态、或者
  // 线程根本没存过状态 —— 此前走的是 else 分支,一个端口都不传,于是**只在摘要里点过名**的
  // 那几份柜文当场掉出装载集。摘要还好端端地回注在 system 消息上,Otto 却丢了对应的规矩。
  // 变异实证:把 route 那个 else 分支里新加的端口构造删掉,这一条当场红。
  it("ENGINE-A7: 状态恢复不回来的一轮,摘要点名的柜文仍然装进说明书", async () => {
    mocks.chatThreadFindFirst.mockResolvedValue({
      projectId: "proj_stream",
      ottoState: '{"corrupt":',
      rollingSummary: "merchant asked for a facebook advert; targeting agreed",
    });
    mocks.tryRestoreRunState.mockResolvedValue(null);

    await POST(req({ projectId: "proj_stream", threadId: "thread_long", text: "carry on then" }));

    const instructions = (mainTurnCall()![0] as { instructions: string }).instructions;
    expect(instructions).toContain("`meta-list-objects`");
    // 钱路与折叠一个字没动:没裁掉任何东西 ⇒ 零折叠调用、零落盘。
    expect(foldCall()).toBeUndefined();
    expect(mocks.saveRollingSummary).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// FRONT-A10 —— 这条路由(聊天输入框实际走的那一条)把类型化引用写进 ChatMessage
// ---------------------------------------------------------------------------
/**
 * 判官第二轮 P1-1:C2 写的那一半有两条落库路,`ottoTurn` 那条上一轮补了围栏,**这一条**没有
 * —— 删掉 `referenceRefs: picked.wire,` 全仓 7630 条照旧全绿。画布与侧栏的输入框走的正是这条
 * 流式路由,所以「这条消息提到了谁」在生产上到底有没有落库,此前没有任何一条测试说得出来。
 *
 * 这里不打桩 `@/lib/reference-refs`:真正跑的是它,只有 Prisma 是替身 —— 否则围栏钉的是替身的
 * 返回值,而不是那一行有没有被写进去。
 */
describe("FRONT-A10 —— 流式落库路把类型化引用写进 ChatMessage", () => {
  const PRODUCT_ID = "ent_stream_product";
  const GENERATION_ID = "gen_stream_one";
  const UPLOAD_ASSET_ID = "ast_stream_one";
  const THREE_TYPES = [`product:${PRODUCT_ID}`, `generation:${GENERATION_ID}`, `upload:${UPLOAD_ASSET_ID}`];

  /** org_stream 自己的三行:一件实体、一件生成、一件上传。 */
  function ownRowsResolve() {
    mocks.entityFindMany.mockResolvedValue([
      { id: PRODUCT_ID, name: "Kopi cendol tin", type: "PRODUCT", catalogKey: null },
    ]);
    mocks.generationFindMany.mockResolvedValue([
      {
        id: GENERATION_ID, assetId: "ast_gen", source: "GENERATED",
        promptText: "Cendol hero shot", projectId: "proj_stream",
        project: { name: "Raya launch" }, asset: { originalFilename: "out.png" },
      },
      {
        id: "gen_from_upload", assetId: UPLOAD_ASSET_ID, source: "UPLOAD",
        promptText: "", projectId: "proj_stream",
        project: { name: "Raya launch" }, asset: { originalFilename: "cendol-shelf.png" },
      },
    ]);
  }

  function persistedUserMessage() {
    return mocks.chatMessageCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> } | undefined;
  }

  it("FRONT-A10 三型引用一起发 ⇒ ChatMessage 那一列落的就是服务端解析过的类型化 ID", async () => {
    ownRowsResolve();
    mocks.run.mockResolvedValue(streamedRunResult({ events: [tokenEvent("Done")] }));

    const res = await POST(req({
      projectId: "proj_stream",
      text: "@Kopi cendol tin like this shot",
      references: THREE_TYPES,
    }));

    expect(res.status).toBe(200);
    const created = persistedUserMessage();
    // 逐字相等,不是「包含」:少写一型、写成裸 id、或整格没写,这一条当场红。
    expect(created?.data.referenceRefs).toEqual(THREE_TYPES);
    // `payload.entityIds`(生成条件)是另一条路,不因为这一格而改样。
    expect((created?.data.payload as { entityIds?: unknown }).entityIds).toEqual([]);
  });

  it("FRONT-A10 一件都没 @ 的一轮,那一列是空表而不是缺了那一格", async () => {
    mocks.run.mockResolvedValue(streamedRunResult({ events: [tokenEvent("Done")] }));

    await POST(req({ projectId: "proj_stream", text: "just talk to me" }));

    expect(persistedUserMessage()?.data.referenceRefs).toEqual([]);
    // 一个 id 都没有 ⇒ 连库都不问。
    expect(mocks.entityFindMany).not.toHaveBeenCalled();
    expect(mocks.generationFindMany).not.toHaveBeenCalled();
  });

  it("FRONT-A10 别家的 id 混进来 ⇒ 整轮不发:不落消息、不建对话、不进 Otto、不预扣", async () => {
    // 解析器按 owner 查,什么都查不到 —— 别家的 id 与自己删掉的在这里长得一模一样。
    mocks.entityFindMany.mockResolvedValue([]);
    mocks.generationFindMany.mockResolvedValue([]);

    const res = await POST(req({
      projectId: "proj_stream",
      text: "@someone else's tin",
      references: ["product:ent_other_shop"],
    }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: referenceUnavailableMessage("notFound") });
    expect(mocks.chatMessageCreate).not.toHaveBeenCalled();
    expect(mocks.chatThreadCreate).not.toHaveBeenCalled();
    expect(mocks.withLlmBudget).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("FRONT-A10 `@` 得比一轮能带的还多 ⇒ 读到的是那一格自己的那句话,不是通用那一句", async () => {
    const tooMany = Array.from({ length: MAX_TURN_REFERENCES + 1 }, (_, i) => `product:ent_${i}`);

    const res = await POST(req({ projectId: "proj_stream", text: "make me a poster", references: tooMany }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: TOO_MANY_REFERENCES_SENTENCE });
    // 通用那一句会把商家指向他已经写好了的正文 —— 判官 P2-2 点的就是这个。
    expect(TOO_MANY_REFERENCES_SENTENCE).not.toBe(TURN_REQUEST_GENERIC_REFUSAL);
    expect(mocks.chatMessageCreate).not.toHaveBeenCalled();
  });

  it("FRONT-A10 正文空着的一轮仍然读到通用那一句(改了引用那一格,别的口径不许跟着变)", async () => {
    const res = await POST(req({ projectId: "proj_stream", text: "" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: TURN_REQUEST_GENERIC_REFUSAL });
  });
});
