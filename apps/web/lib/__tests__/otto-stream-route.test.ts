import { describe, expect, it, vi, beforeEach } from "vitest";
import { getPrincipal, type Principal } from "@fikirtive/db/principal";

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
    validateOttoTurnReferences: vi.fn(),
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

vi.mock("@/lib/auth-guard", async () => ({ requireOwner: mocks.requireOwner, resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: mocks.isImpersonating }));
vi.mock("@/lib/otto-actions", () => ({
  buildOttoContext: mocks.buildOttoContext,
  buildContextSystemMessage: mocks.buildContextSystemMessage,
  finalizeOttoRun: mocks.finalizeOttoRun,
  validateOttoTurnReferences: mocks.validateOttoTurnReferences,
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

  it("persists and surfaces a first-turn insufficient-credits failure without running Otto", async () => {
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
          text: "You're out of credits.",
          payload: expect.objectContaining({
            kind: "stream_run_error",
            error: { kind: "insufficient_credits", text: "You're out of credits." },
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
      data: { kind: "insufficient_credits", text: "You're out of credits." },
    });
    expect(mocks.chatThreadCreate).not.toHaveBeenCalled();
    expect(mocks.chatMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          threadId: "thread_existing",
          role: "AGENT",
          kind: "TURN_ERROR",
          text: "You're out of credits.",
          payload: expect.objectContaining({
            kind: "stream_run_error",
            error: { kind: "insufficient_credits", text: "You're out of credits." },
          }),
        }),
      }),
    );
  });

  it("keeps generic run failures durable with the same typed stream response", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.withLlmBudget.mockRejectedValue(new Error("provider detail must stay private"));

    const res = await POST(req({ projectId: "proj_stream", text: "Make a launch post" }));
    const parts = await res.json() as Array<{ type?: string; data?: { kind?: string; text?: string } }>;
    const streamedError = parts.find((part) => part.type === "data-error")?.data;

    expect(streamedError).toEqual({
      kind: "error",
      text: expect.stringMatching(/^Otto hit a snag - please try again\. Reference: OTTO-/),
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
