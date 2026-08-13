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
}));

const { coworkGenerate } = await import("../cowork-actions");

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
  describe("#914 — requestedPrompt = the merchant's own words", () => {
    it("un-skilled family + an enabled directive ⇒ startCoworkGen gets the composed prompt AND requestedPrompt (the pre-compose text)", async () => {
      mocks.familyHasPromptSkill.mockReturnValue(false);
      mocks.getEnhanceDirective.mockResolvedValue("Avoid text overlays; keep it photorealistic.");

      await coworkGenerate({
        cardId: "card-1",
        prompt: "A product hero on a clean studio set",
        entityIds: [],
        variantSel: {},
      });

      expect(mocks.startCoworkGen).toHaveBeenCalledWith({
        projectId: "project-1",
        threadId: "thread-1",
        prompt: "A product hero on a clean studio set\n\nAvoid text overlays; keep it photorealistic.",
        requestedPrompt: "A product hero on a clean studio set",
        entityIds: [],
        count: 1,
        kind: "image",
        model: "seedream",
        idempotencyKey: "cowork:card-1",
      });
    });

    it("un-skilled family but no directive cell ⇒ composePrompt no-ops, no requestedPrompt attached (nothing to diverge from)", async () => {
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
    });

    it("skilled family ⇒ composePrompt is skipped entirely, no requestedPrompt attached (matches the every-other-test default)", async () => {
      await coworkGenerate({
        cardId: "card-1",
        prompt: "A product hero on a clean studio set",
        entityIds: [],
        variantSel: {},
      });

      expect(mocks.getEnhanceDirective).not.toHaveBeenCalled();
      const call = mocks.startCoworkGen.mock.calls[0]![0] as Record<string, unknown>;
      expect(call).not.toHaveProperty("requestedPrompt");
    });
  });
});
