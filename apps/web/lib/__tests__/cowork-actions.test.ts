import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  chatMessageFindFirst: vi.fn(),
  chatMessageUpdate: vi.fn(),
  genJobFindFirst: vi.fn(),
  startCoworkGen: vi.fn(),
  resolveDisabledModels: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../gen-actions", () => ({ startCoworkGen: mocks.startCoworkGen }));
vi.mock("../model-registry", () => ({ resolveDisabledModels: mocks.resolveDisabledModels }));
vi.mock("../cowork-knowledge", () => ({ getEnhanceDirective: vi.fn() }));
vi.mock("@fikirtive/otto", () => ({ familyHasPromptSkill: () => true }));
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
  mocks.resolveDisabledModels.mockResolvedValue(new Set());
  mocks.startCoworkGen.mockResolvedValue({ id: "job-1", disposition: "fresh" });
  mocks.chatMessageUpdate.mockResolvedValue({});
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
});
