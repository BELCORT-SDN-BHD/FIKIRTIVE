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

function tokenEvent(delta: string) {
  return {
    type: "raw_model_stream_event" as const,
    data: { type: "output_text_delta", delta },
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
  mocks.finalizeOttoRun.mockResolvedValue({ status: "completed" });
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
