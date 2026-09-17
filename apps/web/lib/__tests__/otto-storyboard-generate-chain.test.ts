/**
 * otto-storyboard-generate-chain.test.ts —— FC-1 的**接线**那一半。
 *
 * 现场(Founder 自己的画布,staging 14bcd038,2026-09-14):两镜分镜之后商家说「直接做」,
 * Otto 答「这就生成」,却把 **STORYBOARD_CARD 的编号**交给了只认 GEN_CARD 的 `generate`。
 * 批准项因此指着一张**永远变不成确认卡**的东西:`pendingCardIds` 里躺着一个分镜卡编号,
 * 对话里只留下那句承诺,画布当前轮的灯是 `Ready`,而后台零 GEN_CARD、零 GenJob。
 * 取证:docs/audits/founder-canvas-2026-09-14/{report.md,pending-generate-diagnosis.md}。
 *
 * 中断项的替身形状由 packages/otto/src/skills/generate-storyboard-card.test.ts 用**真 SDK**
 * 钉住(那里跑的是真 runtime + 真 generateSkill);这里跑的是真 `finalizeOttoRun` + 真
 * `canvasTurnStatus`,把「批准项 → 界面」这一段接线钉下来。
 *
 * 钱路一格不动:整份文件 `startGen` 零调用。
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
  mockOrganizationFindUnique,
  MockInsufficientCredits,
  MockSpendCapBlocked,
  mockPrepareStoryboardVideos,
} = vi.hoisted(() => {
  class MockInsufficientCredits extends Error {
    readonly requiredInternal: number | null = null;
    readonly balanceInternal: number | null = null;
    constructor(message = "Not enough credits.") {
      super(message);
      this.name = "InsufficientCredits";
    }
  }
  class MockSpendCapBlocked extends Error {
    readonly requiredInternal = 0;
    readonly capInternal: number | null = null;
    constructor() {
      super("Spend cap reached.");
      this.name = "SpendCapBlocked";
    }
  }
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
    mockOrganizationFindUnique: vi.fn(),
    MockInsufficientCredits,
    MockSpendCapBlocked,
    mockPrepareStoryboardVideos: vi.fn(),
  };
});

vi.mock("@/lib/auth-guard", async () => ({
  requireOwner: mockRequireOwner,
  resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: () => Promise.resolve(false), auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/model-registry", () => ({ resolveDisabledModels: mockResolveDisabledModels }));
vi.mock("@/lib/gen-actions", () => ({ startGen: mockStartGen, startCoworkGen: mockStartGen }));
vi.mock("@/lib/memory-actions", () => ({ getBrandContextText: mockGetBrandContextText }));
// 共享动作层:Otto 端口只是它的一层薄封装 —— 这里替身掉它,断言「转调的是同一条人工路径」。
vi.mock("@/lib/storyboard-gate1-actions", () => ({ prepareStoryboardVideos: mockPrepareStoryboardVideos }));

vi.mock("@fikirtive/db", () => ({
  prisma: {
    chatThread: { findFirst: mockChatThreadFindFirst, update: mockChatThreadUpdate, updateMany: mockChatThreadUpdateMany },
    chatMessage: {
      findFirst: mockChatMessageFindFirst,
      findMany: mockChatMessageFindMany,
      create: mockChatMessageCreate,
      updateMany: mockChatMessageUpdateMany,
    },
    genJob: { findFirst: mockGenJobFindFirst },
    project: { findFirst: async () => null },
    entity: { findMany: mockEntityFindMany },
    generation: { findFirst: mockGenerationFindFirst, findMany: mockGenerationFindMany },
    scheduledPost: { findFirst: mockScheduledPostFindFirst },
    actionEvent: { create: mockActionEventCreate },
    $transaction: mockTransaction,
    $executeRaw: mockExecuteRaw,
    organization: { findUnique: mockOrganizationFindUnique },
  },
  InsufficientCredits: MockInsufficientCredits,
  SpendCapBlocked: MockSpendCapBlocked,
  finalizedReservations: async () => new Set<string>(),
  otherHoldsSince: async () => "none" as const,
}));

const { finalizeOttoRun, strandedApprovalText, approvalPointerText } = await import("@/lib/otto-actions");
const { canvasTurnStatus } = await import("@/lib/otto-canvas-turn");
const { makeOttoStoryboardPort } = await import("@/lib/otto-storyboard-port");

// ── Fixtures ─────────────────────────────────────────────────────────────────
const OWNER_ID = "owner_fc1";
const THREAD_ID = "thread_dad82159";
const STORYBOARD_CARD_ID = "01M2F7DPAH7VZQYX722SCWK9JX";
const GEN_CARD_ID = "01M2F7GOODCARD0000000000";
const PROMISE_TEXT = "Sorry! Let me call up the generate cards for both shots now.";

/** 真 SDK 停在批准项时交给接线层的形状(跨包契约,见文件头)。 */
function generateInterruption(cardId: string) {
  return { rawItem: { name: "generate", arguments: JSON.stringify({ cardId }) }, type: "tool_approval_item" };
}

class FakeRunState {
  toString() {
    return '{"fc1":"state"}';
  }
}

function runResult(cardId: string, text: string | undefined = PROMISE_TEXT) {
  return { state: new FakeRunState(), interruptions: [generateInterruption(cardId)], finalOutput: text, newItems: [] };
}

/** 落库的 AGENT TEXT —— 按写入顺序。 */
function persistedTexts(): string[] {
  return mockChatMessageCreate.mock.calls
    .map((c) => (c[0] as { data?: { kind?: string; text?: string } }).data)
    .filter((d): d is { kind: string; text: string } => d?.kind === "TEXT" && typeof d.text === "string")
    .map((d) => d.text);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockChatMessageFindFirst.mockResolvedValue({ seq: 46 });
  mockChatThreadUpdateMany.mockResolvedValue({ count: 1 });
  mockChatMessageCreate.mockResolvedValue({});
  // 默认:那个编号在库里是一张 STORYBOARD_CARD(现场就是这样 —— 最后一张 GEN_CARD 停在 seq35)。
  mockChatMessageFindMany.mockResolvedValue([{ id: STORYBOARD_CARD_ID, kind: "STORYBOARD_CARD" }]);
});

describe("FC-1 复现:分镜卡编号被当成待确认的生成卡", () => {
  it("批准项指着 STORYBOARD_CARD ⇒ 不得报成待确认,也不得只留一句承诺", async () => {
    const out = await finalizeOttoRun({
      ownerId: OWNER_ID,
      threadId: THREAD_ID,
      isNew: false,
      priorOttoState: "s0",
      result: runResult(STORYBOARD_CARD_ID),
      seqAfterUser: 45,
    });

    // ① 现场症状:pendingCardIds 里躺着一个永远渲染不出确认卡的编号。
    expect(out).not.toEqual(
      expect.objectContaining({ status: "needs_approval", pendingCardIds: [STORYBOARD_CARD_ID] }),
    );
    // ② 现场症状:整轮只落了那句承诺。诚实句必须跟在它后面。
    const texts = persistedTexts();
    expect(texts[0]).toBe(PROMISE_TEXT);
    expect(texts.at(-1)).toBe(strandedApprovalText({ storyboard: true, lang: "en" }));
    // ③ 钱路零动作。
    expect(mockStartGen).not.toHaveBeenCalled();
  });

  it("现场症状:待确认卡为零时画布当前轮报 Ready —— 承诺不许停在绿灯上", async () => {
    const out = await finalizeOttoRun({
      ownerId: OWNER_ID,
      threadId: THREAD_ID,
      isNew: false,
      priorOttoState: "s0",
      result: runResult(STORYBOARD_CARD_ID),
      seqAfterUser: 45,
    });
    const pendingCardIds = "pendingCardIds" in out ? out.pendingCardIds : [];
    // 组件只把**真的 GEN_CARD**数进 pendingConfirmCount(OttoChatStream.tsx:1360/1377),
    // 分镜卡编号数不进去 —— 所以这一轮的灯是 Ready。
    const status = canvasTurnStatus({
      isBusy: false,
      hasAssistantText: true,
      liveStatus: pendingCardIds.length > 0 ? { kind: "needs_approval", pendingCardIds } : { kind: "done", threadId: THREAD_ID },
      steps: [],
      workingCardCount: 0,
      pendingConfirmCount: 0,
    });
    // 修好之后这一轮不再报「等你确认」,而屏幕上最后一句是诚实句,不是承诺。
    expect(status.label).not.toBe("Needs confirmation");
    expect(persistedTexts().at(-1)).toBe(strandedApprovalText({ storyboard: true, lang: "en" }));
  });

  /**
   * FC-1（复核修正 P1）—— 模型**一字未说**时的那一句补话，不得指着一张不存在的卡。
   *
   * #498 的“口头批准静默”那一类：商家说「just do it」、模型一句话也不说就把 `generate`
   * 停在了分镜卡编号上。补话从前按**原始批准项**算，于是落库的是两句互相打脸的话：
   * 先一句「请在上方卡片确认，我会马上开始」（指着一张永远不会出现的卡），再一句诚实话。
   * 直播只流后一句，刷新一次就看见前一句 —— 同一轮的两张嘴对不上。
   */
  it("模型一字未说 + 批准项指着分镜卡 ⇒ 只落那句诚实话，不再指一张不存在的卡", async () => {
    const out = await finalizeOttoRun({
      ownerId: OWNER_ID,
      threadId: THREAD_ID,
      isNew: false,
      priorOttoState: "s0",
      // 模型一字未说 —— 不走 `runResult` 的默认承诺语。
      result: { state: new FakeRunState(), interruptions: [generateInterruption(STORYBOARD_CARD_ID)], finalOutput: undefined, newItems: [] },
      seqAfterUser: 45,
    });

    expect(persistedTexts()).toEqual([strandedApprovalText({ storyboard: true, lang: "en" })]);
    expect(persistedTexts()).not.toContain(approvalPointerText({ cardCount: 1, allGenerate: true, lang: "en" }));
    expect(out).toEqual({
      status: "done",
      reply: strandedApprovalText({ storyboard: true, lang: "en" }),
      appendedReply: strandedApprovalText({ storyboard: true, lang: "en" }),
    });
    expect(mockStartGen).not.toHaveBeenCalled();
  });

  it("真的 GEN_CARD 照旧待确认 —— 这道闸只挡确认不了的那一类", async () => {
    mockChatMessageFindMany.mockResolvedValue([{ id: GEN_CARD_ID, kind: "GEN_CARD" }]);
    const out = await finalizeOttoRun({
      ownerId: OWNER_ID,
      threadId: THREAD_ID,
      isNew: false,
      priorOttoState: "s0",
      result: runResult(GEN_CARD_ID, "Here's the card — confirm when you're ready."),
      seqAfterUser: 45,
    });

    expect(out).toEqual({ status: "needs_approval", pendingCardIds: [GEN_CARD_ID], fallbackReply: null });
    expect(persistedTexts()).toEqual(["Here's the card — confirm when you're ready."]);
    expect(mockStartGen).not.toHaveBeenCalled();
  });
});

describe("FC-1 修复:Otto 走的是人工那条分镜 → 子卡链", () => {
  it("端口把 prepareVideos 转调给共享动作层,并端回真实报价", async () => {
    mockPrepareStoryboardVideos.mockResolvedValue({
      children: [
        { shotId: "shot-1", childCardId: "child-1", estimatedCredits: 22, structuredPrompt: "a", entityIds: [], quoteVersion: "v1", spent: false },
        { shotId: "shot-2", childCardId: "child-2", estimatedCredits: 11, structuredPrompt: "b", entityIds: [], quoteVersion: "v2", spent: false },
      ],
      totalCredits: 33,
    });

    const port = makeOttoStoryboardPort();
    const out = await port.prepareVideos(STORYBOARD_CARD_ID);

    expect(mockPrepareStoryboardVideos).toHaveBeenCalledWith({ cardId: STORYBOARD_CARD_ID });
    expect(out).toEqual({
      shots: [
        { shotId: "shot-1", childCardId: "child-1", estimatedCredits: 22, spent: false },
        { shotId: "shot-2", childCardId: "child-2", estimatedCredits: 11, spent: false },
      ],
      totalCredits: 33,
    });
    // $0:准备只是铸卡,钱路一格不动。
    expect(mockStartGen).not.toHaveBeenCalled();
  });

  it("共享动作层拒绝时原样端回那句话,不自造第二套说法", async () => {
    mockPrepareStoryboardVideos.mockResolvedValue({ error: "Card not found." });
    const port = makeOttoStoryboardPort();
    expect(await port.prepareVideos(STORYBOARD_CARD_ID)).toEqual({ error: "Card not found." });
  });
});
