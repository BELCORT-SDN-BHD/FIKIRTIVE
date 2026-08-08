import { describe, expect, it, vi, beforeEach } from "vitest";
import { getPrincipal, type Principal } from "@fikirtive/db/principal";

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
    creditLedger: { findMany: mocks.creditLedgerFindMany },
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

// The route decides "this was a MaxTurns degrade" with `instanceof MaxTurnsExceededError`,
// so the test throws the REAL class the runtime is wired with — a look-alike would take the
// generic-error branch and silently prove nothing.
const { MaxTurnsExceededError } = await import("@fikirtive/otto");
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
      data: { kind: "insufficient_credits", text: "Not enough credits — this needs 4 credits. Top up in Billing." },
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
          text: "Not enough credits — this needs 4 credits. Top up in Billing.",
          payload: expect.objectContaining({
            kind: "stream_run_error",
            error: { kind: "insufficient_credits", text: "Not enough credits — this needs 4 credits. Top up in Billing." },
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
      data: { kind: "insufficient_credits", text: "Not enough credits — this needs 4 credits. Top up in Billing." },
    });
    expect(mocks.chatThreadCreate).not.toHaveBeenCalled();
    expect(mocks.chatMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          threadId: "thread_existing",
          role: "AGENT",
          kind: "TURN_ERROR",
          text: "Not enough credits — this needs 4 credits. Top up in Billing.",
          payload: expect.objectContaining({
            kind: "stream_run_error",
            error: { kind: "insufficient_credits", text: "Not enough credits — this needs 4 credits. Top up in Billing." },
          }),
        }),
      }),
    );
  });

  // #791-7: "You're out of credits." was usually false — a turn HOLDS 4 credits up front, so a
  // merchant with 3.9 who had spent nothing was told they had none, with their balance on
  // screen contradicting it. The refusal now carries the balance it was judged against.
  it("names the merchant's REAL balance and the real hold when the reserve refuses", async () => {
    mocks.withLlmBudget.mockRejectedValue(
      new mocks.MockInsufficientCredits(undefined, { requiredInternal: 40, balanceInternal: 39 }),
    );

    const parts = (await (await POST(req({ projectId: "proj_stream", text: "hi" }))).json()) as Array<{
      type: string;
      data?: { kind?: string; text?: string };
    }>;

    const error = parts.find((p) => p.type === "data-error");
    expect(error?.data?.text).toBe(
      "You have 3.9 credits — starting a message with Otto holds 4 credits first. Top up in Billing.",
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
