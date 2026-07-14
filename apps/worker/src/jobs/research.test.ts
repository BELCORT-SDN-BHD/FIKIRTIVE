/**
 * research.test.ts — TDD for handleResearch (S3 Task 2, the MONEY CORE).
 *
 * MONEY invariants asserted here (an adversarial review hammers each):
 *  - CAS QUEUED→RUNNING: when the row is not QUEUED (redelivery/duplicate), count===0 → the
 *    handler is a NO-OP (no run, no withLlmBudget, no report) — the primary double-reserve guard.
 *  - Happy path: withLlmBudget is called EXACTLY once with refId=`research:<cardId>` and
 *    maxSteps=tier.maxSteps; a RESEARCH_REPORT is written; card→done; job→DONE.
 *  - withLlmBudget throws → card→failed + job→FAILED + NO report + NO manual credit call.
 *  - $ assertions: reserveCredits/settleCredits/refundReservation are NEVER called directly —
 *    withLlmBudget is the sole spend path.
 *  - owner-scoping: every card/job read+write carries ownerId.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const researchJobFindUnique = vi.fn();
  const researchJobUpdateMany = vi.fn();
  const chatMessageFindFirst = vi.fn();
  const chatMessageCreate = vi.fn();
  const chatMessageUpdateMany = vi.fn();

  const prisma = {
    researchJob: { findUnique: researchJobFindUnique, updateMany: researchJobUpdateMany },
    chatMessage: {
      findFirst: chatMessageFindFirst,
      create: chatMessageCreate,
      updateMany: chatMessageUpdateMany,
    },
  };

  // Direct-credit spies — these must NEVER be called by handleResearch.
  const reserveCredits = vi.fn();
  const settleCredits = vi.fn();
  const refundReservation = vi.fn();

  const newId = vi.fn(() => `msg-${Math.random().toString(36).slice(2)}`);

  // withLlmBudget mock — by default calls fn and returns its result.result (like the real wrapper).
  const withLlmBudget = vi.fn(async (_args: unknown, fn: () => Promise<{ result: unknown; usage?: unknown }>) => {
    const out = await fn();
    return out.result;
  });

  const run = vi.fn();
  const mapOttoUsage = vi.fn(() => ({ inputTokens: 100, outputTokens: 50 }));
  class MaxTurnsExceededError extends Error {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    state?: any;
    constructor(msg = "max turns") { super(msg); this.name = "MaxTurnsExceededError"; }
  }
  const researchAgent = { name: "Researcher" };

  const RESEARCH_TIERS = {
    quick: { label: "Quick", maxSearches: 5, maxPages: 8, maxSteps: 6, estimatedCredits: 10 },
    standard: { label: "Standard", maxSearches: 12, maxPages: 20, maxSteps: 12, estimatedCredits: 25 },
    deep: { label: "Deep", maxSearches: 25, maxPages: 40, maxSteps: 24, estimatedCredits: 60 },
  };

  return {
    prisma, reserveCredits, settleCredits, refundReservation, newId,
    withLlmBudget, run, mapOttoUsage, MaxTurnsExceededError, researchAgent, RESEARCH_TIERS,
    researchJobFindUnique, researchJobUpdateMany, chatMessageFindFirst, chatMessageCreate, chatMessageUpdateMany,
  };
});

vi.mock("@fikirtive/db", () => ({
  prisma: mocks.prisma,
  reserveCredits: mocks.reserveCredits,
  settleCredits: mocks.settleCredits,
  refundReservation: mocks.refundReservation,
}));

vi.mock("@fikirtive/otto", () => ({
  RESEARCH_TIERS: mocks.RESEARCH_TIERS,
  researchAgent: mocks.researchAgent,
  withLlmBudget: mocks.withLlmBudget,
  ottoModelRuntime: { billableModelId: "claude-sonnet-4-6" },
  run: mocks.run,
  MaxTurnsExceededError: mocks.MaxTurnsExceededError,
  mapOttoUsage: mocks.mapOttoUsage,
}));

vi.mock("@fikirtive/core", () => ({
  newId: mocks.newId,
  fetchAndExtract: vi.fn(async (url: string) => ({ url, title: "t", text: "body" })),
  tavilySearch: vi.fn(() => async () => []),
  braveSearch: vi.fn(() => async () => []),
  searchWithFallback: vi.fn(() => async () => []),
}));

import { handleResearch } from "./research.js";

const JOB = {
  id: "job-1",
  ownerId: "owner-1",
  threadId: "thread-1",
  cardId: "card-1",
  tier: "standard",
  status: "QUEUED",
};

const CARD_PAYLOAD = {
  researchId: "r-1",
  topic: "EV market",
  goal: "understand pricing",
  tier: "standard",
  questions: ["who leads?"],
  estimatedCredits: 25,
  status: "running",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeRunResult(text = "# Report\nFindings…"): any {
  return { finalOutput: text, newItems: [], state: { usage: { inputTokens: 100, outputTokens: 50 } } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.researchJobFindUnique.mockResolvedValue({ ...JOB });
  mocks.researchJobUpdateMany.mockResolvedValue({ count: 1 }); // CAS wins by default
  mocks.chatMessageFindFirst.mockImplementation(async (args: { where?: { kind?: string } }) => {
    // card reads return the payload; the seq read returns a seq
    if (args?.where?.kind === "RESEARCH_CARD") return { payload: { ...CARD_PAYLOAD } };
    return { seq: 7 };
  });
  mocks.chatMessageCreate.mockResolvedValue({});
  mocks.chatMessageUpdateMany.mockResolvedValue({ count: 1 });
  mocks.run.mockResolvedValue(makeRunResult());
  mocks.withLlmBudget.mockImplementation(async (_args: unknown, fn: () => Promise<{ result: unknown; usage?: unknown }>) => {
    const out = await fn();
    return out.result;
  });
});

describe("handleResearch — CAS retry idempotency", () => {
  it("is a NO-OP when the status CAS finds count 0 (redelivery/duplicate): no run, no spend, no report", async () => {
    mocks.researchJobUpdateMany.mockResolvedValueOnce({ count: 0 }); // CAS loses
    await handleResearch({ jobId: "job-1" }, 0);
    expect(mocks.withLlmBudget).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.chatMessageCreate).not.toHaveBeenCalled();
  });

  it("returns immediately when the job is not found", async () => {
    mocks.researchJobFindUnique.mockResolvedValueOnce(null);
    await handleResearch({ jobId: "nope" }, 0);
    expect(mocks.researchJobUpdateMany).not.toHaveBeenCalled();
    expect(mocks.withLlmBudget).not.toHaveBeenCalled();
  });

  it("CAS updates ONLY the QUEUED row (money-critical where clause)", async () => {
    await handleResearch({ jobId: "job-1" }, 0);
    expect(mocks.researchJobUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "job-1", status: "QUEUED" }, data: { status: "RUNNING" } }),
    );
  });
});

describe("handleResearch — happy path", () => {
  it("calls withLlmBudget EXACTLY once with refId=research:<cardId> + maxSteps=tier.maxSteps", async () => {
    await handleResearch({ jobId: "job-1" }, 0);
    expect(mocks.withLlmBudget).toHaveBeenCalledTimes(1);
    const args = mocks.withLlmBudget.mock.calls[0]![0] as { refId: string; maxSteps: number; orgId: string; paid: boolean; model: string };
    expect(args.refId).toBe("research:card-1");
    expect(args.maxSteps).toBe(mocks.RESEARCH_TIERS.standard.maxSteps);
    expect(args.orgId).toBe("owner-1");
    expect(args.paid).toBe(true);
    // Contract matrix (WO-OTTO-PHASE1 现状锁定): research meters against the SAME production
    // billable model id — the constant's source moves to the atomic model-runtime manifest.
    expect(args.model).toBe("claude-sonnet-4-6");
  });

  it("runs the researchAgent with maxTurns=tier.maxSteps", async () => {
    await handleResearch({ jobId: "job-1" }, 0);
    expect(mocks.run).toHaveBeenCalledTimes(1);
    const [agent, , opts] = mocks.run.mock.calls[0]!;
    expect(agent).toBe(mocks.researchAgent);
    expect((opts as { maxTurns: number }).maxTurns).toBe(mocks.RESEARCH_TIERS.standard.maxSteps);
  });

  it("writes a RESEARCH_REPORT (owner/thread from job, seq+1, synthesis+sources payload)", async () => {
    await handleResearch({ jobId: "job-1" }, 0);
    expect(mocks.chatMessageCreate).toHaveBeenCalledTimes(1);
    const data = mocks.chatMessageCreate.mock.calls[0]![0].data;
    expect(data.kind).toBe("RESEARCH_REPORT");
    expect(data.ownerId).toBe("owner-1");
    expect(data.threadId).toBe("thread-1");
    expect(data.seq).toBe(8); // last seq 7 + 1
    expect(data.payload.topic).toBe("EV market");
    expect(data.payload.synthesis).toBe("# Report\nFindings…");
    expect(Array.isArray(data.payload.sources)).toBe(true);
  });

  it("flips the card → done and the job → DONE (both owner-scoped)", async () => {
    await handleResearch({ jobId: "job-1" }, 0);
    const cardDone = mocks.chatMessageUpdateMany.mock.calls.find(
      (c) => (c[0].data.payload as { status?: string })?.status === "done",
    );
    expect(cardDone).toBeTruthy();
    expect(cardDone![0].where).toEqual(expect.objectContaining({ id: "card-1", ownerId: "owner-1", kind: "RESEARCH_CARD" }));

    const jobDone = mocks.researchJobUpdateMany.mock.calls.find((c) => c[0].data.status === "DONE");
    expect(jobDone).toBeTruthy();
    expect(jobDone![0].where).toEqual(expect.objectContaining({ id: "job-1", ownerId: "owner-1" }));
  });

  it("$ ASSERTION: never calls reserveCredits/settleCredits/refundReservation directly", async () => {
    await handleResearch({ jobId: "job-1" }, 0);
    expect(mocks.reserveCredits).not.toHaveBeenCalled();
    expect(mocks.settleCredits).not.toHaveBeenCalled();
    expect(mocks.refundReservation).not.toHaveBeenCalled();
  });
});

describe("handleResearch — withLlmBudget throws (insufficient balance / provider / etc.)", () => {
  beforeEach(() => {
    mocks.withLlmBudget.mockRejectedValue(new Error("InsufficientCredits"));
  });

  it("marks the card → failed and the job → FAILED, writes NO report", async () => {
    await handleResearch({ jobId: "job-1" }, 0);
    // no RESEARCH_REPORT created
    expect(mocks.chatMessageCreate).not.toHaveBeenCalled();
    // card → failed
    const cardFailed = mocks.chatMessageUpdateMany.mock.calls.find(
      (c) => (c[0].data.payload as { status?: string })?.status === "failed",
    );
    expect(cardFailed).toBeTruthy();
    // job → FAILED (owner-scoped)
    const jobFailed = mocks.researchJobUpdateMany.mock.calls.find((c) => c[0].data.status === "FAILED");
    expect(jobFailed).toBeTruthy();
    expect(jobFailed![0].where).toEqual(expect.objectContaining({ id: "job-1", ownerId: "owner-1" }));
  });

  it("$ ASSERTION: does NOT touch credits in the failure path (withLlmBudget already refunded)", async () => {
    await handleResearch({ jobId: "job-1" }, 0);
    expect(mocks.reserveCredits).not.toHaveBeenCalled();
    expect(mocks.settleCredits).not.toHaveBeenCalled();
    expect(mocks.refundReservation).not.toHaveBeenCalled();
  });
});

describe("handleResearch — persisted error sanitization", () => {
  const signedUrl = "https://r2.example/u/o1/asset.png?X-Amz-Credential=abc&X-Amz-Signature=secret";

  it("scrubs a URL-bearing withLlmBudget error before persisting to the card + job", async () => {
    mocks.withLlmBudget.mockRejectedValue(new Error(`fetch failed: ${signedUrl}`));
    await handleResearch({ jobId: "job-1" }, 0);

    const cardFailed = mocks.chatMessageUpdateMany.mock.calls.find(
      (c) => (c[0].data.payload as { status?: string })?.status === "failed",
    );
    expect(cardFailed).toBeTruthy();
    const cardError = (cardFailed![0].data.payload as { error?: string }).error;
    expect(cardError).toContain("<redacted-url>");
    expect(cardError).not.toContain("X-Amz-Signature");

    const jobFailed = mocks.researchJobUpdateMany.mock.calls.find((c) => c[0].data.status === "FAILED");
    expect(jobFailed).toBeTruthy();
    expect(jobFailed![0].data.error).toContain("<redacted-url>");
    expect(jobFailed![0].data.error).not.toContain("X-Amz-Signature");
  });

  it("keeps the friendly MaxTurnsExceededError text as-is (fixed string, not a leak source)", async () => {
    mocks.withLlmBudget.mockRejectedValue(new mocks.MaxTurnsExceededError(`step budget hit: ${signedUrl}`));
    await handleResearch({ jobId: "job-1" }, 0);

    const jobFailed = mocks.researchJobUpdateMany.mock.calls.find((c) => c[0].data.status === "FAILED");
    expect(jobFailed).toBeTruthy();
    expect(jobFailed![0].data.error).toBe("The research hit its step budget before finishing.");
  });
});

describe("handleResearch — MaxTurnsExceeded (graceful truncation) is handled by usageOnError", () => {
  it("passes a usageOnError that yields actual usage for a MaxTurnsExceededError carrying state.usage", async () => {
    await handleResearch({ jobId: "job-1" }, 0);
    const args = mocks.withLlmBudget.mock.calls[0]![0] as { usageOnError: (e: unknown) => unknown };
    const err = new mocks.MaxTurnsExceededError();
    err.state = { usage: { inputTokens: 42, outputTokens: 9 } };
    // usageOnError maps the carried usage (non-null) → settle actual, never over-reserve.
    expect(args.usageOnError(err)).not.toBeNull();
    // A non-max-turns error → null (whole reservation refunded).
    expect(args.usageOnError(new Error("other"))).toBeNull();
  });
});
