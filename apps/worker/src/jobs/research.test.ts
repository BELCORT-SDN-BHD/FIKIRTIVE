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

  // 钱路 M1-c:搜索按 Founder 2026-07-03 裁的 3× 计价。这里刻意用**真实的费率算法**
  // (每次搜索 3 internal credits)而不是一个任意占位数 —— 占位数会让下面的金额断言
  // 只是在核对夹具自己,而这条腿的全部意义就是「搜索真的被收了钱」。
  const SEARCH_UNIT_INTERNAL = 3;
  const searchChargeInternal = vi.fn((n: number) =>
    Number.isInteger(n) && n > 0 ? n * SEARCH_UNIT_INTERNAL : 0,
  );
  const researchTierSearchBudgetInternal = vi.fn((maxSearches: number) => searchChargeInternal(maxSearches));

  return {
    prisma, reserveCredits, settleCredits, refundReservation, newId,
    withLlmBudget, run, mapOttoUsage, MaxTurnsExceededError, researchAgent, RESEARCH_TIERS,
    researchJobFindUnique, researchJobUpdateMany, chatMessageFindFirst, chatMessageCreate, chatMessageUpdateMany,
    searchChargeInternal, researchTierSearchBudgetInternal, SEARCH_UNIT_INTERNAL,
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
  researchTierSearchBudgetInternal: mocks.researchTierSearchBudgetInternal,
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
  searchChargeInternal: mocks.searchChargeInternal,
  // #791-6: sanitizeError (redact.ts) now reaches the shared provider-name scrubber in core.
  // Real behaviour, not a stub — a mocked-away redaction would let this suite pass while a
  // provider name reached a persisted error.
  redactProviderNames: (s: string) => s.replace(/\bbyteplus\b/gi, "generation provider"),
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
  // 钱路 M1-b:真 withLlmBudget 会在**结算那一笔事务里**回调 `commitInSettleTx`(交付),所以
  // 这个替身也必须回调它 —— 否则替身与它替代的东西签的不是同一份合同,这一整套用例会在生产
  // 早已交付的路径上断言「什么都没写」。事务由 prisma 替身自己充当(它的 $transaction 就是
  // 直接把自己交给回调)。
  mocks.withLlmBudget.mockImplementation(async (args: unknown, fn: () => Promise<{ result: unknown; usage?: unknown }>) => {
    const out = await fn();
    const commit = (args as { commitInSettleTx?: (tx: unknown) => Promise<void> } | null)?.commitInSettleTx;
    if (commit) await commit(mocks.prisma);
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

  // ── 钱路 M1-c(裁决 9b):搜索这条腿真的被持有、也真的被结算 ──────────────────
  // 以前 searchSources 标着 FREE,而 free 的真正含义是**没人计价**:每一次深研都在替
  // 商家买搜索,账上一分没记。下面两条钉住的正是「现在记了」。
  it("hold 含搜索 worst case = 这一档的 maxSearches × 单次费率", async () => {
    await handleResearch({ jobId: "job-1" }, 0);
    const args = mocks.withLlmBudget.mock.calls[0]![0] as { extraHoldInternal?: number };
    expect(args.extraHoldInternal).toBe(mocks.RESEARCH_TIERS.standard.maxSearches * mocks.SEARCH_UNIT_INTERNAL);
    // 持有额来自档位自己的上限,不是一个手抄的数 —— 换档就跟着换。
    expect(mocks.researchTierSearchBudgetInternal).toHaveBeenCalledWith(
      mocks.RESEARCH_TIERS.standard.maxSearches,
    );
  });

  it("settle 按**实际搜了几次**收,不是按上限收", async () => {
    // 让 agent 在跑的过程中真的用掉 3 次搜索预算(ctx.searchesUsed 是 worker 自己维护的计数器)。
    mocks.run.mockImplementationOnce(async (_agent: unknown, _input: unknown, opts: { context: { searchesUsed: number } }) => {
      opts.context.searchesUsed = 3;
      return { finalOutput: "report", state: { usage: {} } };
    });
    await handleResearch({ jobId: "job-1" }, 0);
    const args = mocks.withLlmBudget.mock.calls[0]![0] as { extraSettleInternal?: () => number };
    expect(typeof args.extraSettleInternal).toBe("function");
    // 3 次 × 3 internal = 9,而不是上限的 12 × 3 = 36。
    expect(args.extraSettleInternal!()).toBe(3 * mocks.SEARCH_UNIT_INTERNAL);
    // 一次没搜就一分不收。
    expect(mocks.searchChargeInternal).toHaveBeenCalled();
  });

  // ── MONEY-A10 / #1046-P2:无 key 时搜索端口**缺席**,不是一个恒返回 [] 的假端口 ──────
  //
  // 旧形状 `buildSearch()` 在无 key 时返回 `async () => []`:agent 调一次「搜索」,没有任何
  // 外部调用发生,却拿到一个成功的空结果 —— 它以为自己搜过了(于是不去说「这条没能核实」),
  // 计数器照样 +1,一次成功的深研因此多结算 3 个 internal credits。
  it("MONEY-A10:没有配置任何搜索 key ⇒ ctx.search === undefined(诚实报不可用,$0)", async () => {
    const prevTavily = process.env.TAVILY_API_KEY;
    const prevBrave = process.env.BRAVE_SEARCH_API_KEY;
    delete process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;
    try {
      await handleResearch({ jobId: "job-1" }, 0);
      const [, , opts] = mocks.run.mock.calls[0]!;
      expect((opts as { context: { search?: unknown } }).context.search).toBeUndefined();
    } finally {
      if (prevTavily !== undefined) process.env.TAVILY_API_KEY = prevTavily;
      if (prevBrave !== undefined) process.env.BRAVE_SEARCH_API_KEY = prevBrave;
    }
  });

  it("MONEY-A10:配置了 key ⇒ ctx.search 是一个真端口", async () => {
    const prev = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = "tvly-test";
    try {
      await handleResearch({ jobId: "job-1" }, 0);
      const [, , opts] = mocks.run.mock.calls[0]!;
      expect(typeof (opts as { context: { search?: unknown } }).context.search).toBe("function");
    } finally {
      if (prev === undefined) delete process.env.TAVILY_API_KEY;
      else process.env.TAVILY_API_KEY = prev;
    }
  });

  it("MONEY-A10:上限判 searchesTaken(占槽),计费按 searchesUsed(成功数)—— 两个计数器都从 0 起", async () => {
    await handleResearch({ jobId: "job-1" }, 0);
    const [, , opts] = mocks.run.mock.calls[0]!;
    const ctx = (opts as { context: { searchesTaken: number; searchesUsed: number; maxSearches: number } }).context;
    expect(ctx.searchesTaken).toBe(0);
    expect(ctx.searchesUsed).toBe(0);
    expect(ctx.maxSearches).toBe(mocks.RESEARCH_TIERS.standard.maxSearches);
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
