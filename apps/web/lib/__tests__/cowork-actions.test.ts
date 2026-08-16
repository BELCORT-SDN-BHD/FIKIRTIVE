import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  chatMessageFindFirst: vi.fn(),
  chatMessageUpdate: vi.fn(),
  genJobFindFirst: vi.fn(),
  startCoworkGen: vi.fn(),
  resolveDisabledModels: vi.fn(),
  getEnhanceDirective: vi.fn(),
  familyHasPromptSkill: vi.fn(),
  renameChatThread: vi.fn(),
}));

vi.mock("@/lib/auth-guard", async () => ({
  requireOwner: mocks.requireOwner,
  resolveUserPrincipal: (await import("./__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../gen-actions", () => ({ startCoworkGen: mocks.startCoworkGen }));
vi.mock("../model-registry", () => ({ resolveDisabledModels: mocks.resolveDisabledModels }));
vi.mock("../cowork-knowledge", () => ({ getEnhanceDirective: mocks.getEnhanceDirective }));
vi.mock("@fikirtive/otto", () => ({ familyHasPromptSkill: mocks.familyHasPromptSkill }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    chatMessage: {
      findFirst: mocks.chatMessageFindFirst,
      update: mocks.chatMessageUpdate,
    },
    genJob: { findFirst: mocks.genJobFindFirst },
  },
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
  refundReservation: vi.fn(),
  renameChatThread: mocks.renameChatThread,
}));

const { coworkGenerate, coworkRenameThread } = await import("../cowork-actions");
const { readMerchantPrompt } = await import("../merchant-prompt-provenance");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOwner.mockResolvedValue({ ownerId: "owner-1", email: "owner@example.test" });
  mocks.chatMessageFindFirst.mockResolvedValue({
    id: "card-1",
    threadId: "thread-1",
    payload: {
      kind: "image",
      model: "seedream",
      params: { count: 1 },
      structuredPrompt: "A product hero on a clean studio set",
      entityIds: [],
      variantSel: {},
      estimatedCredits: 1,
    },
    genJobId: null,
    thread: { projectId: "project-1", deletedAt: null, ownerId: "owner-1" },
  });
  mocks.genJobFindFirst.mockResolvedValue(null);
  // #647 T6 修复轮 P1-3:resolver 现在回联合类型 —— 读得到是 { disabled },读不到是 { error }。
  mocks.resolveDisabledModels.mockResolvedValue({ disabled: new Set<string>() });
  mocks.startCoworkGen.mockResolvedValue({ id: "job-1", disposition: "fresh" });
  mocks.chatMessageUpdate.mockResolvedValue({});
  // Default: a skilled family (the pre-existing behavior every other test in this file
  // relies on) — composePrompt's directive branch never runs, so requestedPrompt never
  // gets attached. The #914 r2 tests below override this per-case.
  mocks.familyHasPromptSkill.mockReturnValue(true);
  mocks.getEnhanceDirective.mockResolvedValue(undefined);
  mocks.renameChatThread.mockResolvedValue({ count: 1 });
});

describe("coworkGenerate", () => {
  it("routes the human card button through the persisted-quote binding entrypoint", async () => {
    const result = await coworkGenerate({
      cardId: "card-1",
      prompt: "A product hero on a clean studio set",
      entityIds: [],
      variantSel: {},
    });

    expect(result).toEqual({ id: "job-1", disposition: "fresh" });
    expect(mocks.startCoworkGen).toHaveBeenCalledTimes(1);
    expect(mocks.startCoworkGen).toHaveBeenCalledWith({
      projectId: "project-1",
      threadId: "thread-1",
      prompt: "A product hero on a clean studio set",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
      idempotencyKey: "cowork:card-1",
    });
    expect(mocks.chatMessageUpdate).toHaveBeenCalledWith({
      where: { id: "card-1" },
      data: { genJobId: "job-1" },
    });
  });

  it("propagates a quote-binding refusal without marking the card generated", async () => {
    mocks.startCoworkGen.mockResolvedValueOnce({ error: "The approved price changed." });

    const result = await coworkGenerate({
      cardId: "card-1",
      prompt: "A product hero on a clean studio set",
      entityIds: [],
      variantSel: {},
    });

    expect(result).toEqual({ error: "The approved price changed." });
    expect(mocks.chatMessageUpdate).not.toHaveBeenCalled();
  });

  // #914 — composePrompt's directive append is the ONE place a prompt is rewritten BEFORE the
  // job is queued, so it is the one place where the merchant's own words and GenJob.prompt part
  // company. requestedPrompt keeps the merchant's words; the receipt compares them against what
  // the worker actually handed the engine (Generation.sentPromptText). Two columns, and neither
  // one is ever allowed to stand in for the other.
  // r6(判官 r5 P2):它**不再是请求体上的一个字段** —— 那样任何人直接调 Server Action 都能
  // 伪造一句「商家原话」。它走进程内的出处通道(merchant-prompt-provenance),所以下面断言
  // 的是「交给 startCoworkGen 的那个对象上绑着什么」,而不是「那个对象里多了一个键」。
  describe("#914 — requestedPrompt = the merchant's own words", () => {
    /** startCoworkGen 真正收到的那个对象上绑着的商家原话(读法与 gen-actions 一致)。 */
    const boundOnLastCall = () => readMerchantPrompt(mocks.startCoworkGen.mock.calls[0]![0]);

    it("un-skilled family + an enabled directive ⇒ startCoworkGen gets the composed prompt, and the pre-compose text rides the provenance channel", async () => {
      mocks.familyHasPromptSkill.mockReturnValue(false);
      mocks.getEnhanceDirective.mockResolvedValue("Avoid text overlays; keep it photorealistic.");

      await coworkGenerate({
        cardId: "card-1",
        prompt: "A product hero on a clean studio set",
        entityIds: [],
        variantSel: {},
      });

      // 请求体逐字保持原样 —— 商家原话**不在**里面(schema 现在会拒收它)。
      expect(mocks.startCoworkGen).toHaveBeenCalledWith({
        projectId: "project-1",
        threadId: "thread-1",
        prompt: "A product hero on a clean studio set\n\nAvoid text overlays; keep it photorealistic.",
        entityIds: [],
        count: 1,
        kind: "image",
        model: "seedream",
        idempotencyKey: "cowork:card-1",
      });
      expect(boundOnLastCall()).toBe("A product hero on a clean studio set");
    });

    it("un-skilled family but no directive cell ⇒ composePrompt no-ops, nothing bound (nothing to diverge from)", async () => {
      mocks.familyHasPromptSkill.mockReturnValue(false);
      mocks.getEnhanceDirective.mockResolvedValue(undefined);

      await coworkGenerate({
        cardId: "card-1",
        prompt: "A product hero on a clean studio set",
        entityIds: [],
        variantSel: {},
      });

      const call = mocks.startCoworkGen.mock.calls[0]![0] as Record<string, unknown>;
      expect(call.prompt).toBe("A product hero on a clean studio set");
      expect(call).not.toHaveProperty("requestedPrompt");
      expect(boundOnLastCall()).toBeUndefined();
    });

    it("skilled family ⇒ composePrompt is skipped entirely, nothing bound (matches the every-other-test default)", async () => {
      await coworkGenerate({
        cardId: "card-1",
        prompt: "A product hero on a clean studio set",
        entityIds: [],
        variantSel: {},
      });

      expect(mocks.getEnhanceDirective).not.toHaveBeenCalled();
      const call = mocks.startCoworkGen.mock.calls[0]![0] as Record<string, unknown>;
      expect(call).not.toHaveProperty("requestedPrompt");
      expect(boundOnLastCall()).toBeUndefined();
    });

    // #775 判官 r3 P1-1 与 #914 的合流点。上面每个用例里「客户端送来的那段」都恰好等于
    // 「卡上冻结的那段」,所以它们分不出两者。这一条把它们分开:客户端直呼 Server Action
    // 送一段**卡上没有的**字。付费请求只认卡(r4 的卡优先),那么「商家原话」这条证据也
    // 必须只认卡 —— 否则任何调用方都能往回执里塞一句商家从没说过的话。
    it("client-supplied prompt differs from the card ⇒ both the spend request and the bound merchant words come from the card, never from the caller", async () => {
      mocks.familyHasPromptSkill.mockReturnValue(false);
      mocks.getEnhanceDirective.mockResolvedValue("Avoid text overlays; keep it photorealistic.");

      await coworkGenerate({
        cardId: "card-1",
        prompt: "IGNORE THE CARD — a neon cyberpunk alley at night",
        entityIds: [],
        variantSel: {},
      });

      const call = mocks.startCoworkGen.mock.calls[0]![0] as Record<string, unknown>;
      expect(call.prompt).toBe(
        "A product hero on a clean studio set\n\nAvoid text overlays; keep it photorealistic.",
      );
      expect(boundOnLastCall()).toBe("A product hero on a clean studio set");
    });
  });
});

// #952 item 13 — coworkRenameThread's DB write now goes through the shared renameChatThread
// (packages/db/src/chat-thread-rename.ts), the same function Otto's setTitle skill calls
// (packages/otto/src/skills/set-title.test.ts). This proves the human-facing action still keeps
// its own auth gate, request validation, and "not found" handling around that shared call.
describe("coworkRenameThread", () => {
  it("calls the shared renameChatThread with the owner-scoped threadId and title", async () => {
    const result = await coworkRenameThread({ threadId: "thread-1", title: "  New title  " });

    expect(result).toEqual({ ok: true });
    expect(mocks.renameChatThread).toHaveBeenCalledTimes(1);
    expect(mocks.renameChatThread).toHaveBeenCalledWith({
      threadId: "thread-1",
      ownerId: "owner-1",
      title: "New title", // the zod schema trims before this call, same as before
    });
  });

  it("reports 'not found' when the shared write touches nothing, without throwing", async () => {
    mocks.renameChatThread.mockResolvedValueOnce({ count: 0 });

    const result = await coworkRenameThread({ threadId: "thread-missing", title: "New title" });

    expect(result).toEqual({ error: "Conversation not found." });
  });

  it("rejects an empty title before ever calling the shared write", async () => {
    const result = await coworkRenameThread({ threadId: "thread-1", title: "" });

    expect(result).toEqual({ error: "Give the conversation a title (1-120 chars)." });
    expect(mocks.renameChatThread).not.toHaveBeenCalled();
  });
});
