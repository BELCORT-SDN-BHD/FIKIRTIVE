import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  class MockInsufficientCredits extends Error {
    constructor(message = "Not enough credits.") {
      super(message);
      this.name = "InsufficientCredits";
    }
  }

  const parts: unknown[] = [];

  return {
    parts,
    MockInsufficientCredits,
    requireOwner: vi.fn(),
    isImpersonating: vi.fn(),
    projectFindFirst: vi.fn(),
    chatThreadCreate: vi.fn(),
    chatThreadFindFirst: vi.fn(),
    chatThreadUpdateMany: vi.fn(),
    chatMessageCreate: vi.fn(),
    chatMessageFindFirst: vi.fn(),
    generationFindFirst: vi.fn(),
    genJobFindFirst: vi.fn(),
    entityFindMany: vi.fn(),
    memoryFindMany: vi.fn(),
    buildOttoContext: vi.fn(),
    buildContextSystemMessage: vi.fn(),
    finalizeOttoRun: vi.fn(),
    validateOwnedGenerationExt: vi.fn(),
    withLlmBudget: vi.fn(),
    run: vi.fn(),
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

vi.mock("@/lib/auth-guard", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: mocks.isImpersonating }));
vi.mock("@/lib/otto-actions", () => ({
  buildOttoContext: mocks.buildOttoContext,
  buildContextSystemMessage: mocks.buildContextSystemMessage,
  finalizeOttoRun: mocks.finalizeOttoRun,
}));
vi.mock("@/lib/otto-generation-validate", () => ({
  validateOwnedGenerationExt: mocks.validateOwnedGenerationExt,
}));
vi.mock("@fikirtive/db", () => ({
  InsufficientCredits: mocks.MockInsufficientCredits,
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
    generation: { findFirst: mocks.generationFindFirst },
    genJob: { findFirst: mocks.genJobFindFirst },
    entity: { findMany: mocks.entityFindMany },
    memory: { findMany: mocks.memoryFindMany },
  },
}));
vi.mock("@fikirtive/otto", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    otto: { name: "Otto" },
    withLlmBudget: mocks.withLlmBudget,
    run: mocks.run,
  };
});

const { POST } = await import("@/app/api/otto/stream/route");

function req(body: unknown) {
  return { json: async () => body } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.parts.length = 0;
  mocks.requireOwner.mockResolvedValue({ ownerId: "org_stream", email: "owner@example.com" });
  mocks.isImpersonating.mockResolvedValue(false);
  mocks.projectFindFirst.mockResolvedValue({ id: "proj_stream" });
  mocks.chatThreadCreate.mockResolvedValue({});
  mocks.chatMessageCreate.mockResolvedValue({});
  mocks.chatMessageFindFirst.mockResolvedValue(null);
  mocks.buildOttoContext.mockResolvedValue({
    orgId: "org_stream",
    userId: "org_stream",
    projectId: "proj_stream",
    threadId: "thread_stream",
    images: [],
    disabledModels: [],
  });
  mocks.buildContextSystemMessage.mockReturnValue(null);
});

describe("POST /api/otto/stream", () => {
  it("surfaces insufficient credits as a stream error without running Otto or persisting an AGENT message", async () => {
    mocks.withLlmBudget.mockRejectedValue(new mocks.MockInsufficientCredits());

    const res = await POST(req({ projectId: "proj_stream", text: "Make a launch post" }));
    const parts = await res.json();

    expect(res.status).toBe(200);
    expect(parts).toContainEqual({
      type: "data-error",
      data: { kind: "insufficient_credits", text: "You're out of credits." },
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
    expect(mocks.chatMessageCreate).toHaveBeenCalledTimes(1);
    expect(mocks.chatMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: "USER", kind: "TEXT", text: "Make a launch post" }),
      }),
    );
    expect(mocks.chatMessageCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: "AGENT" }),
      }),
    );
  });
});
